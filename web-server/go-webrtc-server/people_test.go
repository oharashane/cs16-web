package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testPeople(t *testing.T) (Config, *People) {
	t.Helper()
	dir := t.TempDir()
	cfg := Config{User: "family", Password: "pw", PeopleFile: filepath.Join(dir, "people.json"),
		UsersFile: filepath.Join(dir, "users.ini"), EnvFile: filepath.Join(dir, "server.env")}
	os.WriteFile(cfg.EnvFile, []byte("SV_PASSWORD=open-sesame\n"), 0o600)
	var err error
	people, err = loadPeople(cfg.PeopleFile)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { people = nil })
	return cfg, people
}

func TestPeopleAddressesAndAdminsFile(t *testing.T) {
	cfg, ps := testPeople(t)
	shane, err := ps.Add("shane", "admin")
	if err != nil {
		t.Fatal(err)
	}
	kid, _ := ps.Add("kid", "player")
	if got := shane.Address().String(); got != "127.1.0.1" {
		t.Fatalf("first person's address %s", got)
	}
	if got := kid.Address().String(); got != "127.1.0.2" {
		t.Fatalf("second person's address %s", got)
	}
	if _, err := ps.Add("", "player"); err == nil {
		t.Fatal("an empty name was accepted")
	}
	if _, err := ps.Add(`a"b`, "player"); err == nil {
		t.Fatal("a quote in a name was accepted")
	}
	if err := writeAdmins(cfg, ps); err != nil {
		t.Fatal(err)
	}
	admins, _ := os.ReadFile(cfg.UsersFile)
	if !strings.Contains(string(admins), `"127.1.0.1" "" "abcdefghijklmnopqrstu" "de"`) {
		t.Fatalf("the admin is not in users.ini:\n%s", admins)
	}
	if strings.Contains(string(admins), "127.1.0.2") || strings.Contains(string(admins), "VALVE_ID_LAN") {
		t.Fatalf("users.ini names somebody who is not an admin:\n%s", admins)
	}
	// Reloaded from the file, the same people with the same tokens.
	again, err := loadPeople(cfg.PeopleFile)
	if err != nil {
		t.Fatal(err)
	}
	if again.ByToken(shane.Token) == nil || again.ByToken(shane.Token).ID != 1 {
		t.Fatal("the token does not find its person after a reload")
	}
	info, _ := os.Stat(cfg.PeopleFile)
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("people file mode %o, want 600", info.Mode().Perm())
	}
	// Revoked: gone from the door and from the admin list, still on the record.
	if err := ps.Revoke(shane.ID); err != nil {
		t.Fatal(err)
	}
	if ps.ByToken(shane.Token) != nil {
		t.Fatal("a revoked token still opens the door")
	}
	if !strings.Contains(ps.Admins(), "; do not edit") || strings.Contains(ps.Admins(), "127.1.0.1") {
		t.Fatalf("a revoked admin is still in users.ini:\n%s", ps.Admins())
	}
	if len(ps.List()) != 2 {
		t.Fatal("a revoked person was forgotten")
	}
}

func TestInvitationLeavesACookieAndTheDoorReadsIt(t *testing.T) {
	cfg, ps := testPeople(t)
	person, _ := ps.Add("shane", "admin")
	handler := newHandler(cfg)

	// A stranger with a made-up link gets nothing.
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, httptest.NewRequest("GET", "/i/nobody", nil))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("a bad invitation answered %d", rr.Code)
	}

	// The real link: a cookie, and off to the game.
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, httptest.NewRequest("GET", "/i/"+person.Token, nil))
	if rr.Code != http.StatusFound || rr.Header().Get("Location") != "/play/" {
		t.Fatalf("the invitation answered %d → %q", rr.Code, rr.Header().Get("Location"))
	}
	var cookie *http.Cookie
	for _, c := range rr.Result().Cookies() {
		if c.Name == personCookie {
			cookie = c
		}
	}
	if cookie == nil || cookie.Value != person.Token || !cookie.HttpOnly {
		t.Fatalf("no usable cookie: %+v", cookie)
	}

	// With the cookie and nothing else, /api/me knows them and the settings door opens.
	me := httptest.NewRequest("GET", "/api/me", nil)
	me.AddCookie(cookie)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, me)
	var answer struct {
		Name, Role     string
		ServerPassword string `json:"server_password"`
	}
	json.Unmarshal(rr.Body.Bytes(), &answer)
	if rr.Code != http.StatusOK || answer.Name != "shane" || answer.Role != "admin" || answer.ServerPassword != "open-sesame" {
		t.Fatalf("/api/me: %d %s", rr.Code, rr.Body.String())
	}
	// A person can rename themselves; the seat and the role stay.
	rename := httptest.NewRequest("POST", "/api/me", strings.NewReader(`{"name":"shaneo"}`))
	rename.AddCookie(cookie)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, rename)
	if rr.Code != http.StatusOK || ps.ByToken(person.Token).Name != "shaneo" || !ps.ByToken(person.Token).Admin() {
		t.Fatalf("rename: %d %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(ps.Admins(), "; shaneo") {
		t.Fatalf("the admin list did not follow the rename:\n%s", ps.Admins())
	}
	// Without it, the door is shut as before.
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, httptest.NewRequest("GET", "/api/me", nil))
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("a stranger got %d from /api/me", rr.Code)
	}
}

func TestPeoplePageIsForAdmins(t *testing.T) {
	cfg, ps := testPeople(t)
	admin, _ := ps.Add("shane", "admin")
	player, _ := ps.Add("kid", "player")
	handler := newHandler(cfg)
	try := func(person *Person, basic bool) int {
		r := httptest.NewRequest("GET", "/api/people", nil)
		if person != nil {
			r.AddCookie(&http.Cookie{Name: personCookie, Value: person.Token})
		}
		if basic {
			r.SetBasicAuth("family", "pw")
		}
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, r)
		return rr.Code
	}
	if got := try(nil, false); got != http.StatusUnauthorized {
		t.Fatalf("a stranger got %d", got)
	}
	if got := try(player, false); got != http.StatusForbidden {
		t.Fatalf("a player got %d", got)
	}
	if got := try(admin, false); got != http.StatusOK {
		t.Fatalf("the admin got %d", got)
	}
	if got := try(nil, true); got != http.StatusOK {
		t.Fatalf("the family login got %d (it is how the first admin is made)", got)
	}
	// Changing the game is for admins too; a player's cookie gets 403 there.
	change := httptest.NewRequest("POST", "/api/settings", strings.NewReader(`{"mode":"classic"}`))
	change.AddCookie(&http.Cookie{Name: personCookie, Value: player.Token})
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, change)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("a player changing the game got %d", rr.Code)
	}
	// An admin invites somebody through the API and gets the link back.
	r := httptest.NewRequest("POST", "/api/people", strings.NewReader(`{"name":"friend","role":"player"}`))
	r.Host = "cs16.example"
	r.Header.Set("X-Forwarded-Proto", "https")
	r.AddCookie(&http.Cookie{Name: personCookie, Value: admin.Token})
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, r)
	var made personView
	json.Unmarshal(rr.Body.Bytes(), &made)
	if rr.Code != http.StatusOK || !strings.HasPrefix(made.Link, "https://cs16.example/i/") || made.Address != "127.1.0.3" {
		t.Fatalf("inviting answered %d %s", rr.Code, rr.Body.String())
	}
}
