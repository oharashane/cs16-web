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

Two faults we cannot fix from outside the engine (review §6): the heap is fixed at
256 MB (`Aborted(OOM)` after minutes — patched to 1.5 GB by rewriting the wasm's memory
section, which buys time and nothing else); and the engine leaks ~50 KB of its "Network
Pool" per received datagram. Both are in C we can only reach by compiling it ourselves.
(A third — the missing money and round timer — was on this list on day 1 and turned out
to be a CSDM server setting; see the review. Diagnoses are provisional.) Beyond fixing: configurability (build flags are ours),
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

### Day 1 result: the engine is reproducible

The first engine build took about two minutes on twelve cores and produced the seven
artefacts the npm package ships. Compared with the pristine 1.2.2 tarball
(`engine/compare.py`): `xash.wasm` 3,923,825 bytes both, 549 imports and 8,874 exports
both and *the same sets*, `raw.js` 501,468 bytes both, every side module the same size —
and by sha256, **6 of 7 files byte-identical** (1 differ). The glue patch applied
cleanly (`export default Xash3D`, `start()`, no leftovers): emsdk 4.0.23 emits exactly the
strings the script looks for, so pinning that version was the right call for step 1.

So the published engine is not a mystery any more: it is this source, this toolchain,
these flags, and we can make it again on demand. That is the baseline every later change
is measured against.

The one file that differs, `valve/extras.pk3`, is a zip written at build time: same entry
names, CRCs and sizes, different timestamps inside. Not a real difference.

`npm run build:next` applies the same 1.5 GB heap patch to our engine that `/play` gets,
so that when the two sit side by side the *only* thing that differs is who compiled the
bytes. (`engine/compare.py` must be run before that patch, on a fresh `build.sh` output,
or the memory row will show 1.5 GB against 256 MB and look like a regression.)

### Day 1 result: the game is reproducible too, and step 1 is done

`cs16-client` built in about six minutes (ReGameDLL and yapb are most of it) on emsdk
4.0.17. Against the pristine 0.1.2 tarball: the menu byte-identical; the client dll, the
game dll and the yapb module the same size with identical import and export sets, and
differing in **78, 148 and 738 bytes respectively — all of them `__DATE__`/`__TIME__`
strings** ("Oct 22 2025" → "Sep 9 2026", found with `strings | diff`). `extras.pk3` again
differs only in zip timestamps.

`npm run build:next` bundled our packages into `web/dist-next`; the relay serves it at
`/next` beside `/play`; the served `xash-*.wasm` hashes the same as the one at `/play`
once both carry the 1.5 GB heap patch. **The full Playwright suite passes 8/8 against
`/next`** (`PLAY_PATH=/next/ npx playwright test`) — lobby, join, leave-and-return, Escape,
remembered name, the slot-hijack regression, the deathmatch crash guard, the refused
password.

What that means: the withdrawn npm packages are exactly `f85aa0c` + `2490c5e` + emsdk
4.0.23/4.0.17 + the recipe above, and we can produce them at will. Nothing downstream —
the relay, the page, the tests — can tell the difference. Every later change starts from
here and is measured against here.

Small thing noticed on the way, not fixed: `index.html` hard-codes `/client/favicon.png`
and `/client/loading.jpg`, which only work because `/client` redirects to `/play`. Should
be relative or base-aware; harmless today.

### Where this goes next (in order)

1. **Memory growth.** `-sALLOW_MEMORY_GROWTH=1` in place of the fixed 256 MB (FWGS master
   already links its own Emscripten target that way). Retires `patch-wasm-heap.py`.
2. **The Network Pool leak.** Now findable: build a variant with `-sASSERTIONS=1 -g2
   --profiling-funcs` instead of `-Oz --closure 1`, and instrument `Mem_Malloc` on the
   pool with its caller. The candidates are the 284 lines the fork added to `net_ws.c`.
3. ~~The suit bit / money.~~ Struck out on day 2: it was CSDM's `hide_money`/`hide_timer`
   (a server setting) and is fixed; the engine was never at fault. Recorded in the review
   as a wrong diagnosis, with what it teaches.
4. **A debug flavour** of the build kept beside the release one, for exactly this kind of
   work, plus telemetry hooks (`Module.callbacks` already exists; `memlist` to JS).
5. **Performance**, measured with the fps harness in the scratchpad against dust2 and
   agency: `-O3` instead of `-Oz`; `-msimd128`; `-sMALLOC=mimalloc`; the gl4es renderer
   (submodule already present) against the gl2_shim `webgl2` one; initial heap sizing.
6. **Tracking upstream**: rebase the 25 commits onto current FWGS master (847 commits
   ahead) — worth doing once, with ololoken, who is clearly still working on this.

---

## Day 2 — 9 September 2026: the first change of our own

### How changes are kept

Not by editing the archived checkout. `engine/patches/<package>/NNNN-name.patch` are
unified diffs against the pin; `build.sh` appends the directory to the Docker context and
the Dockerfile applies them with `patch -p1 --forward` before configuring. A patch that
stops applying fails the build loudly. The archive stays exactly `yohimik-pin`, and the
whole difference between "what yohimik shipped" and "what we run" is readable in one
directory. That is the shareable unit.

### Patch 0001: memory growth

`-sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2gb` on the engine's link line, next to the
unchanged `-sINITIAL_MEMORY=256mb`. Result (`compare.py`): memory `256 MB / 2048 MB` where
the published build had `256 MB / 256 MB`; imports and exports identical; `xash.wasm` one
byte larger; `raw.js` 347 bytes larger, which is the growth code Emscripten now emits
instead of `abort("OOM")`.

**The trap that comes with growth** — worth knowing before it bites: when the heap grows,
the WebAssembly memory's `ArrayBuffer` is replaced and every typed array anyone captured
earlier is *detached*. Yohimik's glue patch returned `HEAPU8`, `HEAP32` and friends as
plain values, captured once at start-up, and the network layer reads `em.HEAPU8` on every
packet. That is fine only while the heap can never grow. (His 1.2.1 changelog says
"Fixed: Detached array error", which suggests he met exactly this and chose the fixed
heap rather than the getter.) Our copy of `scripts/patch-emscripten-js.mts` returns
getters — `get HEAPU8() { return HEAPU8 }` — so the wrapper always sees the current view.
With that, `patch-wasm-heap.py` is no longer used for `/next` (it would have written
`max = initial` back in and switched growth off).

### Money and timer: closed, and a note on method

Shane confirmed in play what the CSDM config predicted; a fresh screenshot shows `$ 150`
and a `4:21` round clock at the bottom right. My "still missing" check on day 1 had
cropped the *top* right corner, where I assumed a CS 1.6 HUD puts money. It does not.
The suit-bit theory was built on the widget's second early return while its first was the
one firing; both the crop and the theory are recorded in the review as what not to do.

### The "leak" was not a leak

Reading the engine with the fixed-heap failure in mind, the allocation that matched the
numbers was in `Netchan_Process` (`engine/common/net_chan.c`): every incoming message
carrying the fragment bit calls `Netchan_FindBufferById(…, allocate = true)`, which
allocates a buffer of **`NET_MAX_FRAGMENT` — 65,535 bytes — for each new fragment id**,
on the pool the engine names "Network Pool", and writes into it the fragment's actual
payload, which the server sends a packet at a time at about a kilobyte. Sixty-fold
amplification, held until the transfer completes or the map changes.

Then the screenshots from 7 September were re-read: every one taken during the "leak"
measurements shows green text in the corner — *Downloading [2 remaining]:
media/Half-Life08.mp3 4.1%* — the four missing mp3s (review §6), arriving in-band because
the server had them and the client's zip did not. 58 KB of pool per datagram, 64 MB a
minute, "identical whether standing still or walking": a file download, not a leak. It
only ever looked like memory going missing because the heap could not grow and the map
did not change for fifteen minutes.

Three things follow, and all three are done:

- The content fix of 8 September (ambience and media back in the zip) removed the cause
  for our maps — nothing left to download in-band.
- **Patch 0002** sizes each incoming fragment buffer to its fragment
  (`((frag_length + 7) >> 3) + 16` bytes) instead of 64 KB, replacing a buffer only if a
  larger fragment with the same id ever arrives. Completion, copying and flushing read
  `MSG_GetNumBytesWritten`, not the capacity, so nothing else changes. An in-band
  download now costs about what it is.
- **Patch 0003 (a/b/c)** frees a failed transfer's fragments when the server says
  `svc_filetxferfailed`, via a new `Netchan_DropIncoming` that does not clear
  `net_message` (the existing `Netchan_FlushIncoming` does, and is therefore unsafe to
  call from inside the parser). Before, they lived until the next map.

The review's §6 called this a leak in "the engine's C, in the pool the engine names";
that was right about where and wrong about what. A wrong diagnosis with the right
address is still worth a correction, and the review gets one.

What made the difference this time was being able to *read the code that produced the
number*. Two days of black-box measurement got as far as "50 KB per packet"; two hours
with the source got to the line.

### Day 2 result: the growing engine survives what killed the fixed one

Same shooting harness as 7 September, driving `/next` on the growth build (patch 0001
only; the fragment patches came after this run): **eight minutes, 38,303 datagrams,
alive at the end.** The published 256 MB engine died in that harness at about two and a
half minutes and 5,000 datagrams. The suite passes 8/8 against `/next` on the same build.

That is the fixed-heap problem closed from the right end: not a bigger wall to hit later,
but no wall. Pool measurements on a quiet server follow, to show the wall was never
being approached once the downloads stopped.

### Day 2 result: the pool is empty

Measured on a quiet server, sixty seconds idle in a game, the hardened parser reading the
engine's own `memlist`:

| | packets in 60 s | Network Pool at start | at end |
|---|---|---|---|
| `/play` (published engine) | 4,667 | 0.0 MB | 0.0 MB |
| `/next` (ours: growth + fragment patches) | 5,443 | 0.0 MB | 0.0 MB |

The raw line, on `/next`, thirty seconds apart: `0 bytes (88 bytes real) Network Pool`,
total engine memory `64.93 Mb` both times. Two days ago the same measurement read
`3 MB → 68.8 MB` in sixty seconds, and the 3 MB "baseline" was itself the download
already under way at spawn. The pool holds nothing when nothing is being downloaded —
on the published engine too. Patches 0002 and 0003 change what happens *when* something
is downloaded; the content fix is what made nothing need to be.

### A test bug the second engine exposed

The `/next` suite failed 7/8 once, on the slot-hijack test: "the vanished player never
connected". The server log showed the vanisher connecting and never spawning before the
test closed its tab. Cause: `enteredTheGame()` read the last 400 log lines with no time
window, and a *previous* run's "vanisher entered the game" satisfied it. The same names
are used run after run; on a busy afternoon the lines pile up. It now takes the test's
start time and reads `docker logs --since` — the join test had the same trap, with a
different name. Not the engine's fault; found because a second engine meant running the
suite twice as often.

Second cause, found by running it twice in a row: a player name used again within
`sv_timeout` (180 s since the 7th) comes back as `(1)vanisher`, because the first tab's
ghost still owns the name — the server log says so in as many words. The test's
`enteredTheGame('vanisher')` cannot match `"(1)vanisher<`. Every test player now gets a
fresh name per run (`vanisher-k3f9a`), and the slot test passed three times back to back
on `/next`. Both fixes were needed; the first alone passed once and failed once.
