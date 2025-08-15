#!/bin/bash
# CS Server Setup Script
# This script creates server.cfg from template using environment variables

set -e

echo "🔧 Setting up CS Server configuration..."

# Load environment variables if .env exists
if [ -f "../.env.local" ]; then
    echo "📄 Loading environment from ../.env.local"
    set -a  # automatically export all variables
    source ../.env.local
    set +a
elif [ -f "../.env" ]; then
    echo "📄 Loading environment from ../.env"
    set -a
    source ../.env
    set +a
else
    echo "⚠️  No .env file found, using defaults"
fi

# Check if template exists
if [ ! -f "server.cfg.template" ]; then
    echo "❌ server.cfg.template not found!"
    exit 1
fi

# Create server.cfg from template
echo "🏗️  Creating server.cfg from template..."
cp server.cfg.template server.cfg

# Replace placeholder with actual RCON password
if [ -n "$RCON_PASSWORD" ]; then
    sed -i "s/REPLACE_WITH_YOUR_PASSWORD/$RCON_PASSWORD/g" server.cfg
    echo "✅ RCON password configured"
else
    echo "⚠️  RCON_PASSWORD not set in environment, using placeholder"
fi

echo "✅ CS Server configuration complete!"
echo "🚀 You can now run: docker-compose up -d"
