package main

import (
	_ "embed"
	"net/http"
)

//go:embed people.html
var peopleHTML []byte

//go:embed telemetry.html
var telemetryHTML []byte

//go:embed maps.html
var mapsHTML []byte

// mapsPage lists every map on the server with what it needs and what is missing.
func mapsPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(mapsHTML)
}

// telemetryPage shows the last while of samples: who, with which settings, at what ping.
func telemetryPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(telemetryHTML)
}

// peoplePage is the admin page for invitations: who has one, make one, take one away.
func peoplePage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(peopleHTML)
}
