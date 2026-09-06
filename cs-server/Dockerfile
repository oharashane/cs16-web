# One image for every mode. ReHLDS, ReGameDLL, Metamod, Reunion and AMX Mod X come from the
# base; this adds the plugins the modes use. Maps, wads, sounds and configs are NOT in the
# image — they are mounted from ./shared and ./<mode> by docker-compose.yml, and
# entrypoint.sh wires them in at start.
FROM timoxo/cs1.6:1.9.0817

RUN apt-get update && apt-get install -y --no-install-recommends gettext-base \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /home/steam/csserver/cstrike

COPY shared/addons/ ./addons/
# The union of every mode's addons. The one file that differs per mode (modules.ini) is
# copied in from the mode's /config mount at start.
COPY classic/addons/ deathmatch/addons/ gungame/addons/ ./addons/
COPY shared/reunion.cfg shared/motd.txt shared/autoexec.cfg ./

COPY entrypoint.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
EXPOSE 27015/udp
