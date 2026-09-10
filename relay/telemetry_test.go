package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestTelemetryReportsAndSamples(t *testing.T) {
	cfg, ps := testPeople(t)
	cfg.TelemetryFile = filepath.Join(t.TempDir(), "telemetry.jsonl")
	admin, _ := ps.Add("shane", "admin")
	telemetryLog = &telemetry{cfg: cfg, reports: map[string]clientReport{}, last: map[[4]byte][2]int64{}, rates: map[string]string{}}
	t.Cleanup(func() { telemetryLog = nil })
	handler := newHandler(cfg)

	// The client reports itself; an invited person's report is filed under their name.
	report := httptest.NewRequest("POST", "/api/telemetry", strings.NewReader(`{"name":"typed","settings":{"cl_updaterate":"30"},"fps":58}`))
	report.AddCookie(&http.Cookie{Name: personCookie, Value: admin.Token})
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, report)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("report: %d %s", rr.Code, rr.Body.String())
	}
	if r, ok := telemetryLog.reports["shane"]; !ok || r.Settings["cl_updaterate"] != "30" || r.FPS != 58 {
		t.Fatalf("the report was not filed under the person: %+v", telemetryLog.reports)
	}

	// Reading the samples is for admins; the file's lines come back newest last.
	line, _ := json.Marshal(sample{At: time.Now(), Name: "shane", FPS: 58, Settings: map[string]string{"cl_updaterate": "30"}})
	old, _ := json.Marshal(sample{At: time.Now().Add(-2 * time.Hour), Name: "shane"})
	os.WriteFile(cfg.TelemetryFile, append(append(old, '\n'), append(line, '\n')...), 0o644)
	read := httptest.NewRequest("GET", "/api/telemetry?minutes=30", nil)
	read.AddCookie(&http.Cookie{Name: personCookie, Value: admin.Token})
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, read)
	var answer struct{ Samples []sample }
	json.Unmarshal(rr.Body.Bytes(), &answer)
	if rr.Code != http.StatusOK || len(answer.Samples) != 1 || answer.Samples[0].FPS != 58 {
		t.Fatalf("samples: %d %s", rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, httptest.NewRequest("GET", "/api/telemetry", nil))
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("a stranger read the telemetry: %d", rr.Code)
	}
}

func TestStatusLineParsing(t *testing.T) {
	status := "hostname:  CS\n#      name userid uniqueid frag time ping loss adr\n#  1 \"shane\" 12 STEAM_6:0:1 3 12:04 27 0 127.1.0.1:5000\n#  2 \"kid two\" 13 STEAM_6:0:2 -1 00:31 112 4 127.1.0.2:5001\n"
	m := statusPlayer.FindAllStringSubmatch(status, -1)
	if len(m) != 2 || m[0][1] != "shane" || m[0][2] != "27" || m[1][1] != "kid two" || m[1][3] != "4" {
		t.Fatalf("status parsed as %v", m)
	}
}
