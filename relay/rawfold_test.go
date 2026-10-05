package main

import (
	"os"
	"path/filepath"
	"testing"
)

// The engine asks for models/playerT.mdl; the file on disk is playert.mdl (2026-10-04).
func TestRawFileIgnoresCaseWhenExactMisses(t *testing.T) {
	shared := t.TempDir()
	if err := os.MkdirAll(filepath.Join(shared, "models"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(shared, "models", "playert.mdl"), []byte("IDST"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := Config{SharedDir: shared}
	want := filepath.Join(shared, "models", "playert.mdl")
	for _, asked := range []string{"models/playert.mdl", "models/playerT.mdl", "MODELS/PLAYERT.MDL"} {
		if got := rawFile(cfg, asked); got != want {
			t.Errorf("rawFile(%q) = %q, want %q", asked, got, want)
		}
	}
	if got := foldedUnder(shared, "models/missing.mdl"); got != "" {
		t.Errorf("a missing file resolved to %q", got)
	}
	if got := foldedUnder(shared, "../outside.mdl"); got != "" {
		t.Errorf("a path outside the root resolved to %q", got)
	}
}
