# Multi-Server CS 1.6 Docker Image
# Supports classic, deathmatch, gungame server types
ARG SERVER_TYPE=classic

FROM timoxo/cs1.6:1.9.0817

# Set working directory to cstrike
WORKDIR /home/steam/csserver/cstrike

# Copy shared files first (base layer)
COPY shared/addons/ ./addons/
COPY shared/reunion.cfg ./reunion.cfg
COPY shared/motd.txt ./motd.txt

# Copy all binary assets (consistent approach - no mounting complexity)
COPY shared/wads/ ./
COPY shared/maps/ ./maps/
COPY shared/sound/ ./sound/
COPY shared/models/ ./models/
COPY shared/sprites/ ./sprites/
COPY shared/resources/ ./resources/
COPY shared/overviews/ ./overviews/

# Copy server-specific configurations (overwrites shared)
ARG SERVER_TYPE
COPY ${SERVER_TYPE}/ ./

# Copy server-specific addons (plugins and configs) if they exist
# This allows each server type to have its own plugins (CSDM, Gun Game, etc.)
# Preserve shared modules by copying subdirectories individually
RUN if [ -d "${SERVER_TYPE}/addons" ]; then \
        for subdir in configs plugins scripting modules; do \
            if [ -d "${SERVER_TYPE}/addons/amxmodx/$subdir" ]; then \
                cp -r ${SERVER_TYPE}/addons/amxmodx/$subdir/* ./addons/amxmodx/$subdir/ 2>/dev/null || true; \
            fi; \
        done; \
    fi

# Copy server-specific plugin configuration
COPY ${SERVER_TYPE}/plugins.ini ./addons/amxmodx/configs/plugins.ini

# Install envsubst for environment variable substitution
RUN apt-get update && apt-get install -y gettext-base && rm -rf /var/lib/apt/lists/*

# Create startup script to handle environment variable substitution
RUN echo '#!/bin/bash' > /start-server.sh && \
    echo 'echo "🔧 Substituting environment variables in server.cfg..."' >> /start-server.sh && \
    echo 'envsubst < server.cfg > server.cfg.tmp && mv server.cfg.tmp server.cfg' >> /start-server.sh && \
    echo 'echo "✅ RCON password configured: ${RCON_PASSWORD}"' >> /start-server.sh && \
    echo 'exec /home/steam/start_server.sh "$@"' >> /start-server.sh && \
    chmod +x /start-server.sh

# Set proper permissions for all copied files
RUN chmod 644 server.cfg reunion.cfg motd.txt mapcycle.txt *.wad && \
    chmod -R 755 addons/ maps/ sound/ models/ sprites/ resources/ overviews/

# Use our script as entrypoint to handle env substitution, then call original entrypoint
ENTRYPOINT ["/start-server.sh"]

# Expose CS port
EXPOSE 27015/udp

# The base image handles the entrypoint
