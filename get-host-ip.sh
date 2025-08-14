#!/bin/bash

# Get the host IP address for WebRTC ICE candidates
HOST_IP=$(hostname -I | awk '{print $1}')

if [ -z "$HOST_IP" ]; then
    echo "Could not detect host IP. Please set HOST_IP environment variable manually."
    echo "Example: export HOST_IP=192.168.1.100"
    exit 1
fi

echo "Detected Host IP: $HOST_IP"
export HOST_IP=$HOST_IP

echo "Starting CS16 WebRTC services with proper ICE configuration..."
docker-compose -f docker-compose.webrtc-fixed.yml up --build