#!/bin/bash
# The server's start: wire the mounted content and config into the game directory, render
# the one file that carries a secret, and run HLDS. Everything large lives on the host and
# is mounted, so adding a map or editing the map cycle never means rebuilding an image.
set -euo pipefail
# HLDS runs as root here; what it writes (the bots' .nav meshes) should still be readable
# on the host, where they are kept in git.
umask 022

CS=/home/steam/csserver/cstrike
CONTENT=/content   # ./shared, read-only: maps, wads, sounds, models — the same for every mode
CONFIG=/config     # ./<mode>, read-only: server.cfg, mapcycle.txt, plugins.ini, mode addons

# Content: the image's own copies are replaced by links into the mount.
for d in sound models sprites overviews resources; do
    rm -rf "$CS/$d"
    ln -s "$CONTENT/$d" "$CS/$d"
done
# Maps are the one directory the server writes into: the bots save the navigation mesh
# they build for a map as maps/<map>.nav, beside the .bsp, and read it back on the next
# load. The content mount is read-only, so maps/ is a writable directory of links to the
# content — mounted from ./navs on the host, so a mesh built once is kept.
NAVS=/navs
mkdir -p "$NAVS"
rm -rf "$CS/maps"
ln -s "$NAVS" "$CS/maps"
find "$NAVS" -maxdepth 1 -type l -delete
for f in "$CONTENT"/maps/*; do
    ln -s "$f" "$NAVS/$(basename "$f")"
done
# Wads sit beside the game directory, as GoldSrc expects them.
for w in "$CONTENT"/wads/*.wad; do
    ln -sf "$w" "$CS/$(basename "$w")"
done

# The mode's addons (modules.ini, csdm configs, gungame configs) are copied over the union
# baked into the image; plugins.ini and mapcycle.txt are linked, so an edit on the host is
# read at the next map change without a restart.
# users.ini is a link to the relay's file (made below). On a restart that link is still
# here, and copying the same file onto itself is an error cp refuses — which used to stop
# the container from ever starting a second time. Remove it first; the link is remade.
rm -f "$CS/addons/amxmodx/configs/users.ini"
cp -r "$CONFIG"/addons/. "$CS/addons/"
ln -sf "$CONFIG/plugins.ini" "$CS/addons/amxmodx/configs/plugins.ini"
# The admin list is written by the relay from its people file (one line per invited
# admin, by address) and linked, not copied, so that amx_reloadadmins sees a change at
# once — and so that a relay starting after this container is seen too. Until the relay
# has written it the link dangles and the server has no admins, which is the truth.
ln -sf "$CONFIG/addons/amxmodx/configs/users.ini" "$CS/addons/amxmodx/configs/users.ini"

# The mode files, if this server has them: one .cfg and one .maps.txt per game type, which
# "exec modes/<name>.cfg" and the mapcyclefile cvar read at runtime. Linked rather than
# copied so that editing a mode on the host and switching to it is enough — no restart.
[ -d "$CONFIG/modes" ] && ln -sfn "$CONFIG/modes" "$CS/modes"

# A server with modes chooses its cycle per mode; one without has a single file.
[ -f "$CONFIG/mapcycle.txt" ] && ln -sf "$CONFIG/mapcycle.txt" "$CS/mapcycle.txt"

# server.cfg is the only file with secrets in it, so it is the only one rendered. The
# server password is optional: empty means anyone on the network can join.
: "${RCON_PASSWORD:?RCON_PASSWORD must be set (cs-server/.env)}"
export SV_PASSWORD="${SV_PASSWORD:-}"
envsubst '${RCON_PASSWORD} ${SV_PASSWORD}' < "$CONFIG/server.cfg" > "$CS/server.cfg"

cd /home/steam/csserver
exec ./hlds_run -game cstrike -port "${PORT:-27015}" +ip 0.0.0.0 \
    +map "${MAP:-de_dust2}" +maxplayers "${MAXPLAYERS:-16}" +exec server.cfg "$@"
