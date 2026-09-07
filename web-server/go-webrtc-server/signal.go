package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
)

// One WebSocket per browser, alive for as long as the browser plays. It carries the offer
// this side makes, the browser's answer, and ICE candidates both ways — and nothing after
// that: the game's bytes go over the data channels. When the socket closes, so does the
// session: the PeerConnection, the UDP socket, the registry entry.

var upgrader = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

// Clients are told apart by a four-byte id that looks like an address, because the
// registry and the tests have always keyed on one. It is never sent anywhere.
var clientCounter atomic.Uint32

func nextClientID() [4]byte {
	n := clientCounter.Add(1)
	return [4]byte{10, byte(n >> 16), byte(n >> 8), byte(n)}
}

type websocketMessage struct {
	Event string          `json:"event"`
	Data  json.RawMessage `json:"data"`
}

// resolveServer finds the game server a signalling request is for: /ws/{port}, or the
// older ?server=port. The server must be one discovery has seen and seen recently.
func resolveServer(r *http.Request) (*ServerConfig, int, error) {
	raw := r.PathValue("port")
	if raw == "" {
		raw = r.URL.Query().Get("server")
	}
	port, err := strconv.Atoi(raw)
	if err != nil {
		return nil, http.StatusBadRequest, fmt.Errorf("a server is chosen by its port, and %q is not one", raw)
	}
	if port < MIN_CS_PORT || port > MAX_CS_PORT {
		return nil, http.StatusBadRequest, fmt.Errorf("port %d is outside %d-%d", port, MIN_CS_PORT, MAX_CS_PORT)
	}
	server := serverManager.GetServer(fmt.Sprintf("%s:%d", csHost, port))
	if server == nil || server.Status != "online" {
		return nil, http.StatusNotFound, fmt.Errorf("no server is answering on %d", port)
	}
	return server, http.StatusOK, nil
}

func websocketHandler(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { websocketSession(cfg, w, r) }
}

func websocketSession(cfg Config, w http.ResponseWriter, r *http.Request) {
	server, status, err := resolveServer(r)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}

	socket, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Errorf("websocket upgrade: %v", err)
		return
	}
	ws := &threadSafeWriter{Conn: socket}
	defer ws.Close()

	peer, err := api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		logger.Errorf("new peer connection: %v", err)
		return
	}
	defer peer.Close()

	// The UDP socket exists before the browser has said a word, so there is one place a
	// session is created and one place it is removed, whatever order the channels open in.
	udpSocket, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4zero, Port: 0})
	if err != nil {
		logger.Errorf("udp socket for %s: %v", server.ID, err)
		return
	}
	id := nextClientID()
	conn := serverManager.AddClientConnection(id, server.ID, udpSocket, nil)
	conn.Peer = peer
	conn.Remote = r.RemoteAddr
	defer serverManager.RemoveClientConnection(id)
	logger.Infof("session %v from %s → %s (%s)", id, r.RemoteAddr, server.ID, server.Name)

	unordered, noRetransmits := false, uint16(0)
	channel := func(label string) (*webrtc.DataChannel, error) {
		return peer.CreateDataChannel(label, &webrtc.DataChannelInit{Ordered: &unordered, MaxRetransmits: &noRetransmits})
	}
	readChannel, err := channel("read")
	if err != nil {
		logger.Errorf("read channel: %v", err)
		return
	}
	writeChannel, err := channel("write")
	if err != nil {
		logger.Errorf("write channel: %v", err)
		return
	}
	readChannel.OnOpen(func() {
		raw, err := readChannel.Detach()
		if err != nil {
			logger.Errorf("detach read channel: %v", err)
			return
		}
		go ReadLoop(raw, id)
	})
	writeChannel.OnOpen(func() {
		raw, err := writeChannel.Detach()
		if err != nil {
			logger.Errorf("detach write channel: %v", err)
			return
		}
		conn.SetWriter(raw)
		go startUDPListener(id, udpSocket)
	})

	peer.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}
		if err := ws.WriteJSON("candidate", candidate.ToJSON()); err != nil {
			logger.Errorf("send candidate: %v", err)
		}
	})

	// And the address the outside world reaches this machine on, if there is one. It is
	// not a candidate pion can gather — nothing here can see the tunnel's far side — so it
	// is stated. Its port is the muxed ICE port, which is the port the tunnel forwards, so
	// a browser's checks to it land on the same socket pion is already listening to.
	//
	// Lower priority than a real host candidate on purpose: a browser on this network
	// still prefers the direct path, and only somebody outside falls back to the tunnel.
	if extra := publicCandidate(cfg); extra != nil {
		if err := ws.WriteJSON("candidate", extra); err != nil {
			logger.Errorf("send public candidate: %v", err)
		}
	}
	peer.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		logger.Infof("session %v is %s", id, state)
		// Ending the socket ends the handler, and the handler's defers end everything else.
		if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed {
			ws.Close()
		}
	})

	// This side offers, the browser answers: that is what the client engine expects.
	offer, err := peer.CreateOffer(nil)
	if err != nil {
		logger.Errorf("create offer: %v", err)
		return
	}
	if err := peer.SetLocalDescription(offer); err != nil {
		logger.Errorf("set local description: %v", err)
		return
	}
	if err := ws.WriteJSON("offer", offer); err != nil {
		logger.Errorf("send offer: %v", err)
		return
	}

	for {
		var message websocketMessage
		if err := ws.ReadJSON(&message); err != nil {
			return
		}
		switch message.Event {
		case "answer":
			var answer webrtc.SessionDescription
			if err := json.Unmarshal(message.Data, &answer); err != nil {
				logger.Errorf("bad answer: %v", err)
				return
			}
			if err := peer.SetRemoteDescription(answer); err != nil {
				logger.Errorf("set remote description: %v", err)
				return
			}
		case "candidate":
			var candidate webrtc.ICECandidateInit
			if err := json.Unmarshal(message.Data, &candidate); err != nil {
				logger.Errorf("bad candidate: %v", err)
				return
			}
			if err := peer.AddICECandidate(candidate); err != nil {
				logger.Errorf("add candidate: %v", err)
				return
			}
		default:
			logger.Warnf("session %v sent an unknown event %q", id, message.Event)
		}
	}
}

// threadSafeWriter serialises writes to one WebSocket, which gorilla requires and which
// the ICE callbacks and the offer would otherwise race on.
type threadSafeWriter struct {
	*websocket.Conn
	mu sync.Mutex
}

func (t *threadSafeWriter) WriteJSON(event string, data any) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.Conn.WriteJSON(struct {
		Event string `json:"event"`
		Data  any    `json:"data"`
	}{event, data})
}

// --- the bridge -------------------------------------------------------------------------

// Larger than any datagram the game sends; a data channel message that exceeds it is
// not the game's.
const messageSize = 8 * 1024

// Totals across every session, for /api/metrics.
var packetsToUDP, packetsFromUDP atomic.Int64

// ReadLoop copies what the browser sends into the client's UDP socket, one message per
// datagram, in the order they arrive.
func ReadLoop(from io.Reader, id [4]byte) {
	buffer := make([]byte, messageSize)
	for {
		n, err := from.Read(buffer)
		if err != nil {
			return
		}
		relayPacketToServer(id, buffer[:n])
	}
}

// relayPacketToServer sends one datagram from the browser to its game server.
func relayPacketToServer(id [4]byte, data []byte) {
	conn := serverManager.GetClientConnection(id)
	if conn == nil || conn.UDPSocket == nil {
		return
	}
	target := &net.UDPAddr{IP: net.ParseIP(conn.Server.Host), Port: conn.Server.Port}
	if _, err := conn.UDPSocket.WriteToUDP(data, target); err != nil {
		logger.Errorf("session %v → %s: %v", id, conn.ServerID, err)
		return
	}
	conn.sent(len(data))
	packetsToUDP.Add(1)
}

// startUDPListener copies what the game server sends back into the browser's "write"
// channel. It ends when the socket is closed, which RemoveClientConnection does.
func startUDPListener(id [4]byte, udpSocket *net.UDPConn) {
	buffer := make([]byte, messageSize)
	for {
		n, _, err := udpSocket.ReadFromUDP(buffer)
		if err != nil {
			return
		}
		conn := serverManager.GetClientConnection(id)
		if conn == nil {
			return
		}
		if err := conn.Write(buffer[:n]); err != nil {
			continue
		}
		packetsFromUDP.Add(1)
	}
}

// --- per-session state ------------------------------------------------------------------

// sent and received record one datagram each way, for /api/sessions.
func (c *ClientConnection) sent(bytes int) {
	c.PacketsToServer.Add(1)
	c.BytesToServer.Add(int64(bytes))
	c.touch()
}

func (c *ClientConnection) touch() { c.lastActivity.Store(time.Now().UnixNano()) }

// LastActivityAt is when a datagram last passed either way.
func (c *ClientConnection) LastActivityAt() time.Time { return time.Unix(0, c.lastActivity.Load()) }

// SetWriter attaches the browser's "write" channel once it is open.
func (c *ClientConnection) SetWriter(w io.Writer) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.writeChannel = w
}

// Write sends one datagram to the browser, or reports that there is nowhere to send it yet.
func (c *ClientConnection) Write(data []byte) error {
	c.mu.Lock()
	w := c.writeChannel
	c.mu.Unlock()
	if w == nil {
		return errNoWriter
	}
	if _, err := w.Write(data); err != nil {
		return err
	}
	c.PacketsFromServer.Add(1)
	c.BytesFromServer.Add(int64(len(data)))
	c.touch()
	return nil
}

var errNoWriter = fmt.Errorf("the browser's write channel is not open yet")

// publicCandidate is the address a browser beyond this network should try: the configured
// public address, on the one UDP port every session uses. Nil when none is configured.
func publicCandidate(cfg Config) *webrtc.ICECandidateInit {
	if cfg.PublicAddr == "" || cfg.ICEPort == 0 {
		return nil
	}
	// Below pion's host priority (2130706431) so the direct path wins when it exists.
	const priority = 1677721599
	candidate := fmt.Sprintf("candidate:%d 1 udp %d %s %d typ host generation 0",
		publicFoundation, priority, cfg.PublicAddr, cfg.ICEPort)
	mid, index := "0", uint16(0)
	return &webrtc.ICECandidateInit{Candidate: candidate, SDPMid: &mid, SDPMLineIndex: &index}
}

// A foundation of its own, so a browser groups it separately from pion's candidates.
const publicFoundation = 90000001
