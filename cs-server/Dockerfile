# The game server, built from the parts rather than taken from Docker Hub.
#
# Until 9 September 2026 this was FROM timoxo/cs1.6:1.9.0817 — somebody else's build of
# ReHLDS 3.13 (2023), ReGameDLL 5.26, AMX Mod X 1.8.2 (2011) — which is the situation the
# browser engine was in until engine/ was written. This file pins each component to a
# release URL and a sha256, the way engine/ pins its sources, so the server is
# reproducible and ours to change. HLDS itself (the 2013 Valve build, 3378) still comes
# from Steam through steamcmd; there is no other source for it.
#
# Maps, wads, sounds, models and every server's own config are NOT in the image — they are
# mounted from ./shared and ./<server> by docker-compose.yml, and entrypoint.sh wires them
# in at start.

FROM ubuntu:24.04 AS base
ENV DEBIAN_FRONTEND=noninteractive
RUN dpkg --add-architecture i386 \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl unzip gettext-base \
        lib32gcc-s1 lib32stdc++6 libc6:i386 \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------------------
# HLDS from Steam. App 90 on the steam_legacy branch is the last GoldSrc build (3378) —
# what every no-Steam client, including the browser one, speaks. steamcmd's first
# attempt at app 90 is known to fail while it fetches the mod's own manifests, so the
# update runs twice; the second one validates a complete install.
FROM base AS hlds
WORKDIR /home/steam/steamcmd
RUN curl -sSL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar zxf - \
    && mkdir -p /root/.steam && ln -s /home/steam/steamcmd/linux32 /root/.steam/sdk32
RUN ./steamcmd.sh +force_install_dir /home/steam/csserver +login anonymous \
        +app_set_config 90 mod cstrike +quit || true
RUN ./steamcmd.sh +force_install_dir /home/steam/csserver +login anonymous \
        +app_update 90 -beta steam_legacy validate +quit || true
RUN ./steamcmd.sh +force_install_dir /home/steam/csserver +login anonymous \
        +app_update 90 -beta steam_legacy validate +quit

# ---------------------------------------------------------------------------------------
# The parts, pinned. Change a version here and its hash beside it; nothing else knows.
FROM base AS parts
ARG REHLDS_VERSION=3.15.0.896
ARG REHLDS_SHA256=997baeb7ef3842dab3e034d82dc651ebfe560c23b158adce660a6b97976b4e2b
ARG REGAMEDLL_VERSION=5.30.0.814
ARG REGAMEDLL_SHA256=457f5c96a4d10280fcad47f106cbd5be86363a47df1ccab91c514e9d1bc6fd18
ARG METAMOD_VERSION=1.3.0.149
ARG METAMOD_SHA256=ede7f59c4e0220afe8c02aa348a130cce527f87d36ffdb674e37a501ce57be94
ARG REUNION_VERSION=0.2.0.34
ARG REUNION_SHA256=29745559cefdcaee78c847d16e3861a8981fb77afc7600a58bb1a8a57dfeb897
ARG REAPI_VERSION=5.29.0.358
ARG REAPI_SHA256=f33a7435540bea8706db3fa948e51a85b511f5b18c383b97402a204dc5419195
ARG AMXX_VERSION=1.10.0-git5481
ARG AMXX_BASE_SHA256=ee33b31ae92afd94802c43eae14ecdfa1ffa2ba0b11658e8bec98f48a5881272
ARG AMXX_CSTRIKE_SHA256=76ff2bdd39f6dc14a2088ff4af724599c69a8ae7e3526679927aaef4ca898bf2
ARG REDM_VERSION=1.0.0-b11
ARG REDM_SHA256=2b6a2c5abee9198500c6a6362fcc0e55784dd4fc387365565ab82d8ecaa49abe
# The Condition Zero bots' profiles and radio chatter, which ReGameDLL keeps in its
# repository rather than its releases; pinned to the commit that last touched the file.
ARG BOTS_COMMIT=ba1e521f8904b5d787e9bba34ad5fea7bb969643
ARG BOTS_SHA256=39e6e8a137dbbbdef842cdb4318ef1069b3467127a0cc19bdc6eca1d5d693e38

WORKDIR /parts
# fetch <file> <url> <sha256>: download, verify, or fail the build.
RUN printf '%s\n' '#!/bin/sh' 'set -e' 'curl -sSL -o "$1" "$2"' 'echo "$3  $1" | sha256sum -c -' > /usr/local/bin/fetch \
    && chmod +x /usr/local/bin/fetch
RUN fetch rehlds.zip    "https://github.com/rehlds/ReHLDS/releases/download/${REHLDS_VERSION}/rehlds-bin-${REHLDS_VERSION}.zip" "${REHLDS_SHA256}" \
    && fetch regamedll.zip "https://github.com/rehlds/ReGameDLL_CS/releases/download/${REGAMEDLL_VERSION}/regamedll-bin-${REGAMEDLL_VERSION}.zip" "${REGAMEDLL_SHA256}" \
    && fetch metamod.zip   "https://github.com/rehlds/Metamod-R/releases/download/${METAMOD_VERSION}/metamod-bin-${METAMOD_VERSION}.zip" "${METAMOD_SHA256}" \
    && fetch reunion.zip   "https://github.com/rehlds/reunion/releases/download/${REUNION_VERSION}/reunion-${REUNION_VERSION}.zip" "${REUNION_SHA256}" \
    && fetch reapi.zip     "https://github.com/rehlds/ReAPI/releases/download/${REAPI_VERSION}/reapi-bin-${REAPI_VERSION}.zip" "${REAPI_SHA256}" \
    && fetch amxx-base.tar.gz    "https://www.amxmodx.org/amxxdrop/1.10/amxmodx-${AMXX_VERSION}-base-linux.tar.gz" "${AMXX_BASE_SHA256}" \
    && fetch amxx-cstrike.tar.gz "https://www.amxmodx.org/amxxdrop/1.10/amxmodx-${AMXX_VERSION}-cstrike-linux.tar.gz" "${AMXX_CSTRIKE_SHA256}" \
    && fetch redm.zip      "https://github.com/ReDeathmatch/ReDeathmatch_AMXX/releases/download/${REDM_VERSION}/ReDeathmatch-${REDM_VERSION}.zip" "${REDM_SHA256}" \
    && fetch bots.zip      "https://github.com/rehlds/ReGameDLL_CS/raw/${BOTS_COMMIT}/regamedll/extra/zBot/bot_profiles.zip" "${BOTS_SHA256}"

# Lay them out as they will sit over the HLDS tree, under /parts/csserver.
RUN mkdir -p csserver/cstrike/addons/metamod/dlls csserver/cstrike/addons/reunion \
    && unzip -q rehlds.zip    'bin/linux32/*' -d rehlds    && cp -r rehlds/bin/linux32/. csserver/ \
    && unzip -q regamedll.zip 'bin/linux32/*' -d regamedll && cp -r regamedll/bin/linux32/cstrike/. csserver/cstrike/ \
    && unzip -q metamod.zip -d metamod && cp metamod/addons/metamod/metamod_i386.so csserver/cstrike/addons/metamod/dlls/metamod.so \
    && unzip -q reunion.zip -d reunion && cp reunion/addons/reunion/reunion_mm_i386.so csserver/cstrike/addons/reunion/ \
    && tar xzf amxx-base.tar.gz    -C csserver/cstrike \
    && tar xzf amxx-cstrike.tar.gz -C csserver/cstrike \
    && unzip -q reapi.zip -d reapi && cp reapi/addons/amxmodx/modules/reapi_amxx_i386.so csserver/cstrike/addons/amxmodx/modules/ \
    && unzip -q redm.zip -d redm && cp -r redm/cstrike/. csserver/cstrike/ \
    && unzip -q bots.zip -d bots && cp -r bots/cstrike/. csserver/cstrike/ \
    # The bots exist (bot_enable is read once, at start); how many play is bot_quota, a
    # mode's or an admin's decision, and it starts at none.
    && sed -i 's/^bot_enable "0"/bot_enable "1"/' csserver/cstrike/game_init.cfg \
    # AMX Mod X loads every plugins-*.ini it finds; a mode decides whether deathmatch runs,
    # not the image. The list is kept beside it for the mode files to point at.
    && mv csserver/cstrike/addons/amxmodx/configs/plugins-redm.ini csserver/cstrike/addons/amxmodx/configs/plugins-redm.ini.example \
    && printf 'linux addons/amxmodx/dlls/amxmodx_mm_i386.so\nlinux addons/reunion/reunion_mm_i386.so\n' > csserver/cstrike/addons/metamod/plugins.ini \
    && printf 'ReHLDS %s\nReGameDLL %s\nMetamod-r %s\nReunion %s\nReAPI %s\nAMX Mod X %s\nReDeathmatch %s\n' \
        "${REHLDS_VERSION}" "${REGAMEDLL_VERSION}" "${METAMOD_VERSION}" "${REUNION_VERSION}" "${REAPI_VERSION}" "${AMXX_VERSION}" "${REDM_VERSION}" \
        > csserver/PARTS && printf 'zBot profiles %s\n' "${BOTS_COMMIT}" >> csserver/PARTS

# ---------------------------------------------------------------------------------------
FROM hlds
WORKDIR /home/steam/csserver
COPY --from=parts /parts/csserver/ ./
# The engine loads Metamod as the game DLL; Metamod loads the real one (ReGameDLL).
RUN sed -i 's#^gamedll_linux.*#gamedll_linux "addons/metamod/dlls/metamod.so"#' cstrike/liblist.gam \
    && chmod a+x hlds_run hlds_linux \
    && grep -q metamod cstrike/liblist.gam
# What is ours in the image: who the admins are and what they may do, the Reunion policy
# (how a browser player gets an identity), and the message of the day. Everything a
# mode changes is mounted at run time by entrypoint.sh.
COPY shared/addons/amxmodx/configs/users.ini shared/addons/amxmodx/configs/cmdaccess.ini cstrike/addons/amxmodx/configs/
COPY shared/reunion.cfg shared/motd.txt shared/autoexec.cfg cstrike/
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
EXPOSE 27015/udp
