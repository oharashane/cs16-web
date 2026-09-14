package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
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

// sourceAddress is the address a session's packets leave from, and so the address the
// game server knows the player by. Each session gets its own — 127.0.0.2, 127.0.0.3, … —
// because ReHLDS treats a new connection from a player's IP as that player coming back
// whenever they have been silent for ten seconds, hands the newcomer their slot, and keeps
// their name for it. With every browser behind one address, one person stalling meant the
// next person to join was dropped into their place under their name (6 September 2026).
// Any 127.x address works on the loopback interface without configuration; the game
// server has to be on the same host, in the host's network, to see it. Elsewhere the
// socket binds as before and the relay's one address is what the server sees.
func sourceAddress(cfg Config, id [4]byte) net.IP {
	if host := net.ParseIP(cfg.CSHost); host == nil || !host.IsLoopback() {
		return net.IPv4zero
	}
	return nextLoopbackSource()
}

// nextLoopbackSource hands out 127.0.0.2, 127.0.0.3, … in turn: one for every browser
// session and every client arriving through the game's own tunnel (steam.go), from one
// counter so the two can never land on the same address. 127.0.0.0/8 is entirely local,
// so there are millions and they cost nothing.
var loopbackCounter atomic.Uint32

func nextLoopbackSource() net.IP {
	n := loopbackCounter.Add(1) - 1
	return net.IPv4(127, 0, byte((n/250)%256), byte(2+n%250))
}

// who is a log suffix naming the person, or nothing.
func who(person *Person) string {
	if person == nil {
		return ""
	}
	return " as " + person.Name
}

type websocketMessage struct {
	Event string          `json:"event"`
	Data  json.RawMessage `json:"data"`
}

// resolveServer finds the game server a signalling request is for: /ws/{port}, or the
// older ?server=port. The server must be one discovery has seen and seen recently.
func resolveServer(r *http.Request) (*ServerConfig, int, error) {
	// A server outside the house: ?to=host:port, probed now (eye.go). The bridge is the
	// same; the socket's other end is somebody else's machine.
	if to := r.URL.Query().Get("to"); to != "" {
		server, err := outsideServer(to)
		if err != nil {
			return nil, http.StatusBadGateway, err
		}
		return server, http.StatusOK, nil
	}
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
	id := nextClientID()
	// An invited person's packets leave from their own, stable address, so the game
	// server knows them across sessions; anyone else gets the next one from the counter.
	person := identify(cfg, r)
	source := sourceAddress(cfg, id)
	if person != nil && !source.IsUnspecified() {
		source = person.Address()
		people.Seen(person)
	}
	// A server outside the house is reached from a real interface: the loopback source
	// addresses that keep the house's players apart cannot leave the machine, so the
	// relay's one address is what that server sees — which is the ordinary case anyway.
	if server.GameMode == "outside" {
		source = net.IPv4zero
		if person != nil {
			people.Seen(person)
		}
	}
	udpSocket, err := net.ListenUDP("udp", &net.UDPAddr{IP: source, Port: 0})
	if err != nil {
		logger.Errorf("udp socket for %s: %v", server.ID, err)
		return
	}
	conn := serverManager.AddClientConnection(id, server.ID, udpSocket, nil)
	if conn.Server == nil {
		conn.Server = server // a server outside the house: the bridge knows it only for this session
	}
	conn.Peer = peer
	conn.Remote = r.RemoteAddr
	if person != nil {
		conn.Name = person.Name
	}
	defer serverManager.RemoveClientConnection(id)
	logger.Infof("session %v from %s → %s (%s)%s", id, r.RemoteAddr, server.ID, server.Name, who(person))

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
	// Closed when the peer connection itself ends, which is the only thing that ends a
	// game. Not the signalling socket: see the wait at the bottom of this function.
	peerEnded := make(chan struct{})
	var once sync.Once
	peer.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		logger.Infof("session %v is %s", id, state)
		if state == webrtc.PeerConnectionStateFailed || state == webrtc.PeerConnectionStateClosed {
			once.Do(func() { close(peerEnded) })
			ws.Close() // so the reader below stops waiting for a browser that has gone
		}
	})

	// A signalling socket says nothing at all once the offer, the answer and the candidates
	// are through, and something in the middle will eventually take that for a dead
	// connection: Cloudflare closes an idle WebSocket after about two minutes, which is
	// exactly how long a game lasted through the tunnel until 7 September 2026. A ping
	// every twenty-five seconds is enough to keep every proxy on the path convinced.
	go func() {
		ticker := time.NewTicker(25 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-peerEnded:
				return
			case <-ticker.C:
				if err := ws.Ping(); err != nil {
					return
				}
			}
		}
	}()

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

	defer func() { play(peer, peerEnded, id) }()

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

// play waits for a game that is already running to end. The signalling socket has closed —
// the browser navigated away, or a proxy decided a silent socket was a dead one — but the
// data channels underneath it are what carry the game, and they neither know nor care.
// Before 7 September 2026 the handler simply returned here and took the session with it,
// which is why a game through the tunnel ended after two minutes, every time.
func play(peer *webrtc.PeerConnection, ended <-chan struct{}, id [4]byte) {
	if peer.ConnectionState() != webrtc.PeerConnectionStateConnected {
		return // it never got started; there is nothing to wait for
	}
	logger.Infof("session %v lost its signalling socket; the game continues", id)
	<-ended
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

// Ping keeps the socket, and every proxy in front of it, awake.
func (t *threadSafeWriter) Ping() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.Conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(10*time.Second))
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
		// A server outside the house says why it turns a client away in a connectionless
		// packet nobody else sees; the log keeps the first few, so the eye can learn.
		if conn.Server != nil && conn.Server.GameMode == "outside" && n > 5 && buffer[0] == 0xff && buffer[1] == 0xff && buffer[2] == 0xff && buffer[3] == 0xff && conn.PacketsFromServer.Load() < 6 {
			text := strings.Map(func(r rune) rune {
				if r < 32 || r > 126 {
					return '.'
				}
				return r
			}, string(buffer[4:min(n, 200)]))
			logger.Infof("session %v ← %s: %s", id, conn.Server.ID, text)
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
