#!/bin/bash
# The server's start: wire the mounted content and config into the game directory, render
# the one file that carries a secret, and run HLDS. Everything large lives on the host and
# is mounted, so adding a map or editing the map cycle never means rebuilding an image.
set -euo pipefail

CS=/home/steam/csserver/cstrike
CONTENT=/content   # ./shared, read-only: maps, wads, sounds, models — the same for every mode
CONFIG=/config     # ./<mode>, read-only: server.cfg, mapcycle.txt, plugins.ini, mode addons

# Content: the image's own copies are replaced by links into the mount.
for d in maps sound models sprites overviews resources; do
    rm -rf "$CS/$d"
    ln -s "$CONTENT/$d" "$CS/$d"
done
# Wads sit beside the game directory, as GoldSrc expects them.
for w in "$CONTENT"/wads/*.wad; do
    ln -sf "$w" "$CS/$(basename "$w")"
done

# The mode's addons (modules.ini, csdm configs, gungame configs) are copied over the union
# baked into the image; plugins.ini and mapcycle.txt are linked, so an edit on the host is
# read at the next map change without a restart.
cp -r "$CONFIG"/addons/. "$CS/addons/"
ln -sf "$CONFIG/plugins.ini" "$CS/addons/amxmodx/configs/plugins.ini"

# The mode files, if this server has them: one .cfg and one .maps per game type, which
# "exec modes/<name>.cfg" and the mapcyclefile cvar read at runtime. Linked rather than
# copied so that editing a mode on the host and switching to it is enough — no restart.
[ -d "$CONFIG/modes" ] && ln -sfn "$CONFIG/modes" "$CS/modes"

# A server with modes chooses its cycle per mode; one without has a single file.
[ -f "$CONFIG/mapcycle.txt" ] && ln -sf "$CONFIG/mapcycle.txt" "$CS/mapcycle.txt"

# server.cfg is the only file with a secret in it, so it is the only one rendered.
: "${RCON_PASSWORD:?RCON_PASSWORD must be set (cs-server/.env)}"
envsubst '${RCON_PASSWORD}' < "$CONFIG/server.cfg" > "$CS/server.cfg"

cd /home/steam/csserver
exec ./hlds_run -game cstrike -port "${PORT:-27015}" +ip 0.0.0.0 \
    +map "${MAP:-de_dust2}" +maxplayers "${MAXPLAYERS:-16}" +exec server.cfg "$@"
