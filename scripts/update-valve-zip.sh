#!/bin/bash
# Update valve.zip with latest client configs from source control
# This ensures valve.zip always matches what's in git

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CLIENT_DIR="$PROJECT_ROOT/web-server/go-webrtc-server/client"
CONFIG_DIR="$PROJECT_ROOT/cs-client-config"

cd "$CLIENT_DIR"

echo "🔄 Updating valve.zip with latest client configs from source..."

# Create timestamped backup
echo "📦 Creating backup..."
cp valve.zip "valve.zip.backup.$(date +%Y%m%d-%H%M%S)"

# Extract current valve.zip
echo "📂 Extracting valve.zip..."
rm -rf temp_valve_update
mkdir temp_valve_update
cd temp_valve_update
unzip -q ../valve.zip

# Copy latest configs from source control
echo "📋 Copying configs from source control..."
if [ -f "$CONFIG_DIR/userconfig.cfg" ]; then
    cp "$CONFIG_DIR/userconfig.cfg" cstrike/userconfig.cfg
    echo "   ✅ Updated cstrike/userconfig.cfg"
fi

# Add any other client config files here as needed...

# Repackage valve.zip
echo "🗜️  Repackaging valve.zip..."
zip -r ../valve.zip.new valve/ cstrike/ > /dev/null
cd ..
mv valve.zip.new valve.zip
rm -rf temp_valve_update

# Show size difference
SIZE=$(du -h valve.zip | cut -f1)
echo "✅ Updated valve.zip ($SIZE)"

echo "🚀 Restart web server to load changes:"
echo "   cd $PROJECT_ROOT/web-server && docker compose restart"
