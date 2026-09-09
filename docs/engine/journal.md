# Building the engine ourselves — a journal

*A working log, kept as we go, of rebuilding the browser engine (Xash3D FWGS + cs16-client,
compiled with Emscripten) instead of depending on the tarballs yohimik published and then
withdrew. Written for the next person to do this — probably us, in a year — and as raw
material for an eventual interactive explanation of how a 2003 game ends up in a browser
tab. Struggles are recorded on purpose; the smooth parts are the least instructive.*

Companion files: `engine/` (the build), `docs/review/index.html` §4 (the upstream story),
`docs/bots.md` (parked).

---

## Day 1 — 8 September 2026: recovering the sources

### Why we are doing this

Three faults we cannot fix from outside the engine (review §6): the heap is fixed at
256 MB (`Aborted(OOM)` after minutes — patched to 1.5 GB by rewriting the wasm's memory
section, which buys time and nothing else); the engine leaks ~50 KB of its "Network Pool"
per received datagram; and the client hides the money and round timer because the weapon
bits it receives never carry `WEAPON_SUIT`. All three are in C we can only reach by
compiling it ourselves. Beyond fixing: configurability (build flags are ours),
debugging/telemetry (`-sASSERTIONS`, memory profiler, our own hooks), mobile/web
performance (renderer choices, `-O` levels, SIMD), and independence from a maintainer who
already vanished once.

### What the published build actually was

`xash3d-fwgs@1.2.2` on npm was built from **yohimik's fork of the engine, branch `merged`,
commit `f85aa0c`** (19 Jan 2026) — *not* from FWGS upstream — plus `cs16-client@0.1.2` from
**yohimik's fork of Velaron/cs16-client, commit `2490c5e`**. Both fork repositories were
deleted on 28 August 2026. The monorepo mirror we kept (`~/darkoak-backups/
webxash3d-fwgs-mirror-2026-07`) has the *recipes* (Dockerfiles, the TypeScript wrapper, the
script that patches Emscripten's output) but its submodule directories are empty: the
engine and client sources were never in it.

The recipes, verbatim from the mirror:

    # engine — emscripten/emsdk:4.0.23
    EMCC_CFLAGS="-s USE_SDL=2"
    emconfigure ./waf configure --emscripten && emmake ./waf build && emmake ./waf install --destdir ./out
    mv out/xash.js out/raw.js          # then scripts/patch-emscripten-js.mts rewrites it

    # cs16-client — emscripten/emsdk:4.0.17
    emcmake cmake -S . -B build -DCMAKE_INSTALL_PREFIX=./out && cmake --build build --config Release --target install

### Struggle 1: the source is in deleted repositories

The obvious route — clone the fork — is gone. What worked: GitHub keeps a fork's objects
in the parent repository's shared store for a long time after the fork is deleted, and
`git fetch <upstream> <sha>` will hand them over if you know the SHA. We knew both SHAs
from the mirror's `.gitmodules` pointers.

    git clone https://github.com/FWGS/xash3d-fwgs
    git fetch origin f85aa0c8f7d46c27191132b44d872c8e331308de      # yohimik's merged branch tip
    git clone https://github.com/Velaron/cs16-client
    git fetch origin 2490c5e9b66928e86df191ec1cdd802b6357a71c      # yohimik's client tip

Both fetched. The GitHub API also answers `200` for those commits under the parent repos,
which is the same mechanism and is *not* proof a commit is in the parent's history: the
compare API says `f85aa0c` is 25 commits *ahead* of FWGS master and hundreds behind.
Those 25 are the port. Durable copies now live in
`~/darkoak-backups/engine-sources-2026-09-08/`, tagged `yohimik-pin` in each — do not rely
on GitHub still serving them next year.

### What the 25 engine commits are (so the port is understood, not just copied)

27 files, +592/−118. The shape:

| Area | What it does |
|---|---|
| `engine/platform/emscripten/net_emscripten.{h,js}` | Every BSD socket call (`recvfrom`, `sendto`, `sendto_batch`, `socket`, `select`, …) is `#define`d to `emscripten_net_*`, and a `--js-library` forwards each to `Module.net.*` — the JavaScript `Net` object our WebRTC transport implements. This is the whole trick that lets a UDP game speak WebRTC. Author: ololoken. |
| `engine/common/net_ws.c` (+284) | `NET_USE_SEND_BATCH`: fragments sent as a batch through `sendto_batch`; split-packet handling. **This is where the Network Pool lives — the leak is somewhere in these 284 lines or what they call.** |
| `engine/platform/emscripten/lib_emscripten.c` | `dladdr` replacement: finds a function's name by walking `LDSO.loadedLibsByHandle` in JS (dynamic linking of the game/menu side modules needs it). Also exports `getErrnoLocation` so JS can set `errno`. |
| `engine/common/{host,cmd}.c`, `cl_gameui.c` | Exports `Cmd_ExecuteString` (`EMSCRIPTEN_KEEPALIVE`) — how the page talks to the console; the main loop via `emscripten_set_main_loop_arg`; callbacks `Module.callbacks.gameReady/serverInfo/fsSyncRequired`. |
| `filesystem/filesystem.c` | Tracks each open file's path and mode so writes can notify JS (`fsSyncRequired`) — persistence hooks. |
| `ref/gl/*`, `wscript` | A `webgl2` renderer target (`XASH_WEBGL=1, XASH_GLES=1`) built on `gl2_shim`; `precision highp float` injected into shaders; alpha channel forced to 0 for a Chromium bug. |
| `engine/wscript` | The link line — see below. |
| `scripts/waifulib/{c_emscripten,xcompile}.py` | Teaches waf that `--emscripten` means `emcc`/`em++`/`emar`, `.wasm` side modules with `-sSIDE_MODULE=1 -Oz`, and a `-sMAIN_MODULE=1` program. |
| `common/port.h`, `3rdparty/library_suffix` | Library extension is `.wasm`, so `dlopen("cs_emscripten_wasm32.wasm")` resolves. |

The link line that made the build we run (and its two decisions we will change):

    -sENVIRONMENT=web -sAUTO_JS_LIBRARIES=0 -lidbfs.js -lwebgl.js -lopenal.js -lasync.js -sNO_POLYFILL
    --js-library=../engine/platform/emscripten/net_emscripten.js
    -sINITIAL_MEMORY=256mb -sSTACK_SIZE=16mb -Oz --closure 1 --minify-wasm-imports
    -sMAX_WEBGL_VERSION=2 -sMIN_WEBGL_VERSION=2 -sFULL_ES2
    -sEXPORTED_RUNTIME_METHODS=callMain,addRunDependency,removeRunDependency,FS,ccall
    -sMODULARIZE -sEXPORT_NAME=Xash3D

No `ALLOW_MEMORY_GROWTH` — hence the fixed heap. `-Oz --closure 1` — hence no symbol
names in stack traces. FWGS upstream master, by contrast, links its (separate, older,
SDL-based) Emscripten target with `-sINITIAL_MEMORY=128MB -sALLOW_MEMORY_GROWTH=1
-sASYNCIFY=1`; that target has no `platform/emscripten` directory and no network bridge,
so it is not a drop-in alternative, but it is evidence growth works with this codebase.

The 7 cs16-client commits are small (+38 lines): the client dll built as a `-sSIDE_MODULE`
`.wasm`; `HUD_GetRenderInterface` short-circuited; device-pixel-ratio applied to
`m_truescrinfo` (the 2× Retina story); and — the important part — **submodule pointers
into two more yohimik forks**, `ReGameDLL_CS` (the game/server dll, `cs_emscripten_wasm32.wasm`)
and `mainui_cpp` (the menu). Their Emscripten changes live *there*. Recovered the same
way; see below.

### Struggle 2: two more deleted forks under the client

`cs16-client/.gitmodules` at the pin points `3rdparty/ReGameDLL_CS` and `3rdparty/mainui_cpp`
at `yohimik/…` — gone. `git submodule update` fails on the URL before it can try the SHA.

What worked: the port's real author is **ololoken** (his name is in every emscripten file
header), and his forks are alive — `ololoken/ReGameDLL_CS` (branches `emscripten`,
`fork-main`), `ololoken/mainui_cpp` (`xash-emscripten`, `emscripten-xash`, …, pushed the
day we looked), `ololoken/xash3d-fwgs` (`emscripten-net`, `emscripten-gl4es`, and a `master`
that tracks FWGS), `ololoken/cs16-client`, `ololoken/library-suffix`. They serve the exact
SHAs we need. So:

    git config submodule.3rdparty/ReGameDLL_CS.url https://github.com/ololoken/ReGameDLL_CS
    git config submodule.3rdparty/mainui_cpp.url   https://github.com/ololoken/mainui_cpp
    git submodule update --init --recursive

Worth knowing about ololoken's branches: his `emscripten-net` (July 2025) is the *origin*
of the port, and yohimik's `merged` (our pin) is that work carried forward through six
months of upstream merges plus the batch-send and export changes. The pin is the most
advanced Emscripten engine that exists. His `master` is FWGS master with none of it. His
two launchers (`ololoken/xash3d-launcher`, `ololoken/cs16-launcher`, Jan 2026) are Vite
pages of his own with a public demo, and their READMEs state the build commands above
verbatim — independent confirmation of the recipe.

### The engine's other submodules

Fifteen, all at public upstreams (`FWGS/mainui_cpp`, `ptitSeb/gl4es`, xiph `opus/ogg/vorbis/
opusfile`, `FWGS/xash-extras` — which becomes `extras.pk3` — `ololoken/library-suffix`, …).
Every pinned SHA verified reachable on 8 Sep 2026.

### Machine

12 cores, 94 GB, 1.7 TB free on /home, Docker works as this user, `emscripten/emsdk:4.0.23`
pulled. No local emsdk — everything builds in the container, as yohimik did.

### Plan for the drop-in (step 1)

Same sources, same emsdk, same recipe, same wrapper — the goal is an artefact we can swap
for the tarball and not notice, so that every later change is *ours* and measurable
against a known baseline.

1. `engine/xash3d-fwgs/` and `engine/cs16-client/` hold the mirror's package recipes
   (Dockerfile, `lib/` wrapper, `scripts/patch-emscripten-js.mts`, tsconfigs).
2. `engine/build.sh` builds both in Docker with the durable sources as context, then runs
   the JS patch and `tsc`, producing two directories shaped exactly like the npm packages.
3. `web/` gains a switch: the vendored tarballs (as now) or the built packages, side by
   side — `/play/` stays on the tarball until the built one has passed the same tests.

Everything after that — memory growth, the leak, the suit bit, `-sASSERTIONS`, a debug
build, telemetry hooks, renderer/perf work — starts from a green drop-in.

### Struggle 3: getting the source into Docker without copying it into the repo

The sources are 380 MB with submodules and belong in `~/darkoak-backups`, not in
`cs16-web`. Yohimik's Dockerfiles do `COPY xash3d-fwgs .` from the package directory,
which only works because the monorepo had the source as a submodule right there. Two
things did not work: a symlink from `engine/xash3d-fwgs/xash3d-fwgs` to the backups
(Docker refuses paths outside the build context), and feeding a tar on stdin with
`-f engine/xash3d-fwgs/Dockerfile.build` — BuildKit's exact words:

    failed to read dockerfile: open /home/…/engine/xash3d-fwgs/Dockerfile.build: no such file or directory

When the context arrives on stdin, `-f` is resolved *inside the tar*. What works, and is
what `engine/build.sh` does: `git ls-files --recurse-submodules -z | tar …` to get exactly
the checked-out files (submodules in, `.git` out — which is also what yohimik's `COPY` of a
submodule directory gave him, since a submodule's `.git` is a pointer file), then
`tar -rf` our Dockerfile onto the end, then `docker build -f Dockerfile.build - < tarball`.
Contexts came out at 105 MB / 2,775 files for the engine and 71 MB / 2,039 for the client.

A smaller trap on the way: `setsid nohup ./build.sh … &` prints `Done` from the shell
within seconds, because `setsid` forks and its parent exits while the build carries on as
a daemon. The first time that looked like an instant failure — and that time it *was*
one, which is how the two got confused. Now the script prints `=== name: BUILD OK` or
`BUILD FAILED` and the last thirty lines of the log, and that is what we wait for.

### Day 1, evening: first builds launched

Both packages building in parallel, engine on emsdk 4.0.23 and client on 4.0.17, exactly
the recipe. Waiting.
