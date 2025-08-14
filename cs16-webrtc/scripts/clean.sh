#!/bin/bash
# Clean up CS1.6 WebRTC Relay System

echo "🧹 Cleaning up CS1.6 WebRTC Relay System..."

cd "$(dirname "$0")/.."

# Stop and remove containers
echo "🛑 Stopping and removing containers..."
docker-compose down --volumes --remove-orphans

# Remove images
echo "🗑️  Removing built images..."
docker rmi $(docker images "cs16-webrtc*" -q) 2>/dev/null || true

# Clean up Docker system
echo "🔄 Cleaning Docker system..."
docker system prune -f

echo "✅ Cleanup complete!"