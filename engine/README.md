# engine/ — building the browser engine ourselves

The browser runs Xash3D FWGS and cs16-client compiled to WebAssembly. Until September
2026 those came from npm tarballs yohimik published and then withdrew; this directory
builds the same thing from source so that the engine is ours to change.

    ./build.sh                # both packages, into engine/xash3d-fwgs/dist and engine/cs16-client/dist
    ./build.sh engine         # or one of them
    ./build.sh client
    ./build.sh engine speed   # a variant: base patches plus patches/xash3d-fwgs.speed/
    ./build.sh engine debug   # symbols, assertions, nothing minified — for looking inside

Sources are expected at `$ENGINE_SOURCES` (default `~/darkoak-backups/engine-sources-2026-09-08`),
checked out at the `yohimik-pin` tags with submodules populated — see
`docs/engine/journal.md` for how those were recovered and why they live outside the repo.

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

`xash3d-fwgs/scripts/patch-emscripten-js.mts` differs from yohimik's in one respect: the
heap views come back as getters, because growth detaches captured typed arrays.

Variants (`patches/<package>.<name>/`) apply after the base set and are written against
the base-patched tree. There is one `dist` per package: build the variant, measure it
(`compare.py` for the surface, the fps harness for speed), build the base back.

`compare.py` says whether a build is a drop-in: sizes, the memory section's limits, and
the difference in import and export names. Run it on a fresh `build.sh` output, before
any page build.
