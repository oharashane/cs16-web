package main

import (
	"testing"
	"time"
)

func TestRawMissesKeepGameFilesForTenMinutes(t *testing.T) {
	rawMisses.Lock()
	rawMisses.total, rawMisses.seen = 0, map[string]time.Time{}
	rawMisses.Unlock()
	start := time.Unix(1_000_000, 0)
	noteRawMiss("models/player/gign/gignT.mdl", start)
	noteRawMiss("../../etc/passwd", start)
	noteRawMiss("<script>.mdl", start)
	_, misses := healthExtras(start.Add(time.Minute))
	if got := misses["recent"].([]string); len(got) != 1 || got[0] != "models/player/gign/gignT.mdl" {
		t.Fatalf("recent = %v", got)
	}
	if _, later := healthExtras(start.Add(11 * time.Minute)); len(later["recent"].([]string)) != 0 {
		t.Fatalf("a miss outlived its window: %v", later["recent"])
	}
}

func TestPublicAddressIsReportedWithoutTheAddress(t *testing.T) {
	notePublicAddress("example.tun.ply.gg", "")
	address, _ := healthExtras(time.Now())
	if address["configured"] != true || address["resolved"] != false {
		t.Fatalf("address = %v", address)
	}
	notePublicAddress("", "")
}
