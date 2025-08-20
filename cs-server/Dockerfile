# Multi-Server CS 1.6 Docker Image
# Supports classic, deathmatch, gungame server types

FROM timoxo/cs1.6:1.9.0817

# Define build argument for server type
ARG SERVER_TYPE=classic

# Install system dependencies
RUN apt-get update && apt-get install -y gettext-base && rm -rf /var/lib/apt/lists/*

WORKDIR /home/steam/csserver/cstrike

# Copy shared files
COPY shared/addons/ ./addons/
COPY shared/reunion.cfg ./reunion.cfg
COPY shared/motd.txt ./motd.txt
COPY shared/wads/ ./
COPY shared/maps/ ./maps/
COPY shared/sound/ ./sound/
COPY shared/models/ ./models/
COPY shared/sprites/ ./sprites/
COPY shared/resources/ ./resources/
COPY shared/overviews/ ./overviews/

# Copy server-specific addons (merges with shared addons)
COPY ${SERVER_TYPE}/addons/ ./addons/

# Copy server-specific config files
COPY ${SERVER_TYPE}/server.cfg ./server.cfg
COPY ${SERVER_TYPE}/mapcycle.txt ./mapcycle.txt
COPY ${SERVER_TYPE}/plugins.ini ./addons/amxmodx/configs/plugins.ini

# Create startup script
RUN echo '#!/bin/bash' > /start-server.sh && \
    echo 'echo "Substituting environment variables in server.cfg..."' >> /start-server.sh && \
    echo 'envsubst < server.cfg > server.cfg.tmp && mv server.cfg.tmp server.cfg' >> /start-server.sh && \
    echo 'echo "RCON password configured: ${RCON_PASSWORD}"' >> /start-server.sh && \
    echo '' >> /start-server.sh && \
    echo 'exec /home/steam/start_server.sh "$@"' >> /start-server.sh && \
    chmod +x /start-server.sh

# Set permissions
RUN chmod 644 server.cfg reunion.cfg motd.txt mapcycle.txt *.wad && \
    chmod -R 755 addons/ maps/ sound/ models/ sprites/ resources/ overviews/

ENTRYPOINT ["/start-server.sh"]

# Expose CS port
EXPOSE 27015/udp
