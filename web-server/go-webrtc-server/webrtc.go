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

	if ip := publicIP(cfg.PublicIP); ip != "" {
		// Server-reflexive rather than host: the public address is offered *beside* the
		// local ones. Replacing the host candidates would leave a browser on the LAN trying
		// to reach this machine by way of the internet.
		engine.SetNAT1To1IPs([]string{ip}, webrtc.ICECandidateTypeSrflx)
		logger.Infof("also offering %s as this relay's public address", ip)
	}

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
		if net.ParseIP(configured) == nil {
			logger.Errorf("RELAY_PUBLIC_IP=%q is not an IP address; ignoring it", configured)
			return ""
		}
		return configured
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
