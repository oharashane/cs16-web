# cs16-web

Counter-Strike 1.6 in the browser, on this machine, for the family. A real ReHLDS
server in Docker, a small Go relay that carries the game's UDP over WebRTC data channels,
and the Xash3D-FWGS WebAssembly client. Darkoak's `cs16` room reads and drives it; see
`docs/proposals/cs16-room.md` in the darkoak repository for the plan and
`docs/history/` here for how it was built the first time (2025).

## What runs where

| Part | Where | Port |
|---|---|---|
| **The server** — one, every mode's plugins loaded, built from pinned parts | `cs-server/main/`, container `cs16-main` | **27015** UDP |
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
main/modes/<name>.maps.txt  its rotation, named by the mapcyclefile cvar (ReGameDLL insists on the .txt)
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
npm run build                 # → web/dist (our engine, engine/), served at /play
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

The browser gets the game in **bundles**, built by `scripts/package-valve.py` into
`content/` (git-ignored, except the manifest): `base.zip`, the game itself — the
Half-Life files the engine needs, the Counter-Strike client files, and everything two or
more maps share — and `maps/<map>.zip`, one per map: its `.bsp`, overview, sky, and the
wads, models and sounds only it asks for. `manifest.json` says what each bundle is, with
the sha256 the browser caches it under (and is also written as `valve.manifest.json`, the
name darkoak's room reads).

A player waits for the base and the map the server is on; the rest of the rotation
arrives behind the game, the maps after the current one first, and a map change finds its
files in place. Each bundle is cached on its own in the browser, so a returning player
reads them all back, a new map costs a few megabytes, and only a new base — rare — costs
the whole download again. Today the base is 202 MB and the 23 maps 54 MB together; the
previous one-zip build was 271 MB before a player could move.

    scripts/package-valve.py                # every map the modes' rotations name
    scripts/package-valve.py --maps de_dust2 cs_office

Maps come from `cs-server/shared/`, so a map the client has is a map the server has. The
Steam-only files come from `content/valve.zip`, the last one-zip build, which is kept for
that and for the 2025 client at `/legacy`.

## Why `main` is on the host network

Each relay session sends to the game server from its own loopback address (`127.0.0.2`,
`.3`, …). ReHLDS treats a new connection from a known address as that player reconnecting
once they have been silent for ten seconds, and hands the newcomer their slot and name;
behind Docker's port proxy every browser had the same address, which is the three-player
name mixup of 6 September 2026. `network_mode: host` in `docker-compose.yml` lets the
server see the real source address. (The three 2025 servers, which stayed behind the proxy
with the problem, were retired on 9 September 2026.)

## The two tunnels

`csweb` (`roosevelt-etiology.tun.ply.gg:46089` → local 46089) carries WebRTC/ICE for
browsers; its public and local ports must be the same number, and `RELAY_ICE_PORT` must be
that number too.

`cs 1.6 udp (hlds)` (`roosevelt-refuses.tun.ply.gg:9767` → local **27515**) carries native
Counter-Strike clients. It points at the relay's ingress (`RELAY_STEAM_PORT`), not at the
game server: everyone through a tunnel shares the agent's address, and ReHLDS reads a
second connection from a known address as the first player reconnecting — it hands over
their slot and their name. The ingress gives each client its own loopback address, the way
`signal.go` does for browsers. LAN clients still connect straight to 27015.

## The controls

They are on the play page itself: name, server password, **Join**, and under it the game —
type (classic, deathmatch, deathmatch FFA, gun game, scoutzknivez), map, gravity, bunny
hopping, and
— for classic — normal or maximum money, with a **Change and join** button that only
wakes up when something differs from what the server already has. Join sends nothing;
Change writes the values into `cs-server/main/modes/<mode>.cfg` and tells the running
server, so the choice survives map changes and restarts, and moves everyone to the chosen
map. `/admin` redirects here. Every map runs fifteen minutes.

The whole site — pages, client, `valve.zip` — is behind one login (`RELAY_USER` and
`RELAY_PASSWORD` in `.relay.env`; the admin key still opens it, for scripts). What is
deliberately outside: `/api/servers`, `/api/sessions` and `/api/metrics`, which is how
darkoak's room watches the machine, and the signalling socket.

Every mode offers every map: which map you play is a choice, not a property of the game
type. The list lives in `cs-server/main/modes/*.maps.txt`, the client's zip carries exactly
those maps, and `addons/amxmodx/configs/maps.ini` — the in-game `amx_mapmenu` — is the
same list again, so the menu never offers a map a browser would have to download. The
entrypoint copies the addons at start, so changing that file needs a container restart.

## People: invitations instead of a shared login

Since 9 September 2026 a person is somebody the relay knows. An admin makes an
**invitation** on `/people` — a name and a role, player or admin — and gets a link,
`/i/<token>`. Whoever opens the link is that person in that browser from then on: the
lobby fills in their name and locks it, `/api/sessions` names their session, and their
packets leave the relay from an address that is theirs alone (`127.1.hi.lo` from their
id), so the game server sees a stable player, with a `STEAM_` id Reunion derives from the
address, instead of `VALVE_ID_LAN` for everyone.

The name is theirs to change: typing a different one in the lobby renames the person
everywhere (the seat and the role stay). And the lobby fills in the server password for an
invited browser — the invitation already opened a bigger door — so nothing is typed; the
password itself stays, because it is what keeps strangers off the game's own tunnel.

Changing the game — type, map, gravity, the rest of the lobby's controls — is for admins;
everyone else sees the settings and cannot touch them, and the relay refuses the change
(`POST /api/settings`) from anyone who is not one.

That address is also how admins are admins: the relay writes the server's `users.ini`
(one line per admin, by address; `cs-server/main/addons/amxmodx/configs/users.ini`,
git-ignored) on every change and tells the server `amx_reloadadmins`. Nobody else has
admin flags any more — the `VALVE_ID_LAN` line is gone — so the server password is a
gate to *play*, not to *operate*. Revoking keeps the record and closes the door.

The people live in `.relay-people.json` (mode 600, git-ignored), because the tokens are
the keys. The family login (`RELAY_USER`/`RELAY_PASSWORD`) still opens the site and
`/people`, which is how the first admin is made; it is on the list in
`docs/secrets-to-reset.md` to retire.

## Network settings, and what helped

The rates are set on both sides. The server bounds them in `cs-server/main/server.cfg`:
`sv_minupdaterate 20`, `sv_maxupdaterate 101`, and `sv_maxrate 100000` (raised from the
stock 25,000 on 9 September, which choked a client asking for a hundred updates a second
and made the update-rate experiment read backwards). Within those, the client chooses:
four selects — updates a second from the server (`cl_updaterate`), commands a second to
it (`cl_cmdrate`), interpolation (`ex_interp`), bandwidth (`rate`) — in the lobby and
again in the pause card, where a change takes effect at once. They are remembered per
browser.

Every ten seconds while playing the page tells the relay what it is set to and how it is
doing (frame rate, whether the tab is in front); the relay lines that up with the game
ping and loss the server reports for the player and the browser→relay round trip, and
writes one line per player to `logs/telemetry.jsonl`. `/telemetry` (admins) shows the
last while, and a table by settings: median game ping per combination, which is the
number that says what helped.

## A tab that is not in front

A browser stops the frame loop of a page that is not in front, and the engine's loop
rides on it. So the page watches its own animation clock and, when it stalls, drives the
engine's frames itself from a worker's timer (`web/src/tick.worker.ts`) through two
functions the engine exports for it (`engine/patches/xash3d-fwgs/0004-…`). The player
stays in the game at full speed while the tab is behind another one or the screen is off,
and the loop goes back to the browser when the tab returns. `bench/hidden.mjs` measures
it, under a real window. `?keepalive=0` on the play page turns it off, for telling it apart
from anything else by ear; the telemetry counts its takeovers.

## Loading

The client downloads `valve.zip` and unpacks it into the engine's in-memory filesystem.
Since 9 September 2026 the unpack runs in a Web Worker (`web/src/unzip.worker.ts`) so the
page stays responsive, and the unpacked files are cached in IndexedDB (`web/src/cache.ts`)
keyed by the zip's identity — a repeat visit reads them back instead of downloading and
inflating again (~3.8 s vs ~7 s to in-game). Both are best-effort: no worker falls back to
an inline unzip, no IndexedDB re-downloads. Per-map bundles — a small base plus the
server's maps on demand — are the next step and belong with the museum.
