package main

import (
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/ice/v4"
	"github.com/pion/interceptor"
	"github.com/pion/logging"
	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

const (
	// CS_SERVER_HOST is the configured host for all CS servers
	// In local development: "127.0.0.1"
	// In VPS deployment: your VPN or direct IP to CS servers
	CS_SERVER_HOST = "127.0.0.1"

	// Port range for allowed CS servers (security constraint)
	MIN_CS_PORT = 27000
	MAX_CS_PORT = 27030
)

var connections = NewFixedArray[io.Writer](128)

var (
	addr     = ":8080" // Changed to port 8080 for WebRTC
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	api *webrtc.API

	// lock for peerConnections and trackLocals
	listLock        sync.RWMutex
	peerConnections []*peerConnectionState
	trackLocals     map[string]*webrtc.TrackLocalStaticRTP

	logger = logging.NewDefaultLoggerFactory().NewLogger("sfu-ws")

	// Server management - replacing Python dependency
	serverManager *ServerManager

	// Metrics for monitoring
	packetsToUDP   int64
	packetsFromUDP int64
	metricsLock    sync.RWMutex
)

type websocketMessage struct {
	Event string          `json:"event"`
	Data  json.RawMessage `json:"data"`
}

type peerConnectionState struct {
	peerConnection *webrtc.PeerConnection
	websocket      *threadSafeWriter
	signalsCount   int
}

// getEnvOrDefault returns environment variable value or default
func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

const DefaultSignalsCount = 1

// Add to list of tracks and fire renegotation for all PeerConnections.
func addTrack(t *webrtc.TrackRemote) *webrtc.TrackLocalStaticRTP { // nolint
	listLock.Lock()
	defer func() {
		listLock.Unlock()
		signalPeerConnections()
	}()

	// Create a new TrackLocal with the same codec as our incoming
	trackLocal, err := webrtc.NewTrackLocalStaticRTP(t.Codec().RTPCodecCapability, t.ID(), t.StreamID())
	if err != nil {
		panic(err)
	}

	trackLocals[t.ID()] = trackLocal

	for _, con := range peerConnections {
		con.signalsCount = DefaultSignalsCount
	}

	return trackLocal
}

// Remove from list of tracks and fire renegotation for all PeerConnections.
func removeTrack(t *webrtc.TrackLocalStaticRTP) {
	listLock.Lock()
	defer func() {
		listLock.Unlock()
		signalPeerConnections()
	}()

	for _, con := range peerConnections {
		con.signalsCount = DefaultSignalsCount
	}

	delete(trackLocals, t.ID())
}

// signalPeerConnections updates each PeerConnection so that it is getting all the expected media tracks.
func signalPeerConnections() { // nolint
	listLock.Lock()
	defer func() {
		listLock.Unlock()
		dispatchKeyFrame()
	}()

	attemptSync := func() (tryAgain bool) {
		for i := range peerConnections {
			if peerConnections[i].signalsCount <= 0 {
				continue
			}

			if peerConnections[i].peerConnection.ConnectionState() == webrtc.PeerConnectionStateClosed {
				peerConnections = append(peerConnections[:i], peerConnections[i+1:]...)

				return true // We modified the slice, start from the beginning
			}

			// map of sender we already are seanding, so we don't double send
			existingSenders := map[string]bool{}

			for _, sender := range peerConnections[i].peerConnection.GetSenders() {
				if sender.Track() == nil {
					continue
				}

				existingSenders[sender.Track().ID()] = true

				// If we have a RTPSender that doesn't map to a existing track remove and signal
				if _, ok := trackLocals[sender.Track().ID()]; !ok {
					if err := peerConnections[i].peerConnection.RemoveTrack(sender); err != nil {
						return true
					}
				}
			}

			// Don't receive videos we are sending, make sure we don't have loopback
			for _, receiver := range peerConnections[i].peerConnection.GetReceivers() {
				if receiver.Track() == nil {
					continue
				}

				existingSenders[receiver.Track().ID()] = true
			}

			// Add all track we aren't sending yet to the PeerConnection
			for trackID := range trackLocals {
				if _, ok := existingSenders[trackID]; !ok {
					if _, err := peerConnections[i].peerConnection.AddTrack(trackLocals[trackID]); err != nil {
						return true
					}
				}
			}

			offer, err := peerConnections[i].peerConnection.CreateOffer(nil)
			if err != nil {
				return true
			}

			if err = peerConnections[i].peerConnection.SetLocalDescription(offer); err != nil {
				return true
			}

			if err = peerConnections[i].websocket.WriteJSON("offer", offer); err != nil {
				return true
			}
		}

		return tryAgain
	}

	for syncAttempt := 0; ; syncAttempt++ {
		if syncAttempt == 25 {
			// Release the lock and attempt a sync in 3 seconds. We might be blocking a RemoveTrack or AddTrack
			go func() {
				time.Sleep(time.Second * 3)
				signalPeerConnections()
			}()

			return
		}

		if !attemptSync() {
			break
		}
	}
}

// dispatchKeyFrame sends a keyframe to all PeerConnections, used everytime a new user joins the call.
func dispatchKeyFrame() {
	listLock.Lock()
	defer listLock.Unlock()

	for i := range peerConnections {
		for _, receiver := range peerConnections[i].peerConnection.GetReceivers() {
			if receiver.Track() == nil {
				continue
			}

			_ = peerConnections[i].peerConnection.WriteRTCP([]rtcp.Packet{
				&rtcp.PictureLossIndication{
					MediaSSRC: uint32(receiver.Track().SSRC()),
				},
			})
		}
	}
}

const messageSize = 1024 * 8

func ReadLoop(d io.Reader, ip [4]byte) {
	fmt.Printf("🔄 Starting ReadLoop for client %v\n", ip)
	for {
		buffer := make([]byte, messageSize)
		n, err := d.Read(buffer)
		if err != nil {
			fmt.Printf("❌ DataChannel closed for client %v; Exit the readloop: %v\n", ip, err)
			serverManager.RemoveClientConnection(ip)
			return
		}

		fmt.Printf("📦 Received %d bytes from client %v\n", n, ip)

		// Send packet directly to CS server via UDP
		go relayPacketToServer(ip, buffer[:n])
	}
}

// relayPacketToServer sends a game packet directly to the appropriate CS server
func relayPacketToServer(clientIP [4]byte, data []byte) {
	// Get client connection info
	conn := serverManager.GetClientConnection(clientIP)
	if conn == nil {
		logger.Errorf("❌ No connection found for client %v", clientIP)
		return
	}

	if conn.UDPSocket == nil {
		logger.Errorf("❌ No UDP socket for client %v", clientIP)
		return
	}

	// Update activity timestamp
	conn.LastActivity = time.Now()

	// Send to CS server via UDP
	serverAddr := fmt.Sprintf("%s:%d", conn.Server.Host, conn.Server.Port)
	addr, err := net.ResolveUDPAddr("udp", serverAddr)
	if err != nil {
		logger.Errorf("❌ Failed to resolve server address %s: %v", serverAddr, err)
		return
	}

	n, err := conn.UDPSocket.WriteToUDP(data, addr)
	if err != nil {
		logger.Errorf("❌ Failed to send UDP packet to %s: %v", serverAddr, err)
		return
	}

	// Update metrics
	metricsLock.Lock()
	packetsToUDP++
	metricsLock.Unlock()

	fmt.Printf("🎯 Relayed %d bytes from client %v to %s (%s)\n", n, clientIP, serverAddr, conn.Server.Name)
}

// startUDPListener starts listening for UDP responses from CS servers
func startUDPListener(clientIP [4]byte, udpSocket *net.UDPConn) {
	fmt.Printf("🔄 Starting UDP listener for client %v\n", clientIP)

	for {
		buffer := make([]byte, 2048)
		n, addr, err := udpSocket.ReadFromUDP(buffer)
		if err != nil {
			fmt.Printf("❌ UDP read error for client %v: %v\n", clientIP, err)
			break
		}

		fmt.Printf("📨 Received %d bytes from %s for client %v\n", n, addr, clientIP)

		// Get client connection
		conn := serverManager.GetClientConnection(clientIP)
		if conn == nil {
			fmt.Printf("❌ Client connection not found for %v\n", clientIP)
			continue
		}

		// Update activity
		conn.LastActivity = time.Now()

		// Send back to WebRTC client
		_, err = conn.WriteChannel.Write(buffer[:n])
		if err != nil {
			fmt.Printf("❌ Failed to send to WebRTC client %v: %v\n", clientIP, err)
			continue
		}

		// Update metrics
		metricsLock.Lock()
		packetsFromUDP++
		metricsLock.Unlock()

		fmt.Printf("✅ Relayed %d bytes from %s to client %v\n", n, addr, clientIP)
	}

	fmt.Printf("🔌 UDP listener stopped for client %v\n", clientIP)
}

// Handle incoming websockets.
func websocketHandler(w http.ResponseWriter, r *http.Request) { // nolint
	// Check for server selection parameter
	serverParam := r.URL.Query().Get("server")
	var serverID string

	if serverParam == "" {
		// No server specified, use default
		serverID = serverManager.GetDefaultServer()
	} else {
		// Check if it's just a port number (e.g., "27016")
		if port, err := strconv.Atoi(serverParam); err == nil {
			// Validate port is within allowed CS server range
			if port < MIN_CS_PORT || port > MAX_CS_PORT {
				logger.Errorf("Port %d outside allowed range (%d-%d)", port, MIN_CS_PORT, MAX_CS_PORT)
				http.Error(w, fmt.Sprintf("Port must be between %d and %d", MIN_CS_PORT, MAX_CS_PORT), http.StatusBadRequest)
				return
			}
			// Port only - combine with configured host
			serverID = fmt.Sprintf("%s:%d", CS_SERVER_HOST, port)
		} else {
			// Full host:port format (for backward compatibility)
			serverID = serverParam
		}
	}

	// Validate server exists and is online
	server := serverManager.GetServer(serverID)
	if server == nil || server.Status != "online" {
		logger.Errorf("Server not available: %s", serverID)
		http.Error(w, "Server not available", http.StatusNotFound)
		return
	}

	logger.Infof("🎯 Client connecting to server: %s (%s)", serverID, server.Name)

	// Upgrade HTTP request to Websocket
	unsafeConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Errorf("Failed to upgrade HTTP to Websocket: ", err)
		return
	}

	c := &threadSafeWriter{unsafeConn, sync.Mutex{}} // nolint

	// When this frame returns close the Websocket
	defer c.Close() //nolint

	// Create new PeerConnection
	peerConnection, err := api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		logger.Errorf("Failed to creates a PeerConnection: %v", err)

		return
	}

	// When this frame returns close the PeerConnection
	defer peerConnection.Close() //nolint

	// Accept one audio track incoming
	for _, typ := range []webrtc.RTPCodecType{webrtc.RTPCodecTypeAudio} {
		if _, err := peerConnection.AddTransceiverFromKind(typ, webrtc.RTPTransceiverInit{
			Direction: webrtc.RTPTransceiverDirectionRecvonly,
		}); err != nil {
			logger.Errorf("Failed to add transceiver: %v", err)

			return
		}
	}

	f := false
	var z uint16 = 0
	readChannel, err := peerConnection.CreateDataChannel("read", &webrtc.DataChannelInit{
		Ordered:        &f,
		MaxRetransmits: &z,
	})
	if err != nil {
		logger.Errorf("Failed to creates a data channel: %v", err)

		return
	}
	ip := [4]byte{}
	for i := range ip {
		ip[i] = byte(rand.Intn(256))
	}
	index, err := connections.Add(nil)
	if err != nil {
		logger.Errorf("Failed to add connection: %v", err)
		return
	}
	ip[0] = index

	readChannel.OnOpen(func() {
		fmt.Printf("🔗 READ DataChannel OPENED for client %v\n", ip)
		d, err := readChannel.Detach()
		if err != nil {
			panic(err)
		}
		go ReadLoop(d, ip)
	})
	defer readChannel.Close()

	writeChannel, err := peerConnection.CreateDataChannel("write", &webrtc.DataChannelInit{
		Ordered:        &f,
		MaxRetransmits: &z,
	})
	if err != nil {
		logger.Errorf("Failed to creates a data channel: %v", err)

		return
	}
	writeChannel.OnOpen(func() {
		fmt.Printf("🔗 WRITE DataChannel OPENED for client %v\n", ip)
		d, err := writeChannel.Detach()
		if err != nil {
			panic(err)
		}
		connections.Replace(index, d)

		// Create UDP socket for this client
		udpSocket, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4zero, Port: 0})
		if err != nil {
			logger.Errorf("Failed to create UDP socket for client %v: %v", ip, err)
			return
		}

		// Register client connection with server manager
		serverManager.AddClientConnection(ip, serverID, udpSocket, d)

		// Start UDP listener for responses from CS server
		go startUDPListener(ip, udpSocket)
	})
	defer writeChannel.Close()

	defer connections.Remove(ip[0])

	// Trickle ICE. Emit server candidate to client
	peerConnection.OnICECandidate(func(i *webrtc.ICECandidate) {
		if i == nil {
			return
		}
		// If you are serializing a candidate make sure to use ToJSON
		// Using Marshal will result in errors around `sdpMid`

		if writeErr := c.WriteJSON("candidate", i.ToJSON()); writeErr != nil {
			logger.Errorf("Failed to write JSON: %v", writeErr)
		}
	})

	// If PeerConnection is closed remove it from global list
	peerConnection.OnConnectionStateChange(func(p webrtc.PeerConnectionState) {
		fmt.Printf("🔗 PeerConnection state changed to: %s\n", p.String())
		switch p {
		case webrtc.PeerConnectionStateFailed:
			fmt.Printf("❌ PeerConnection FAILED for client %v\n", ip)
			if err := peerConnection.Close(); err != nil {
				logger.Errorf("Failed to close PeerConnection: %v", err)
			}
		case webrtc.PeerConnectionStateClosed:
			fmt.Printf("🔒 PeerConnection CLOSED for client %v\n", ip)
			signalPeerConnections()
		case webrtc.PeerConnectionStateConnected:
			fmt.Printf("✅ PeerConnection CONNECTED for client %v\n", ip)
		default:
		}
	})

	peerConnection.OnTrack(func(t *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		// Create a track to fan out our incoming video to all peers
		trackLocal := addTrack(t)
		defer removeTrack(trackLocal)

		buf := make([]byte, 1500)
		rtpPkt := &rtp.Packet{}

		for {
			i, _, err := t.Read(buf)
			if err != nil {
				return
			}

			if err = rtpPkt.Unmarshal(buf[:i]); err != nil {
				logger.Errorf("Failed to unmarshal incoming RTP packet: %v", err)

				return
			}

			rtpPkt.Extension = false
			rtpPkt.Extensions = nil

			if err = trackLocal.WriteRTP(rtpPkt); err != nil {
				return
			}
		}
	})

	// Add our new PeerConnection to global list
	state := peerConnectionState{peerConnection, c, DefaultSignalsCount}
	listLock.Lock()
	peerConnections = append(peerConnections, &state)
	listLock.Unlock()

	// Signal for the new PeerConnection
	signalPeerConnections()

	message := &websocketMessage{}
	for {
		_, raw, err := c.ReadMessage()
		if err != nil {
			logger.Errorf("Failed to read message: %v", err)

			return
		}

		if err := json.Unmarshal(raw, &message); err != nil {
			logger.Errorf("Failed to unmarshal json to message: %v", err)

			return
		}

		switch message.Event {
		case "candidate":
			candidate := webrtc.ICECandidateInit{}
			if err := json.Unmarshal(message.Data, &candidate); err != nil {
				logger.Errorf("Failed to unmarshal json to candidate: %v", err)

				return
			}

			if err := peerConnection.AddICECandidate(candidate); err != nil {
				logger.Errorf("Failed to add ICE candidate: %v", err)

				return
			}
		case "answer":
			answer := webrtc.SessionDescription{}
			if err := json.Unmarshal(message.Data, &answer); err != nil {
				logger.Errorf("Failed to unmarshal json to answer: %v", err)

				return
			}

			if err := peerConnection.SetRemoteDescription(answer); err != nil {
				logger.Errorf("Failed to set remote description: %v", err)

				return
			}
			listLock.Lock()
			state.signalsCount -= 1
			isNeedSignaling := state.signalsCount > 0
			listLock.Unlock()
			if isNeedSignaling {
				signalPeerConnections()
			}
		default:
			logger.Errorf("unknown message: %+v", message)
		}
	}
}

// Helper to make Gorilla Websockets threadsafe.
type threadSafeWriter struct {
	*websocket.Conn
	sync.Mutex
}

func (t *threadSafeWriter) WriteJSON(event string, v interface{}) error {
	t.Lock()
	defer t.Unlock()

	return t.Conn.WriteJSON(struct {
		Event string `json:"event"`
		Data  any    `json:"data"`
	}{event, v})
}

const html = ""

func indexHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html")
	fmt.Fprint(w, html)
}

// healthHandler provides server health information
func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	metricsLock.RLock()
	packetsSent := packetsToUDP
	packetsReceived := packetsFromUDP
	metricsLock.RUnlock()

	servers := serverManager.GetServers()
	onlineCount := 0
	for _, server := range servers {
		if server.Status == "online" {
			onlineCount++
		}
	}

	health := map[string]interface{}{
		"timestamp": time.Now().Unix(),
		"status":    "ok",
		"go_rtc_server": map[string]interface{}{
			"status":           "ok",
			"packets_to_udp":   packetsSent,
			"packets_from_udp": packetsReceived,
		},
		"cs_servers": map[string]interface{}{
			"total":  len(servers),
			"online": onlineCount,
		},
	}

	json.NewEncoder(w).Encode(health)
}

// metricsHandler provides Prometheus-style metrics
func metricsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain")

	metricsLock.RLock()
	packetsSent := packetsToUDP
	packetsReceived := packetsFromUDP
	metricsLock.RUnlock()

	servers := serverManager.GetServers()
	onlineServers := 0
	for _, server := range servers {
		if server.Status == "online" {
			onlineServers++
		}
	}

	fmt.Fprintf(w, "# HELP pkt_to_udp_total Total packets sent to UDP\n")
	fmt.Fprintf(w, "# TYPE pkt_to_udp_total counter\n")
	fmt.Fprintf(w, "pkt_to_udp_total %d\n", packetsSent)

	fmt.Fprintf(w, "# HELP pkt_from_udp_total Total packets received from UDP\n")
	fmt.Fprintf(w, "# TYPE pkt_from_udp_total counter\n")
	fmt.Fprintf(w, "pkt_from_udp_total %d\n", packetsReceived)

	fmt.Fprintf(w, "# HELP cs_servers_online Number of online CS servers\n")
	fmt.Fprintf(w, "# TYPE cs_servers_online gauge\n")
	fmt.Fprintf(w, "cs_servers_online %d\n", onlineServers)

	fmt.Fprintf(w, "# HELP cs_servers_total Total number of discovered CS servers\n")
	fmt.Fprintf(w, "# TYPE cs_servers_total gauge\n")
	fmt.Fprintf(w, "cs_servers_total %d\n", len(servers))
}

// serversHandler provides information about available CS servers
func serversHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	response := serverManager.GetServersAPI()
	json.NewEncoder(w).Encode(response)
}

type Server struct {
}

var disabledXPoweredBy = false
var xPoweredByValue = "cs16-webrtc-relay"

func init() {
	disable, _ := os.LookupEnv("DISABLE_X_POWERED_BY")
	if disable == "true" {
		disabledXPoweredBy = true
	}
	xPoweredValue, has := os.LookupEnv("X_POWERED_BY_VALUE")
	if has {
		xPoweredByValue = xPoweredValue
	}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !disabledXPoweredBy {
		w.Header().Set("X-Powered-By", xPoweredByValue)
	}
	switch r.URL.Path {
	case "/websocket", "/signal": // Support both endpoints for compatibility
		websocketHandler(w, r)
	case "/":
		// Serve dashboard as root page
		http.ServeFile(w, r, "dashboard.html")
	case "/client", "/client/":
		// Serve Xash client with optional connection parameters
		http.ServeFile(w, r, filepath.Join("client", "index.html"))
	case "/api/heartbeat":
		// Server health check
		healthHandler(w, r)
	case "/api/metrics":
		// Prometheus-style metrics
		metricsHandler(w, r)
	case "/api/servers":
		// Available CS servers
		serversHandler(w, r)
	default:
		// Serve static assets from client directory
		p := r.URL.Path
		var clientPath string

		if strings.HasPrefix(p, "/client/") {
			// Remove /client prefix for files under /client/
			relativePath := strings.TrimPrefix(p, "/client/")
			clientPath = filepath.Join("client", relativePath)
		} else {
			// For other paths, serve from client directory
			clientPath = filepath.Join("client", p)
		}

		// Check if file exists in client directory
		if _, err := os.Stat(clientPath); os.IsNotExist(err) {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, clientPath)
	}
}

// getExternalIP attempts to detect the best IP address for WebRTC ICE candidates
func getExternalIP() (string, error) {
	// Method 1: Try to get default route IP (most reliable for LAN)
	if ip, err := getDefaultRouteIP(); err == nil {
		logger.Infof("Auto-detected IP via default route: %s", ip)
		return ip, nil
	}

	// Method 2: Try network interfaces (prefer non-Docker IPs)
	if ip, err := getPreferredInterfaceIP(); err == nil {
		logger.Infof("Auto-detected IP via interface scan: %s", ip)
		return ip, nil
	}

	// Method 3: Fallback to external IP services (for cloud deployments)
	services := []string{
		"https://api.ipify.org",
		"https://ifconfig.me",
		"https://icanhazip.com",
	}

	for _, service := range services {
		client := &http.Client{Timeout: 5 * time.Second}
		resp, err := client.Get(service)
		if err != nil {
			continue
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			continue
		}

		ip := strings.TrimSpace(string(body))
		if parsedIP := net.ParseIP(ip); parsedIP != nil && parsedIP.To4() != nil {
			logger.Infof("Auto-detected IP via external service: %s", ip)
			return ip, nil
		}
	}

	return "", fmt.Errorf("could not determine external IP")
}

// getDefaultRouteIP gets the IP that would be used for external traffic
func getDefaultRouteIP() (string, error) {
	// Connect to a remote address to determine which local IP would be used
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return "", err
	}
	defer conn.Close()

	localAddr := conn.LocalAddr().(*net.UDPAddr)
	return localAddr.IP.String(), nil
}

// getPreferredInterfaceIP scans interfaces and prefers non-Docker IPs
func getPreferredInterfaceIP() (string, error) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return "", err
	}

	var candidateIPs []string

	for _, iface := range interfaces {
		// Skip down or loopback interfaces
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}

		// Skip Docker interfaces
		if strings.Contains(iface.Name, "docker") || strings.Contains(iface.Name, "br-") {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}

			if ip == nil || ip.IsLoopback() || ip.To4() == nil {
				continue
			}

			// Prefer private network ranges for LAN deployment
			if ip.IsPrivate() {
				candidateIPs = append(candidateIPs, ip.String())
			}
		}
	}

	if len(candidateIPs) > 0 {
		return candidateIPs[0], nil
	}

	return "", fmt.Errorf("no suitable interface IP found")
}

func runSFU() {
	settingEngine := webrtc.SettingEngine{}
	settingEngine.DetachDataChannels()

	port, ok := os.LookupEnv("PORT")
	if ok {
		p, err := strconv.Atoi(port)
		if err == nil {
			udpMux, err := ice.NewMultiUDPMuxFromPort(p)
			if err != nil {
				panic(err)
			}
			settingEngine.SetICEUDPMux(udpMux)
		}
	}

	ip, ok := os.LookupEnv("IP")
	if ok {
		if ip == "auto" {
			// Auto-detect external IP using a public service
			detectedIP, err := getExternalIP()
			if err != nil {
				logger.Errorf("Failed to auto-detect IP: %v", err)
			} else {
				logger.Infof("Auto-detected external IP: %s", detectedIP)
				settingEngine.SetNAT1To1IPs([]string{detectedIP}, webrtc.ICECandidateTypeHost)
			}
		} else {
			logger.Infof("Using configured IP: %s", ip)
			settingEngine.SetNAT1To1IPs([]string{ip}, webrtc.ICECandidateTypeHost)
		}
	}

	m := &webrtc.MediaEngine{}
	err := m.RegisterDefaultCodecs()
	if err != nil {
		panic(err)
	}

	i := &interceptor.Registry{}
	err = webrtc.RegisterDefaultInterceptors(m, i)
	if err != nil {
		panic(err)
	}
	api = webrtc.NewAPI(webrtc.WithSettingEngine(settingEngine), webrtc.WithMediaEngine(m), webrtc.WithInterceptorRegistry(i))

	// Init other state
	trackLocals = map[string]*webrtc.TrackLocalStaticRTP{}

	// request a keyframe every 3 seconds
	go func() {
		for range time.NewTicker(time.Second * 3).C {
			dispatchKeyFrame()
		}
	}()

	// Initialize server manager
	serverManager = NewServerManager()

	// Start CS server discovery
	serverManager.StartDiscovery()

	// start HTTP server
	logger.Infof("🚀 Starting Enhanced Go RTC Server on %s", addr)
	logger.Infof("🔍 CS Server discovery active (ports 27000-27030)")
	logger.Infof("📊 Metrics available at http://localhost%s/api/metrics", addr)
	logger.Infof("🎮 Server list at http://localhost%s/api/servers", addr)
	if err := http.ListenAndServe(addr, &Server{}); err != nil { //nolint: gosec
		logger.Errorf("Failed to start http server: %v", err)
	}
}
