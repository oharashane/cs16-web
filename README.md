# cs16-web

Counter-Strike 1.6 in the browser, on this machine, for the family. Three real ReHLDS
servers in Docker, a small Go relay that carries the game's UDP over WebRTC data channels,
and the Xash3D-FWGS WebAssembly client. Darkoak's `cs16` room reads and drives it; see
`docs/proposals/cs16-room.md` in the darkoak repository for the plan and
`docs/history/` here for how it was built the first time (2025).

## What runs where

| Part | Where | Port |
|---|---|---|
| ReHLDS classic / deathmatch / gungame | `cs-server/`, containers `cs16-classic`, `cs16-deathmatch`, `cs16-gungame` | 27015 / 27016 / 27017 UDP |
| Relay: pages, client files, API, signalling | `web-server/go-webrtc-server/`, the `cs16-relay` user unit | **27100** TCP |
| Relay: ICE, every WebRTC session | same process | **27101** UDP |

The relay scans 27000–27030 every three seconds. A browser asks for a server at
`/ws/<port>`; the relay offers, the browser answers, and two unreliable data channels —
`read` and `write` — carry the game's datagrams to a UDP socket the relay opens for that
browser. Reaching it from outside the LAN is one forwarded UDP port, 27101, plus HTTP.

API, read by darkoak's cs16 room: `/api/servers` (what discovery sees), `/api/sessions`
(each browser: server, since when, packets and bytes each way, ICE round trip),
`/api/metrics` (Prometheus text), `/api/heartbeat`.

## Servers

Maps, wads, sounds and models live in `cs-server/shared/` (git-ignored, 1.7 GB) and are
**mounted**, not baked: adding a map is a file copy and a `changelevel`. Each mode's
`server.cfg`, `mapcycle.txt`, `plugins.ini` and mode-specific addons live in
`cs-server/<mode>/` and are mounted the same way; `plugins.ini` and `mapcycle.txt` are read
live. `entrypoint.sh` wires it together and renders `server.cfg` with the RCON password.

```sh
cd cs-server
cp ../.env.example .env && chmod 600 .env     # then put a generated password in it
docker compose build
docker compose up -d                          # or: up -d classic
docker compose logs -f classic
docker compose stop deathmatch
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
(`config.go`): `RELAY_HTTP_ADDR` (`:27100`), `RELAY_ICE_PORT` (`27101`), `RELAY_PUBLIC_IP`
(empty; `auto` or an address to offer to browsers beyond the LAN), `RELAY_CLIENT_DIR`,
`CS_HOST`. The tests include a full WebRTC round trip with pion playing the browser, so
"does the relay still relay" is `go test`, not a browser.

Then open `http://<this machine>:27100/` and pick a server, or go straight to
`http://<this machine>:27100/client?server=27015`.

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
npm run build                 # → web/dist, which the relay serves at / and /client
npx playwright test           # end to end against the running relay and a live server
```

The 2025 client — engine 1.0.1 with its hand patches — is kept whole under
`web-server/go-webrtc-server/client/` and served at `/legacy`, until the new one has
been played on every machine in the house.

## Game content

`content/valve.zip` (git-ignored, 443 MB) holds the `valve/` and `cstrike/` directories
the browser needs. It must carry every map the servers might run; today it holds 64 of the
servers' 351. Rebuilding it from `cs-server/shared/` is the next piece of work.
