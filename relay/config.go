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
	// The built client (web/dist): index.html and its hashed assets. Served at /play.
	ClientDir string
	// The same client built against the engine we compile ourselves (web/dist-next), served
	// at /next beside /play so the two can be compared. Empty directory: 404, nothing else.
	NextDir string
	// The pages: docs/index.html at /, docs/review/index.html at /review.
	DocsDir string
	// The server's mode files — one .cfg and one .maps.txt each, plus modes.json and
	// current.cfg — which /admin reads and writes. They are the server's own definition
	// of how it plays, so writing them is how a setting survives a map change.
	ModesDir string
	// Where the servers' secrets live: the rcon password /admin needs to tell a running
	// server what it is now. Mode 600, never printed.
	EnvFile string
	// The container /admin restarts when asked to.
	Container string
	// The password for the pages, as HTTP basic auth. Empty: the pages are open. Set from
	// a file only the service reads, never from a unit file or a shell.
	AdminKey string
	// The family's own login, which is what everybody actually types: a name and a
	// password rather than a forty-byte key. Either this or the admin key opens the site.
	User     string
	Password string
	// The people who have been invited: names, roles and the tokens in their links. Mode
	// 600, beside .relay.env, for the same reason. Empty: nobody is anybody, and the
	// family login is all there is.
	PeopleFile string
	// Where the relay writes the game server's admin list from the people file; linked
	// into the container by entrypoint.sh. Empty: not written.
	UsersFile string
	// Where the ten-second samples of who is playing how well go, one JSON line each.
	// Empty: no telemetry.
	TelemetryFile string
	// The game content the browser downloads — valve.zip — which no build produces.
	ContentDir string
	// The server's content as it is on disk (cs-server/shared): served read-only at /raw
	// for the demo viewer, which wants plain .bsp, .wad and sky files.
	SharedDir string
	// A scanned drive's organized view (scripts/museum-drive.py), served read-only at
	// /drive for the curator's desk to look at a map that is not on the server. Empty
	// means no drive is mounted.
	DriveDir string
	// The drive's merged install in game layout (maps/, models/, sound/, wad/ …), the one
	// the lab mounts; /raw/ falls back to it so a lab map downloads the game's way.
	DriveGameDir string
	// The name the site is reached by from outside (cs16.darkoak.xyz): what /fetch treats as
	// its own when a download URL names it.
	PublicHost string
	// darkoak, which keeps the collection's records and the tools: the museum's pages read
	// from it and post a visitor's words to it, with its admin key (DARKOAK_URL, DARKOAK_KEY).
	DarkoakURL string
	DarkoakKey string
	// Where the game servers are. Discovery scans MIN_CS_PORT..MAX_CS_PORT on this host.
	CSHost string
	// The server people play on. The client offers this one and no other; the rest are
	// still discovered, still in /api/servers, and still reachable with ?server=<port>
	// by anyone testing them.
	PrimaryPort int
	// The port the game's own playit tunnel forwards to, where native Counter-Strike
	// clients arrive. 0: no ingress, and the tunnel points straight at the game server —
	// which is what it did until 7 September 2026, when everyone through it shared one
	// address and so, sometimes, one slot. See steam.go.
	SteamPort int
	// PublicIP resolved to an address, once, at startup. Empty when none is configured or
	// it could not be resolved. See Resolve.
	PublicAddr string
}

func configFromEnv() Config {
	return Config{
		HTTPAddr:      envOr("RELAY_HTTP_ADDR", ":27100"),
		ICEPort:       intOr("RELAY_ICE_PORT", 27101),
		PublicIP:      os.Getenv("RELAY_PUBLIC_IP"),
		ClientDir:     envOr("RELAY_CLIENT_DIR", "../web/dist"),
		NextDir:       envOr("RELAY_NEXT_DIR", "../web/dist-next"),
		DocsDir:       envOr("RELAY_DOCS_DIR", "../docs"),
		AdminKey:      os.Getenv("RELAY_ADMIN_KEY"),
		User:          os.Getenv("RELAY_USER"),
		Password:      os.Getenv("RELAY_PASSWORD"),
		ContentDir:    envOr("RELAY_CONTENT_DIR", "../content"),
		SharedDir:     envOr("RELAY_SHARED_DIR", "../cs-server/shared"),
		DriveDir:      envOr("RELAY_DRIVE_DIR", ""),
		DriveGameDir:  envOr("RELAY_DRIVE_GAME_DIR", ""),
		PublicHost:    envOr("RELAY_PUBLIC_HOST", ""),
		DarkoakURL:    envOr("DARKOAK_URL", ""),
		DarkoakKey:    os.Getenv("DARKOAK_KEY"),
		CSHost:        envOr("CS_HOST", "127.0.0.1"),
		PrimaryPort:   intOr("RELAY_PRIMARY_PORT", 27015),
		SteamPort:     intOr("RELAY_STEAM_PORT", 0),
		ModesDir:      envOr("RELAY_MODES_DIR", "../cs-server/main/modes"),
		EnvFile:       envOr("RELAY_ENV_FILE", "../cs-server/.env"),
		Container:     envOr("RELAY_CONTAINER", "cs16-main"),
		PeopleFile:    envOr("RELAY_PEOPLE_FILE", "../.relay-people.json"),
		UsersFile:     envOr("RELAY_USERS_FILE", "../cs-server/main/addons/amxmodx/configs/users.ini"),
		TelemetryFile: envOr("RELAY_TELEMETRY_FILE", "../logs/telemetry.jsonl"),
	}
}

func intOr(key string, fallback int) int {
	if value, err := strconv.Atoi(os.Getenv(key)); err == nil && value > 0 {
		return value
	}
	return fallback
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

// Resolve settles the things that must not be worked out again per session: the public
// address, which is a DNS lookup. Called once, at startup.
func (c *Config) Resolve() {
	c.PublicAddr = publicIP(c.PublicIP)
}
