# bench/ — the measurements

Every number in `docs/engine/journal.md` and the review came from a script like these.
Until 9 September they lived in a session scratchpad and would have vanished with it;
now they live here, so the next engine build is measured the same way as the last one.

They drive the built client through the running relay against the live game server, the
way the Playwright suite does — end to end on this machine, not a unit test. Headless
Chromium draws with SwiftShader, a CPU rasteriser that caps at 60 fps: frame rates here
are about the engine and the number of draw calls, never about a GPU, and a map that
reads 60 is "fast enough here", not a measurement.

    node bench/boot.mjs      does this build boot and join at all; what the engine said if not
    node bench/load.mjs      Join → in the game, first visit and second; worst main-thread stall
    node bench/fps.mjs       frames per second on the current map, per window size, per settings
    node bench/pool.mjs      the engine's own Network Pool accounting, idle, twice
    node bench/lag.mjs       game ping and the browser→relay hop for one player, per settings
    node bench/soak.mjs      minutes of shooting; memory each minute; whether anything kicked us
    node bench/modes.mjs     every game type: switch to it, join, spawn, read its cvars back (changes the live server)
    node bench/hidden.mjs    a tab that is not in front: do the datagrams keep coming, is the player still on the server
    npm run bench            boot, load, fps, pool — the quick pass after a rebuild

Each script's header says what it takes from the environment. The ones that matter to all
of them:

| variable | default | |
|---|---|---|
| `PLAY_PATH` | `/play/` | `/next/` measures the canary build instead |
| `RELAY_URL` | `http://127.0.0.1:27100` | |
| `SERVER` | the primary | a port, to reach a server that is not the one the lobby offers |

Credentials are read from the files the services read them from — the site's login from
`.relay.env`, the server's password and rcon from `cs-server/.env` — and never printed or
put on a command line. `scripts/rcon.py` is the rcon path; it only reaches servers on this
machine.

Run them one at a time. Two browsers rasterising at once share the CPU and both read low.
`MAP=` on fps and all of `modes.mjs` change the live server, for everyone on it.

`hidden.mjs` needs a real window to mean anything — headless Chromium reports every page
visible, whatever is in front — so run it as `HEADED=1 xvfb-run -a node bench/hidden.mjs`.

`load.mjs` runs its two visits in two browsers on one profile on disk. A second engine
boot from the cache in the same incognito-style context — what `newContext()` gives —
crashes headless Chromium's browser process; a profile on disk, which is what a player
has, does not. The journal (day 4) has the isolation table.

What they have found so far, for the record:

- **-O3 buys nothing** (fps, two sizes, two runs each): the engine's own WebAssembly is
  not where a frame goes; the GL path is.
- **The "leak" was a download** (pool): 0 bytes idle once the missing sounds were shipped.
- **The growing heap survives** (soak): 8 minutes and 38,303 datagrams where the fixed
  heap died at ~5,000.
- **`cl_updaterate 20` reads 21 ms game ping against 47** (lag): a feel question that
  needs a person, not a headless run.
- **7.0 s first visit → 3.8 s from cache** (load), one ~780 ms heap-growth stall left.
