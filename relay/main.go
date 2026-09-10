// The relay: real Counter-Strike servers on one side, browsers on the other.
//
// A browser cannot open a UDP socket, and the game speaks nothing else. So the browser
// opens two unreliable, unordered WebRTC data channels to this process — "read" for what
// it sends, "write" for what it receives — and this process gives each browser a UDP socket
// of its own and copies bytes both ways. The game server sees an ordinary client at this
// machine's address; the browser sees a server at 127.0.0.1. Nothing is interpreted.
//
// Everything is served from one HTTP address: the pages, the client's files, the API the
// darkoak room reads, and the WebSocket that carries the WebRTC offer and answer. ICE uses
// one fixed UDP port for every session, so reaching this from outside the LAN is one port
// forwarded, not a range.
package main

import (
	"fmt"
	"log"
	"net/http"
)

// The relay's own log: plain lines to stderr, which under systemd is the journal with its
// own timestamps. pion's logger was here before and printed nothing below Error unless an
// environment variable said otherwise, which is how sessions came and went unrecorded.
type relayLogger struct{}

func (relayLogger) Infof(format string, args ...any) { log.Print(fmt.Sprintf(format, args...)) }
func (relayLogger) Warnf(format string, args ...any) {
	log.Print("warning: " + fmt.Sprintf(format, args...))
}
func (relayLogger) Errorf(format string, args ...any) {
	log.Print("error: " + fmt.Sprintf(format, args...))
}

var logger relayLogger

// The registry of game servers found and browsers connected. One per process.
var serverManager *ServerManager

func main() {
	log.SetFlags(0)
	cfg := configFromEnv()
	cfg.Resolve()
	csHost = cfg.CSHost
	serverManager = NewServerManager()
	api = newWebRTCAPI(cfg)
	var err error
	if people, err = loadPeople(cfg.PeopleFile); err != nil {
		log.Fatalf("people: %v", err)
	}
	if err := writeAdmins(cfg, people); err != nil {
		logger.Warnf("admins not written: %v", err)
	}

	serverManager.StartDiscovery()
	startSteamIngress(cfg)
	startTelemetry(cfg)

	logger.Infof("serving pages, client and API on %s; ICE on udp/%d; game servers at %s:%d-%d",
		cfg.HTTPAddr, cfg.ICEPort, cfg.CSHost, MIN_CS_PORT, MAX_CS_PORT)
	log.Fatal(http.ListenAndServe(cfg.HTTPAddr, newHandler(cfg)))
}
