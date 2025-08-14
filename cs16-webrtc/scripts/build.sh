#!/bin/bash
# Build CS1.6 WebRTC Relay System

echo "🏗️  Building CS1.6 WebRTC Relay System..."
echo "📅 $(date)"

cd "$(dirname "$0")/.."

# Stop any running containers
echo "🛑 Stopping existing containers..."
docker-compose down

# Build and start services
echo "🔧 Building and starting services..."
docker-compose up --build -d

# Wait for services to start
echo "⏳ Waiting for services to initialize..."
sleep 10

# Check service health
echo "🔍 Checking service health..."
echo "📊 Web Relay (http://localhost:8080): $(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080 || echo "FAILED")"
echo "🎮 CS1.6 Server (UDP 27015): $(timeout 3 bash -c 'echo -n | nc -u localhost 27015' && echo "OPEN" || echo "CLOSED")"

echo ""
echo "✅ Build complete!"
echo "🌐 Dashboard: http://localhost:8080"
echo "🎯 CS1.6 Server: localhost:27015"
echo ""
echo "📋 Useful commands:"
echo "  docker-compose logs -f              # View all logs"
echo "  docker-compose logs -f web-relay    # View web relay logs"
echo "  docker-compose logs -f cs16-server  # View CS1.6 server logs"
echo "  docker-compose down                 # Stop all services"