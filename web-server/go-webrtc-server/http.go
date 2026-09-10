package main

import (
	"crypto/subtle"
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
	mux.HandleFunc("GET /ws/{port}", websocketHandler(cfg))
	mux.HandleFunc("GET /websocket", websocketHandler(cfg)) // the address the 2025 client dials
	// The controls live on the page people play from; this is where they used to be.
	mux.HandleFunc("GET /admin", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/play/", http.StatusFound)
	})
	// Anyone can see what the game is; changing it is for admins.
	mux.HandleFunc("GET /api/settings", adminOnly(cfg, settingsHandler(cfg)))
	mux.HandleFunc("POST /api/settings", adminsOnly(cfg, settingsHandler(cfg)))
	// Invitations: opening one is how a browser becomes somebody. The people page and
	// its API are for admins.
	mux.HandleFunc("GET /i/{token}", inviteHandler(cfg))
	mux.HandleFunc("GET /api/me", adminOnly(cfg, meHandler(cfg)))
	mux.HandleFunc("POST /api/me", adminOnly(cfg, meHandler(cfg)))
	mux.HandleFunc("GET /people", adminsOnly(cfg, peoplePage))
	mux.HandleFunc("GET /api/people", adminsOnly(cfg, peopleHandler(cfg)))
	mux.HandleFunc("POST /api/people", adminsOnly(cfg, peopleHandler(cfg)))
	mux.HandleFunc("DELETE /api/people/{id}", adminsOnly(cfg, peopleHandler(cfg)))
	// Everything a person loads — the pages, the client, the game's files — is behind the
	// login. Only the room's read-only API and the signalling socket are not.
	mux.HandleFunc("GET /", adminOnly(cfg, staticHandler(cfg)))
	return mux
}

// adminOnly is the door to everything a person sees: the pages, the client, the game's
// own files, and the settings. Two keys open it — the family's name and password, which
// is what anybody types, and the admin key, which is what a script holds. With neither
// configured the door stands open, which is right on a laptop and wrong on the internet.
//
// What is deliberately outside it: /api/servers, /api/sessions, /api/metrics and the
// signalling socket. The first three are how darkoak's room watches this machine and say
// nothing secret; the last carries no game until a server accepts the player, and the
// server has its own password.
func adminOnly(cfg Config, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if cfg.AdminKey == "" && cfg.Password == "" {
			next(w, r)
			return
		}
		if identify(cfg, r) != nil || familyOrScript(cfg, r) {
			next(w, r)
			return
		}
		w.Header().Set("WWW-Authenticate", `Basic realm="cs16"`)
		http.Error(w, "this is a family server; an invitation, or the name and password, please", http.StatusUnauthorized)
	}
}

// familyOrScript is the two older keys: the family's shared login and the admin key.
func familyOrScript(cfg Config, r *http.Request) bool {
	user, password, given := r.BasicAuth()
	if !given {
		return false
	}
	family := cfg.Password != "" &&
		subtle.ConstantTimeCompare([]byte(user), []byte(cfg.User)) == 1 &&
		subtle.ConstantTimeCompare([]byte(password), []byte(cfg.Password)) == 1
	script := cfg.AdminKey != "" && subtle.ConstantTimeCompare([]byte(password), []byte(cfg.AdminKey)) == 1
	return family || script
}

// adminsOnly is the door to the people page: an invited admin, or — until the shared
// login is retired — the family login or the admin key, which is how the first admin
// gets made.
func adminsOnly(cfg Config, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if cfg.AdminKey == "" && cfg.Password == "" {
			next(w, r)
			return
		}
		if identify(cfg, r).Admin() || familyOrScript(cfg, r) {
			next(w, r)
			return
		}
		if identify(cfg, r) != nil {
			http.Error(w, "this page is for admins", http.StatusForbidden)
			return
		}
		w.Header().Set("WWW-Authenticate", `Basic realm="cs16"`)
		http.Error(w, "this page is for admins", http.StatusUnauthorized)
	}
}

const personCookie = "cs16_person"

// The people file, loaded once. nil until main loads it; then never nil.
var people *People

// identify is who this request is from, by the cookie an invitation left; nil for nobody.
func identify(cfg Config, r *http.Request) *Person {
	if people == nil {
		return nil
	}
	cookie, err := r.Cookie(personCookie)
	if err != nil {
		return nil
	}
	return people.ByToken(cookie.Value)
}

// inviteHandler is the link in an invitation: it leaves the cookie and sends the browser
// to the game. A link that names nobody says so, without saying why.
func inviteHandler(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		person := people.ByToken(r.PathValue("token"))
		if person == nil {
			http.Error(w, "this invitation is not one this server knows", http.StatusNotFound)
			return
		}
		http.SetCookie(w, &http.Cookie{
			Name: personCookie, Value: person.Token, Path: "/",
			MaxAge: 365 * 24 * 3600, HttpOnly: true, SameSite: http.SameSiteLaxMode,
			Secure: r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https",
		})
		http.Redirect(w, r, "/play/", http.StatusFound)
	}
}

// meHandler tells the client who it is, so the lobby can greet them by name — and hands
// an invited browser the server's password, since the invitation already opened a door
// that the password is a weaker version of; a native Steam client through the tunnel
// still has to know it. POST {name} renames the person. Nobody: an empty name.
func meHandler(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		person := identify(cfg, r)
		if person == nil {
			if r.Method == http.MethodPost {
				http.Error(w, "only an invited person has a name to change", http.StatusForbidden)
				return
			}
			writeJSON(w, map[string]any{"name": "", "role": ""})
			return
		}
		if r.Method == http.MethodPost {
			var want struct{ Name string }
			if err := json.NewDecoder(r.Body).Decode(&want); err != nil {
				http.Error(w, "a name, as JSON", http.StatusBadRequest)
				return
			}
			was := person.Name
			if err := people.Rename(person, want.Name); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if err := writeAdmins(cfg, people); err != nil {
				logger.Errorf("admins: %v", err)
			}
			logger.Infof("%s is now called %s", was, person.Name)
		}
		writeJSON(w, map[string]any{"id": person.ID, "name": person.Name, "role": person.Role,
			"server_password": serverPassword(cfg.EnvFile)})
	}
}

// inviteLink is the link to give somebody, built from how this request reached us, so it
// is the LAN address on the LAN and the public name from outside.
func inviteLink(r *http.Request, person *Person) string {
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	return scheme + "://" + r.Host + "/i/" + person.Token
}

type personView struct {
	ID       int       `json:"id"`
	Name     string    `json:"name"`
	Role     string    `json:"role"`
	Address  string    `json:"address"`
	Link     string    `json:"link,omitempty"`
	Created  time.Time `json:"created_at"`
	LastSeen time.Time `json:"last_seen,omitempty"`
	Revoked  bool      `json:"revoked"`
}

func view(r *http.Request, person *Person) personView {
	v := personView{ID: person.ID, Name: person.Name, Role: person.Role, Address: person.Address().String(),
		Created: person.CreatedAt, LastSeen: person.LastSeen, Revoked: person.Revoked}
	if !person.Revoked {
		v.Link = inviteLink(r, person)
	}
	return v
}

// peopleHandler: GET lists everyone, POST {name, role} invites somebody and answers with
// their link, DELETE /api/people/{id} revokes. Every change rewrites the server's admins.
func peopleHandler(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			var want struct{ Name, Role string }
			if err := json.NewDecoder(r.Body).Decode(&want); err != nil {
				http.Error(w, "a name and a role, as JSON", http.StatusBadRequest)
				return
			}
			person, err := people.Add(want.Name, want.Role)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if err := writeAdmins(cfg, people); err != nil {
				logger.Errorf("admins: %v", err)
			}
			logger.Infof("invited %s as %s (%s)", person.Name, person.Role, person.Address())
			writeJSON(w, view(r, person))
		case http.MethodDelete:
			var id int
			if _, err := fmt.Sscanf(r.PathValue("id"), "%d", &id); err != nil {
				http.Error(w, "which person?", http.StatusBadRequest)
				return
			}
			if err := people.Revoke(id); err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			if err := writeAdmins(cfg, people); err != nil {
				logger.Errorf("admins: %v", err)
			}
			logger.Infof("revoked person %d", id)
			w.WriteHeader(http.StatusNoContent)
		default:
			views := []personView{}
			for _, person := range people.List() {
				views = append(views, view(r, person))
			}
			writeJSON(w, map[string]any{"people": views})
		}
	}
}

// Files Vite (and the 2025 build) name with a content hash never change under that name.
var hashedName = regexp.MustCompile(`-[A-Za-z0-9_-]{8}\.[a-z0-9]+$`)

// staticHandler serves four trees from one address:
//
//	/                   the explainer (docs/index.html), admin key required
//	/review             the review (docs/review/index.html), admin key required
//	/play/...           the built client (dist), hashed assets immutable
//	/next/...           the same client on our own engine build (dist-next)
//	/legacy, /assets/.. the 2025 client, exactly as it was
//	/valve.zip          the game content, revalidated rather than re-downloaded
//
// /client, the client's address until September 2026, redirects to /play.
func staticHandler(cfg Config) http.HandlerFunc {
	pages := func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(cfg.DocsDir, "index.html")
		if strings.HasPrefix(r.URL.Path, "/review") {
			path = filepath.Join(cfg.DocsDir, "review", "index.html")
		}
		w.Header().Set("Cache-Control", "no-store")
		http.ServeFile(w, r, path)
	}
	return func(w http.ResponseWriter, r *http.Request) {
		var path string
		p := r.URL.Path
		switch {
		case p == "/" || p == "/review" || p == "/review/":
			pages(w, r)
			return
		case p == "/client" || strings.HasPrefix(p, "/client/"):
			http.Redirect(w, r, "/play"+strings.TrimPrefix(p, "/client")+queryOf(r), http.StatusMovedPermanently)
			return
		case p == "/play" || p == "/play/":
			path = filepath.Join(cfg.ClientDir, "index.html")
		case strings.HasPrefix(p, "/play/"):
			path = under(cfg.ClientDir, strings.TrimPrefix(p, "/play/"))
		// The client on the engine we build ourselves, side by side with the one on the
		// published engine, until it has earned /play.
		case p == "/next" || p == "/next/":
			path = filepath.Join(cfg.NextDir, "index.html")
		case strings.HasPrefix(p, "/next/"):
			path = under(cfg.NextDir, strings.TrimPrefix(p, "/next/"))
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

func queryOf(r *http.Request) string {
	if r.URL.RawQuery == "" {
		return ""
	}
	return "?" + r.URL.RawQuery
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
	Name              string    `json:"name"` // the invited person behind it, or ""
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
			Name:              conn.Name,
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
	if steamServer != nil {
		fmt.Fprintf(w, "# HELP steam_clients Native clients arriving through the game's tunnel\n# TYPE steam_clients gauge\nsteam_clients %d\n", steamServer.count())
	}
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		logger.Errorf("write json: %v", err)
	}
}
