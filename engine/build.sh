#!/usr/bin/env bash
# Build the browser engine and the game from source, in Docker, the way the withdrawn npm
# packages were built. See docs/engine/journal.md for where the sources come from.
#
#   ./build.sh                  both
#   ./build.sh engine           xash3d-fwgs  → engine/xash3d-fwgs/dist  (an npm-package-shaped tree)
#   ./build.sh client           cs16-client  → engine/cs16-client/dist
#   ./build.sh engine speed     as above, plus patches/xash3d-fwgs.speed/ on top of the base patches
#   ./build.sh engine debug     … plus patches/xash3d-fwgs.debug/ — symbols, assertions, no minifying
#   EMSDK=6.0.9 ./build.sh engine   a different Emscripten (the Dockerfiles default to the pins)
#
# A variant's patches apply after the base ones and are written against the base-patched
# tree. The dist directory is one: build the variant you want to measure, measure, build
# the base back. ENGINE_SOURCES points at the checkouts (tag yohimik-pin, submodules
# populated).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SOURCES=${ENGINE_SOURCES:-$HOME/darkoak-backups/engine-sources-next}
what=${1:-all}
VARIANT=${2:-}

# The Docker context is a tar of exactly the files git knows about, submodules included
# and .git excluded — what a recursive checkout looks like from inside the container —
# with our Dockerfile appended, because when the context comes in on stdin Docker will
# only read a Dockerfile that is inside it. (Struggle 3 in the journal.)
context() {
    local src=$1 dockerfile=$2 tarball=$3
    # The working tree as it is, minus .git and build leftovers. (git ls-files
    # --recurse-submodules was used until 10 September; it omits a submodule checked out
    # at a commit other than the one recorded, which a newer checkout with a moved
    # submodule always is.)
    tar -C "$src" --exclude=.git --exclude='./build' --exclude='./out' --exclude=node_modules -cf "$tarball" .
    tar -rf "$tarball" -C "$(dirname "$dockerfile")" "$(basename "$dockerfile")"
    # Our changes ride along as patches, applied inside the container before the build,
    # so the source archive stays exactly the pin and the diff from it is readable here.
    local base=patches/$(basename "$src") variant=patches/$(basename "$src").${VARIANT:-none}
    for dir in "$base" "$variant"; do
        if [ -d "$HERE/$dir" ] && ls "$HERE/$dir"/*.patch >/dev/null 2>&1; then
            tar -rf "$tarball" -C "$HERE" "$dir"
        fi
    done
}

build() {
    local name=$1 src=$SOURCES/$2 pkg=$HERE/$2 tag=cs16-$1-builder${VARIANT:+-$VARIANT}
    local tarball; tarball=$(mktemp --suffix=.tar)
    echo "=== $name${VARIANT:+ ($VARIANT)}: docker build from $src"
    context "$src" "$pkg/Dockerfile.build" "$tarball"
    echo "=== $name: context $(du -h "$tarball" | cut -f1), $(tar -tf "$tarball" | wc -l) files"
    # The tag from the last successful build is removed first: otherwise a failed build
    # leaves it standing, and the artefacts copied out afterwards are the old ones with a
    # new date — which is how a client "built from newer source" came out byte-identical
    # to the pin on 10 September.
    docker rmi -f "$tag" >/dev/null 2>&1 || true
    docker build --progress=plain ${EMSDK:+--build-arg EMSDK=$EMSDK} -f Dockerfile.build -t "$tag" - < "$tarball" > "$pkg/build.log" 2>&1 || true
    rm -f "$tarball"
    if ! docker image inspect "$tag" >/dev/null 2>&1; then
        echo "=== $name: BUILD FAILED — last lines of $pkg/build.log:"; tail -n 30 "$pkg/build.log"; return 1
    fi
    rm -rf "$pkg/dist" && mkdir -p "$pkg/dist"
    docker run --rm --user "$(id -u):$(id -g)" -v "$pkg/dist:/out" "$tag"
    echo "=== $name: artefacts"; find "$pkg/dist" -type f | sed "s|$pkg/||" | sort
}

case $what in
    engine|all)
        build engine xash3d-fwgs
        # The TypeScript wrapper: patch Emscripten's glue into an ES module that hands
        # back the runtime pieces, then compile lib/ into dist/ beside the wasm.
        (cd "$HERE/xash3d-fwgs" && npm install --no-audit --no-fund --silent && npm run build:ts)
        echo "=== engine: BUILD OK"
        ;;&
    client|all)
        build client cs16-client
        echo "=== client: BUILD OK"
        ;;
esac
