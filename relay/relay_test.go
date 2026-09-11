package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
)

// A fake game server: every datagram it receives is answered with "mock".
type MockCS16Server struct {
	conn     *net.UDPConn
	mu       sync.Mutex
	received [][]byte
}

func createMockCS16Server(t *testing.T) *MockCS16Server {
	t.Helper()
	conn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 0})
	if err != nil {
		t.Fatalf("mock server: %v", err)
	}
	m := &MockCS16Server{conn: conn}
	go func() {
		buffer := make([]byte, 2048)
		for {
			n, addr, err := m.conn.ReadFromUDP(buffer)
			if err != nil {
				return
			}
			m.mu.Lock()
			m.received = append(m.received, append([]byte(nil), buffer[:n]...))
			m.mu.Unlock()
			m.conn.WriteToUDP([]byte{0xFF, 0xFF, 0xFF, 0xFF, 'm', 'o', 'c', 'k', 0}, addr)
		}
	}()
	t.Cleanup(func() { conn.Close() })
	return m
}

func (m *MockCS16Server) Port() int { return m.conn.LocalAddr().(*net.UDPAddr).Port }

func (m *MockCS16Server) Received() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.received)
}

// register makes the mock server one discovery would have found, and returns its id.
func (m *MockCS16Server) register(t *testing.T) string {
	t.Helper()
	id := fmt.Sprintf("127.0.0.1:%d", m.Port())
	serverManager.updateServer(id, "127.0.0.1", m.Port(),
		&ServerInfo{Name: "Mock CS Server", Map: "de_dust2", Game: "cstrike", MaxPlayers: 16}, 5.0)
	return id
}

// A writer that remembers what reached the browser.
type TestWriteChannel struct {
	mu   sync.Mutex
	data []byte
}

func (t *TestWriteChannel) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.data = append(t.data, p...)
	return len(p), nil
}

func (t *TestWriteChannel) Len() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.data)
}

func freshManager(t *testing.T) {
	t.Helper()
	serverManager = NewServerManager()
	t.Cleanup(serverManager.StopDiscovery)
}

func eventually(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if ok() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestHealthHandler(t *testing.T) {
	freshManager(t)
	rr := httptest.NewRecorder()
	healthHandler(rr, httptest.NewRequest("GET", "/api/heartbeat", nil))
	if rr.Code != http.StatusOK || rr.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("status %d, type %q", rr.Code, rr.Header().Get("Content-Type"))
	}
	var response map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response["status"] != "ok" || response["go_rtc_server"] == nil || response["timestamp"] == nil {
		t.Errorf("unexpected body %s", rr.Body.String())
	}
}

func TestServersHandler(t *testing.T) {
	freshManager(t)
	serverManager.updateServer("127.0.0.1:27015", "127.0.0.1", 27015,
		&ServerInfo{Name: "Test Server", Map: "de_dust2", Game: "cstrike", Players: 5, MaxPlayers: 16}, 10.0)
	rr := httptest.NewRecorder()
	serversHandler(Config{PrimaryPort: 27015})(rr, httptest.NewRequest("GET", "/api/servers", nil))
	var response map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if count, _ := response["count"].(float64); count != 1 || response["servers"] == nil {
		t.Errorf("expected one server, got %s", rr.Body.String())
	}
	// The client asks which server to offer; the relay is the one that knows.
	if primary, _ := response["primary"].(float64); primary != 27015 {
		t.Errorf("primary: got %v, want 27015", response["primary"])
	}
}

func TestMetricsHandler(t *testing.T) {
	freshManager(t)
	packetsToUDP.Store(42)
	packetsFromUDP.Store(24)
	rr := httptest.NewRecorder()
	metricsHandler(rr, httptest.NewRequest("GET", "/api/metrics", nil))
	for _, metric := range []string{"pkt_to_udp_total 42", "pkt_from_udp_total 24", "relay_sessions 0", "cs_servers_online", "cs_servers_total"} {
		if !strings.Contains(rr.Body.String(), metric) {
			t.Errorf("metric %q missing from:\n%s", metric, rr.Body.String())
		}
	}
}

// The bridge alone: bytes from a browser reach the server, and the reply comes back.
func TestRTCToUDPRelay(t *testing.T) {
	freshManager(t)
	mock := createMockCS16Server(t)
	serverID := mock.register(t)

	udpSocket, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4zero, Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	browser := &TestWriteChannel{}
	id := [4]byte{192, 168, 1, 100}
	conn := serverManager.AddClientConnection(id, serverID, udpSocket, browser)
	defer serverManager.RemoveClientConnection(id)
	go startUDPListener(id, udpSocket)

	relayPacketToServer(id, []byte{0xFF, 0xFF, 0xFF, 0xFF, 'i', 'n', 'f', 'o', 0})

	eventually(t, "the server to receive the packet", func() bool { return mock.Received() == 1 })
	eventually(t, "the reply to reach the browser", func() bool { return browser.Len() > 0 })
	if conn.PacketsToServer.Load() != 1 || conn.PacketsFromServer.Load() != 1 {
		t.Errorf("session counted %d out, %d in", conn.PacketsToServer.Load(), conn.PacketsFromServer.Load())
	}
}

// A packet arriving before the browser's write channel is open is dropped, not a crash.
func TestReplyBeforeWriterIsDropped(t *testing.T) {
	freshManager(t)
	mock := createMockCS16Server(t)
	serverID := mock.register(t)
	udpSocket, _ := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4zero, Port: 0})
	id := [4]byte{192, 168, 1, 101}
	conn := serverManager.AddClientConnection(id, serverID, udpSocket, nil)
	defer serverManager.RemoveClientConnection(id)
	go startUDPListener(id, udpSocket)

	relayPacketToServer(id, []byte("hello"))
	eventually(t, "the server to receive the packet", func() bool { return mock.Received() == 1 })
	time.Sleep(50 * time.Millisecond)
	if conn.PacketsFromServer.Load() != 0 {
		t.Errorf("a reply was counted with no writer to receive it")
	}
}

func TestConcurrentClientConnections(t *testing.T) {
	freshManager(t)
	mock := createMockCS16Server(t)
	serverID := mock.register(t)

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			udpSocket, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4zero, Port: 0})
			if err != nil {
				t.Error(err)
				return
			}
			id := [4]byte{192, 168, 1, byte(i)}
			serverManager.AddClientConnection(id, serverID, udpSocket, &TestWriteChannel{})
			relayPacketToServer(id, []byte{0xFF, 0xFF, 0xFF, 0xFF, byte(i)})
			serverManager.RemoveClientConnection(id)
		}(i)
	}
	wg.Wait()
	if n := serverManager.SessionCount(); n != 0 {
		t.Errorf("%d sessions left behind", n)
	}
}

func TestResolveServer(t *testing.T) {
	freshManager(t)
	serverManager.updateServer("127.0.0.1:27015", "127.0.0.1", 27015, &ServerInfo{Name: "Up"}, 1)
	serverManager.updateServer("127.0.0.1:27016", "127.0.0.1", 27016, &ServerInfo{Name: "Down"}, 1)
	serverManager.servers["127.0.0.1:27016"].LastSeen = time.Now().Add(-offlineAfter - time.Second)
	serverManager.markServerOffline("127.0.0.1:27016")
	handler := newHandler(Config{})

	cases := []struct {
		path   string
		status int
	}{
		{"/ws/27015", http.StatusBadRequest}, // the server is there; the failure is the missing Upgrade header
		{"/websocket?server=27015", http.StatusBadRequest},
		{"/ws/27016", http.StatusNotFound},   // known but offline
		{"/ws/27017", http.StatusNotFound},   // never seen
		{"/ws/26999", http.StatusBadRequest}, // outside the range
		{"/ws/abc", http.StatusBadRequest},
		{"/websocket", http.StatusBadRequest}, // no server named at all
	}
	for _, c := range cases {
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, httptest.NewRequest("GET", c.path, nil))
		if rr.Code != c.status {
			t.Errorf("%s: got %d, want %d (%s)", c.path, rr.Code, c.status, strings.TrimSpace(rr.Body.String()))
		}
	}
}

func TestStaticFilesAndCacheHeaders(t *testing.T) {
	client, content := t.TempDir(), t.TempDir()
	must := func(name, body string) {
		if err := os.MkdirAll(filepath.Dir(name), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(name, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	must(client+"/index.html", "<html>new client</html>")
	must(client+"/assets/index-Ab12Cd34.js", "new js")
	next := t.TempDir()
	must(next+"/index.html", "<html>next client</html>")
	must(next+"/assets/index-Ef56Gh78.js", "next js")
	must(content+"/manifest.json", "{}")
	must(content+"/base.zip", "PK")
	must(content+"/maps/de_dust2.zip", "PK")
	docs := t.TempDir()
	must(docs+"/index.html", "<html>explainer</html>")
	must(docs+"/review/index.html", "<html>review</html>")
	handler := newHandler(Config{ClientDir: client, NextDir: next, ContentDir: content, DocsDir: docs,
		AdminKey: "open-sesame", User: "family", Password: "let-me-in"})

	// Everything a person loads is behind the login now, so the ordinary getter knocks.
	get := func(path string) *httptest.ResponseRecorder {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("GET", path, nil)
		req.SetBasicAuth("family", "let-me-in")
		handler.ServeHTTP(rr, req)
		return rr
	}
	// And what happens when nobody knocks.
	getAnonymous := func(path string) *httptest.ResponseRecorder {
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, httptest.NewRequest("GET", path, nil))
		return rr
	}
	expect := func(path string, status int, body string) {
		t.Helper()
		rr := get(path)
		if rr.Code != status || (body != "" && !strings.Contains(rr.Body.String(), body)) {
			t.Errorf("%s → %d %q, want %d %q", path, rr.Code, rr.Body.String(), status, body)
		}
	}
	expect("/play", 200, "new client")
	expect("/play/?server=27015", 200, "new client")
	expect("/play/assets/index-Ab12Cd34.js", 200, "new js")
	expect("/next", 200, "next client")
	expect("/next/?server=27015", 200, "next client")
	expect("/next/assets/index-Ef56Gh78.js", 200, "next js")
	// Nothing opens without the login — not the pages, not the client, not the game's files.
	for _, path := range []string{"/", "/review", "/play/"} {
		if rr := getAnonymous(path); rr.Code != http.StatusUnauthorized {
			t.Errorf("%s without a login → %d, want 401", path, rr.Code)
		}
	}
	// The room's read-only API is deliberately outside it.
	for _, path := range []string{"/api/servers", "/api/sessions", "/api/metrics"} {
		if rr := getAnonymous(path); rr.Code == http.StatusUnauthorized {
			t.Errorf("%s asks for a login; the room has none", path)
		}
	}
	// A script holding the admin key gets in the same way a person does.
	withKey := func(path string) *httptest.ResponseRecorder {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("GET", path, nil)
		req.SetBasicAuth("anyone", "open-sesame")
		handler.ServeHTTP(rr, req)
		return rr
	}
	for path, body := range map[string]string{"/": "explainer", "/review": "review", "/review/": "review"} {
		if rr := withKey(path); rr.Code != 200 || !strings.Contains(rr.Body.String(), body) {
			t.Errorf("%s with the key → %d %q, want 200 %q", path, rr.Code, rr.Body.String(), body)
		}
	}
	// The client's old address still works, query and all.
	if rr := get("/client/?server=27015"); rr.Code != 301 || rr.Header().Get("Location") != "/play/?server=27015" {
		t.Errorf("/client/?server=27015 → %d %q, want 301 to /play/?server=27015", rr.Code, rr.Header().Get("Location"))
	}
	expect("/content/manifest.json", 200, "{}")
	expect("/content/base.zip", 200, "PK")
	expect("/content/maps/de_dust2.zip", 200, "PK")
	if h := get("/content/manifest.json").Header().Get("Cache-Control"); h != "no-store" {
		t.Errorf("manifest cache header %q", h)
	}
	if h := get("/content/base.zip").Header().Get("Cache-Control"); h != "public, no-cache" {
		t.Errorf("base.zip cache header %q", h)
	}
	expect("/nothing-here.js", 404, "")
	expect("/dashboard.html", 404, "")

	for _, path := range []string{"/play/assets/index-Ab12Cd34.js", "/next/assets/index-Ef56Gh78.js"} {
		if h := get(path).Header().Get("Cache-Control"); !strings.Contains(h, "immutable") {
			t.Errorf("%s cache header %q", path, h)
		}
	}
	// The mux normalises dot segments into a redirect; nothing is served for them.
	for _, path := range []string{"/../../etc/passwd", "/play/../go.mod", "/content/../go.mod"} {
		if rr := get(path); rr.Code == 200 {
			t.Errorf("%s served a file", path)
		}
	}
}

// The whole relay, with pion playing the browser: signalling over the WebSocket, ICE on
// loopback, both data channels open, a packet to the mock server and its reply back.
func TestBrowserRoundTrip(t *testing.T) {
	freshManager(t)
	mock := createMockCS16Server(t)
	mock.register(t)
	// The mock listens on an ephemeral port; let signalling accept it for this test.
	minPort, maxPort := MIN_CS_PORT, MAX_CS_PORT
	MIN_CS_PORT, MAX_CS_PORT = 1, 65535
	t.Cleanup(func() { MIN_CS_PORT, MAX_CS_PORT = minPort, maxPort })
	api = newWebRTCAPI(Config{ICEPort: 0})

	web := httptest.NewServer(newHandler(Config{}))
	defer web.Close()

	ws, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(web.URL, "http")+fmt.Sprintf("/ws/%d", mock.Port()), nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer ws.Close()

	engine := webrtc.SettingEngine{}
	engine.SetIncludeLoopbackCandidate(true)
	browser, err := webrtc.NewAPI(webrtc.WithSettingEngine(engine)).NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer browser.Close()

	var mu sync.Mutex
	send := func(event string, data any) {
		mu.Lock()
		defer mu.Unlock()
		if err := ws.WriteJSON(map[string]any{"event": event, "data": data}); err != nil {
			t.Errorf("send %s: %v", event, err)
		}
	}
	opened := make(chan *webrtc.DataChannel, 2)
	replies := make(chan []byte, 8)
	browser.OnDataChannel(func(channel *webrtc.DataChannel) {
		channel.OnOpen(func() { opened <- channel })
		if channel.Label() == "write" {
			channel.OnMessage(func(message webrtc.DataChannelMessage) { replies <- message.Data })
		}
	})
	browser.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate != nil {
			send("candidate", candidate.ToJSON())
		}
	})

	go func() {
		for {
			var message websocketMessage
			if err := ws.ReadJSON(&message); err != nil {
				return
			}
			switch message.Event {
			case "offer":
				var offer webrtc.SessionDescription
				json.Unmarshal(message.Data, &offer)
				if err := browser.SetRemoteDescription(offer); err != nil {
					t.Errorf("remote description: %v", err)
					return
				}
				answer, err := browser.CreateAnswer(nil)
				if err != nil {
					t.Errorf("answer: %v", err)
					return
				}
				browser.SetLocalDescription(answer)
				send("answer", answer)
			case "candidate":
				var candidate webrtc.ICECandidateInit
				json.Unmarshal(message.Data, &candidate)
				browser.AddICECandidate(candidate)
			}
		}
	}()

	var read *webrtc.DataChannel
	for i := 0; i < 2; i++ {
		select {
		case channel := <-opened:
			if channel.Label() == "read" {
				read = channel
			}
		case <-time.After(10 * time.Second):
			t.Fatal("data channels did not open")
		}
	}
	if read == nil {
		t.Fatal("no read channel")
	}

	// The engine's first packet is a datagram like any other; the mock answers every one.
	if err := read.Send([]byte{0xFF, 0xFF, 0xFF, 0xFF, 'g', 'e', 't', 'c', 'h', 'a', 'l', 'l', 'e', 'n', 'g', 'e'}); err != nil {
		t.Fatal(err)
	}
	select {
	case reply := <-replies:
		if string(reply[4:8]) != "mock" {
			t.Errorf("reply %q", reply)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no reply reached the browser")
	}

	// And the session is visible to whoever reads the API.
	resp, err := http.Get(web.URL + "/api/sessions")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var body struct {
		Count    int       `json:"count"`
		Sessions []Session `json:"sessions"`
	}
	json.NewDecoder(resp.Body).Decode(&body)
	if body.Count != 1 || body.Sessions[0].PacketsToServer < 1 || body.Sessions[0].PacketsFromServer < 1 || body.Sessions[0].Port != mock.Port() {
		t.Errorf("sessions: %+v", body)
	}

	// The signalling socket has nothing more to say once the channels are open, and
	// something in the middle will eventually close it for being quiet — Cloudflare does,
	// after about two minutes. That must not end the game: the data channels carry it.
	ws.Close()
	time.Sleep(500 * time.Millisecond)
	if serverManager.SessionCount() != 1 {
		t.Fatalf("closing the signalling socket ended the game; sessions = %d", serverManager.SessionCount())
	}
	if err := read.Send([]byte{0xFF, 0xFF, 0xFF, 0xFF, 'p', 'i', 'n', 'g'}); err != nil {
		t.Fatal(err)
	}
	select {
	case reply := <-replies:
		if string(reply[4:8]) != "mock" {
			t.Errorf("reply after the socket closed: %q", reply)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the game stopped when the signalling socket did")
	}

	// Closing the peer connection — the browser really leaving — does end it.
	browser.Close()
	eventually(t, "the session to be removed", func() bool { return serverManager.SessionCount() == 0 })
}

func TestRawContentAndDemoHeaders(t *testing.T) {
	shared, content := t.TempDir(), t.TempDir()
	os.MkdirAll(filepath.Join(shared, "maps"), 0o755)
	os.WriteFile(filepath.Join(shared, "maps", "de_test.bsp"), []byte("BSP"), 0o644)
	os.MkdirAll(filepath.Join(content, "demos"), 0o755)
	// A GoldSrc demo: the header (magic, demo protocol 5, network protocol 47, map, game,
	// checksum, directory offset) and a directory of one empty playback section.
	header := make([]byte, 544+4+92)
	copy(header, "HLDEMO\x00\x00")
	header[8] = 5
	header[12] = 47
	copy(header[16:], "de_dust2\x00")
	copy(header[16+260:], "cstrike\x00")
	header[540] = 544 & 0xff // directory offset 544, little-endian
	header[541] = 544 >> 8
	header[544] = 1 // one entry
	entry := header[548:]
	entry[0] = 1 // playback
	copy(entry[4:], "Playback\x00")
	entry[76], entry[77], entry[78], entry[79] = 0, 0, 0x80, 0x3f // 1.0 second
	entry[84], entry[85] = 544&0xff, 544>>8                       // offset: the directory itself, zero bytes long
	os.WriteFile(filepath.Join(content, "demos", "match.dem"), header, 0o644)
	os.WriteFile(filepath.Join(content, "demos", "notes.txt"), []byte("not a demo"), 0o644)
	os.WriteFile(filepath.Join(content, "demos", "odd.dem"), []byte("XXXXXXXX"), 0o644)

	handler := newHandler(Config{ContentDir: content, SharedDir: shared})
	get := func(path string) *httptest.ResponseRecorder {
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, httptest.NewRequest("GET", path, nil))
		return rr
	}
	if rr := get("/raw/maps/de_test.bsp"); rr.Code != 200 || rr.Body.String() != "BSP" {
		t.Fatalf("/raw served %d %q", rr.Code, rr.Body.String())
	}
	// The mux cleans a dotted path into a redirect before the handler sees it; either way,
	// nothing outside the content directory is served.
	if rr := get("/raw/../go.mod"); rr.Code != 404 && rr.Code != 307 || strings.Contains(rr.Body.String(), "module ") {
		t.Fatalf("/raw let a path out of the content directory: %d %q", rr.Code, rr.Body.String())
	}
	rr := get("/api/demos")
	var body struct {
		Demos []struct {
			Name, Map, Game, Problem string
			Protocol                 int32
		}
	}
	json.Unmarshal(rr.Body.Bytes(), &body)
	if rr.Code != 200 || len(body.Demos) != 2 {
		t.Fatalf("/api/demos: %d %s", rr.Code, rr.Body.String())
	}
	for _, d := range body.Demos {
		switch d.Name {
		case "match.dem":
			if d.Map != "de_dust2" || d.Game != "cstrike" || d.Protocol != 47 || d.Problem != "" {
				t.Fatalf("match.dem read as %+v", d)
			}
		case "odd.dem":
			if !strings.Contains(d.Problem, "not a GoldSrc demo") {
				t.Fatalf("odd.dem read as %+v", d)
			}
		default:
			t.Fatalf("unexpected demo %q", d.Name)
		}
	}
	if rr := get("/demos"); rr.Code != 200 || !strings.Contains(rr.Body.String(), "Upload") {
		t.Fatalf("/demos: %d", rr.Code)
	}
	// One demo's details, and the player page for it — but not for a name that is not there.
	if rr := get("/api/demos/match.dem"); rr.Code != 200 || !strings.Contains(rr.Body.String(), `"map":"de_dust2"`) {
		t.Fatalf("/api/demos/match.dem: %d %s", rr.Code, rr.Body.String())
	}
	if rr := get("/api/demos/nothing.dem"); rr.Code != 404 {
		t.Fatalf("/api/demos/nothing.dem: %d", rr.Code)
	}

	// Uploads: a demo lands under a cleaned name, junk is refused by its first bytes, and a
	// delete removes the file. The multipart field is "demo".
	post := func(field, filename string, data []byte) *httptest.ResponseRecorder {
		var body bytes.Buffer
		mp := multipart.NewWriter(&body)
		part, _ := mp.CreateFormFile(field, filename)
		part.Write(data)
		mp.Close()
		req := httptest.NewRequest("POST", "/api/demos", &body)
		req.Header.Set("Content-Type", mp.FormDataContentType())
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr
	}
	if rr := post("demo", "Final (round 3).dem", header); rr.Code != 200 || !strings.Contains(rr.Body.String(), `"name":"Final_round_3.dem"`) || strings.Contains(rr.Body.String(), "problem") {
		t.Fatalf("upload: %d %s", rr.Code, rr.Body.String())
	}
	if _, err := os.Stat(filepath.Join(content, "demos", "Final_round_3.dem")); err != nil {
		t.Fatalf("the upload was not written: %v", err)
	}
	if rr := post("demo", "junk.dem", []byte("not a demo at all")); rr.Code != 200 || !strings.Contains(rr.Body.String(), "not a GoldSrc demo") {
		t.Fatalf("junk upload: %d %s", rr.Code, rr.Body.String())
	}
	if _, err := os.Stat(filepath.Join(content, "demos", "junk.dem")); err == nil {
		t.Fatalf("the junk was written")
	}
	del := httptest.NewRecorder()
	handler.ServeHTTP(del, httptest.NewRequest("DELETE", "/api/demos/Final_round_3.dem", nil))
	if del.Code != 204 {
		t.Fatalf("delete: %d", del.Code)
	}
	if _, err := os.Stat(filepath.Join(content, "demos", "Final_round_3.dem")); err == nil {
		t.Fatalf("the delete left the file")
	}
}
