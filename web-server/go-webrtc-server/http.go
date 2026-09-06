package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/pion/webrtc/v4"
)

// newHandler is the whole HTTP surface: pages, the client's files, the API, signalling.
func newHandler(cfg Config) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/heartbeat", healthHandler)
	mux.HandleFunc("GET /api/servers", serversHandler(cfg))
	mux.HandleFunc("GET /api/sessions", sessionsHandler)
	mux.HandleFunc("GET /api/metrics", metricsHandler)
	mux.HandleFunc("GET /ws/{port}", websocketHandler)
	mux.HandleFunc("GET /websocket", websocketHandler) // the address the 2025 client dials
	mux.HandleFunc("GET /", staticHandler(cfg))
	return mux
}

// Files Vite (and the 2025 build) name with a content hash never change under that name.
var hashedName = regexp.MustCompile(`-[A-Za-z0-9_-]{8}\.[a-z0-9]+$`)

// staticHandler serves three trees from one address:
//
//	/ and /client/...   the built client (dist), hashed assets immutable
//	/legacy, /assets/.. the 2025 client, exactly as it was
//	/valve.zip          the game content, revalidated rather than re-downloaded
func staticHandler(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var path string
		p := r.URL.Path
		switch {
		case p == "/" || p == "/client" || p == "/client/":
			path = filepath.Join(cfg.ClientDir, "index.html")
		case strings.HasPrefix(p, "/client/"):
			path = under(cfg.ClientDir, strings.TrimPrefix(p, "/client/"))
		case p == "/legacy" || p == "/legacy/":
			path = filepath.Join(cfg.LegacyDir, "index.html")
		case strings.HasPrefix(p, "/assets/"):
			path = under(cfg.LegacyDir, strings.TrimPrefix(p, "/"))
		case p == "/valve.zip":
			path = filepath.Join(cfg.ContentDir, "valve.zip")
		}
		if path == "" {
			http.NotFound(w, r)
			return
		}
		info, err := os.Stat(path)
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
		base := filepath.Base(path)
		switch {
		case hashedName.MatchString(base):
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		case strings.HasSuffix(base, ".zip"):
			w.Header().Set("Cache-Control", "public, no-cache")
		}
		http.ServeFile(w, r, path)
	}
}

// under joins a request path onto a directory and refuses to leave it. An empty result
// means "not a file we serve".
func under(dir, rel string) string {
	path := filepath.Join(dir, filepath.FromSlash(rel))
	if !strings.HasPrefix(path, filepath.Clean(dir)+string(os.PathSeparator)) {
		return ""
	}
	return path
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	servers := serverManager.GetServers()
	online := 0
	for _, server := range servers {
		if server.Status == "online" {
			online++
		}
	}
	writeJSON(w, map[string]any{
		"timestamp": time.Now().Unix(),
		"status":    "ok",
		"go_rtc_server": map[string]any{
			"status":           "ok",
			"packets_to_udp":   packetsToUDP.Load(),
			"packets_from_udp": packetsFromUDP.Load(),
			"sessions":         serverManager.SessionCount(),
		},
		"cs_servers": map[string]any{"total": len(servers), "online": online},
	})
}

func serversHandler(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body := serverManager.GetServersAPI()
		// Which server the client should offer. Named here rather than guessed there, so
		// moving the family to a different one is a setting and not a new build.
		body["primary"] = cfg.PrimaryPort
		writeJSON(w, body)
	}
}

// Session is one browser's connection as /api/sessions reports it: what the darkoak room
// samples, and what a lag investigation starts from.
type Session struct {
	ID                string    `json:"id"`
	Server            string    `json:"server"`
	ServerName        string    `json:"server_name"`
	Port              int       `json:"port"`
	Remote            string    `json:"remote"`
	State             string    `json:"state"`
	ConnectedAt       time.Time `json:"connected_at"`
	LastActivity      time.Time `json:"last_activity"`
	PacketsToServer   int64     `json:"packets_to_server"`
	PacketsFromServer int64     `json:"packets_from_server"`
	BytesToServer     int64     `json:"bytes_to_server"`
	BytesFromServer   int64     `json:"bytes_from_server"`
	// Round trip between browser and relay as ICE measures it, in milliseconds; null
	// until a pair has been nominated. The game's own net_graph adds the server's share.
	RttMs *float64 `json:"rtt_ms"`
}

func sessionsHandler(w http.ResponseWriter, r *http.Request) {
	sessions := []Session{}
	for _, conn := range serverManager.Connections() {
		session := Session{
			ID:                fmt.Sprintf("%d.%d.%d.%d", conn.IP[0], conn.IP[1], conn.IP[2], conn.IP[3]),
			Server:            conn.ServerID,
			Remote:            conn.Remote,
			ConnectedAt:       conn.ConnectedAt,
			LastActivity:      conn.LastActivityAt(),
			PacketsToServer:   conn.PacketsToServer.Load(),
			PacketsFromServer: conn.PacketsFromServer.Load(),
			BytesToServer:     conn.BytesToServer.Load(),
			BytesFromServer:   conn.BytesFromServer.Load(),
		}
		if conn.Server != nil {
			session.ServerName, session.Port = conn.Server.Name, conn.Server.Port
		}
		if conn.Peer != nil {
			session.State = conn.Peer.ConnectionState().String()
			session.RttMs = roundTrip(conn.Peer)
		}
		sessions = append(sessions, session)
	}
	writeJSON(w, map[string]any{"sessions": sessions, "count": len(sessions), "timestamp": time.Now().Unix()})
}

// roundTrip reads the nominated candidate pair's RTT out of the peer's stats.
func roundTrip(peer *webrtc.PeerConnection) *float64 {
	for _, stat := range peer.GetStats() {
		if pair, ok := stat.(webrtc.ICECandidatePairStats); ok && pair.Nominated && pair.CurrentRoundTripTime > 0 {
			ms := pair.CurrentRoundTripTime * 1000
			return &ms
		}
	}
	return nil
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	servers := serverManager.GetServers()
	online := 0
	for _, server := range servers {
		if server.Status == "online" {
			online++
		}
	}
	fmt.Fprintf(w, "# HELP pkt_to_udp_total Total packets sent to UDP\n# TYPE pkt_to_udp_total counter\npkt_to_udp_total %d\n", packetsToUDP.Load())
	fmt.Fprintf(w, "# HELP pkt_from_udp_total Total packets received from UDP\n# TYPE pkt_from_udp_total counter\npkt_from_udp_total %d\n", packetsFromUDP.Load())
	fmt.Fprintf(w, "# HELP relay_sessions Browsers connected now\n# TYPE relay_sessions gauge\nrelay_sessions %d\n", serverManager.SessionCount())
	fmt.Fprintf(w, "# HELP cs_servers_online Number of online CS servers\n# TYPE cs_servers_online gauge\ncs_servers_online %d\n", online)
	fmt.Fprintf(w, "# HELP cs_servers_total Total number of discovered CS servers\n# TYPE cs_servers_total gauge\ncs_servers_total %d\n", len(servers))
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		logger.Errorf("write json: %v", err)
	}
}
