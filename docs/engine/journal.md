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

Shane's questions the same evening, and what they changed: one link is per *person*,
not per browser — open it on every device and each is that person; two devices at once
are one seat and will collide, so each kid gets their own. The kids want to rename
themselves, so the name box is editable again for invited people and `POST /api/me`
renames the person everywhere (the seat stays). And the server password stays — it is
what keeps strangers off the game's own tunnel — but an invited browser gets it from
`/api/me` and the box disappears, since the invitation already opened a bigger door.
Then: changing the game from the lobby is for admins only — the relay's `POST
/api/settings` sits behind the same door as `/people`, and the lobby shows everyone else
the settings disabled, with the legend saying an admin can change them.

### The loading screen says what it is doing

Shane wanted to watch. The screen now has a detail line under the bar and a list of
steps with their times: the engine's parts as they arrive (by plain name and size, read
from the browser's own resource timings — no engine change), then "Downloaded 271 MB"
with the rate as it goes, "Unpacked 4,234 files" with the file passing by, "Cached for
next time", "Game started", "Relay connected". A second visit reads "Loaded 4,234 files
from the cache" instead of the download. The worker and the cache now report counts and
names rather than a fraction; the bench's `load.mjs` reads the same phase line it always
did, and `window.__loadSteps` keeps the list for it.

### A tab that is not in front keeps playing (patch 0004)

The engine's loop rides on `emscripten_set_main_loop`, which is `requestAnimationFrame`,
and a browser stops or slows that for a tab that is not in front. Measured under a real
window (`HEADED=1 xvfb-run -a node bench/hidden.mjs` — headless Chromium reports every
page visible whatever is in front, and the first afternoon's runs measured nothing):
another tab in front takes the page from 60 to **1 frame a second**. At one frame a
second the client still sends a packet a second, so the server's `sv_timeout 180` never
fires — but the netchan crawls, the datagrams from the server halve (47 a second
against 93), and within ten seconds the client reconnects on its own: the server logged
a second `connected` for the same address, then a full minute to "entered the game" at
one frame a second. Coming back meant a lag burst and, sometimes, the lobby.

The fix is two exported functions in `host.c` (`0004-frames-from-the-page-when-hidden`):
`Host_WebLoop(0)` pauses the engine's own scheduling, `Host_WebFrame()` runs one frame,
`Host_WebLoop(1)` hands the loop back. The page (`main.ts`, `tick.worker.ts`) watches
its own animation clock; when no frame has come for 250 ms it takes over, running a
frame per tick of a worker's 50 ms timer — workers are not throttled, and their messages
are delivered to a hidden page — and hands back when the clock is healthy again. Keyed
on the clock rather than on `document.hidden`, because the clock is what actually stops,
and it stops in cases the visibility flag does not name (under xvfb it never changed).

The same four minutes on the canary: the datagrams stayed at 93 a second the whole
time, the server saw one connection start to end, and the tab came back into the game.
The leak watchdog's `memlist` still fires once the datagram count passes its estimate
(it measured 0 bytes and reset, as designed) — 300 lines of console for nothing, now
that the pool does not leak; a candidate for removal.

Promoted to `/play` the same evening (11 of 11 in the suite), and a six-minute run there
— past the five-minute mark at which Chrome moves a hidden tab's timers to once a
minute — read 1,400 datagrams per fifteen seconds start to end, the server saw one
connection, and the tab came back at 57 frames a second. One false lead on the way: the
console line "*name* timed out" during a run is the server announcing *another* player's
drop — the previous test's ghost, or one's own old seat after a reconnect — not this
client's.

### The game in bundles

The one zip became a base and a bundle per map. The packager (`scripts/package-valve.py`)
now sorts every file a map asks for — its `.bsp`, overview, sky, wads, `.res` deps, the
sounds its entities name — by how many of the chosen maps want it: two or more, and it
goes to the base; one, and it goes with that map. The base also drops the stock skies no
chosen map names (384 sky faces in the Steam files, 150 of them used). What came out:

| | before | after |
|---|---|---|
| before a player can move | 271 MB, one zip | **202 MB** base + the current map (0.1 – 18 MB) |
| the maps | inside the zip | 23 bundles, 54 MB together; de_aztec 18 MB, most under 3 MB |
| a new map added to the rotation | the whole zip again | its bundle, cached on its own |
| a new base | the whole zip | the whole base — rare |

Not the hundred megabytes the review guessed. The base *is* the game: the player and
weapon models (33 MB compressed), the sounds (42 MB), the shared texture wads
(`halflife.wad` alone is 36 MB unpacked), the Half-Life music custom maps play (12 MB).
What could still come out — the Half-Life monster models (10 MB compressed), HUD sprites
nothing uses — needs a reference graph from the game's own code rather than from the
maps, and is a museum-era job. The honest win today is a first visit that plays sooner,
and maps that are individually addressable and individually cached, which is what the
museum needs from this.

The client (`main.ts`): read `content/manifest.json`; read whatever the cache holds into
the filesystem and mark the bundles whose sha256 still matches; fetch the base if it is
not there (a stale base clears the cache — it is most of the bytes), then the map the
server is on, from `/api/servers`; then, behind the game, the rest of the rotation, the
maps *after* the current one first, so a rotation change finds its files in place; and a
five-second poll while playing that fetches a map at once if the server changed to one
the prefetch had not reached. Files written into MEMFS after the engine started are seen
by it, which was the question the whole design hung on: a test changes the live server's
map under a joined player and the client loads the new map from files it fetched behind
the game, with nothing missing in its console. The relay serves `/content/…` from the
content directory; `/valve.zip` stays for the 2025 client.

Measured (`bench/load.mjs`, cache cleared, on this machine where the download is not the
cost): first visit **5.9 s** to in the game against 7.0 before, the map arriving as its
own step after the base; second visit 3.5 s against 3.9. The suite is 12 of 12, the
twelfth being the map change under a joined player.

### Rates on both sides, and telemetry to say what helped

Shane asked where the update rate is set — both sides — and for toggles and numbers for
tonight. Checking the server first found the thing the 6 September experiment had run
into without knowing: `sv_maxrate 25000`, the stock cap on bytes a second per client,
which chokes a client asking for a hundred updates a second — so 20 updates read *better*
than 100 because 100 was being throttled. It is 100,000 now, and the client's default
`rate` 20,000 has a 100,000 option beside it.

The client got four selects (updates, commands, interpolation, bandwidth) in the lobby
and in the pause card, applied at once and remembered; and a ten-second report to the
relay of what it is set to, its frame rate and whether the tab is in front. The relay
(`telemetry.go`) samples every ten seconds: the game ping and loss from the server's
`status`, the ICE round trip, packet rates per session, the server's own rate cvars once
a minute, joined to the client's report by the player's name, one JSON line each to
`logs/telemetry.jsonl`. `/telemetry` shows the samples and a table by settings with the
median game ping per combination. That table is the answer to "what helps", per person
and per machine, rather than an afternoon's impression.

### A second of delay on every sound — not yet understood

Shane, playing tonight: every sound arrives about a second late. New since the last
session, which makes the suspects everything shipped since: the built engine and its
patches, the worker keepalive, the bundles, the rates. Nothing measurable here shows
it — the audio glue (OpenAL's 25 ms queue, 0.1 s lookahead) is the same in both engines,
and the telemetry never saw the keepalive engage in any recorded play, all of it
headless. The one concrete suspect is the keepalive's stall detector on a slow machine:
loading a sound for the first time can hold a frame long enough to trip a 250 ms
threshold, and the pause-and-resume around it would land right after a sound. So the
detector is conservative now (900 ms unless the tab says it is hidden, ten healthy
frames before handing back), its takeovers are counted into the telemetry, and
`?keepalive=0` turns it off entirely. `/next` carries yohimik's engine with the same
client, so the evening can bisect by ear: `/play`, `/play/?keepalive=0`, `/next`.

**Resolved the same night.** With the conservative detector the delay was gone on
`/play`, and `?keepalive=0` made no further difference — so the delay *was* the stall
detector at 250 ms, tripping on his machine's first load of each sound and pausing and
resuming the engine's loop around it: the pause-and-resume was the second. A stall
detector on the main thread must not fire on the main thread's own hitches; 900 ms and
ten healthy frames before handing back is where it sits now, and the telemetry counts
its takeovers so a machine that still trips it will say so. The `/next` A/B (yohimik's
engine, the same page) would not play for Shane and only reached the menu: headless it
joined in 5.7 s, and the difference is almost certainly the heap — that build skipped the
1536 MB heap patch the vendored engine needs, and his screen at "sharp" wants more than
256 MB. Not pursued; `/next` is the canary on our engine again.

**The quarter second that remains** is the audio pipeline itself: the engine mixes
sound `_snd_mixahead` = 0.12 s ahead (a Xash default meant for machines that stall), the
SDL2 emscripten backend asks for 1,024 frames (23 ms at 44.1 kHz) and the browser's
output adds about 30 ms — 170 to 200 ms between the shot and the sound, on the fastest
machine. The lead is a live cvar, so it is a fifth select beside the network ones
("Sound lead": 0.12 / 0.08 / 0.05 / 0.03), in the presets, and in the telemetry. 0.05
takes 70 ms off on a machine that holds its frame rate; the cost of too little is
crackle, which the ear reports at once.

**Read back, not assumed.** Shane could not tell whether a setting had taken, and asked
for "interp changed from 0.1 to 0.01" as the engine has it rather than as the page
asked. `applyNetwork` now reads each cvar before and after (`getCVar`, 400 ms) and
writes "updates 100 → 30 · interp 0.01 → 0.033" under the selects, or "did not take
(engine has …)". The first read-back found two things at once: the engine caps
`cl_cmdrate` at 100 (the old config's 105 was being rounded down all along — the option
says 100 now), and "auto" interpolation reads back as the value the engine chose, one
update's worth. On the other side, the telemetry sampler asks the server `user "<name>"`
for each player and records `cl_updaterate` and `rate` as the server has them — the
proof from the side that would be choking if a setting had not taken.

## Day 5 — 10 September 2026: the dependencies

**The small ones, in an hour.** The relay to Go 1.26 (pion's current transport asks for
it) and pion/webrtc 4.2.20 from 4.1.3; the client to Vite 8 (rolldown: a build in 280 ms
against 1.5 s), TypeScript 7, jszip 3.10.2, Playwright 1.63. The suite passed on all of
it, with one thing learned about the suite: while a Docker build runs on this machine,
the relay's discovery can miss a server's answer, `/api/servers` briefly says the primary
is not running, and the suite's `beforeEach` skips the rest — five "skipped" that were
not the code. Rerun quiet, all pass. Worth making discovery tolerant of one missed reply.

**Emscripten 4.0.23 → 6.0.9, the engine.** Two majors. The Dockerfiles take the emsdk
as a build argument now (`EMSDK=… ./build.sh engine`), and the first build stopped
exactly where it should: the glue patch found nothing to match, because 6.x's MODULARIZE
is a different shape — an async factory that `await`s `createWasm()` and `run()` and
returns `Module` itself, with no `moduleRtn` and no ready promise. The patch script now
detects the shape and does the right thing for each; the 4.x path is unchanged. The
engine came out **5 % smaller** (3.72 MB against 3.92), with a different set of syscall
imports (epoll, poll, pipe2 — libc moved on) and a thousand fewer libc++ exports; the
side modules are the same size to within a hundred bytes. `/next` on it: 13 of 13 in the
suite. Promoted to `/play` the same afternoon; 4.0.23 stays one argument away.

**build.sh had a lie in it.** A failed `docker build` left the previous build's image
tag standing, the script saw a tag and copied its artefacts out, and a client "built from
newer source" came out byte-identical to the pin with a fresh timestamp. Found by asking
for a string the new source has (`cl_killsound`) and not finding it. The tag is removed
before every build now, so a failure is a failure.

**The client from ololoken's main — in progress.** 66 commits past the pin (the pin's
own seven are four of ololoken's rebased plus yohimik's `-Oz`, version-check skip and
submodule bump, the first two now `patches/cs16-client/`). Three obstacles so far, each
about submodules rather than code: the recorded `mainui_cpp` commit no longer exists on
any branch of ololoken's fork (force-pushed away; `emscripten-xash`, updated two days
ago, is the live one); `git ls-files --recurse-submodules` silently omits a submodule
checked out at a commit other than the recorded one, so the build context lacked it
(the context is a plain tar of the working tree now); and the current `mainui_cpp`
asks pkg-config for freetype2 unless told to use stbtt.

**The leak watchdog is gone.** Seventy-seven lines of `main.ts` that estimated the
network pool from the datagram count, asked the engine for `memlist` every forty-five
seconds once the estimate passed 600 MB, and reconnected the player if the pool was
really full. The pool has read 0 bytes since 9 September; the watchdog had become three
hundred lines of console every few minutes for nothing. Removed, with the two calls that
started and stopped it.

**The cleanup, from the review's list.** `archive/2025/` now holds the 2025 diary, the
2025 client whole, the one-zip packaging scripts and the notes for the three old servers,
with a README saying what each was; `/legacy` and `/valve.zip` are no longer served, and
the relay's test knows. `web-server/go-webrtc-server/` is `relay/` (module `cs16/relay`,
the unit file follows). The client's `userconfig.cfg` lives in `content/` beside what it
goes into. In `cs-server/shared/`, the 111 top-level wads were 103 duplicates of `wads/`
and 8 that only existed at the top — one copy of each now, in `wads/`, which is where the
entrypoint links from and the packager looks first; `cl_dlls`, `dlls`, `hw` and `logos`,
client-side or empty, are gone from the server's content. The Caddyfile from Plan A is
deleted. What stays that the review questioned: `resource/`, `gfx/`, `media/`, `events/`,
because maps' `.res` files and skies can name them.

**A rename with a trap in it.** `relay/` is one directory shallower than
`web-server/go-webrtc-server/` was, and every default path in `config.go` was relative
to the working directory: `../../web/dist`, `../../.relay-people.json`,
`../../cs-server/…`. The restarted relay served nothing, wrote an admin list into a new
`~/Desktop/cs-server/`, and the suite failed top to bottom for a quarter of an hour
before the reason was read. One level off, nine paths. Fixed to `../…`, the stray
directory removed; the real people file and admin list were never touched, because the
wrong paths pointed at nothing. A relay that resolves its defaults against the binary's
own location rather than the working directory would not have this class of mistake.

**The client from ololoken's main builds** (`engine-sources-next/`: the engine pin by
link, the client as a git worktree at `ololoken/main` with the pin's `mainui_cpp`
copied in — the menu's recorded commit is gone from every branch of the fork, and
ololoken's live `emscripten-xash` branch does not carry the Emscripten CMake block the
pin's does; yapb's own `crlib` submodule needed initialising). The client module is 1 %
larger and imports the new code's symbols (`cl_killsound`, `HudSayText`, the voice
location); the server module is 48 % larger (1.96 MB against 1.32 — ololoken's
ReGameDLL submodule has moved on); the menu is byte-identical, as it should be. It
boots and joins on `/next`; the suite there decides whether it is promoted.

13 of 13 on `/next`, then 13 of 13 again on `/play` after the promotion: the client is
built from ololoken's main of 25 March 2026 now, sixty-six commits past the pin, on the
Emscripten 6 engine. `engine-sources-next/` is the default source for `build.sh`; the
pin stays one variable away. That closes the dependency updates: relay, page, engine
toolchain and client are all current, and the engine's own source stays at the pin by
choice until there is a reason to take on the rebase.

### Bots on the page, and a relay that forgives a map change

The game settings offer the bot count and skill; `bot_quota_mode fill` in `server.cfg`
makes the count mean "players on the server", so bots leave as people arrive, and the
two cvars persist in the mode file like the rest. Two things came out of the test that
asks for bots and waits for one:

- **The server was "gone" during every map change.** Discovery queries every three
  seconds and marked a server offline on the first unanswered query; a map change holds
  the server for five to fifteen seconds; a join in that window got "no server is
  answering" from `/ws/27015`, which the page reports as "the relay did not answer" —
  Shane's `/next` symptom of last night, which was never `/next` at all. A server is
  offline now only after 25 seconds of silence, and a settings change no longer
  `changelevel`s to the map already running.
- **Bots wait for a person on a team**, not merely connected (`bot_join_after_player`).
  The test joins a team before it expects one.

`bench/navs.mjs` walks the rotation with bots on so each map's mesh is built once and
kept in `cs-server/navs/`, which is in git; the server would otherwise build it the
first time a bot plays the map, holding everyone for those seconds.

**Building the meshes found a map that kills the server.** The first two passes of
`navs.mjs` joined a browser and raised the quota — and learned that bots added by
quota never build a mesh; only `bot_add` does, and it needs no person at all. The third
pass, `changelevel` + `bot_add` + wait, built eight and found the rest already there
(the content ships meshes for some, under links the host cannot follow, and the game's
filesystem is case-insensitive: `cs_1337_assault` plays with `cs_1337_ASSAULT.nav`).
One map refused: **de_dust2_xmas asks for `models/xmasblock/snow_tree.mdl`, which is
nowhere — not in the content, not in the Steam files — and ReGameDLL's answer to a
missing model is `FATAL ERROR (shutting down)`.** The server died and came back on
the default map. It has been in three rotations since the map list was set, waiting for
its turn. Out of all five rotations now; the bundles are rebuilt without it. Twenty-two
maps, twenty-two meshes, in git.

### What a map needs, as a record

`scripts/mapdeps.py` reads a map's worldspawn (wads, sky), its entity lump (every model,
sprite and sound), and its `.res`, and says where each file is: the server's content, the
Steam files, or nowhere. `--catalogue` does it for every map on the server into
`content/catalogue.json`, and `/maps` shows it with the missing in red. The numbers:
255 maps on the server, 101 with something missing, **15 that would shut the server
down** for a model that does not exist — the Christmas map among them, wanting four
models from an "xmasblock" pack and a wind sound. Of the twenty-two in the rotation, seven
name something absent, all of it harmless in play: wads whose textures are embedded,
two skies that draw black (awp_rooftops, fy_simpsons), one sound. This is the first
record the museum will need of what an artifact is, and it was one afternoon's script.
The bots got a "carry" setting the same hour — anything, pistols, knives — which is the
`bot_allow_*` cvars in the mode file.

### Do the bots play every mode, and with what?

Measured (`bench/bots.mjs`: each mode with bots filling to four, one person on a team,
ninety seconds, then the server log's kill lines, which name the weapon):

| mode, map | bots' kills in 90 s | with |
|---|---|---|
| team-dm, de_dust2 | 6 | galil, famas, ak47, mp5navy (CSDM's own bot lists) |
| ffa-dm, de_dust2 | 9 | the same, plus scout |
| gungame, fy_iceworld2k | bots at levels 2–4 | the ladder's weapons |
| classic, de_dust2 | 6 | bought |
| team-dm and ffa-dm, **de_rats_1337** | **0** | — the mesh is there, the bots do not get about on a map that is furniture at giant scale |
| ffa-dm, de_dust2, *pistols only* | 4 | deagle, fiveseven, usp — CSDM still hands them a primary, and they leave it holstered |
| classic, de_dust2, *pistols only* | 9 | deagle, fiveseven, usp, elite |

So bots work in every mode, "pistols only" holds in deathmatch as well as classic, and
Gun Game ignores the choice by rule (the ladder decides; a bot forbidden its own level's
weapon would stand there with a knife) — on the server and on the page, which hides the
choice there. The rats maps are the exception: the bots have a mesh and do nothing with
it. A bot-friendly rotation is the ordinary maps.

## Day 6 — 11 September 2026: the collection, and demos

The museum is part of the cs16 room in darkoak (`docs/cs16-collection.md` there): artifact
records with the rotation's dependency scan as the seed, an import that never overwrites
a person's words, annotation as the one write, and reads as registry rows. It was a room
of its own for a day; Shane wants the game and its museum to be one room, so the three
tables moved into `cs16.db` and the five tools and the collection page under `Cs16/`.

Playing GoldSrc demos in the browser is researched in `docs/proposals/demo-playback.md`.
The finding that settles it: our engine already records and plays demos of GoldSrc-
protocol sessions — `bench/demo.mjs` records eight seconds against our ReHLDS from the
browser, reads the file back out of the engine's filesystem (`IDEM`, net protocol 176 =
48 | BIT(7)) and plays it, de_dust2 drawn from the recorded view with the HUD and nothing
on the wire. A `HLDEMO` network frame is the same 7 netchan ints and the same stripped
message as an Xash `dem_read` frame, behind 460 bytes of client state. The client-side
frames (events, weapon animations, sounds, usercmds) are what a standalone converter
cannot place — Xash demos have no slot for them and encode usercmds in the engine's own
delta format — and what a reader *inside* `cl_demo.c` hands to existing engine calls. So:
patch 0005, a third demo reader beside the Quake one; hlviewer as the parse-and-preview
exhibit; protocol 46/47 the risk to check against the drive.

### Day 6, later: the engine plays GoldSrc demos

Shane: his demos are protocol 46 and 47, and recovering them is the museum's work, so
the translation is ours to do. The reference turned out to exist — compLexity Demo
Player (GPL-3, 2008–2014) rewrote 43–47 demos for the protocol-48 client for a decade,
and its converter is the complete list of differences: for 47, the version number and
nothing else; for 46, five-bit weapon indices in `svc_clientdata` and a `svc_voiceinit`
without its quality byte; for either, 21 bytes after a set VAC flag in
`svc_serverinfo`. The rest is game-level, for CS 1.0–1.5 demos on the 1.6 client
(sequence numbers, `_r.mdl` names, a sprite blacklist, `SendAudio`'s pitch) and waits
for a 46 file. Test material from the Internet Archive: 21 Half-Life speedrun demos of
2004 (47), 61 Kreedz records (48), a 162 MB HLTV match on de_dust2 (48). No 46 yet.

Patch `0005-goldsrc-demos`: `playdemo` opens a HLDEMO file. Its network frames go down
the `dem_read` path (the same seven sequence numbers and the same message, behind 436
bytes of client state of which the usercmd and view angles are kept); its client-side
frames go to `CL_QueueEvent`, `CL_WeaponAnim`, `S_StartSound` and `Demo_ReadBuffer`;
`CL_DemoGoldSrcProtocol` tells the parser which of the three wire differences to apply.
`bench/hldemo.mjs <demo> [map]` fetches a demo and its map from the relay into the
engine's filesystem and plays it. The Kreedz record plays in first person with the HUD,
viewmodels, the plugin's chat and the clock; the HLTV match plays with its chase camera
and the players' models. The 2004 Half-Life demo runs through its
loading section with protocol 47 and stops at a map we do not have — after an afternoon
on two single-player traps: `CL_ClearState` shuts the console and only multiplayer
reopens it (the recording's errors went nowhere), and the single-player map checksum is
a constant that can never match a demo's (it disconnected, behind that closed console).
A recording now keeps its console, and a checksum mismatch is a warning.
The `dem` crate (khanghugo, Rust, parser and writer) parses the 47 file completely and
shows its message stream identical in shape to the 48 files'; a small dumper on it in
the scratchpad was how the two were compared.

A demo needs its map as a file the engine can load, and the resources its server had:
the resource list inside a demo is exactly the dependency list the collection keeps for
maps. The `/demos` page's next job is a way in from the play page and that red-for-
missing list per demo.

### Day 6, evening: the demos page

Shane: a demos page to upload and play from, with real controls — pause, a draggable
scrubber, speed, perspectives — and everything a recording carries, shown. Done as three
pieces. Patch 0006 gives the engine a transport for a GoldSrc demo: `demo_pause`,
`demo_speed` (scaling `host.frametime` while one plays, the simplest way to make the
game's clock, the animations and the recording agree), `demo_seek` (forward without
waiting, four hundred frames a host frame; backward by restarting with the target carried
across), and `Demo_WebState()` for the page. The relay reads recordings itself
(`demoinfo.go`): the loading section's messages, including a port of the delta-description
decoding, up to the resource list — so each demo's dependencies get the collection's
red-for-missing treatment — and a scan of the playback frames for the recorder's commands
and sounds. The play page grew a second mode at `/demos/<name>`: no lobby, no server, the
map from the bundles or the server's files, the bar under the picture. One trap: the
engine takes the mouse the moment it moves over the picture, which in a game is right and
on a page with a bar is not — Playwright reported the canvas intercepting every click on
the pause button; the page now hands the mouse over only after a click on the picture.
Measured on the HLTV match: bar at 5 s, seek to 14:27 in a second, back in half.

## Day 7 — 12 September 2026: the tour

Shane wants the review's visual twin: less prose, more diagrams, tables and little
client-side demos, a tour of the museum, the client, how it works and how the game
works — top down, and with the contributors credited. Built as a second Vite entry at
`/tour`: ten chapters as data, widgets mounted as they scroll into view, the visuals made
by the bench. The widgets worth the name: a netcode simulator that shows why the update
rate is the lever; a recording inspector that parses a dropped `.dem` in the browser and
draws the path the recorder walked; a model inspector that reads a `.mdl` header and
paints its textures from their 8-bit palettes; the catalogue with a fly-through in
hlviewer.js; the engine's parts measured live; the protocol byte layouts. The clip in
chapter one is the demo page's canvas recorded by `MediaRecorder` for thirty seconds,
because Playwright's own recording starts at page load and there is no ffmpeg here to
trim it. The plan is `docs/proposals/interactive-tour.md`.

### Day 7, later: extras, and the roadmap in the tour

The tour's extras chapter becomes the deep-dive chapter. The demo reader moves into
`web/tour/dem.ts` — the Go parser's walk, ported, including the bit reader and the delta
decoding — so a dropped recording now yields the server's greeting and its delta
descriptions in the browser. On those tables sits the delta-compression stop, which is
the best thing on the tour: the real field list a Counter-Strike server sent, with the
arithmetic of what delta encoding saves. Beside it, a BSP reader that draws a map's floor
plan from its vertex lump and places bomb sites and buy zones from the models lump (brush
entities have no origin, which is why the first pass showed only spawns); a live usercmd;
the stock sounds; and the roadmap Shane asked for, kept in the page rather than in a
document. The bench's screenshot pass now walks the page three times, because each widget
mounts when scrolled near and mounting makes the page taller.

## Day 8 — 12 September 2026: more ways to play

Shane asked which other ways Counter-Strike was played, whether we could stand them up,
what the early-2000s announcer sounds were, and whether 1.5 could be retrofitted onto our
1.6 engine. The research is `docs/proposals/variations.md`. Four modes built from parts
already here — `match` (league rules), `aim`, `awp`, `climb` — the first three needing no
new content at all, and `aim` proving that ReGameDLL's default-weapon cvars replace what
used to take a plugin. The packager then rebuilt bundles for twenty-five new maps; the
base went from 202 to 221 MB and changed hash, which costs every browser one re-download.

Two faults found by trying. A map added to `cs-server/shared` while the container runs is
invisible: the entrypoint links maps at start. And restarting to pick it up put the
container in a loop — the entrypoint copies the mode addons over the image's, and
`users.ini` is by then a symlink to the relay's copy that the next line makes, so `cp`
refused ("same file") and `set -e` did the rest. Latent since invitations shipped on the
9th; nobody had restarted the container since. One `rm -f` before the copy, and a second
restart now comes up clean.

The sounds question has a good answer waiting: the 2007 Kreedz recording on the demos page
asks for five files we do not have — `misc/impressive.wav`, `misc/perfect.wav`,
`misc/mod_godlike.wav`, `misc/holyshit.wav`, `misc/mod_wickedsick.wav` — which is an
Advanced Quake Sounds pack named exactly as that plugin names it. A recording in the
museum is missing its own soundtrack. Restoring it needs a plugin we can compile (the
image carries `amxxpc`) and a way for a mode to carry its own files to the browser, which
is the next piece of machinery.

### Day 8, later: four more modes, our first plugin, and the tour chapter

Shane chose zombie escape, hide and seek, jailbreak and 35hp, and asked what the modes he
did not recognise actually were — and what made each fun. Three of the four need a
mechanic cvars cannot express, so the first plugin of our own: `museum.sma`, compiled by
the `amxxpc` in the image, six cvars, everything off unless a mode turns it on — health
and armour on spawn, stripping by team, a knife back, a speed, and infection on death.
2 KB, loads as plugin 18, and 35hp puts 35 on the HUD with a Deagle in hand.

Zombie Escape is the honest miss: the mode is its maps — a long route, chokepoints, a door
and a timer — and we have no `ze_` maps. What we have is the infection.

The tour gained chapter 4, "The ways people played": twenty-two kinds of server with what
each did, why it was fun, and what it needs from us, reading the live mode list so "on this
server" is a fact rather than a claim. Twelve of the twenty-two run here today. That
chapter is the one that answers what a museum of this game is actually for — the bomb is
not what people remember, the server they played on every night is.

### Day 8, later still: what arms you

Shane asked which maps provide weapons, and the map files answer it. 138 of 256 do, by one
of two entities: `armoury_entity` leaves guns on the floor (119 maps — aim_ak-colt places
eighteen AKs and eighteen M4s), `game_player_equip` puts them in your hands at the spawn
(29 maps — scoutzknivez, awp_india, cs_deagle5). The other 118 expect the buy menu.
`scripts/mapdeps.py` now decodes ReGameDLL's armoury item numbers, so the catalogue
carries it and the tour's map table shows what each map gives, with filters for maps that
arm you and maps built for scavenging.

Out of that, the mode Shane described: `scavenge` — both teams stripped to a knife, no
money, no buy time, `mp_weapons_allow_map_placed` on, and a rotation chosen by rule from
the catalogue (five or more kinds of gun on the floor; sixteen maps, mostly fy_). The
`game_player_equip` maps are deliberately not in it, because stripping on spawn would
remove exactly what they hand over — which is the general rule worth remembering: a mode
and a map have to agree about who arms the player.

The bundles were rebuilt twice today and the base went 202 → 221 → 228 MB, each time with
a new hash and so a re-download. Map additions want batching.

## Day 9 — 13 September 2026: the drive in the collection, and the shouts

Shane's drive went in as records: `scripts/museum-scan.py` reads every map in
`organized/` (4,936), every model in the pool (4,803) and the uG recordings (48), resolves
each dependency to drive, server, base or missing, and gives each thing a family and the
scanner's tags. darkoak holds it as a second store beside the server's, and the curator's
desk is where a person goes through it: filter, open, see what a map needs, fly through
it (the relay serves the drive read-only at `/drive`, and `/fly?path=` is hlviewer.js over
either store), then say a status, a rating, a note, tags. The one server touch:
de_dust2_xmas made whole — four models from the pool, the fifth from inside a download
archive — plus two skies that had been drawing black.

Three plugins from the drive, enabled. The announcer is our own file with the rules the
old plugins settled on and the wavs everyone passed around (Unreal Tournament's voice; the
name "Quake sounds" stuck anyway). Two things bit. One file had an 18-byte `fmt` chunk
and a `fact` chunk and the engine would not load it; all 39 are plain 16-bit PCM now.
And the classic `client_cmd(id, "spk …")` does nothing in the browser: `spk` builds a
sentence, and the engine builds one from a typed command but not from a stuffed one
(same line typed: loaded; same line stuffed: nothing — `cl_trace_stufftext` shows it
arriving, `soundlist` shows it never loading, `cl_filterstuffcmd 0` changes nothing).
`play` takes the file by name from either path, so that is what the plugin says. Worth
remembering for GunGame's level sounds, which also `spk`. The sounds ride in a bundle of
their own, `extras.zip`, after the base — 2.7 MB, and the base's hash unchanged.

Death beams (BMJ's dib3, "only the dead see") needed only the plain `DeathMsg` in place
of the stats module's `CS_DeathMsg`. Shane's admin ESP — KoST's, cut down to a green box
and nothing else — draws only for an admin on the spectator team now; it used to draw for
any dead admin, which on a public server is a dead player narrating.

The 2011 league config as an experiment in the network help: Shane's own CAL/ESEA
userconfig, minus keys and sensitivity, applied to the running engine and read back. Of
37 settings: 15 took, 12 were already so, `cl_cmdrate 102` came back 100, and nine the
engine does not have (`gl_picmip`, `gl_ztrick`, `gl_dither`, `gl_wateramp`,
`gl_texturemode` — for which `gl_texture_nearest` is the engine's word — `m_filter` and
three vsync/aniso names). Frame rate under SwiftShader 20 → 19, which is noise; the
browser caps at the display rate whatever `fps_max` says, so the config's one real lever
on a modern machine is the network half, and that was already set.

### Day 9, later: the lab

Shane's question — what would it take for a drive map to get "load it now" and play in
the browser — has a second server as its answer, and it took an afternoon. `cs16-lab`
is the same image on 27016 with a small config of its own (no modes, no bots, the
museum's plugins), and the drive's merged install mounted read-only *under* the shared
content: the entrypoint links the drive's tree first and the content's over it, so every
one of the 5,044 maps loads by name and nothing is copied. Three drive maps
changelevel'd on it first go. The browser's side is a bundle per map, made the first
time the desk asks for it (`scripts/package-lab.py`, 1–2 s, resolved the way the
catalogue is) and listed in `lab-manifest.json`, which the client merges after the main
one. The base never changes for a lab map. Press to playing: 1.6 s plus the map load.

Two things fell out. The desk's numbers were wrong about wads: a map that embeds every
texture needs none of the wads its worldspawn names, and most do — reading the texture
lump moved the drive's whole maps from 2,262 to 3,551, and turned zm_dust2's bundle from
47 MB of a mapper's editor list into 1.6 MB. And the room's server table still listed the
three 2025 servers retired on 9 September; it is main and lab now.

## Day 10 — 14 September 2026: files the game's way, and the eye

Shane called the bundles hacky, and they were: a scaffold for a client that could not do
what every game client since 1998 does, ask the server what it needs and fetch the rest.
The web build's HTTP downloader spoke over raw sockets and failed silently. Patch 0008
is a web downloader with the same seven entry points and the same completion path, but
the transfer is the page's: `Module.http.fetch/poll/take`, the browser's `fetch`, a
same-origin URL directly and any other through the relay's `/fetch` proxy; the file goes
into the engine's `downloaded/` and into the browser's cache. Both servers say
`sv_downloadurl https://cs16.darkoak.xyz/raw/`, and `/raw/` falls back to the drive's
merged install, so a lab map needs no bundle at all: deathrun_bkm, never bundled, came
down in one join and was in the cache for the next. The per-map zips are now a prefetch,
not a requirement.

The all-seeing eye, the 2003 server browser, as a page: the GoldSrc master no longer
resolves, so GameTracker's public US list gives the candidates and every one is asked
directly. Twenty-four answered, ~150 people; ClassicCS.com's Old School #1 took the
museum's client — 26 people on cs_assault, a kill feed, 74 ms — and three deathmatch
servers said "STEAM validation rejected". An outside session's socket had to bind to a
real interface; the loopback trick that keeps the house's players apart cannot leave the
machine.

Two things to chase: with HTTP failing the client fell back to the in-band `dlfile`, and
the fragment reassembly trashed a heap block (`Mem_FreeBlock` at net_chan.c:1141) —
the in-band path, patch 0002's territory, has a bug the browser build can hit; and the
demos' early-frames glitches, still owed.

### Day 10, later: what is owed, looked at

The in-band file transfer (a server with no `sv_downloadurl`, or one whose URL fails)
reproduces every time on the lab: turn the URL off, join on an unbundled drive map, and
after "processing downloaded/maps/…" the engine dies in `Mem_FreeBlock` at
`Netchan_FlushIncoming` (net_chan.c:1141) — "trashed header sentinel 1, alloc at
<corrupted>". The bit writers are overflow-checked, so it is not a fragment buffer
overrun; it reads like a stale pointer freed twice, in the territory of patches 0002 (the
replace-in-place of a too-small fragment buffer) and 0003c (dropping a failed transfer's
fragments, which also drops any other transfer in flight on that stream). Not found by
reading; an address-sanitizer build is the next tool. It does not bite while HTTP works,
which it now does for our servers and for any public server with a fast-download site.

The demos' early frames: traced ug2014-assaultfodder from the demos page with every
message named. The loading section carries the server's greeting, the resource list,
twenty-nine WeaponList registrations and the lightstyles — and no ScoreInfo, TeamInfo,
InitHUD or ResetHUD at all; the first TeamInfo arrives in playback a few seconds in, for
one player, when something changes. These recordings were started mid-game, and the
old client's `record` wrote the connection's saved signon and asked for no fresh state;
so a scoreboard that fills in one player at a time is what the file holds, for us and
for the native client alike. Anything *wrong* rather than missing — a team shown
switched — needs a recording and a time to look at.

## Day 11 — 15 September 2026: the museum fills out

Models on the museum's pages: a model's record draws the model turning — the studio
file parsed in the browser, bones in their rest pose, the body parts' triangles, the
textures' average colours, flat-shaded — and **Wear it**: a skin over one of the nine
stock classes, a viewmodel over the stock one of its name. The choice is the browser's;
the play page fetches the files fresh at every boot and writes them over the stock ones
in the engine's filesystem before the game starts. Your own screen only, as it always
was. Tested: a drive GIGN skin chosen in the museum was the bytes at
`models/player/gign/gign.mdl` in the engine on the next join.

The desk's last jobs moved into the museum — a curator's imports and the journal — and
the desk says so and stays as the room's own view of the ledger. A map's record draws the
map from above (edges, spawns, sites, hostages). The wallhack, for recordings only
(patch 0009). The first try — the depth test off in the engine's own player routine —
drew nothing, because the Counter-Strike client has a studio renderer of its own and
calls back into the engine only to emit a body part's triangles: `R_StudioDrawPoints`
is the one place every path passes. The second try lives there: after the normal draw, a
player is drawn again with the depth test reversed, no texture, one orange, nudged
towards the eye so its own first draw does not speckle it — the "chams" of 2004, which
is the wrapper's trick made visible. Gated on `PARM_PLAYING_DEMO`, not on the cvar.
Checked by counting orange pixels in screenshots of `hltv_2022_dust2` at seven times,
chase camera: three figures behind the low wall at mid, the visible player untouched. The `.res` lines that were URLs are files again (cs_1337_assault whole). The
scrubber holds its destination through a backward seek, and Firefox commits on release.
Recordings list the players they name and carry their real 2014 dates from the archive.
The picture has a half setting. Bots fill classic to six, pistols, normal.

Provenance, the full run: every download archive on the drive against GameBanana, one
request a second, and the md5-proven ones written onto the records as "gamebanana" —
author, year, page, licence — with `scripts/provenance-apply.py`.
