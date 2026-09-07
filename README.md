# cs16-web

Counter-Strike 1.6 in the browser, on this machine, for the family. Three real ReHLDS
servers in Docker, a small Go relay that carries the game's UDP over WebRTC data channels,
and the Xash3D-FWGS WebAssembly client. Darkoak's `cs16` room reads and drives it; see
`docs/proposals/cs16-room.md` in the darkoak repository for the plan and
`docs/history/` here for how it was built the first time (2025).

## What runs where

| Part | Where | Port |
|---|---|---|
| **The server** — one, every mode's plugins loaded | `cs-server/main/`, container `cs16-main` | **27015** UDP |
| The 2025 servers, kept until each mode is proven | `cs16-classic`, `cs16-deathmatch`, `cs16-gungame` | 27021 / 27022 / 27023 UDP |
| Relay: pages, client files, API, signalling | `web-server/go-webrtc-server/`, the `cs16-relay` user unit | **27100** TCP |
| Relay: ICE, every WebRTC session | same process | **27101** UDP |

A browser asks for a server at `/ws/<port>`; the relay offers, the browser answers, and two
unreliable data channels carry the game's datagrams to a UDP socket the relay opens for that
browser. The lobby offers **one** server — the relay says which in `/api/servers` as
`primary`, set by `RELAY_PRIMARY_PORT` — so a player picks a name and a picture and plays.
`?server=<port>` reaches the others while they exist.

API, read by darkoak's cs16 room: `/api/servers`, `/api/sessions` (each browser: server,
since when, packets and bytes each way, ICE round trip), `/api/metrics`, `/api/heartbeat`.

## The server, and its modes

Maps, wads, sounds and models live in `cs-server/shared/` (git-ignored, 1.7 GB) and are
**mounted**, not baked. So is each server's config directory. `entrypoint.sh` wires them
together and renders `server.cfg` with the RCON password.

`cs-server/main/` is the one people play on. Every mode's plugins are loaded at once and
the game type is decided at **runtime** by cvars, so switching is instant and nobody is
disconnected:

```
main/modes/<name>.cfg     the cvars that make the mode
main/modes/<name>.maps    its rotation, named by the mapcyclefile cvar
main/modes/modes.json     what each is called, what it is for, where it starts
main/modes/current.cfg    one exec line: the mode the server is in
```

Six modes: `classic`, `fun` (fy/aim), `team-dm`, `ffa-dm`, `gungame`, `scoutz`.

Loading a map resets cvars the game DLL owns — `mp_freeforall` and `sv_gravity` among them
— and `server.cfg` is *not* re-run on a map change. So `current.cfg` is exec'd from
`amxx.cfg`, which AMX Mod X re-reads on every map. That is what makes a mode survive the
rotation. A mode's cvars must therefore be set only in mode files; a plugin's own config
loads later and would silently win, which is why `gg_enabled` is commented out of
`gungame.cfg`.

Change modes through darkoak's room (`set_mode`, `get_modes`), or by hand:

```sh
cd cs-server
cp ../.env.example .env && chmod 600 .env     # then put a generated password in it
docker compose build && docker compose up -d
docker compose logs -f main
```

## Relay

A static Go binary, run as a systemd user unit that rebuilds it from the working tree on
every start:

```sh
./deploy/install-user-service.sh          # once
systemctl --user restart cs16-relay       # after editing
journalctl --user -u cs16-relay -f
cd web-server/go-webrtc-server && GOTOOLCHAIN=auto go test ./...
```

Settings are environment variables with defaults that are right for this machine
(`config.go`): `RELAY_HTTP_ADDR` (`:27100`), `RELAY_ICE_PORT`, `RELAY_PUBLIC_IP` (empty,
`auto`, an address, or a hostname — resolved once at startup), `RELAY_PRIMARY_PORT` (the
one server the lobby offers), `RELAY_CLIENT_DIR`, `CS_HOST`.

For play from outside the house the relay offers one extra ICE candidate,
`<RELAY_PUBLIC_IP>:<RELAY_ICE_PORT>`, at a lower priority than its real ones — so a browser
at home takes the direct path and only somebody outside falls back to the tunnel. It is
added to what pion gathers rather than replacing it: host rewriting would have removed the
LAN addresses, and server-reflexive rewriting produced an ephemeral port that no tunnel
forwards. The tests include a full WebRTC round trip with pion playing the browser, so
"does the relay still relay" is `go test`, not a browser.

Then open `http://<this machine>:27100/play`, or go straight to
`http://<this machine>:27100/play?server=27015`. The root, `/`, is a short explainer and
`/review` the September 2026 review; both ask for the admin key (`RELAY_ADMIN_KEY`, read
from `.relay.env` by the unit) when one is set. `/client` redirects to `/play`.

## Client

`web/` is a Vite project: Xash3D-FWGS **1.2.2** and cs16-client **0.1.2**, installed from
the tarballs in `web/vendor/` — upstream deleted its repositories and deprecated its npm
packages in August 2026, so nothing here is fetched from a registry that has announced its
own removal (`~/darkoak-backups/` holds every version ever published). `src/webrtc.ts` is
the transport: a WebSocket to `/ws/<port>` for the offer and answer, two data channels for
the game. The page lists the relay's servers, takes a name, and offers "Fast" (one pixel
per CSS pixel, what Retina Macs want) or "Sharp".

```sh
cd web
npm install
npm run build                 # → web/dist, which the relay serves at /play
npx playwright test           # end to end against the running relay and live servers
```

The tests play as far as a real player does: lobby, download, unpack, engine boot, WebRTC,
leaving and rejoining without a second download, the name still in the box on the next
visit, that a refused password is explained rather than silently dropping the player at a
menu, and — because it hid for a year — that joining a team on deathmatch does not crash
the server.

**When the game will not start**, the page now says so. The engine reports a refusal to its
own console, which it draws on the canvas where no script can read it, so the page watches
what arrives instead: a server that accepts you streams updates continuously, one that
turns you away sends a refusal and falls silent. Measured, right password against wrong:
341 datagrams against 2.

The engine boots once per visit: leaving a server returns to the lobby with the game
still in memory, so joining another is immediate — the 274 MB is downloaded and unpacked
once. The name, the last server and the picture choice are remembered in the browser.

The 2025 client — engine 1.0.1 with its hand patches — is kept whole under
`web-server/go-webrtc-server/client/` and served at `/legacy`, until the new one has
been played on every machine in the house.

## Game content

`content/valve.zip` (git-ignored) is what the browser downloads and unpacks into memory,
so what goes in it is a choice. `scripts/package-valve.py` builds it from the previous zip
(for the files only a Steam install has) and `cs-server/shared/` (for the maps and what
they need): by default every map the three cycles mention, each with the wads its
worldspawn names, its `.res` dependencies, its overview and its sky, and none of
Half-Life's own campaign. 274 MB for 28 maps today, down from 443 MB for 64.
`content/valve.manifest.json` says exactly what is in it and which referenced wads exist
nowhere; darkoak's cs16 room reads it to say which maps a browser can join.

```sh
scripts/package-valve.py                       # the cycles' maps
scripts/package-valve.py --maps de_dust2 cs_office fy_iceworld
```

## Why `main` is on the host network

Each relay session sends to the game server from its own loopback address (`127.0.0.2`,
`.3`, …). ReHLDS treats a new connection from a known address as that player reconnecting
once they have been silent for ten seconds, and hands the newcomer their slot and name;
behind Docker's port proxy every browser had the same address, which is the three-player
name mixup of 6 September 2026. `network_mode: host` in `docker-compose.yml` lets the
server see the real source address. The three 2025 servers are still behind the proxy and
still have the problem; they are on their way out.
