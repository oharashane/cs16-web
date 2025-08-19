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
    ls -la ./addons/amxmodx/modules/ | grep -E "(cstrike|total)" && \
    echo "============================================="

# Copy server-specific plugin configuration
COPY ${SERVER_TYPE}/plugins.ini ./addons/amxmodx/configs/plugins.ini

# Install envsubst for environment variable substitution
RUN apt-get update && apt-get install -y gettext-base && rm -rf /var/lib/apt/lists/*

# Create startup script to handle environment variable substitution
RUN echo '#!/bin/bash' > /start-server.sh && \
    echo 'echo "🔧 Substituting environment variables in server.cfg..."' >> /start-server.sh && \
    echo 'envsubst < server.cfg > server.cfg.tmp && mv server.cfg.tmp server.cfg' >> /start-server.sh && \
    echo 'echo "✅ RCON password configured: ${RCON_PASSWORD}"' >> /start-server.sh && \
    echo '' >> /start-server.sh && \
    echo '# TEMPORARY: Start server and fix CSDM config after it loads' >> /start-server.sh && \
    echo '/home/steam/start_server.sh "$@" &' >> /start-server.sh && \
    echo 'SERVER_PID=$!' >> /start-server.sh && \
    echo 'echo "🕐 Waiting for CSDM to generate broken config..."' >> /start-server.sh && \
    echo 'sleep 8' >> /start-server.sh && \
    echo 'echo "🔧 Fixing config format (CSDM module failed to load)..."' >> /start-server.sh && \
    echo 'cat > addons/amxmodx/configs/csdm.cfg << "EOF"' >> /start-server.sh && \
    echo '[settings]' >> /start-server.sh && \
    echo 'enabled = 1' >> /start-server.sh && \
    echo '' >> /start-server.sh && \
    echo '[equip]' >> /start-server.sh && \
    echo 'menus = ps' >> /start-server.sh && \
    echo 'autoitems = ah' >> /start-server.sh && \
    echo '' >> /start-server.sh && \
    echo '[primary]' >> /start-server.sh && \
    echo 'ak47 "AK47" 1' >> /start-server.sh && \
    echo 'm4a1 "M4A1" 1' >> /start-server.sh && \
    echo 'awp "AWP" 1' >> /start-server.sh && \
    echo 'mp5navy "MP5" 1' >> /start-server.sh && \
    echo 'p90 "P90" 1' >> /start-server.sh && \
    echo '' >> /start-server.sh && \
    echo '[secondary]' >> /start-server.sh && \
    echo 'glock18 "Glock" 1' >> /start-server.sh && \
    echo 'usp "USP" 1' >> /start-server.sh && \
    echo 'deagle "Deagle" 1' >> /start-server.sh && \
    echo 'EOF' >> /start-server.sh && \
    echo 'echo "✅ Config format fixed"' >> /start-server.sh && \
    echo 'wait $SERVER_PID' >> /start-server.sh && \
    chmod +x /start-server.sh

# FINAL LAYER: Force copy server-specific configs to ensure they override shared configs
# This layer is separate and late to prevent caching issues with config changes
ARG SERVER_TYPE
COPY ${SERVER_TYPE}/addons/amxmodx/configs/ ./addons/amxmodx/configs/
RUN echo "=== FINAL CONFIG OVERRIDE: Copied ${SERVER_TYPE} configs ===" && \
    echo "Files copied:" && \
    ls -la ./addons/amxmodx/configs/ && \
    echo "Contents of csdm.cfg after override:" && \
    head -5 ./addons/amxmodx/configs/csdm.cfg 2>/dev/null || echo "No csdm.cfg found" && \
    echo "File size and permissions:" && \
    ls -la ./addons/amxmodx/configs/csdm.cfg && \
    echo "=== Config override complete ==="

# Set proper permissions for all copied files
RUN chmod 644 server.cfg reunion.cfg motd.txt mapcycle.txt *.wad && \
    chmod -R 755 addons/ maps/ sound/ models/ sprites/ resources/ overviews/

# Use our script as entrypoint to handle env substitution, then call original entrypoint
ENTRYPOINT ["/start-server.sh"]

# Expose CS port
EXPOSE 27015/udp

# The base image handles the entrypoint
