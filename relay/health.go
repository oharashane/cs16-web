package main

import (
	"regexp"
	"sort"
	"sync"
	"time"
)

// What the heartbeat says beyond "the process answers": the two ways the game stopped
// working on 2026-10-04 while every server was up. The public address did not resolve at
// boot, so browsers outside the house had no candidate to reach; and a file the server
// told clients to fetch was not where the client asked for it, so every join retried
// forever. The darkoak room reads both each minute and tells the owner when one changes.

var publicAddress struct {
	sync.RWMutex
	configured, resolved bool
}

func notePublicAddress(configured, resolved string) {
	publicAddress.Lock()
	publicAddress.configured, publicAddress.resolved = configured != "", resolved != ""
	publicAddress.Unlock()
}

// A path a client may be told about: the name is what a browser asked for, so only the
// shape of a game file is kept, and only so many of them.
var gameFilePath = regexp.MustCompile(`^[A-Za-z0-9_./!+-]{1,120}\.(mdl|spr|wav|bsp|wad|tga|bmp|txt|res|mp3|lst)$`)

const rawMissWindow = 10 * time.Minute

var rawMisses = struct {
	sync.Mutex
	total int64
	seen  map[string]time.Time
}{seen: map[string]time.Time{}}

func noteRawMiss(rel string, now time.Time) {
	if !gameFilePath.MatchString(rel) {
		return
	}
	rawMisses.Lock()
	defer rawMisses.Unlock()
	rawMisses.total++
	for path, at := range rawMisses.seen {
		if now.Sub(at) > rawMissWindow {
			delete(rawMisses.seen, path)
		}
	}
	if _, known := rawMisses.seen[rel]; known || len(rawMisses.seen) < 50 {
		rawMisses.seen[rel] = now
	}
}

func healthExtras(now time.Time) (address map[string]any, misses map[string]any) {
	publicAddress.RLock()
	address = map[string]any{"configured": publicAddress.configured, "resolved": publicAddress.resolved}
	publicAddress.RUnlock()
	rawMisses.Lock()
	defer rawMisses.Unlock()
	recent := []string{}
	for path, at := range rawMisses.seen {
		if now.Sub(at) <= rawMissWindow {
			recent = append(recent, path)
		}
	}
	sort.Strings(recent)
	if len(recent) > 10 {
		recent = recent[:10]
	}
	return address, map[string]any{"total": rawMisses.total, "recent": recent}
}
