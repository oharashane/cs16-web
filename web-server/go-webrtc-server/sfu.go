package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/gorilla/websocket"
	"github.com/pion/ice/v4"
	"github.com/pion/interceptor"
	"github.com/pion/logging"
	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
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
)

// Packet structure for communication with Python
type Packet struct {
	ClientIP [4]byte `json:"client_ip"`
	Data     []byte  `json:"data"`
}

var connections = NewFixedArray[io.Writer](128)

var packets = make(chan *Packet, 256)

var (
	addr     = ":8080"  // Changed to port 8080 for WebRTC
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	api *webrtc.API

	// lock for peerConnections and trackLocals
	listLock        sync.RWMutex
	peerConnections []*peerConnectionState
	trackLocals     map[string]*webrtc.TrackLocalStaticRTP

	logger = logging.NewDefaultLoggerFactory().NewLogger("sfu-ws")
	
	// Python server communication - configurable for LAN deployment
	pythonServerURL = getEnvOrDefault("PYTHON_RELAY_URL", "http://127.0.0.1:3000")
	httpClient = &http.Client{Timeout: 15 * time.Second}
	
	// WebSocket connection to Python for responses
	pythonWS *websocket.Conn
	pythonWSMutex sync.Mutex
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
			return
		}
		
		fmt.Printf("📦 Received %d bytes from client %v\n", n, ip)
		
		// Send packet to Python server via HTTP POST
		packet := &Packet{
			ClientIP: ip,
			Data:     buffer[:n],
		}
		go sendPacketToPython(packet)
	}
}

// sendPacketToPython sends a game packet to the Python relay server
func sendPacketToPython(packet *Packet) {
	jsonData, err := json.Marshal(packet)
	if err != nil {
		logger.Errorf("Failed to marshal packet: %v", err)
		return
	}

	resp, err := httpClient.Post(pythonServerURL+"/game-packet", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		logger.Errorf("Failed to send packet to Python: %v", err)
		return
	}
	defer resp.Body.Close()
}

// connectToPython establishes WebSocket connection to Python for receiving responses
func connectToPython() {
	for {
		pythonWSMutex.Lock()
		if pythonWS != nil {
			pythonWS.Close()
		}
		
		pythonWSURL := strings.Replace(pythonServerURL, "http://", "ws://", 1) + "/ws-from-go"
		conn, _, err := websocket.DefaultDialer.Dial(pythonWSURL, nil)
		if err != nil {
			logger.Errorf("Failed to connect to Python WebSocket: %v", err)
			pythonWSMutex.Unlock()
			time.Sleep(5 * time.Second)
			continue
		}
		
		pythonWS = conn
		pythonWSMutex.Unlock()
		logger.Infof("Connected to Python WebSocket")
		
		// Listen for messages from Python
		for {
			var packet Packet
			err := conn.ReadJSON(&packet)
			if err != nil {
				logger.Errorf("Failed to read from Python WebSocket: %v", err)
				break
			}
			
			fmt.Printf("📨 Received packet from Python for client %v: %d bytes\n", packet.ClientIP, len(packet.Data))
			
			// Send packet back to the appropriate client
			sendPacketToClient(packet)
		}
	}
}

// sendPacketToClient sends a packet back to the WebRTC client
func sendPacketToClient(packet Packet) {
	channel, err := connections.Get(packet.ClientIP[0])
	if err != nil || channel == nil {
		fmt.Printf("❌ Failed to get DataChannel for client %v: %v\n", packet.ClientIP, err)
		return
	}
	
	n, err := channel.Write(packet.Data)
	if err != nil {
		fmt.Printf("❌ Failed to write to DataChannel for client %v: %v\n", packet.ClientIP, err)
		return
	}
	
	fmt.Printf("✅ Sent %d bytes to DataChannel for client %v\n", n, packet.ClientIP)
}

// Handle incoming websockets.
func websocketHandler(w http.ResponseWriter, r *http.Request) { // nolint
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

// proxyToPython forwards API requests to the Python server
func proxyToPython(w http.ResponseWriter, r *http.Request, endpoint string) {
	url := fmt.Sprintf("%s/%s", pythonServerURL, endpoint)
	
	resp, err := httpClient.Get(url)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to proxy to Python: %v", err), http.StatusServiceUnavailable)
		return
	}
	defer resp.Body.Close()
	
	// Copy response headers
	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	
	w.WriteHeader(resp.StatusCode)
	
	// Copy response body
	_, err = io.Copy(w, resp.Body)
	if err != nil {
		logger.Errorf("Failed to copy response body: %v", err)
	}
}

const html = ""

func indexHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html")
	fmt.Fprint(w, html)
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
	case "/websocket", "/signal":  // Support both endpoints for compatibility
		websocketHandler(w, r)
	case "/":
		// Serve dashboard as root page
		http.ServeFile(w, r, "dashboard.html")
	case "/client":
		// Serve Xash client with optional connection parameters
		http.ServeFile(w, r, filepath.Join("client", "index.html"))
	case "/api/heartbeat":
		// Proxy heartbeat requests to Python server
		proxyToPython(w, r, "heartbeat")
	case "/api/heartbeat-webrtc":
		// Proxy WebRTC heartbeat requests to Python server
		proxyToPython(w, r, "heartbeat-webrtc")
	case "/api/test-pipeline":
		// Proxy pipeline test requests to Python server
		proxyToPython(w, r, "test-pipeline")
	case "/api/metrics":
		// Proxy metrics requests to Python server  
		proxyToPython(w, r, "metrics")
	case "/api/servers":
		// Proxy servers requests to Python server
		proxyToPython(w, r, "servers")
	default:
		// Serve static assets from client directory
		p := r.URL.Path
		clientPath := filepath.Join("client", p)
		
		// Check if file exists in client directory
		if _, err := os.Stat(clientPath); os.IsNotExist(err) {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, clientPath)
	}
}

// getExternalIP attempts to detect the external IP address
func getExternalIP() (string, error) {
	// Try to get IP from container's default route interface
	interfaces, err := net.Interfaces()
	if err == nil {
		for _, iface := range interfaces {
			if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
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
				
				// Return the first non-loopback IPv4 address
				return ip.String(), nil
			}
		}
	}
	
	// Fallback: try external IP detection services
	services := []string{
		"https://api.ipify.org",
		"https://ifconfig.me",
		"https://icanhazip.com",
	}
	
	for _, service := range services {
		resp, err := http.Get(service)
		if err != nil {
			continue
		}
		defer resp.Body.Close()
		
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			continue
		}
		
		ip := strings.TrimSpace(string(body))
		if net.ParseIP(ip) != nil {
			return ip, nil
		}
	}
	
	return "", fmt.Errorf("could not determine external IP")
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

	// Connect to Python WebSocket for responses
	go connectToPython()

	// start HTTP server
	logger.Infof("Starting WebRTC server on %s", addr)
	if err := http.ListenAndServe(addr, &Server{}); err != nil { //nolint: gosec
		logger.Errorf("Failed to start http server: %v", err)
	}
}