package main

// Who is playing. An invitation is a link with a token in it; opening it once puts a
// cookie in that browser, and from then on the relay knows the person behind every
// request, every session and — through the address it gives their packets — the game
// server knows them too. Before this (7 September 2026) every browser reached the server
// as VALVE_ID_LAN with every admin flag there is, because that is the one identity Reunion
// hands a client it cannot tell apart, and users.ini listed it.
//
// The people live in one JSON file beside the relay's other secrets (mode 600), because
// the tokens are the keys to the door.

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Person struct {
	ID        int       `json:"id"`
	Name      string    `json:"name"`
	Role      string    `json:"role"` // "player" or "admin"
	Token     string    `json:"token"`
	CreatedAt time.Time `json:"created_at"`
	LastSeen  time.Time `json:"last_seen,omitempty"`
	Revoked   bool      `json:"revoked,omitempty"`
}

func (p *Person) Admin() bool { return p != nil && p.Role == "admin" && !p.Revoked }

// Address is the loopback address this person's packets leave from, and so what the game
// server knows them by: 127.1.hi.lo from the id, stable for as long as the person exists.
// Sessions with nobody behind them keep taking 127.0.x.y from the counter in signal.go,
// so the two can never meet.
func (p *Person) Address() net.IP {
	return net.IPv4(127, 1, byte(p.ID>>8), byte(p.ID))
}

// People is the file of them, loaded once and written on every change.
type People struct {
	path    string
	mu      sync.Mutex
	persons []*Person
}

func loadPeople(path string) (*People, error) {
	people := &People{path: path}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return people, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, &people.persons); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return people, nil
}

func (p *People) save() error {
	data, err := json.MarshalIndent(p.persons, "", "  ")
	if err != nil {
		return err
	}
	tmp := p.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p.path)
}

// Add makes a person and their token. The role is "admin" or "player"; anything else is
// a player. Names are trimmed to what the game accepts.
func (p *People) Add(name, role string) (*Person, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 31 || strings.ContainsAny(name, "\"\n\r;") {
		return nil, errors.New("a name is one to thirty-one characters, without quotes")
	}
	if role != "admin" {
		role = "player"
	}
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	id := 1
	for _, other := range p.persons {
		if other.ID >= id {
			id = other.ID + 1
		}
	}
	if id > 65535 {
		return nil, errors.New("no addresses left for another person")
	}
	person := &Person{ID: id, Name: name, Role: role, Token: base64.RawURLEncoding.EncodeToString(raw), CreatedAt: time.Now().UTC()}
	p.persons = append(p.persons, person)
	return person, p.save()
}

// Rename changes what a person is called — in the lobby, on the server, in the logs from
// now on. The seat (the address) and the role stay theirs.
func (p *People) Rename(person *Person, name string) error {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 31 || strings.ContainsAny(name, "\"\n\r;") {
		return errors.New("a name is one to thirty-one characters, without quotes")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	person.Name = name
	return p.save()
}

// ByToken finds the person a cookie or an invitation names; nil for nobody, or somebody
// revoked. Tokens are 192 random bits, so a map lookup is not a timing oracle worth
// worrying about.
func (p *People) ByToken(token string) *Person {
	if token == "" {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, person := range p.persons {
		if person.Token == token && !person.Revoked {
			return person
		}
	}
	return nil
}

func (p *People) ByID(id int) *Person {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, person := range p.persons {
		if person.ID == id {
			return person
		}
	}
	return nil
}

// Revoke keeps the record (the address stays theirs, the name stays in the logs) and
// closes the door: the cookie and the link stop working.
func (p *People) Revoke(id int) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, person := range p.persons {
		if person.ID == id {
			person.Revoked = true
			return p.save()
		}
	}
	return errors.New("no such person")
}

// Seen notes that a person just started a session. Best effort.
func (p *People) Seen(person *Person) {
	p.mu.Lock()
	defer p.mu.Unlock()
	person.LastSeen = time.Now().UTC()
	_ = p.save()
}

// List is everyone, revoked included, oldest first.
func (p *People) List() []*Person {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := append([]*Person(nil), p.persons...)
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// Admins is the users.ini the game server reads: one line per admin, keyed by the
// address their packets come from, which is the one thing about a browser player the
// server can see and nobody else can forge from another browser. Flags are the set the
// family's shared identity had; "de" means "by address, no password".
func (p *People) Admins() string {
	var b strings.Builder
	b.WriteString("; Written by the relay from its people file whenever somebody is added or removed —\n")
	b.WriteString("; do not edit; the next change overwrites it. One line per admin, by the address\n")
	b.WriteString("; the relay gives that person's packets. amx_reloadadmins makes the server re-read it.\n")
	b.WriteString("; <name|ip|steamid> <password> <access flags> <account flags>\n")
	for _, person := range p.List() {
		if person.Admin() {
			fmt.Fprintf(&b, "\"%s\" \"\" \"abcdefghijklmnopqrstu\" \"de\"   ; %s\n", person.Address(), person.Name)
		}
	}
	return b.String()
}

// writeAdmins puts the admin list where the server reads it and asks the server to
// re-read it. The file is linked into the container by entrypoint.sh, so this is live.
func writeAdmins(cfg Config, people *People) error {
	if cfg.UsersFile == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(cfg.UsersFile), 0o755); err != nil {
		return err
	}
	tmp := cfg.UsersFile + ".tmp"
	if err := os.WriteFile(tmp, []byte(people.Admins()), 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, cfg.UsersFile); err != nil {
		return err
	}
	password, err := rconPassword(cfg.EnvFile)
	if err != nil {
		return nil // no server to tell; the file is written and the next start reads it
	}
	address := fmt.Sprintf("%s:%d", cfg.CSHost, cfg.PrimaryPort)
	if _, err := rcon(address, password, "amx_reloadadmins"); err != nil {
		logger.Warnf("admins written but %s did not reload them: %v", address, err)
	}
	return nil
}
