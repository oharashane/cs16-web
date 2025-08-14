# CS1.6 ReHLDS Game Server
FROM debian:bullseye-slim

# Install dependencies for ReHLDS
RUN apt-get update && apt-get install -y \
    lib32gcc-s1 \
    lib32stdc++6 \
    libc6-i386 \
    wget \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Create server directory
WORKDIR /opt/cs16

# Copy server files
COPY . .

# Set executable permissions
RUN chmod +x hlds_linux

EXPOSE 27015/udp

CMD ["./hlds_linux", "-game", "cstrike", "+map", "de_dust2", "+maxplayers", "16", "-port", "27015"]