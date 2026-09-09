package main

// Reading and writing how the server plays: the game type, the map, and the handful of
// knobs the page offers. "Until it is told otherwise" is the whole point — the settings go
// into the mode's own .cfg, which amxx.cfg re-runs on every map load, so a map change does
// not quietly undo them and neither does a restart. See settings.go for the door.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// A mode as the server files describe it: the name, what it is called on screen, and the
// maps its rotation names.
type Mode struct {
	Name    string
	Display string
	Purpose string
	Maps    []string
}

// One set of choices, as the page sends them.
type adminView struct {
	Mode     string
	Map      string
	Gravity  int
	Bhop     bool
	MaxFunds bool
}

var settableName = regexp.MustCompile(`^[A-Za-z0-9_.\-]+$`)

// gravities offered, and the one the game shipped with.
var gravities = []int{100, 200, 400, 800}

// readModes reads the mode files the server itself reads: one .cfg and one .maps.txt each,
// named in modes.json.
func readModes(dir string) ([]Mode, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "modes.json"))
	if err != nil {
		return nil, err
	}
	var manifest struct {
		Modes []struct {
			Name    string `json:"name"`
			Display string `json:"display"`
			Purpose string `json:"purpose"`
		} `json:"modes"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return nil, err
	}
	modes := make([]Mode, 0, len(manifest.Modes))
	for _, m := range manifest.Modes {
		mode := Mode{Name: m.Name, Display: m.Display, Purpose: m.Purpose}
		if list, err := os.ReadFile(filepath.Join(dir, m.Name+".maps.txt")); err == nil {
			for _, line := range strings.Split(string(list), "\n") {
				if name := strings.TrimSpace(line); name != "" && !strings.HasPrefix(name, "//") {
					mode.Maps = append(mode.Maps, name)
				}
			}
		}
		modes = append(modes, mode)
	}
	return modes, nil
}

// currentSettings reads the mode in force and the knobs this page owns out of its file.
func currentSettings(dir string, modes []Mode) (mode string, gravity int, bhop, maxFunds bool) {
	gravity, mode = 800, ""
	if raw, err := os.ReadFile(filepath.Join(dir, "current.cfg")); err == nil {
		if found := regexp.MustCompile(`modes/([A-Za-z0-9_-]+)\.cfg`).FindSubmatch(raw); found != nil {
			mode = string(found[1])
		}
	}
	if mode == "" && len(modes) > 0 {
		mode = modes[0].Name
	}
	raw, err := os.ReadFile(filepath.Join(dir, mode+".cfg"))
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(raw), "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 2 {
			continue
		}
		switch fields[0] {
		case "sv_gravity":
			gravity, _ = strconv.Atoi(fields[1])
		case "sv_enablebunnyhopping":
			bhop = fields[1] == "1"
		case "mp_startmoney":
			money, _ := strconv.Atoi(fields[1])
			maxFunds = money >= 16000
		}
	}
	return
}

// currentMap asks the server what it is playing, which discovery already knows.
func currentMap(cfg Config) string {
	if server := serverManager.GetServer(fmt.Sprintf("%s:%d", cfg.CSHost, cfg.PrimaryPort)); server != nil {
		return server.Map
	}
	return ""
}

// apply writes the settings into the mode's file, tells the running server about them,
// and changes to the chosen map. Nobody is disconnected: the map changes under them, as
// it does at the end of every map anyway.
func apply(cfg Config, modes []Mode, want adminView) (message, problem string) {
	mode := findMode(modes, want.Mode)
	if mode == nil {
		return "", "no such game type"
	}
	if want.Map != "" && !settableName.MatchString(want.Map) {
		return "", "that is not a map name"
	}
	if sort.SearchInts(gravities, want.Gravity) == len(gravities) || !contains(gravities, want.Gravity) {
		return "", "gravity must be one of the offered numbers"
	}

	settings := map[string]string{
		"sv_gravity":            strconv.Itoa(want.Gravity),
		"sv_enablebunnyhopping": boolCvar(want.Bhop),
		"mp_timelimit":          "15",
	}
	// Money is Counter-Strike's own; in the deathmatch modes it is set to the maximum
	// already and the choice does not appear on the page.
	if mode.Name == "classic" {
		settings["mp_startmoney"] = map[bool]string{true: "16000", false: "800"}[want.MaxFunds]
	}
	if err := writeSettings(filepath.Join(cfg.ModesDir, mode.Name+".cfg"), settings); err != nil {
		return "", "could not write the mode file: " + err.Error()
	}
	if err := os.WriteFile(filepath.Join(cfg.ModesDir, "current.cfg"),
		[]byte(fmt.Sprintf("exec modes/%s.cfg\n", mode.Name)), 0o644); err != nil {
		return "", "could not choose the mode: " + err.Error()
	}

	password, err := rconPassword(cfg.EnvFile)
	if err != nil {
		return "", "the settings are saved, but the server could not be told: " + err.Error()
	}
	address := fmt.Sprintf("%s:%d", cfg.CSHost, cfg.PrimaryPort)
	commands := []string{fmt.Sprintf("exec modes/%s.cfg", mode.Name)}
	if want.Map != "" {
		commands = append(commands, "changelevel "+want.Map)
	}
	for _, command := range commands {
		if _, err := rcon(address, password, command); err != nil {
			return "", "the settings are saved, but the server did not answer: " + err.Error()
		}
		time.Sleep(200 * time.Millisecond)
	}
	where := mode.Display
	if want.Map != "" {
		where += " on " + want.Map
	}
	return "Now playing " + where + ".", ""
}

// writeSettings replaces the named cvars in a mode file and leaves everything else — the
// comments, the order, the settings this page does not own — exactly as it found them.
func writeSettings(path string, settings map[string]string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	lines := strings.Split(string(raw), "\n")
	seen := map[string]bool{}
	for i, line := range lines {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 2 {
			continue
		}
		if value, wanted := settings[fields[0]]; wanted {
			lines[i] = fields[0] + " " + value
			seen[fields[0]] = true
		}
	}
	var missing []string
	for name, value := range settings {
		if !seen[name] {
			missing = append(missing, name+" "+value)
		}
	}
	sort.Strings(missing)
	body := strings.Join(lines, "\n")
	if len(missing) > 0 {
		body = strings.TrimRight(body, "\n") + "\n" + strings.Join(missing, "\n") + "\n"
	}
	return os.WriteFile(path, []byte(body), 0o644)
}

func findMode(modes []Mode, name string) *Mode {
	for i := range modes {
		if modes[i].Name == name {
			return &modes[i]
		}
	}
	return nil
}

func contains(numbers []int, want int) bool {
	for _, n := range numbers {
		if n == want {
			return true
		}
	}
	return false
}

func boolCvar(on bool) string {
	if on {
		return "1"
	}
	return "0"
}
