# engine/ — building the browser engine ourselves

The browser runs Xash3D FWGS and cs16-client compiled to WebAssembly. Until September
2026 those came from npm tarballs yohimik published and then withdrew; this directory
builds the same thing from source so that the engine is ours to change. Since 9 September
2026 the build here is what `/play` serves (`web` builds against it by default); the
tarballs stay in `web/vendor/` as the archived reference, reachable with
`npm run build:vendored` for an A/B.

    ./build.sh                # both packages, into engine/xash3d-fwgs/dist and engine/cs16-client/dist
    ./build.sh engine         # or one of them
    ./build.sh client
    ./build.sh engine speed   # a variant: base patches plus patches/xash3d-fwgs.speed/
    ./build.sh engine debug   # symbols, assertions, nothing minified — for looking inside
    EMSDK=6.0.9 ./build.sh engine        # a different Emscripten than the pinned one
    ENGINE_SOURCES=~/darkoak-backups/engine-sources-next ./build.sh client   # newer source

Sources are expected at `$ENGINE_SOURCES` (default `~/darkoak-backups/engine-sources-2026-09-08`),
checked out at the `yohimik-pin` tags with submodules populated — see
`docs/engine/journal.md` for how those were recovered and why they live outside the repo.
`~/darkoak-backups/engine-sources-next/` is the same layout for newer source: the engine
pin by link, and the client as a git worktree at ololoken's `main` with the pin's
`mainui_cpp` copied in (its recorded menu commit no longer exists upstream, and the live
branch lacks the Emscripten build block). `ENGINE_SOURCES=~/darkoak-backups/engine-sources-next
./build.sh client` builds the client from it.

The recipes in `xash3d-fwgs/` and `cs16-client/` are yohimik's, copied from the monorepo
mirror; `Dockerfile.build` in each is ours and differs only in taking the source tree as
the Docker context instead of expecting it as a submodule.

## What is ours

`patches/<package>/` are unified diffs against the pin, applied in order inside the
container before configuring; the archived source is never edited. Today:

| patch | what |
|---|---|
| `0001-memory-growth` | `ALLOW_MEMORY_GROWTH`, 2 GB maximum, in place of a fixed 256 MB heap |
| `0002-fragment-buffers-sized-to-fragments` | an incoming fragment buffer is the size of its fragment, not 64 KB |
| `0003a/b/c` | `Netchan_DropIncoming`, and the client frees a failed transfer's fragments at once |
| `0004-frames-from-the-page-when-hidden` | `Host_WebLoop(0/1)` pauses/resumes the engine's own scheduling and `Host_WebFrame()` runs one frame, so the page can drive frames from a worker's timer while its tab is hidden |

`patches/cs16-client/` holds the two changes yohimik made to the client on top of its
source (`-Oz` for the side modules, and skipping the engine version check on the web),
so the client can be built from ololoken's current main rather than the pin.

`xash3d-fwgs/scripts/patch-emscripten-js.mts` differs from yohimik's in one respect: the
heap views come back as getters, because growth detaches captured typed arrays.

Variants (`patches/<package>.<name>/`) apply after the base set and are written against
the base-patched tree. There is one `dist` per package: build the variant, measure it
(`compare.py` for the surface, `web/bench/` for speed, loading, memory and lag — see the
README there), build the base back.

`compare.py` says whether a build is a drop-in: sizes, the memory section's limits, and
the difference in import and export names. Run it on a fresh `build.sh` output, before
any page build.
