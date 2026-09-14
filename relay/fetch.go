package main

// The proxy for a server's fast-download site. A browser may not fetch from another
// origin, so the engine's downloads (net_http_web.c through the page) come here:
// /fetch?url=<absolute>. Only http(s), only the sizes a game file has, kept on the
// relay's disk under content/fetched/<host>/<path> so the second player on that map
// costs the site nothing. Family login, like every door; an outside session's own
// download URL is what will arrive here in practice.

import (
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const fetchLimit = 64 << 20 // no game file is bigger

func fetchHandler(cfg Config) http.HandlerFunc {
	client := &http.Client{Timeout: 90 * time.Second}
	return func(w http.ResponseWriter, r *http.Request) {
		raw := r.URL.Query().Get("url")
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			http.Error(w, "url must be an absolute http(s) address", http.StatusBadRequest)
			return
		}
		// Our own /raw/ under another name — the public host asked for from a LAN origin, or
		// the reverse — is served from disk, login already checked at the door.
		if strings.HasPrefix(u.Path, "/raw/") && (strings.EqualFold(u.Host, r.Host) || (cfg.PublicHost != "" && strings.EqualFold(u.Host, cfg.PublicHost))) {
			if path := rawFile(cfg, strings.TrimPrefix(u.Path, "/raw/")); path != "" {
				http.ServeFile(w, r, path)
				return
			}
			http.NotFound(w, r)
			return
		}
		// A cache key that is a safe path: host, then the URL's path with nothing above it.
		rel := filepath.Clean("/" + u.Path)
		if strings.Contains(rel, "..") || rel == "/" {
			http.Error(w, "not a file", http.StatusBadRequest)
			return
		}
		local := filepath.Join(cfg.ContentDir, "fetched", strings.ReplaceAll(u.Host, ":", "_"), filepath.FromSlash(rel))
		if info, err := os.Stat(local); err == nil && !info.IsDir() {
			http.ServeFile(w, r, local)
			return
		}
		req, _ := http.NewRequest("GET", u.String(), nil)
		req.Header.Set("User-Agent", eyeAgent)
		res, err := client.Do(req)
		if err != nil {
			http.Error(w, "the site did not answer: "+err.Error(), http.StatusBadGateway)
			return
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			http.Error(w, "the site said "+res.Status, http.StatusBadGateway)
			return
		}
		body, err := io.ReadAll(io.LimitReader(res.Body, fetchLimit+1))
		if err != nil || len(body) > fetchLimit {
			http.Error(w, "the file could not be read, or is too big to be a game file", http.StatusBadGateway)
			return
		}
		if err := os.MkdirAll(filepath.Dir(local), 0o755); err == nil {
			_ = os.WriteFile(local, body, 0o644)
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		w.Write(body)
	}
}
