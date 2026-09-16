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
try { const v = HLViewer.init('#hlv', { paths: { base: '/', replays: 'content/demos', maps: '` + html.EscapeString(mapsBase) + `', wads: '` + html.EscapeString(wadsBase) + `', skies: '` + html.EscapeString(skyBase) + `', sounds: 'raw/sound' } }); window.hlv = v; v.load('` + html.EscapeString(name) + `.bsp');
  // ?pose=aerial: the whole map from above at an angle, once it has loaded — the museum's camera
  if (new URLSearchParams(location.search).get('pose') === 'aerial') { const t = setInterval(() => { const g = v.game; if (!g || !g.worldScene || !g.worldScene.bsp) return; clearInterval(t); const vs = g.worldScene.bsp.vertices || g.worldScene.bsp.vertexes || []; let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const p of vs) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); } if (!vs.length) return; const c = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2), span = Math.max(hi[0] - lo[0], hi[1] - lo[1]); const from = [c[0] - span * 0.55, c[1] - span * 0.55, c[2] + span * 0.7]; const d = [c[0] - from[0], c[1] - from[1], c[2] - from[2]]; g.camera.position[0] = from[0]; g.camera.position[1] = from[1]; g.camera.position[2] = from[2]; g.camera.rotation[0] = Math.atan2(-d[2], Math.hypot(d[0], d[1])); g.camera.rotation[1] = Math.atan2(d[1], d[0]); }, 200); } }
catch (e) { document.getElementById('s').textContent = 'The viewer refused: ' + e; }
</script></body></html>`))
	}
}
