# cs-server/ — the game server

One ReHLDS server in Docker, `cs16-main` on UDP 27015, built by `Dockerfile` from pinned
parts and run by `docker-compose.yml`. Every game type's plugins are loaded at once and
the type is decided at run time by the files in `main/modes/`; see the repository README
for how modes work and how to switch them.

## What the image is

Since 9 September 2026 the image is built here, not pulled: HLDS 3378 from Steam through
steamcmd (there is no other source), and each of the parts from its release URL with a
sha256 beside it in `Dockerfile`. `cat /home/steam/csserver/PARTS` inside a container
says what it was built from. Today:

| part | version | what it is |
|---|---|---|
| ReHLDS | 3.15.0.896 | the engine, rebuilt: security fixes, the 2025 userinfo exploit closed |
| ReGameDLL | 5.30.0.814 | the game: Counter-Strike's rules, and the Condition Zero bots |
| Metamod-r | 1.3.0.149 | loads the plugins below between engine and game |
| Reunion | 0.2.0.34 | lets no-Steam clients — the browser is one — join, and gives them an identity (`reunion.cfg`) |
| AMX Mod X | 1.10 build 5481 | the scripting layer the game-type plugins run on |
| ReAPI | 5.29.0.358 | AMX Mod X's window onto ReHLDS/ReGameDLL, for plugins written for them |
| ReDeathmatch | 1.0.0-b11 | a deathmatch written for ReGameDLL; installed, not yet enabled (`plugins-redm.ini.example`) |
| zBot profiles | commit `ba1e521` | the bots' personalities and radio chatter, from ReGameDLL's repository |

Until then it was `timoxo/cs1.6:1.9.0817` from Docker Hub — ReHLDS 3.13 (2023), ReGameDLL
5.26, and AMX Mod X **1.8.2 (2011)** — which `docs/engine/journal.md` (day 4) records the
reasons for leaving.

Change a version by editing its `ARG` and the hash beside it; `docker compose build`
does the rest. A wrong hash fails the build, which is the point of it.

## What is where

```
Dockerfile           the image: HLDS + the parts above + entrypoint.sh
docker-compose.yml   the one service, its mounts, its ports; reads ./.env
entrypoint.sh        at start: links the content in, copies the config over, renders server.cfg, runs HLDS
.env                 RCON_PASSWORD and SV_PASSWORD (mode 600, git-ignored)
shared/              content, mounted read-only at /content: maps, wads, sounds, models (git-ignored, 1.7 GB)
shared/addons/       the AMX Mod X configs that are ours (admins in users.ini, cmdaccess.ini) and metamod's plugin list
shared/reunion.cfg   how a joining client gets an identity — see the review, "one identity for every browser"
main/                this server's config, mounted read-only at /config: server.cfg, plugins.ini, modes/, addons/
main/modes/          <name>.cfg, <name>.maps.txt (ReGameDLL adds .txt to whatever mapcyclefile says), modes.json, current.cfg
main/addons/         the game-type plugins and their configs: CSDM 2.1.3 (deathmatch), GunGame 2.13c, and csdm's module
navs/                the bots' navigation meshes, one per map, built by the server the first time a bot plays it
logs/main/           HLDS logs (they carry rcon lines; never paste one)
```

Anything under `shared/` or `main/` is read at start or at the next map change; nothing
there needs an image build. The three 2025 servers (classic, deathmatch, gungame on
27021–27023) were retired on 9 September 2026; their definitions are in git history.

## Running it

```sh
cp ../.env.example .env && chmod 600 .env     # then put generated passwords in it
docker compose build
docker compose up -d
docker compose logs -f main
```

`../scripts/rcon.py 27015 status` talks to its console from this machine, reading the
password from `.env` so it never goes on a command line. Darkoak's cs16 room does the same
through its own tools.

## Bots

ReGameDLL's Condition Zero bots are built in and enabled (`bot_enable 1` in
`game_init.cfg`); how many play is `bot_quota`, which starts at 0. They wait for a human
(`bot_join_after_player 1`) and build a map's navigation mesh the first time they play it —
five or six seconds for a small map, saved to `navs/` and kept. `bot_chatter off` keeps them
from playing radio sounds the browser client does not carry. See `docs/bots.md`.
