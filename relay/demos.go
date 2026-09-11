package main

// The demo viewer: GoldSrc .dem files dropped into content/demos, listed with what their
// headers say, played in the browser by hlviewer.js over the server's own maps, wads and
// skies (served plainly at /raw): the map and the recorded camera, no player models.
// Since engine patch 0005 the game itself plays them too (playdemo, full first person);
// bench/hldemo.mjs is how, until the play page has a way in. See
// docs/proposals/demo-playback.md.

import (
	_ "embed"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

//go:embed demos.html
var demosHTML []byte

func demosPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(demosHTML)
}

type demoFile struct {
	Name     string    `json:"name"`
	Bytes    int64     `json:"bytes"`
	Modified time.Time `json:"modified"`
	Map      string    `json:"map,omitempty"` // read from the demo's header, if it is a GoldSrc demo
	Game     string    `json:"game,omitempty"`
	Protocol int32     `json:"protocol,omitempty"`
	Problem  string    `json:"problem,omitempty"`
}

// demosHandler lists content/demos/*.dem with what each demo's header says about itself.
func demosHandler(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dir := filepath.Join(cfg.ContentDir, "demos")
		entries, _ := os.ReadDir(dir)
		demos := []demoFile{}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".dem") {
				continue
			}
			info, err := entry.Info()
			if err != nil {
				continue
			}
			d := demoFile{Name: entry.Name(), Bytes: info.Size(), Modified: info.ModTime()}
			d.Map, d.Game, d.Protocol, d.Problem = demoHeader(filepath.Join(dir, entry.Name()))
			demos = append(demos, d)
		}
		sort.Slice(demos, func(i, j int) bool { return demos[i].Modified.After(demos[j].Modified) })
		writeJSON(w, map[string]any{"demos": demos})
	}
}

// demoHeader reads the fixed header of a GoldSrc demo: "HLDEMO\0\0", the demo and network
// protocol versions, the map name and the game directory. Enough to say what a file is
// before anything tries to play it.
func demoHeader(path string) (mapName, game string, protocol int32, problem string) {
	f, err := os.Open(path)
	if err != nil {
		return "", "", 0, err.Error()
	}
	defer f.Close()
	var header [8 + 4 + 4 + 260 + 260]byte
	if _, err := f.Read(header[:]); err != nil {
		return "", "", 0, "too short to be a demo"
	}
	if string(header[:6]) != "HLDEMO" {
		return "", "", 0, "not a GoldSrc demo (no HLDEMO magic)"
	}
	le := func(b []byte) int32 { return int32(b[0]) | int32(b[1])<<8 | int32(b[2])<<16 | int32(b[3])<<24 }
	demoProtocol := le(header[8:12])
	protocol = le(header[12:16])
	cstr := func(b []byte) string {
		if i := strings.IndexByte(string(b), 0); i >= 0 {
			return string(b[:i])
		}
		return string(b)
	}
	mapName = cstr(header[16 : 16+260])
	game = cstr(header[16+260 : 16+520])
	if demoProtocol != 5 {
		problem = "demo protocol " + itoa(demoProtocol) + " (5 is the one hlviewer reads)"
	}
	return mapName, game, protocol, problem
}

func itoa(n int32) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	if neg {
		b = append([]byte{'-'}, b...)
	}
	return string(b)
}
