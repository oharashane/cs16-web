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
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

//go:embed lobby.html
var lobbyHTML string

//go:embed maps.html
var mapsWingHTML string

//go:embed models.html
var modelsHTML string

//go:embed curators.html
var curatorsHTML string

//go:embed museum.js
var museumJS []byte

//go:embed museum.css
var museumCSS []byte

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
			// with the asker's name, so the record can say what they gave it
			var q url.Values
			if person := identify(cfg, r); person != nil {
				q = url.Values{"by": {person.Name}}
			}
			darkoak(cfg, w, "GET", "/artifacts/"+url.PathEscape(id), q, nil)
			return
		}
		darkoak(cfg, w, "GET", "/artifacts", r.URL.Query(), nil)
	}
}

// museumSay posts a curator's fields on a record: the note, the status, whether it is on
// display, where it came from, the tags. Curators only; a visitor's part is the stars,
// through museumVote. The name is the invitation's, never the body's.
func museumSay(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		person := identify(cfg, r)
		if !person.Admin() {
			http.Error(w, "a record's fields are the curators'; anyone with a name may give it stars", http.StatusForbidden)
			return
		}
		var said map[string]any
		if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&said); err != nil {
			http.Error(w, "not json", http.StatusBadRequest)
			return
		}
		allowed := map[string]bool{"add": true, "remove": true, "note": true, "status": true, "author": true, "year": true, "source": true, "license": true, "shown": true}
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

// museumVote is a visitor's stars on a record, in their invitation's name.
func museumVote(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		person := identify(cfg, r)
		if person == nil {
			http.Error(w, "stars take a name: open the museum from your own invitation link", http.StatusForbidden)
			return
		}
		var vote struct {
			Stars int `json:"stars"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&vote); err != nil || vote.Stars < 0 || vote.Stars > 5 {
			http.Error(w, "stars are 0 to 5", http.StatusBadRequest)
			return
		}
		body, _ := json.Marshal(map[string]any{"by": person.Name, "stars": vote.Stars})
		darkoak(cfg, w, "POST", "/artifacts/"+url.PathEscape(r.PathValue("id"))+"/vote", nil, strings.NewReader(string(body)))
	}
}

// museumPlay changes a server's map for a visitor: the lab for anyone with a name, main for
// a curator. The map comes to the browser the game's way, so nothing is bundled first. On
// the lab, bots asked for join once the map is up: the lab's own config keeps them at
// zero on every map change (a bot on an unseen map builds a navigation mesh first), so
// the quota is set after it.
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
			Bots   int    `json:"bots"`
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
		logger.Infof("museum: %s loads %s on %d (bots %d)", person.Name, want.Map, port, want.Bots)
		if port == 27016 && want.Bots > 0 && want.Bots <= 4 {
			bots := want.Bots
			go func() {
				time.Sleep(8 * time.Second)
				for _, c := range []string{"bot_difficulty 1", "bot_join_team any", fmt.Sprintf("bot_quota %d", bots)} {
					if _, err := rcon(fmt.Sprintf("%s:%d", cfg.CSHost, port), password, c); err != nil {
						logger.Warnf("museum: the lab did not take %q: %v", c, err)
					}
				}
			}()
		}
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

// museumCurate is the curator's back office through the same door: an import of a
// catalogue, and the journal. Curators only.
func museumCurate(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		person := identify(cfg, r)
		if !person.Admin() {
			http.Error(w, "the back office is the curators'", http.StatusForbidden)
			return
		}
		switch r.PathValue("what") {
		case "import":
			body, _ := io.ReadAll(io.LimitReader(r.Body, 4<<10))
			logger.Infof("museum: %s imports %s", person.Name, strings.TrimSpace(string(body)))
			darkoak(cfg, w, "POST", "/import", nil, strings.NewReader(string(body)))
		case "journal":
			darkoak(cfg, w, "GET", "/journal", r.URL.Query(), nil)
		case "seed":
			logger.Infof("museum: %s seeds the display", person.Name)
			body, _ := json.Marshal(map[string]any{"by": person.Name})
			darkoak(cfg, w, "POST", "/seed", nil, strings.NewReader(string(body)))
		default:
			http.NotFound(w, r)
		}
	}
}

// wingPage serves one of the museum's pages with who is here written in: their name and
// whether they are a curator, from the invitation, or null on the family login alone.
func wingPage(cfg Config, page string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		person := identify(cfg, r)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		me := "null"
		if person != nil {
			b, _ := json.Marshal(map[string]any{"name": person.Name, "curator": person.Admin()})
			me = string(b)
		}
		w.Write([]byte(strings.Replace(page, "__ME_JSON__", me, 1)))
	}
}

func museumAsset(kind string, body []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", kind)
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(body)
	}
}

// previewsList says which records have pictures: the ids with a <id>.jpg under
// content/previews, made offline by scripts/previews.mjs. The wings ask once and show a
// picture only where there is one.
func previewsList(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ids := []int64{}
		entries, _ := os.ReadDir(filepath.Join(cfg.ContentDir, "previews"))
		for _, e := range entries {
			name := e.Name()
			if !strings.HasSuffix(name, ".jpg") || strings.Contains(name, "-") {
				continue
			}
			if id, err := strconv.ParseInt(strings.TrimSuffix(name, ".jpg"), 10, 64); err == nil {
				ids = append(ids, id)
			}
		}
		w.Header().Set("Cache-Control", "no-cache")
		writeJSON(w, map[string]any{"ids": ids})
	}
}

// roadmapFile serves docs/roadmap.md, which the curators' room renders.
func roadmapFile(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		http.ServeFile(w, r, filepath.Join(cfg.DocsDir, "roadmap.md"))
	}
}

func redirectTo(target string, code int) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target+queryOf(r), code) }
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
