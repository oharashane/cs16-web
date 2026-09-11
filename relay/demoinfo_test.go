package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The demos in content/demos are not committed; when they are there, every one must read.
func TestDemoInfoReadsWhatIsThere(t *testing.T) {
	dir := filepath.Join("..", "content", "demos")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Skip("no content/demos")
	}
	have := haveResources(Config{ContentDir: filepath.Join("..", "content"), SharedDir: filepath.Join("..", "cs-server", "shared")})
	seen := 0
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".dem") {
			continue
		}
		seen++
		info := readDemoInfo(filepath.Join(dir, e.Name()), have)
		if info.Problem != "" {
			t.Errorf("%s: %s", e.Name(), info.Problem)
		}
		if info.Map == "" || len(info.Sections) < 2 || info.Seconds <= 0 {
			t.Errorf("%s: header or directory not read: %+v", e.Name(), info.Sections)
		}
		if info.ParsedUpTo != "" {
			t.Errorf("%s: loading section stopped at %s", e.Name(), info.ParsedUpTo)
		}
		if len(info.Resources) == 0 {
			t.Errorf("%s: no resources", e.Name())
		}
		t.Logf("%s: map %s game %s proto %d hltv %v %.0fs %d frames | server %q build %d max %d slot %d recorder %q | gravity %g sky %q | usermsgs %d resources %d (%v) missing %d | commands %d sounds %d frames %v",
			e.Name(), info.Map, info.Game, info.Protocol, info.HLTV, info.Seconds, info.Frames, info.Server, info.Build, info.MaxPlayers, info.Slot, info.Recorder,
			info.Gravity, info.Sky, len(info.UserMessages), len(info.Resources), info.ResourceCounts, info.Missing, len(info.Commands), len(info.ClientSounds), info.FrameTypes)
		if len(info.Commands) > 0 {
			t.Logf("   typed: %s", strings.Join(info.Commands[:min(8, len(info.Commands))], " | "))
		}
		missing := []string{}
		for _, r := range info.Resources {
			if r.Missing && len(missing) < 6 {
				missing = append(missing, r.Kind+":"+r.Path)
			}
		}
		if len(missing) > 0 {
			t.Logf("   missing: %s", strings.Join(missing, ", "))
		}
	}
	if seen == 0 {
		t.Skip("no demos in content/demos")
	}
}
