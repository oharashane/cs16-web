#!/bin/bash

echo "🚀 Starting CS16 WebRTC Hybrid Relay"
echo "📅 $(date)"

# Start Python server in background
echo "🐍 Starting Python relay server on port 3000..."
CLIENT_DIR=/app/client python unified_server.py &
PYTHON_PID=$!

# Give Python a moment to start
sleep 2

# Start Go WebRTC server
echo "🐹 Starting Go WebRTC server on port 8080..."
webrtc-server &
GO_PID=$!

# Function to cleanup on exit
cleanup() {
    echo "🛑 Shutting down services..."
    kill $PYTHON_PID $GO_PID 2>/dev/null
    wait
    exit 0
}

# Trap signals for graceful shutdown
trap cleanup SIGTERM SIGINT

echo "✅ Both services started successfully"
echo ""
echo "🌐 HYBRID ARCHITECTURE READY:"
echo "   🎮 Web Client (Go WebRTC):  http://localhost:8080" 
echo "   📊 API/Metrics (Python):    http://localhost:3000/metrics"
echo "   🎯 Server Config:           http://localhost:3000/servers"
echo ""

# Wait for either process to exit
wait -n
echo "❌ One service exited, shutting down..."
cleanup