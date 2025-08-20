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

# Copy server-specific addons (plugins, scripting, modules) but NOT configs yet
# This allows each server type to have its own plugins (CSDM, Gun Game, etc.)
# Preserve shared modules by copying subdirectories individually
ARG SERVER_TYPE
RUN if [ -d "${SERVER_TYPE}/addons" ]; then \
        for subdir in plugins scripting modules; do \
            if [ -d "${SERVER_TYPE}/addons/amxmodx/$subdir" ]; then \
                echo "Copying ${SERVER_TYPE}/addons/amxmodx/$subdir/* to ./addons/amxmodx/$subdir/"; \
                cp -rf ${SERVER_TYPE}/addons/amxmodx/$subdir/* ./addons/amxmodx/$subdir/ 2>/dev/null || echo "No files to copy in $subdir"; \
            fi; \
        done; \
    fi && \
    echo "=== Contents of modules directory after copy ===" && \
    ls -la ./addons/amxmodx/modules/ && \
    echo "=== Contents of plugins directory after copy ===" && \
    ls -la ./addons/amxmodx/plugins/ | grep -E "(csdm|total)" && \
    echo "=============================================" && \
    echo "=== Checking CSDM module specifically ===" && \
    ls -la ./addons/amxmodx/modules/csdm_amxx_i386.so 2>/dev/null || echo "CSDM module not found after copy"

# Copy server-specific plugin configuration
COPY ${SERVER_TYPE}/plugins.ini ./addons/amxmodx/configs/plugins.ini

# Copy server-specific modules configuration (if it exists)
RUN if [ -f "${SERVER_TYPE}/addons/amxmodx/configs/modules.ini" ]; then \
        cp "${SERVER_TYPE}/addons/amxmodx/configs/modules.ini" ./addons/amxmodx/configs/; \
    fi

# Copy CSDM module directly (if it exists for this server type)
RUN if [ -f "${SERVER_TYPE}/addons/amxmodx/modules/csdm_amxx_i386.so" ]; then \
        cp "${SERVER_TYPE}/addons/amxmodx/modules/csdm_amxx_i386.so" ./addons/amxmodx/modules/; \
        echo "=== CSDM module copied for ${SERVER_TYPE} ==="; \
    else \
        echo "=== No CSDM module for ${SERVER_TYPE} ==="; \
    fi

# Install envsubst for environment variable substitution
RUN apt-get update && apt-get install -y gettext-base && rm -rf /var/lib/apt/lists/*

# Create startup script to handle environment variable substitution
RUN echo '#!/bin/bash' > /start-server.sh && \
    echo 'echo "🔧 Substituting environment variables in server.cfg..."' >> /start-server.sh && \
    echo 'envsubst < server.cfg > server.cfg.tmp && mv server.cfg.tmp server.cfg' >> /start-server.sh && \
    echo 'echo "✅ RCON password configured: ${RCON_PASSWORD}"' >> /start-server.sh && \
    echo '' >> /start-server.sh && \
    echo 'exec /home/steam/start_server.sh "$@"' >> /start-server.sh && \
    chmod +x /start-server.sh

# FINAL LAYER: Force copy server-specific configs to ensure they override shared configs
# This layer is separate and late to prevent caching issues with config changes
ARG SERVER_TYPE
COPY ${SERVER_TYPE}/addons/amxmodx/configs/ ./addons/amxmodx/configs/
RUN echo "=== FINAL CONFIG OVERRIDE: Copied ${SERVER_TYPE} configs ===" && \
    echo "Files copied:" && \
    ls -la ./addons/amxmodx/configs/ && \
    echo "=== Config override complete ==="

# Set proper permissions for all copied files
RUN chmod 644 server.cfg reunion.cfg motd.txt mapcycle.txt *.wad && \
    chmod -R 755 addons/ maps/ sound/ models/ sprites/ resources/ overviews/

# Use our script as entrypoint to handle env substitution, then call original entrypoint
ENTRYPOINT ["/start-server.sh"]

# Expose CS port
EXPOSE 27015/udp

# The base image handles the entrypoint
