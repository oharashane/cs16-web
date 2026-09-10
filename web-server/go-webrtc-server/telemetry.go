package main

// What helps: every ten seconds, one line per player into logs/telemetry.jsonl — the
// game ping and loss the server reports for them (rcon status), the browser→relay round
// trip ICE measures, the relay's packet rates for their session, and what the client
// last said about itself: its network settings, its frame rate, whether the tab was in
// front. Shane flips the settings tonight; the file says which combination was better,
// in numbers rather than impressions. /telemetry shows the last while, for admins.

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// clientReport is what the page posts about itself while playing.
type clientReport struct {
	Name      string            `json:"name"`
	Settings  map[string]string `json:"settings"` // cl_updaterate, cl_cmdrate, ex_interp, rate
	FPS       float64           `json:"fps"`
	Hidden    bool              `json:"hidden"`    // frames driven by the worker clock right now
	Takeovers int               `json:"takeovers"` // how often the worker clock has taken over this visit
	Keepalive bool              `json:"keepalive"` // the keepalive is on at all (?keepalive=0 turns it off)
	Sharp     bool              `json:"sharp"`
	At        time.Time         `json:"-"`
}

// sample is one line of the file.
type sample struct {
	At           time.Time         `json:"at"`
	Name         string            `json:"name"`
	Server       string            `json:"server,omitempty"`
	GamePingMs   *int              `json:"game_ping_ms,omitempty"` // the server's view, from status
	LossPercent  *int              `json:"loss_percent,omitempty"`
	RelayRttMs   *float64          `json:"relay_rtt_ms,omitempty"` // browser → relay, ICE
	ToServerPPS  float64           `json:"to_server_pps"`
	FromServerPP float64           `json:"from_server_pps"`
	Settings     map[string]string `json:"settings,omitempty"`
	ServerSees   map[string]string `json:"server_sees,omitempty"` // the client's rates as the server has them (rcon user)
	FPS          float64           `json:"fps,omitempty"`
	Hidden       bool              `json:"hidden,omitempty"`
	Takeovers    int               `json:"takeovers,omitempty"`
	Keepalive    *bool             `json:"keepalive,omitempty"`
	ServerRates  map[string]string `json:"server_rates,omitempty"`
}

type telemetry struct {
	cfg     Config
	mu      sync.Mutex
	reports map[string]clientReport // by player name
	last    map[[4]byte][2]int64    // packets to/from at the last tick, per session
	rates   map[string]string       // the server's sv_maxrate etc., refreshed each minute
}

var statusPlayer = regexp.MustCompile(`(?m)^#\s*\d+\s+"([^"]*)"\s+\S+\s+\S+\s+-?\d+\s+[\d:]+\s+(\d+)\s+(\d+)`)
var userinfoLine = regexp.MustCompile(`(?m)^(cl_updaterate|rate)\s+(\S+)`)
var cvarValue = regexp.MustCompile(`is "([^"]*)"`)

var telemetryLog *telemetry

func startTelemetry(cfg Config) {
	if cfg.TelemetryFile == "" {
		return
	}
	telemetryLog = &telemetry{cfg: cfg, reports: map[string]clientReport{}, last: map[[4]byte][2]int64{}, rates: map[string]string{}}
	go telemetryLog.run()
}

func (t *telemetry) run() {
	tick := time.NewTicker(10 * time.Second)
	defer tick.Stop()
	minute := 0
	for range tick.C {
		if minute%6 == 0 {
			t.readRates()
		}
		minute++
		t.sample()
	}
}

func (t *telemetry) address() string { return fmt.Sprintf("%s:%d", t.cfg.CSHost, t.cfg.PrimaryPort) }

func (t *telemetry) readRates() {
	password, err := rconPassword(t.cfg.EnvFile)
	if err != nil {
		return
	}
	rates := map[string]string{}
	for _, name := range []string{"sv_maxrate", "sv_maxupdaterate", "sv_minupdaterate", "sys_ticrate"} {
		if answer, err := rcon(t.address(), password, name); err == nil {
			if m := cvarValue.FindStringSubmatch(answer); m != nil {
				rates[name] = m[1]
			}
		}
	}
	t.mu.Lock()
	t.rates = rates
	t.mu.Unlock()
}

// sample writes one line per session that has a name (an invited person's, or what the
// client reported), joining the server's status by that name.
func (t *telemetry) sample() {
	conns := serverManager.Connections()
	if len(conns) == 0 {
		return
	}
	pings := map[string][2]int{}
	sees := map[string]map[string]string{}
	if password, err := rconPassword(t.cfg.EnvFile); err == nil {
		if status, err := rcon(t.address(), password, "status"); err == nil {
			for _, m := range statusPlayer.FindAllStringSubmatch(status, -1) {
				ping, _ := strconv.Atoi(m[2])
				loss, _ := strconv.Atoi(m[3])
				pings[m[1]] = [2]int{ping, loss}
				// What the server has for this client's rates — the proof a setting took,
				// from the side that would be choking if it had not.
				if !strings.ContainsAny(m[1], "\"\n;") {
					if info, err := rcon(t.address(), password, fmt.Sprintf("user \"%s\"", m[1])); err == nil {
						seen := map[string]string{}
						for _, kv := range userinfoLine.FindAllStringSubmatch(info, -1) {
							seen[kv[1]] = kv[2]
						}
						if len(seen) > 0 {
							sees[m[1]] = seen
						}
					}
				}
			}
		}
	}
	now := time.Now()
	t.mu.Lock()
	defer t.mu.Unlock()
	var lines []sample
	for _, conn := range conns {
		name := conn.Name
		report, reported := t.reports[name]
		if name == "" {
			// An anonymous session: find a report by elimination — the one whose name is
			// on the server and not an invited person's.
			for n, r := range t.reports {
				if now.Sub(r.At) < 30*time.Second {
					if _, onServer := pings[n]; onServer {
						name, report, reported = n, r, true
						break
					}
				}
			}
		}
		if name == "" {
			continue
		}
		to, from := conn.PacketsToServer.Load(), conn.PacketsFromServer.Load()
		prev, had := t.last[conn.IP]
		t.last[conn.IP] = [2]int64{to, from}
		s := sample{At: now, Name: name, Server: conn.ServerID, ServerRates: t.rates}
		if had {
			s.ToServerPPS = float64(to-prev[0]) / 10
			s.FromServerPP = float64(from-prev[1]) / 10
		}
		if p, ok := pings[name]; ok {
			ping, loss := p[0], p[1]
			s.GamePingMs, s.LossPercent = &ping, &loss
		}
		s.ServerSees = sees[name]
		if conn.Peer != nil {
			s.RelayRttMs = roundTrip(conn.Peer)
		}
		if reported && now.Sub(report.At) < 30*time.Second {
			s.Settings, s.FPS, s.Hidden, s.Takeovers = report.Settings, report.FPS, report.Hidden, report.Takeovers
			keepalive := report.Keepalive
			s.Keepalive = &keepalive
		}
		lines = append(lines, s)
	}
	if len(lines) == 0 {
		return
	}
	if err := os.MkdirAll(filepath.Dir(t.cfg.TelemetryFile), 0o755); err != nil {
		return
	}
	f, err := os.OpenFile(t.cfg.TelemetryFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		logger.Warnf("telemetry: %v", err)
		return
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	for _, s := range lines {
		_ = enc.Encode(s)
	}
}

// telemetryHandler: POST is the client's report about itself; GET (admins) is the last
// while of samples, newest last, ?minutes=30 by default.
func telemetryHandler(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			if telemetryLog == nil {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			var report clientReport
			if err := json.NewDecoder(r.Body).Decode(&report); err != nil || report.Name == "" {
				http.Error(w, "a name and settings, as JSON", http.StatusBadRequest)
				return
			}
			if person := identify(cfg, r); person != nil {
				report.Name = person.Name
			}
			report.At = time.Now()
			telemetryLog.mu.Lock()
			telemetryLog.reports[report.Name] = report
			telemetryLog.mu.Unlock()
			w.WriteHeader(http.StatusNoContent)
			return
		}
		minutes, _ := strconv.Atoi(r.URL.Query().Get("minutes"))
		if minutes <= 0 {
			minutes = 30
		}
		since := time.Now().Add(-time.Duration(minutes) * time.Minute)
		rows := []json.RawMessage{}
		if f, err := os.Open(cfg.TelemetryFile); err == nil {
			defer f.Close()
			scanner := bufio.NewScanner(f)
			scanner.Buffer(make([]byte, 1<<20), 1<<20)
			for scanner.Scan() {
				line := scanner.Bytes()
				var head struct {
					At time.Time `json:"at"`
				}
				if json.Unmarshal(line, &head) == nil && head.At.After(since) {
					rows = append(rows, json.RawMessage(strings.Clone(string(line))))
				}
			}
		}
		writeJSON(w, map[string]any{"minutes": minutes, "samples": rows})
	}
}
