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
amplification, held until the transfer completes or the map changes. (58 KB per datagram
rather than 64: not quite every datagram carried a fragment.)

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

### Day 3 — 9 September: measuring, and two things the source volunteered

**A misreading, caught within the hour.** A grep of `wscript` put `LOW_MEMORY = 1` next
to the Emscripten configure lines, and for about an hour the journal, the review and
patch 0002's description said the web build's fragment buffers were 32 KB and that
`NUM_PACKET_ENTITIES` was capped at 64. The line belongs to the branch *above* — MAGX,
a Motorola phone platform. The Emscripten branch sets `GL = False, WEBGL2 = True` and
nothing else; `XASH_LOW_MEMORY` is 0 on the web, the buffers were 64 KB as first written,
and ~58 KB per datagram means nearly every datagram carried one fragment. Reverted
everywhere. Grep output shows lines, not the `if` they live under; read the block.

**Rebasing onto FWGS master: a first look.** Master is 739 commits past the fork's base
(18 Jan 2026). Twenty of the fork's 27 files were also changed upstream since. A dry
`git rebase` stops on the *first* fork commit with five conflicts: `common/xash3d_types.h`,
`engine/common/launcher.c`, `engine/platform/sdl2/vid_sdl2.c`, `wscript`, and
`scripts/waifulib/c_emscripten.py`, which upstream has **deleted** — their Emscripten
support moved elsewhere in the build system. So this is not an afternoon; it is a port of
the port, best done with ololoken, and it is the reason the pin is worth keeping
buildable for as long as it serves.

**gl4es for the web: feasible on paper.** gl4es's own sources and CMake mention
Emscripten; the fork's configure simply never enables it (`GL = False`, `WEBGL2 = True`).
A variant patch adds `GL4ES = True` to that block. Whether it compiles is the next
experiment.

**`-O3` versus `-Oz`: nothing.** Same client, same window, same map, the speed variant
(`patches/xash3d-fwgs.speed/`, -O3 on the main module and every side module) against the
base, two runs each:

| awp_rooftops | base | -O3 |
|---|---|---|
| 640 × 400 | 30.9 / 31.4 fps | 30.7 / 31.1 fps |
| 320 × 200 | 37.9 / 38.0 fps | 37.8 / 37.6 fps |

(cs_office, cs_italy and de_dust2 sit on the 60 Hz frame cap in headless Chromium at
either size and cannot show a difference.) The -O3 engine is 3% larger, the renderer 24%
larger, the menu 22% larger, for no frames. So the engine's own WebAssembly is not where
a frame's time goes; the GL path is — here the software rasteriser, on a real machine the
browser's per-draw-call cost through the shim. The base stays `-Oz`: smaller download,
same speed. The variant stays in the tree as the record. Next lever is the renderer.

(A caveat on the harness: headless Chromium draws with SwiftShader, a CPU rasteriser, so
the 320 → 640 drop is fill cost a GPU would not pay. The -O3 result holds at both sizes,
which is what makes it a result about the engine rather than about the rasteriser.)

**gl4es for the web: it compiles, it initialises, and then the page dies.** The variant
(`patches/xash3d-fwgs.gl4es/`, one line: `conf.options.GL4ES = True` in the Emscripten
configure block) produces `libref_gl4es.wasm`, 1.2 MB against the shim's 210 KB. Loaded
under the shim's name (a Vite alias for `ENGINE_REF=gl4es`; string aliases do not match an
import with a `?url` query — use a regex), it prints its whole LIBGL banner — *Hardware
vendor is WebKit, Targeting OpenGL 2.1, Trying to use VBO* — and then the page reports
"The game could not start: n is not a function". A minified name; a JavaScript function the
engine expected and did not get. Building gl4es with the debug flags to read the real one.
The suspect: gl4es resolves many GL entry points through `eglGetProcAddress`, and
Emscripten has shipped `GL_ENABLE_GET_PROC_ADDRESS=0` by default since 3.1.x, which makes
that return null. If so, one link flag.

Also from this round: the fps harness needs `S` (the scratchpad path for rcon) in its
environment; three "failures" of the gl4es measurement were that, not gl4es.

**The glue patch script is exact-string matching, and the debug build found it out.**
Yohimik's `patch-emscripten-js.mts` rewrites Emscripten's glue with three `replaceAll`
calls on exact text — Closure's one-line output. A build without Closure emits the same
code readably, with spaces, newlines and a comment inside one `else`, and the script
silently did nothing, so the page failed with `"default" is not exported by
…/generated/xash.js`. Ours now matches patterns instead of text, throws when a pattern
finds nothing (a silent no-op is how this stayed hidden), and was checked against both
shapes — the published minified glue and the debug one. Any future emsdk that changes the
glue will fail loudly at build, which is the right place.

**gl4es: where it actually stops, by name.** With the debug flags the minified `n` became
`Aborted(Assertion failed: undefined symbol 'glColor4f'. perhaps a side module was not
linked in?)`. The module's own tables say the rest: `libref_gl4es.wasm` has **3 exports
and imports 89 GL functions** — `glBegin`, `glColor4f`, `glActiveTextureARB`,
`glBufferDataARB`, … — and exports no `gl4es_*` symbol at all. The 1.2 MB is `ref_gl`
compiled with `XASH_GL4ES=1 XASH_GL_STATIC=1`, calling OpenGL 1 directly and expecting
*someone else* to provide it. gl4es — the translator that would provide it — was never
linked in: waf's `libs: ['gl4es']` on a side-module target under Emscripten does not
pull the library's objects into the `.wasm`, and the main module has no GL1 either
(`-lwebgl.js` is GLES2-shaped). So the experiment ends at a link problem, not a
rendering one. To go further: build gl4es's own CMake for Emscripten as a static
archive and link it into the side module (or into the main module and export the `gl*`
names), then try again. Parked; the shim is what `/next` runs. Given that `-O3` moved
nothing, a faster translator would have to cut *draw calls*, and gl4es's own banner said
"Not trying to batch small subsequent glDrawXXXX" — so the expected gain was small
before the link problem was found.

### Day 3, later: our engine is what /play serves

After a family session on `/next` and 8/8 suites on both routes, the built engine became
the default: `web`'s `build` script compiles against `engine/xash3d-fwgs` and
`engine/cs16-client` with no wasm-patching (the engine grows on its own), and the relay
serves it at `/play`. The withdrawn tarballs stay installed in `web/vendor/` as the
archived reference; `npm run build:vendored` rebuilds against them for a comparison, and
`patch-wasm-heap.py` survives only for that path. `/next` stays the canary: it builds the
same engine until a variant dist is dropped into `engine/xash3d-fwgs/dist` (e.g.
`./build.sh engine speed`), which is how the next experiment gets in front of a browser
without disturbing `/play`.

The OOM watchdog in `main.ts` (the reconnect-before-the-ceiling) is now a safety net that
should never fire, since the heap grows to 2 GB. Left in place: it costs nothing when it
does not trigger, and a mobile browser with a tighter ceiling might still reach it.

## Day 4 — 9 September 2026: the platform first

The museum can wait; the decision today was to make the platform stable and fast and
current before building anything on it. The order: the measurements into the repo, our
own server image, identity, the hidden-tab keepalive, per-map bundles, then latency with a
person at the keyboard, then the smaller dependency updates. The engine rebase onto FWGS
master stays parked until there is a reason.

### The measurements, into the repo

Every number in this journal came from a Playwright script in the session's scratchpad —
thirty-five of them by the end, one per question, each a copy of the last with two lines
changed. They would have vanished with the session. `web/bench/` now holds the six that
answered questions worth asking again (boot, load, fps, pool, lag, soak) over one shared
library, and `scripts/rcon.py` is the rcon path the lag measurement uses — the password
read from `cs-server/.env`, never on a command line. `npm run bench` is the quick pass
after a rebuild. The README there records what each has found, so the next engine is
measured against the last.

### The server image: what is actually in it

The game server is `timoxo/cs1.6:1.9.0817` from Docker Hub — the same situation the
engine was in: somebody else's build of somebody else's components, taken on trust. Read
from the binaries rather than the label:

| component | in the image | upstream, September 2026 |
|---|---|---|
| HLDS | 3378 via steamcmd (`-beta steam_legacy`) | same — the last GoldSrc build |
| ReHLDS | 3.13.0.788 (July 2023) | 3.15.0.896 (May 2025): userinfo exploit fix, speedhack detection |
| ReGameDLL | 5.26.0.668 (Dec 2024) | 5.30.0.814 (May 2025): bot quota fixes for deathmatch, sniper-aware bots |
| Metamod-r | 1.3.0.138 (Apr 2024 build) | 1.3.0.149 |
| Reunion | 0.2.0.13 | 0.2.0.34 (Aug 2026) |
| AMX Mod X | **1.8.2** (2011) | 1.10 build 5481 |
| base OS | Ubuntu 24.04 | |

AMX Mod X 1.8.2 is fifteen years old. Everything in `cs-server/shared/addons/` — the
modules, the 23 base plugins, CSDM 2.1.3c, GunGame — was picked to run on it. The image
also carries CSDM's own `csdm_amxx_i386.so` module under `modules/`, which the newer
deathmatch plugins do not need.

Every upstream asset resolves by URL today (checked: `rehlds-bin-3.15.0.896.zip`,
`regamedll-bin-5.30.0.814.zip`, `metamod-bin-1.3.0.149.zip`, `reunion-0.2.0.34.zip`,
`amxmodx-1.10.0-git5481-{base,cstrike}-linux.tar.gz`), so the image can be built the
way `engine/` is: pinned URLs, sha256 beside each, HLDS itself from steamcmd. Nothing
about the image needs the Docker Hub one once that exists.

### The deathmatch question, which the update forces

CSDM 2.1.3 is the piece that will not follow. It predates ReGameDLL; its `csdm_ffa`
plugin segfaults on any team join (bisected on 6 September), and the ReDeathmatch
project's own survey of the field says the original CSDM "cannot work with ReGameDLL".
The lineage since:

- **ReCSDM** (ReHLDS team) — the popular adaptation; a 2022 ReHLDS issue reports the
  identical crash-on-team-select with ReCSDM 3.6 on AMXX 1.10.
- **CSDM ReAPI** (Vaqtincha, then wopox1337) — rewritten on ReAPI; lost pause, team
  deathmatch and item mode; development moved to…
- **ReDeathmatch** (`ReDeathmatch/ReDeathmatch_AMXX`, MIT) — team DM and FFA, random
  spawns, spawn protection, gun menus, per-map JSON configs with hot reload, tickets,
  bot weapon config. Needs ReGameDLL + AMXX 1.9/1.10 + ReAPI. Last release 1.0.0-b11,
  23 June 2024 (one 155 KB zip: two plugins, one gamemode JSON, three spawn files, and
  the full source); last commit May 2025; **the repository is archived, read-only.**
  Finished rather than abandoned, going by its notes, but nobody is answering issues.

So the update trades a 2011 plugin stack with a known segfault for a 2025 one that is
read-only. That is still the right trade: it is the one written for the engine we run,
it does free-for-all and random spawns natively (two things we bolted on with
`mp_freeforall` and CSDM's spawn presets), and MIT means it can be forked into
`cs-server/` and patched like the engine if it ever needs it. GunGame stays as it is
until proven on 1.10; AMXX loads older plugins.

What ReGameDLL 5.30 may also bring: the Condition Zero bots. `docs/bots.md` found
`bot_quota` unknown to the build in the image; whether a current ReGameDLL registers them
for a Counter-Strike (not Condition Zero) game is the first thing to ask the new image,
before YaPB is considered. Shane's view: bots are welcome, not required, and useful for
testing — which is exactly what a headless soak with six bots shooting at it would be.

### The image, built and booted

Written and built the same afternoon: `cs-server/Dockerfile` is three stages — Ubuntu
24.04 with the i386 libraries; HLDS from steamcmd (app 90, `steam_legacy`, run three
times because the first attempt at that app always fails); the parts fetched to pinned
URLs with a `fetch <file> <url> <sha256>` helper that fails the build on a wrong hash —
laid over the HLDS tree, `liblist.gam` pointed at Metamod. 1.22 GB against the Docker Hub
image's 1.45. First boot on a trial port, with `main/` mounted as it is on the live server:

- Every part reports itself: ReHLDS 3.15.0.896, Metamod-r 1.3.0.149, AMX Mod X
  1.10.0.5481, Reunion 0.2.0.34, ReGameDLL 5.30.0.814-dev.
- **CSDM 2.1.3c loads and runs on AMX Mod X 1.10.** Its module (`csdm_amxx_i386.so`,
  which lives in `main/addons/`, not the image) loads as a Metamod plugin, all six of its
  plugins report *running*, and so does GunGame 2.13c. The ReDeathmatch question is
  therefore not forced today; it is installed and disabled, for when CSDM's remaining
  limits (no random spawns of its own, the `csdm_ffa` segfault) are worth the change.
- A browser client joins through the relay (`?server=27016`), so Reunion 0.2.0.34 with
  our `reunion.cfg` still hands the Xash client an identity.
- **`mapcyclefile` comes back with `.txt` on the end.** Set it to `modes/ffa-dm.maps` and
  read it back: `modes/ffa-dm.maps.txt`. ReHLDS's own source does not do it, so it is the
  new ReGameDLL — and `nextmap.amxx` then reads a file that does not exist. The rotation
  files are now `<mode>.maps.txt` everywhere (the mode cfgs, the relay's `modes.go`, the
  packager, darkoak's `Cs16Modes.cs`, which reads either name), and the old names are
  gone from the tree.
- **The bots are there.** `bot_add` on the trial server brought in "Harold", who built the
  navigation mesh for de_dust2_3x3 in six seconds — and then could not read it back,
  because `maps/` is a link into the read-only content mount, so the save silently failed
  and the bots were kicked "to maintain quota". `entrypoint.sh` now makes `maps/` a
  writable directory of links into the content, mounted from `cs-server/navs/`, and the
  second try saved a 260 KB `de_dust2_3x3.nav` on the host. The profiles and chatter come
  from ReGameDLL's repository (`regamedll/extra/zBot/bot_profiles.zip`, pinned to the
  commit that last touched it); `bot_enable 1` is set in `game_init.cfg` at build, since
  that cvar is read once at start; quota starts at zero and bots wait for a human.
- rcon answers from ReHLDS 3.15 end in NUL bytes, which made `grep` treat every answer
  as binary and print nothing; `scripts/rcon.py` strips them. An hour went into thinking
  the server was not answering.

### A crash that turned out to be the harness's

Writing the load measurement's "second visit" — the next day's cache hit — the page died
every time. Not the page: the *browser process*, a `trap int3` in a thread-pool thread of
`chrome-headless-shell` (the kernel log has one per attempt), no message on stderr. Full
Chromium in headless mode did it too. The shape, after a dozen isolations:

| first visit (writes the cache) | then | result |
|---|---|---|
| in a page | leave, Join again on the same page (no boot) | fine |
| in a page | reload, boot from cache | **browser dies** |
| in a page | second tab boots from cache while the first plays | **browser dies** |
| in a page | reload, cache cleared, boot from download | fine |
| in a page | navigate to a plain page, read the cache with a cursor (no engine) | fine |
| in a page | plain page, allocate a 256 MB wasm memory, read the cache | **browser dies** |
| in a page, 30 s wait | reload, boot from cache | dies (not a write still in flight) |
| in a page, cache read in 100-file slices | reload, boot from cache | dies (not the transaction's size) |
| in one browser (closed cleanly) | a new browser on the same profile boots from cache | fine (3.8 s) |
| profile on disk: in a page | reload, boot from cache | **fine** (3.9 s) |
| profile on disk: in a page | second tab boots from cache | **fine** (5.3 s) |

Every dying case used a Playwright `newContext()` — an incognito-style context, whose
IndexedDB lives **in memory** in the browser process. Every surviving one across a reload
or a second tab used a profile on disk. So: 440 MB written into an in-memory IndexedDB,
then read back into a renderer that is also allocating a large WebAssembly memory, hits
a CHECK in Chromium's browser process. A real player's profile is on disk; the family's
browsers will not see this. A private/incognito window would, on the second boot after the
first visit — noted in the review as a known limit, since detecting one is guesswork.

The measurements now use a profile on disk wherever a boot from the cache follows a
write in the same browser (`load.mjs`); the suite's cache test only checks the write. Two
hours, and the finding is a line in a README — but it was the line "the client crashes
the browser on reload" until it was.

### Cutover, 12:49

`docker compose up -d --build main`: the live server came back on the built image in
twenty seconds, every part reporting itself, `bot_chatter off`, the rotation file with its
`.txt`. The relay restarted (it reads the renamed rotations) and darkoak restarted (its
room reads either name). Two steps were left to Shane, because the auto-mode
classifier declined them from here: **the rcon password must be rotated** — it appeared
in this session's transcript, through a `docker logs` line whose nested quotes got past
the masking — and the three 2025 containers, gone from the compose file, are still
running until `docker rm -f cs16-classic cs16-deathmatch cs16-gungame`. Neither blocks
anything; both are one command.

`bench/modes.mjs` is the re-proving: switch to each mode through the settings API (an
`exec` by hand is undone at the next map load, since `amxx.cfg` re-execs
`current.cfg` — the first version of the script found that out), join, spawn, read the
mode's cvars back. Its results follow the run.

The run, on the live server, 13:05:

| mode | joined | map | csdm | gg | ffa | cycle |
|---|---|---|---|---|---|---|
| classic | 6.9 s | de_dust2 | 0 | 0 | 0 | classic.maps.txt |
| team-dm | 6.8 s | de_rats_1337 | 1 | 0 | 0 | team-dm.maps.txt |
| ffa-dm | 6.8 s | de_rats_1337 | 1 | 0 | 1 | ffa-dm.maps.txt |
| gungame | 6.8 s | fy_iceworld2k | 0 | 1 | 0 | gungame.maps.txt |
| scoutz | 6.8 s | scoutzknivez | 0 | 0 | 0 | scoutz.maps.txt |

Every mode joined, and the cvars that make each mode are what its file says. The
Playwright suite, 9 of 9, on the same server ten minutes later. The server is on the
built image; the Docker Hub one is history.

### Identity: an invitation is a link

The evening's work, in Shane's order. The shared identity — every browser as
`VALVE_ID_LAN` with every admin flag — was the residue of the three-player mixup, and
the fix is the one the review sketched: the relay knows who somebody is and gives their
packets an address that says so.

An admin makes an invitation on `/people`: a name, a role, and back comes a link with a
192-bit token in it. Opening it leaves an `HttpOnly` cookie and lands in the lobby with
the name filled in and locked. From then on that browser is that person: to the pages
(the cookie opens the door the family login opened), to `/api/sessions` (a `name`
field, which the room will read), and to the game server, because their session's UDP
socket binds `127.1.hi.lo` from their id instead of the next `127.0.x.y` from the
counter. Reunion's `cid_RevEmu2013` went from 10 (VALVE_ID_LAN) to 3 (STEAM_ by
address), so the server sees a stable id per person. Admins are the relay's doing: on
every change it writes `users.ini` — one line per admin, by address, flags "de" — and
sends `amx_reloadadmins`; `entrypoint.sh` links that file into the container so the
reload sees it. The `VALVE_ID_LAN` line is gone with the file: nobody uninvited is an
admin any more.

Twelve Go tests and two more in the suite: the link leaves the cookie and a bad one is a
404; a player's cookie gets 403 on `/people` and an admin's gets in; the invited player's
session carries the name, the server's `status` shows them at their own address, and a
revoked link stops working. The first admin is made with the family login on `/people`,
which is the last thing that login is for.
