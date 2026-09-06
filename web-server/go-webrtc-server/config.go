package main

import (
	"os"
	"strconv"
)

// Config is everything that differs between this machine and another one. Each value has
// a default that is right here, so the service runs with no environment at all.
type Config struct {
	// Where the pages, the client's files, the API and the signalling WebSocket are served.
	HTTPAddr string
	// The one UDP port every WebRTC session uses. Forward this one from outside. 0 means
	// an ephemeral port per session, which only a test wants.
	ICEPort int
	// The address a browser beyond this machine's own networks should be told to reach
	// ICEPort on. Empty: only this machine's own addresses are offered, which is right for
	// the LAN and the tailnet. "auto": the address of the default route. It is offered in
	// addition to the local ones, so a LAN browser still takes the short path.
	PublicIP string
	// Where the client's files live: index.html, assets/, valve.zip.
	ClientDir string
	// Where the relay's own pages live: dashboard.html, play.html.
	PagesDir string
	// Where the game servers are. Discovery scans MIN_CS_PORT..MAX_CS_PORT on this host.
	CSHost string
}

func configFromEnv() Config {
	icePort, err := strconv.Atoi(envOr("RELAY_ICE_PORT", "27101"))
	if err != nil {
		icePort = 27101
	}
	return Config{
		HTTPAddr:  envOr("RELAY_HTTP_ADDR", ":27100"),
		ICEPort:   icePort,
		PublicIP:  os.Getenv("RELAY_PUBLIC_IP"),
		ClientDir: envOr("RELAY_CLIENT_DIR", "client"),
		PagesDir:  envOr("RELAY_PAGES_DIR", "."),
		CSHost:    envOr("CS_HOST", "127.0.0.1"),
	}
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
