package main

import (
	"fmt"
	"net"
	"strings"

	"github.com/pion/ice/v4"
	"github.com/pion/webrtc/v4"
)

// The API every session's PeerConnection is made from. Built once: it holds the ICE UDP mux.
var api *webrtc.API

func newWebRTCAPI(cfg Config) *webrtc.API {
	engine := webrtc.SettingEngine{}
	// The data channels are read and written as byte streams by the bridge, not through
	// callbacks: fewer copies, and no goroutine per message.
	engine.DetachDataChannels()
	// A browser on this same machine offers loopback candidates through mDNS; offering ours
	// back costs nothing and is what an in-process test needs.
	engine.SetIncludeLoopbackCandidate(true)

	if cfg.ICEPort != 0 {
		mux, err := ice.NewMultiUDPMuxFromPort(cfg.ICEPort)
		if err != nil {
			panic(fmt.Sprintf("cannot listen for ICE on udp/%d: %v", cfg.ICEPort, err))
		}
		engine.SetICEUDPMux(mux)
	}

	// The public address is deliberately NOT given to SetNAT1To1IPs. Host rewriting
	// replaces this machine's own addresses, which would send a browser in the next room
	// out through the tunnel and back; server-reflexive rewriting keeps them but derives
	// its port from whichever socket pion gathered on, which came out ephemeral and no
	// tunnel forwards that. So pion offers its real candidates and signal.go adds one more.

	return webrtc.NewAPI(webrtc.WithSettingEngine(engine))
}

// publicIP resolves the configured public address: literal, "auto", or nothing.
func publicIP(configured string) string {
	switch strings.ToLower(strings.TrimSpace(configured)) {
	case "":
		return ""
	case "auto":
		ip, err := defaultRouteIP()
		if err != nil {
			logger.Errorf("RELAY_PUBLIC_IP=auto but the default route has no address: %v", err)
			return ""
		}
		return ip
	default:
		if net.ParseIP(configured) != nil {
			return configured
		}
		// A tunnel gives you a hostname — roosevelt-etiology.tun.ply.gg — and ICE
		// candidates carry addresses, so it is resolved here, once, at startup. If the
		// tunnel's address ever moves, restarting the relay is what picks it up.
		addresses, err := net.LookupIP(configured)
		if err != nil {
			logger.Errorf("RELAY_PUBLIC_IP=%q could not be resolved: %v; ignoring it", configured, err)
			return ""
		}
		for _, address := range addresses {
			if ipv4 := address.To4(); ipv4 != nil {
				logger.Infof("resolved %s to %s", configured, ipv4)
				return ipv4.String()
			}
		}
		logger.Errorf("RELAY_PUBLIC_IP=%q resolved to no IPv4 address; ignoring it", configured)
		return ""
	}
}

// defaultRouteIP is the local address packets to the internet leave from. Nothing is sent.
func defaultRouteIP() (string, error) {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return "", err
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.String(), nil
}
