package main

// The all-seeing eye: a server browser, as the 2003 program of that name was. Which
// public Counter-Strike 1.6 servers have people on them right now, and a door to join
// one through this relay — the same bridge as for the house's own servers, with the
// socket's other end somebody else's machine.
//
// Where the list comes from: the GoldSrc master server (hl1master.steampowered.com) no
// longer resolves to anything that answers UDP, so the candidates come from GameTracker's
// public list page for the United States, fetched politely (one page, a named agent,
// cached for ten minutes), and every candidate is then asked directly with A2S_INFO for
// its name, map, players and ping from here. The truth is in the second step; the first
// only says who to ask. Valve's own IGameServersService would replace the first step
// given a Steam Web API key.

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const eyeAgent = "cs16-museum-eye/0.1 (a family museum of Counter-Strike 1.6; contact shane@oharaspace.com)"

type eyeServer struct {
	Addr     string `json:"addr"`
	Name     string `json:"name"`
	Map      string `json:"map"`
	Game     string `json:"game"`
	Players  int    `json:"players"` // humans
	Bots     int    `json:"bots"`
	Max      int    `json:"max"`
	VAC      bool   `json:"vac"`
	Password bool   `json:"password"`
	PingMs   int    `json:"ping_ms"`
	HaveMap  bool   `json:"have_map"`          // the browser's bundles carry the map it is on
	Verdict  string `json:"verdict,omitempty"` // welcomes | steam-only | a refusal's words; empty until somebody has tried
}

var eye struct {
	sync.Mutex
	at      time.Time
	servers []eyeServer
	// What a server said the last time one of ours knocked: "welcomes" a non-Steam client,
	// or "steam-only". Learned from the first connectionless answers of outside sessions
	// (signal.go), never probed — knocking on a server to find out is a player's act.
	verdicts map[string]eyeVerdict
}

type eyeVerdict struct {
	Verdict string    `json:"verdict"` // welcomes, steam-only, or the refusal's own words
	At      time.Time `json:"at"`
}

// eyeLearn reads a server's first answers to a join: a connection accepted ("B ..."), the
// Steam refusal, or another refusal ("9<reason>").
func eyeLearn(addr, text string) {
	var verdict string
	switch {
	case strings.HasPrefix(text, "B "):
		verdict = "welcomes"
	case strings.HasPrefix(text, "9STEAM validation rejected"):
		verdict = "steam-only"
	case strings.HasPrefix(text, "9"):
		verdict = strings.TrimRight(strings.TrimPrefix(text, "9"), ". ")
	default:
		return
	}
	eye.Lock()
	defer eye.Unlock()
	if eye.verdicts == nil {
		eye.verdicts = map[string]eyeVerdict{}
	}
	eye.verdicts[addr] = eyeVerdict{Verdict: verdict, At: time.Now()}
	for i := range eye.servers {
		if eye.servers[i].Addr == addr {
			eye.servers[i].Verdict = verdict
		}
	}
}

// a2sInfo asks one server who it is. The reply may first be a challenge (2020 onward).
func a2sInfo(addr string, timeout time.Duration) (*eyeServer, error) {
	conn, err := net.DialTimeout("udp", addr, timeout)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	query := append([]byte{0xff, 0xff, 0xff, 0xff, 'T'}, []byte("Source Engine Query\x00")...)
	started := time.Now()
	conn.SetDeadline(time.Now().Add(timeout))
	if _, err := conn.Write(query); err != nil {
		return nil, err
	}
	buf := make([]byte, 4096)
	n, err := conn.Read(buf)
	if err != nil {
		return nil, err
	}
	if n >= 9 && buf[4] == 'A' {
		if _, err := conn.Write(append(query, buf[5:9]...)); err != nil {
			return nil, err
		}
		if n, err = conn.Read(buf); err != nil {
			return nil, err
		}
	}
	ping := int(time.Since(started).Milliseconds())
	if n < 6 || buf[4] != 'I' {
		return nil, fmt.Errorf("not an info reply")
	}
	p := 6
	str := func() string {
		if p >= n {
			return ""
		}
		e := p
		for e < n && buf[e] != 0 {
			e++
		}
		s := string(buf[p:e])
		p = e + 1
		return s
	}
	name, mapName, _, game := str(), str(), str(), str()
	if p+9 > n {
		return nil, fmt.Errorf("short info reply")
	}
	p += 2 // app id
	players, maxPlayers, bots := int(buf[p]), int(buf[p+1]), int(buf[p+2])
	p += 3
	// server type, environment, visibility, vac
	visibility, vac := buf[p+2], buf[p+3]
	return &eyeServer{Addr: addr, Name: name, Map: mapName, Game: game, Players: players - bots, Bots: bots, Max: maxPlayers,
		VAC: vac == 1, Password: visibility == 1, PingMs: ping}, nil
}

var eyeAddr = regexp.MustCompile(`href="/server_info/(\d+\.\d+\.\d+\.\d+:\d+)/"`)

// candidates is the polite fetch: GameTracker's page of United States servers by players.
func eyeCandidates() ([]string, error) {
	req, _ := http.NewRequest("GET", "https://www.gametracker.com/search/cs/US/?sort=3&order=DESC&searchipp=50", nil)
	req.Header.Set("User-Agent", eyeAgent)
	client := &http.Client{Timeout: 15 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var out []string
	for _, m := range eyeAddr.FindAllStringSubmatch(string(body), -1) {
		if !seen[m[1]] {
			seen[m[1]] = true
			out = append(out, m[1])
		}
	}
	return out, nil
}

// eyeServers is the list, refreshed when older than ten minutes.
func eyeServers(cfg Config) ([]eyeServer, error) {
	eye.Lock()
	defer eye.Unlock()
	if time.Since(eye.at) < 10*time.Minute && eye.servers != nil {
		return eye.servers, nil
	}
	candidates, err := eyeCandidates()
	if err != nil {
		if eye.servers != nil {
			return eye.servers, nil
		}
		return nil, err
	}
	have := haveResources(cfg)
	var wg sync.WaitGroup
	results := make([]*eyeServer, len(candidates))
	for i, addr := range candidates {
		wg.Add(1)
		go func(i int, addr string) {
			defer wg.Done()
			if s, err := a2sInfo(addr, 1500*time.Millisecond); err == nil {
				s.HaveMap = have("maps/"+s.Map+".bsp") != ""
				results[i] = s
			}
		}(i, addr)
	}
	wg.Wait()
	var servers []eyeServer
	for _, s := range results {
		if s != nil {
			if v, ok := eye.verdicts[s.Addr]; ok {
				s.Verdict = v.Verdict
			}
			servers = append(servers, *s)
		}
	}
	sort.Slice(servers, func(i, j int) bool { return servers[i].Players > servers[j].Players })
	eye.at, eye.servers = time.Now(), servers
	return servers, nil
}

func eyeAPI(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// One server, asked now: the lobby uses this for a server outside the house.
		if to := r.URL.Query().Get("to"); to != "" {
			if _, _, err := net.SplitHostPort(to); err != nil {
				http.Error(w, "to must be host:port", http.StatusBadRequest)
				return
			}
			s, err := a2sInfo(to, 2*time.Second)
			if err != nil {
				http.Error(w, "the server did not answer: "+err.Error(), http.StatusBadGateway)
				return
			}
			s.HaveMap = haveResources(cfg)("maps/"+s.Map+".bsp") != ""
			writeJSON(w, s)
			return
		}
		servers, err := eyeServers(cfg)
		if err != nil {
			http.Error(w, "the list could not be fetched: "+err.Error(), http.StatusBadGateway)
			return
		}
		writeJSON(w, map[string]any{"servers": servers, "at": eye.at})
	}
}

// outsideServer is a server outside the house, for the bridge: probed now, never listed
// by discovery. The port in the ServerConfig is the real one; the ID is host:port.
func outsideServer(to string) (*ServerConfig, error) {
	host, portText, err := net.SplitHostPort(to)
	if err != nil {
		return nil, fmt.Errorf("a server outside is named host:port, and %q is not", to)
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return nil, fmt.Errorf("port %q is not one", portText)
	}
	ip := net.ParseIP(host)
	if ip == nil {
		addrs, err := net.LookupIP(host)
		if err != nil || len(addrs) == 0 {
			return nil, fmt.Errorf("%s does not resolve", host)
		}
		ip = addrs[0]
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() {
		return nil, fmt.Errorf("%s is not outside", host)
	}
	info, err := a2sInfo(net.JoinHostPort(ip.String(), portText), 2*time.Second)
	if err != nil {
		return nil, fmt.Errorf("%s did not answer: %v", to, err)
	}
	return &ServerConfig{ID: net.JoinHostPort(ip.String(), portText), Host: ip.String(), Port: port, Name: info.Name, Map: info.Map,
		Players: info.Players, MaxPlayers: info.Max, Status: "online", LastSeen: time.Now(), GameMode: "outside"}, nil
}

func eyePage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write([]byte(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>The wider world</title>
<style>:root{color-scheme:dark}body{margin:0;padding:24px 16px;background:#141414;color:#e8e2cf;font:14px/1.5 system-ui,sans-serif;max-width:1100px;margin-inline:auto}h1{font-size:1.4rem;margin:0 0 .3rem}.sub{opacity:.7;margin:0 0 1rem;font-size:.9rem}table{border-collapse:collapse;width:100%}td,th{padding:.3rem .5rem;border-bottom:1px solid #2a2a2a;text-align:left;vertical-align:top}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}.muted{opacity:.6}.no{color:#e07a6a}.ok{color:#8fd694}button{font:inherit;padding:.2rem .7rem;background:#262626;color:inherit;border:1px solid #3a352a;border-radius:6px;cursor:pointer}button:hover{border-color:#d9c37a}.pill{font-size:.75rem;border:1px solid #3a352a;border-radius:4px;padding:0 4px;opacity:.8}</style></head><body>
<p class="sub"><a href="/">← the lobby</a> · <a href="/maps">maps</a> · <a href="/models">models</a> · <a href="/recordings">recordings</a> · <a href="/story">the story</a> · <a href="/engine">the engine</a> · <a href="/curators">the curators’ room</a></p>
<h1>The wider world <span class="muted" style="font-size:.9rem;font-weight:400">— the all-seeing eye</span></h1>
<p class="sub">Public Counter-Strike 1.6 servers in the United States with people on them right now — asked directly, one packet each, from this relay. <b>Join</b> takes you there through the museum's own client and bridge; it works when the server accepts a non-Steam client; a map the browser lacks is fetched from the server on the way in. A server that has turned one of us away is marked <b>Steam only</b>; one that let us in, <b>welcomes us</b>; the rest nobody has tried yet — the join says within seconds. This is an experiment: the 2003 program by this name did exactly this, and no browser has.</p>
<p id="status" class="muted">Asking…</p>
<table><thead><tr><th>Server</th><th>Map</th><th class="n">People</th><th class="n">Bots</th><th class="n">Slots</th><th class="n">Ping from here</th><th></th><th></th></tr></thead><tbody id="rows"></tbody></table>
<script>
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
(async () => {
  try {
    const r = await fetch('/api/eye'); if (!r.ok) throw new Error(await r.text());
    const { servers, at } = await r.json();
    document.getElementById('status').textContent = servers.length + ' answered · ' + servers.reduce((a, s) => a + s.players, 0) + ' people playing · as of ' + new Date(at).toLocaleTimeString();
    document.getElementById('rows').innerHTML = servers.map(s => '<tr><td><b>' + esc(s.name) + '</b><br><span class="muted">' + esc(s.addr) + '</span></td><td>' + esc(s.map) + (s.have_map ? '' : ' <span class="pill">downloads on join</span>') + '</td><td class="n">' + s.players + '</td><td class="n">' + s.bots + '</td><td class="n">' + s.max + '</td><td class="n">' + s.ping_ms + ' ms</td><td>' + (s.verdict === 'welcomes' ? '<span class="pill ok">welcomes us</span> ' : s.verdict === 'steam-only' ? '<span class="pill no">Steam only</span> ' : s.verdict ? '<span class="pill no" title="' + esc(s.verdict) + '">refused</span> ' : '') + (s.vac ? '<span class="pill">VAC</span> ' : '') + (s.password ? '<span class="pill">password</span>' : '') + '</td><td>' + (!s.password ? '<a href="/play?server=' + encodeURIComponent(s.addr) + '"><button type="button">Join</button></a>' : '') + '</td></tr>').join('');
  } catch (e) { document.getElementById('status').textContent = 'The eye is closed: ' + e.message; }
})();
</script></body></html>`))
}
