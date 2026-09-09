# engine/ — building the browser engine ourselves

The browser runs Xash3D FWGS and cs16-client compiled to WebAssembly. Until September
2026 those came from npm tarballs yohimik published and then withdrew; this directory
builds the same thing from source so that the engine is ours to change.

    ./build.sh            # both packages, into engine/xash3d-fwgs/dist and engine/cs16-client/dist
    ./build.sh engine     # or one of them
    ./build.sh client

Sources are expected at `$ENGINE_SOURCES` (default `~/darkoak-backups/engine-sources-2026-09-08`),
checked out at the `yohimik-pin` tags with submodules populated — see
`docs/engine/journal.md` for how those were recovered and why they live outside the repo.

The recipes in `xash3d-fwgs/` and `cs16-client/` are yohimik's, copied from the monorepo
mirror; `Dockerfile.build` in each is ours and differs only in taking the source tree as
the Docker context instead of expecting it as a submodule.
