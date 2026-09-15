package main

// A fly-through of one map, from the server's files or from a scanned drive, in
// hlviewer.js: the curator's desk links here to look at a map before deciding anything
// about it. ?path= names the .bsp — under the drive's organized view, or a bare name for
// one the server serves.

import (
	"html"
	"net/http"
	"path"
	"strings"
)

func flyPage(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p := strings.ReplaceAll(r.URL.Query().Get("path"), "\\", "/")
		var mapsBase, wadsBase, skyBase, name string
		switch {
		case p == "":
			http.Error(w, "?path=<a map .bsp on the drive, or a map name on the server>", http.StatusBadRequest)
			return
		case cfg.DriveDir != "" && strings.HasPrefix(p, cfg.DriveDir+"/"):
			rel := strings.TrimPrefix(p, cfg.DriveDir+"/")
			if under(cfg.DriveDir, rel) == "" {
				http.NotFound(w, r)
				return
			}
			mapsBase, wadsBase, skyBase = "drive/"+path.Dir(rel), "drive/content/wad", "drive/content/gfx/env"
			name = strings.TrimSuffix(path.Base(rel), ".bsp")
		default:
			mapsBase, wadsBase, skyBase = "raw/maps", "raw/wads", "raw/gfx/env"
			name = strings.TrimSuffix(path.Base(p), ".bsp")
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write([]byte(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>` + html.EscapeString(name) + ` — fly-through</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/hlviewer.js@0.8.5/dist/hlviewer.js.css">
<style>:root{color-scheme:dark}body{margin:0;background:#111;color:#e8e2cf;font:14px system-ui,sans-serif}#hlv{width:100vw;height:calc(100vh - 34px);background:#000}p{margin:0;padding:8px 12px;opacity:.75}body.still #hlv{height:100vh}body.still p{display:none}</style></head><body class="` + map[bool]string{true: "still", false: ""}[r.URL.Query().Get("still") == "1"] + `">
<div id="hlv"></div><p><b>` + html.EscapeString(name) + `</b> — drag to look, WASD to move. Drawn from the BSP and its wads by hlviewer.js, no engine, so there are no models in it. <span id="s"></span></p>
<script src="https://cdn.jsdelivr.net/npm/hlviewer.js@0.8.5/dist/hlviewer.min.js"></script>
<script>
try { const v = HLViewer.init('#hlv', { paths: { base: '/', replays: 'content/demos', maps: '` + html.EscapeString(mapsBase) + `', wads: '` + html.EscapeString(wadsBase) + `', skies: '` + html.EscapeString(skyBase) + `', sounds: 'raw/sound' } }); window.hlv = v; v.load('` + html.EscapeString(name) + `.bsp'); }
catch (e) { document.getElementById('s').textContent = 'The viewer refused: ' + e; }
</script></body></html>`))
	}
}
