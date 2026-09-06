# One image for every mode. ReHLDS, ReGameDLL, Metamod, Reunion and AMX Mod X come from the
# base; this adds the plugins the modes use. Maps, wads, sounds and configs are NOT in the
# image — they are mounted from ./shared and ./<mode> by docker-compose.yml, and
# entrypoint.sh wires them in at start.
FROM timoxo/cs1.6:1.9.0817

RUN apt-get update && apt-get install -y --no-install-recommends gettext-base \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /home/steam/csserver/cstrike

# Only what every mode shares: AMX Mod X itself, Metamod, Reunion. A mode's own plugins
# and configs are NOT baked in — entrypoint.sh copies them from that mode's /config mount.
# Baking the union put CSDM's plugins and its plugins-csdm.ini into all three images, and
# AMX Mod X loads any plugins-*.ini it finds, so classic and gungame ran CSDM too.
COPY shared/addons/ ./addons/
COPY shared/reunion.cfg shared/motd.txt shared/autoexec.cfg ./

COPY entrypoint.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
EXPOSE 27015/udp
