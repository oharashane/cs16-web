package main

// The museum: the collection's pages, for every visitor. The records live in darkoak; this
// is the door the pages use — reads passed through with darkoak's key, and what a visitor
// said posted under the name on their invitation, since the relay is what knows who they
// are. A curator (an admin invitation) may also set the status, load a map on main, and
// the rest; a visitor may rate, tag and note; the family login alone may only look.

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

//go:embed museum.html
var museumHTML string

var darkoakClient = &http.Client{Timeout: 30 * time.Second}

// darkoak forwards one request to darkoak's museum API, key attached, and copies the answer.
func darkoak(cfg Config, w http.ResponseWriter, method, path string, query url.Values, body io.Reader) {
	if cfg.DarkoakURL == "" || cfg.DarkoakKey == "" {
		http.Error(w, "the museum's records are not reachable: DARKOAK_URL and DARKOAK_KEY are not set", http.StatusServiceUnavailable)
		return
	}
	u := strings.TrimRight(cfg.DarkoakURL, "/") + "/api/cs16/museum" + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequest(method, u, body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	req.Header.Set("Authorization", "Bearer "+cfg.DarkoakKey)
	req.Header.Set("Host", cfg.PublicHost)
	if cfg.PublicHost != "" {
		req.Host = cfg.PublicHost // darkoak chooses the room by the host name
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := darkoakClient.Do(req)
	if err != nil {
		http.Error(w, "darkoak did not answer: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer res.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(res.StatusCode)
	io.Copy(w, res.Body)
}

func museumRooms(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { darkoak(cfg, w, "GET", "/rooms", nil, nil) }
}

func museumArtifacts(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if id := r.PathValue("id"); id != "" {
			darkoak(cfg, w, "GET", "/artifacts/"+url.PathEscape(id), nil, nil)
			return
		}
		darkoak(cfg, w, "GET", "/artifacts", r.URL.Query(), nil)
	}
}

// museumSay posts what a visitor said. The name is the invitation's, never the body's;
// the curator's fields go through only for an admin.
func museumSay(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		person := identify(cfg, r)
		if person == nil {
			http.Error(w, "saying something takes a name: open the site from your own invitation link", http.StatusForbidden)
			return
		}
		var said map[string]any
		if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&said); err != nil {
			http.Error(w, "not json", http.StatusBadRequest)
			return
		}
		allowed := map[string]bool{"rating": true, "add": true, "remove": true, "note": true}
		if person.Admin() {
			for _, k := range []string{"status", "author", "year", "source"} {
				allowed[k] = true
			}
		}
		clean := map[string]any{"by": person.Name}
		for k, v := range said {
			if allowed[k] {
				clean[k] = v
			}
		}
		body, _ := json.Marshal(clean)
		darkoak(cfg, w, "POST", "/artifacts/"+url.PathEscape(r.PathValue("id"))+"/say", nil, strings.NewReader(string(body)))
	}
}

// museumPlay changes a server's map for a visitor: the lab for anyone with a name, main for
// a curator. The map comes to the browser the game's way, so nothing is bundled first.
func museumPlay(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		person := identify(cfg, r)
		if person == nil {
			http.Error(w, "loading a map takes a name: open the site from your own invitation link", http.StatusForbidden)
			return
		}
		var want struct {
			Map    string `json:"map"`
			Server string `json:"server"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&want); err != nil || want.Map == "" {
			http.Error(w, "a map name is required", http.StatusBadRequest)
			return
		}
		if !mapNameOK(want.Map) {
			http.Error(w, "that is not a map name", http.StatusBadRequest)
			return
		}
		// The records know whether the map would shut the server down: a model or a sprite
		// nobody has. Ask before telling the server.
		if verdict := museumFatal(cfg, want.Map); verdict != "" {
			http.Error(w, verdict, http.StatusConflict)
			return
		}
		port := 27016
		if want.Server == "main" {
			if !person.Admin() {
				http.Error(w, "only a curator changes the map everyone is playing", http.StatusForbidden)
				return
			}
			port = cfg.PrimaryPort
		}
		password, err := rconPassword(cfg.EnvFile)
		if err != nil {
			http.Error(w, "the server could not be told: "+err.Error(), http.StatusInternalServerError)
			return
		}
		answer, err := rcon(fmt.Sprintf("%s:%d", cfg.CSHost, port), password, "changelevel "+want.Map)
		if err != nil {
			http.Error(w, "the server did not answer: "+err.Error(), http.StatusBadGateway)
			return
		}
		logger.Infof("museum: %s loads %s on %d", person.Name, want.Map, port)
		short := strings.TrimSpace(answer)
		if strings.Contains(answer, "Loading map") || len(short) > 300 {
			short = fmt.Sprintf("the %s is changing to %s", map[bool]string{true: "lab", false: "server"}[port == 27016], want.Map)
		}
		writeJSON(w, map[string]any{"said": short, "server": port})
	}
}

func mapNameOK(name string) bool {
	if len(name) == 0 || len(name) > 64 {
		return false
	}
	for _, c := range name {
		if !(c == '_' || c == '-' || c == '.' || c == '$' || (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
			return false
		}
	}
	return true
}

func museumPage(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		person := identify(cfg, r)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		me := "null"
		if person != nil {
			b, _ := json.Marshal(map[string]any{"name": person.Name, "curator": person.Admin()})
			me = string(b)
		}
		w.Write([]byte(strings.Replace(museumHTML, "__ME__", me, 1)))
	}
}

// museumFatal asks darkoak about a map by name: "" if some record of it is playable, a
// reason otherwise. A map on the server and the drive both is judged by either.
func museumFatal(cfg Config, name string) string {
	if cfg.DarkoakURL == "" || cfg.DarkoakKey == "" {
		return ""
	}
	u := strings.TrimRight(cfg.DarkoakURL, "/") + "/api/cs16/museum/artifacts?kind=map&size=20&q=" + url.QueryEscape(name)
	req, _ := http.NewRequest("GET", u, nil)
	req.Header.Set("Authorization", "Bearer "+cfg.DarkoakKey)
	if cfg.PublicHost != "" {
		req.Host = cfg.PublicHost
	}
	res, err := darkoakClient.Do(req)
	if err != nil {
		return ""
	}
	defer res.Body.Close()
	var page struct {
		Items []struct {
			Name  string `json:"name"`
			Fatal bool   `json:"fatal"`
		} `json:"items"`
	}
	if json.NewDecoder(res.Body).Decode(&page) != nil {
		return ""
	}
	seen := false
	for _, item := range page.Items {
		if !strings.EqualFold(item.Name, name) {
			continue
		}
		seen = true
		if !item.Fatal {
			return ""
		}
	}
	if seen {
		return name + " would shut the server down: a model or a sprite it needs is nowhere"
	}
	return ""
}
