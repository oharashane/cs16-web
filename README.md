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
| Relay: dashboard, client files, `/api/servers`, `/api/metrics` | `web-server/go-webrtc-server/`, a Go binary | 27100 |
| Relay: signalling, one listener per discovered server | same binary | 27200 + (CS port − 27000) → 27215 / 27216 / 27217 |

The relay scans 27000–27030 every three seconds and opens a signalling listener for each
server it finds. The browser opens two unreliable data channels; the relay gives each
browser a UDP socket and forwards bytes both ways.

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

```sh
cd web-server/go-webrtc-server
go build -o relay . && ./relay                # GOTOOLCHAIN=auto fetches the Go the module asks for
curl -s localhost:27100/api/servers | jq .
```

Then open `http://<this machine>:27100/` and pick a server, or go straight to
`http://<this machine>:27100/client?server=27015`.

## Client content

`web-server/go-webrtc-server/client/valve.zip` (git-ignored, 443 MB) holds the `valve/` and
`cstrike/` game directories the browser needs. It must carry every map the servers might
run; today it holds 64 of the servers' 351. `package-valve-from-server.sh` rebuilds it from
`cs-server/shared/` and a Steam `valve/` folder.

The client under `client/assets/` is `xash3d-fwgs` 1.0.1 with three patches to the minified
bundle (`client/MANUAL_MODIFICATIONS.md`). Replacing it with a source build is the next step.
