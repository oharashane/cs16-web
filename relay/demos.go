package main

// The demos: GoldSrc .dem files in content/demos, listed with what each one says about
// itself (demoinfo.go), uploaded and removed here by admins, and played by the game
// itself at /demos/<name> — the play page in its demo mode, on the engine with patches
// 0005 and 0006. See docs/proposals/demo-playback.md.

import (
	_ "embed"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

//go:embed demos.html
var demosHTML []byte

func demosPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(demosHTML)
}

// demoPlayerPage serves the play page for /demos/<name>: the same built client, which
// reads the demo's name from the path and plays it instead of joining a server.
func demoPlayerPage(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := demoFileName(r.PathValue("name"))
		if name == "" || !demoExists(cfg, name) {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		http.ServeFile(w, r, filepath.Join(cfg.ClientDir, "index.html"))
	}
}

func demosDir(cfg Config) string { return filepath.Join(cfg.ContentDir, "demos") }

func demoExists(cfg Config, name string) bool {
	st, err := os.Stat(filepath.Join(demosDir(cfg), name))
	return err == nil && !st.IsDir()
}

var unsafeInName = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// demoFileName makes a file name we are willing to serve and store from whatever a
// request or an upload called it: the base name, the odd characters replaced, .dem at
// the end. Empty when nothing is left.
func demoFileName(given string) string {
	name := filepath.Base(strings.ReplaceAll(given, "\\", "/"))
	name = strings.TrimSpace(name)
	if name == "." || name == ".." || name == "/" {
		return ""
	}
	stem := strings.TrimSuffix(strings.TrimSuffix(name, ".dem"), ".DEM")
	stem = strings.Trim(unsafeInName.ReplaceAllString(stem, "_"), "._")
	if stem == "" {
		return ""
	}
	return stem + ".dem"
}

// demosHandler: GET lists every demo with its details; POST takes uploads (multipart,
// any number of files in the "demo" field, or one raw body with ?name=); the details
// come from a sidecar written the first time a file is read.
func demosHandler(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			listDemos(cfg, w)
		case http.MethodPost:
			uploadDemos(cfg, w, r)
		default:
			http.Error(w, "GET or POST", http.StatusMethodNotAllowed)
		}
	}
}

func listDemos(cfg Config, w http.ResponseWriter) {
	dir := demosDir(cfg)
	entries, _ := os.ReadDir(dir)
	have := haveResources(cfg)
	demos := []demoInfo{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".dem") {
			continue
		}
		info, err := demoInfoFor(filepath.Join(dir, entry.Name()), have)
		if err != nil {
			continue
		}
		info.MapMissing = info.Map != "" && have("maps/"+info.Map+".bsp") == ""
		demos = append(demos, info)
	}
	sort.Slice(demos, func(i, j int) bool { return demos[i].Modified.After(demos[j].Modified) })
	writeJSON(w, map[string]any{"demos": demos})
}

// One demo's details, and DELETE removes it (and its sidecar).
func demoHandler(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := demoFileName(r.PathValue("name"))
		if name == "" || !demoExists(cfg, name) {
			http.NotFound(w, r)
			return
		}
		path := filepath.Join(demosDir(cfg), name)
		switch r.Method {
		case http.MethodGet:
			have := haveResources(cfg)
			info, err := demoInfoFor(path, have)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			info.MapMissing = info.Map != "" && have("maps/"+info.Map+".bsp") == ""
			writeJSON(w, info)
		case http.MethodDelete:
			if err := os.Remove(path); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			_ = os.Remove(path + ".json")
			logger.Infof("demo removed: %s", name)
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "GET or DELETE", http.StatusMethodNotAllowed)
		}
	}
}

const maxDemoUpload = 2 << 30 // an HLTV match is a few hundred megabytes; two gigabytes is room

func uploadDemos(cfg Config, w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxDemoUpload)
	dir := demosDir(cfg)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	replace := r.URL.Query().Get("replace") == "1"
	type outcome struct {
		Name    string `json:"name"`
		Bytes   int64  `json:"bytes,omitempty"`
		Problem string `json:"problem,omitempty"`
	}
	var results []outcome
	save := func(given string, body io.Reader) {
		name := demoFileName(given)
		if name == "" {
			results = append(results, outcome{Name: given, Problem: "no usable name"})
			return
		}
		path := filepath.Join(dir, name)
		if !replace && demoExists(cfg, name) {
			results = append(results, outcome{Name: name, Problem: "already here (upload with ?replace=1 to replace it)"})
			return
		}
		// the first bytes say whether it is a demo at all, before anything is written
		head := make([]byte, 12)
		n, err := io.ReadFull(body, head)
		if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) {
			results = append(results, outcome{Name: name, Problem: err.Error()})
			return
		}
		if err := sniffDemo(head[:n]); err != nil {
			results = append(results, outcome{Name: name, Problem: err.Error()})
			return
		}
		tmp, err := os.CreateTemp(dir, ".upload-*")
		if err != nil {
			results = append(results, outcome{Name: name, Problem: err.Error()})
			return
		}
		written, err := io.Copy(tmp, io.MultiReader(strings.NewReader(string(head[:n])), body))
		tmp.Close()
		if err != nil {
			os.Remove(tmp.Name())
			results = append(results, outcome{Name: name, Problem: err.Error()})
			return
		}
		if err := os.Rename(tmp.Name(), path); err != nil {
			os.Remove(tmp.Name())
			results = append(results, outcome{Name: name, Problem: err.Error()})
			return
		}
		_ = os.Remove(path + ".json") // a replaced file's details are stale
		logger.Infof("demo uploaded: %s (%d bytes)", name, written)
		results = append(results, outcome{Name: name, Bytes: written})
	}

	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
		reader, err := r.MultipartReader()
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if part.FormName() != "demo" || part.FileName() == "" {
				part.Close()
				continue
			}
			save(part.FileName(), part)
			part.Close()
		}
	} else {
		save(r.URL.Query().Get("name"), r.Body)
	}
	if len(results) == 0 {
		http.Error(w, "no files: send them as the multipart field \"demo\"", http.StatusBadRequest)
		return
	}
	writeJSON(w, map[string]any{"uploaded": results})
}
