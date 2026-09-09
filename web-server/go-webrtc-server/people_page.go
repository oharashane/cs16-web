package main

import (
	_ "embed"
	"net/http"
)

//go:embed people.html
var peopleHTML []byte

// peoplePage is the admin page for invitations: who has one, make one, take one away.
func peoplePage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(peopleHTML)
}
