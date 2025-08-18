#!/bin/bash
# Valve.zip Packaging Script for CS Server Assets
# Creates valve.zip from your cs-server/shared directory
# Use this when you want to include custom maps/assets from your server

set -e

VALVE_ZIP="valve.zip"
TEMP_DIR="temp_server_packaging"
CS_SERVER_DIR="../../../cs-server"

show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Package valve.zip from cs-server/shared assets"
    echo "Includes your custom maps, WADs, and server content"
    echo ""
    echo "Options:"
    echo "  -o, --output FILE     Output filename (default: valve.zip)"
    echo "  -f, --force           Overwrite existing valve.zip"
    echo "  -h, --help            Show this help"
    echo "  -s, --server-dir DIR  CS server directory (default: $CS_SERVER_DIR)"
    echo ""
    echo "Examples:"
    echo "  $0                              # Use default server directory"
    echo "  $0 --output custom-valve.zip   # Custom output name"
    echo "  $0 --server-dir ~/cs-server    # Custom server path"
    echo ""
    echo "⚖️  LEGAL NOTICE:"
    echo "   Only packages your legitimately obtained game assets"
    echo "   You must own CS 1.6 to use these files"
}

check_server_path() {
    local server_path="$1"
    
    if [ ! -d "$server_path" ]; then
        echo "❌ Error: CS server path does not exist: $server_path"
        exit 1
    fi
    
    if [ ! -d "$server_path/shared" ]; then
        echo "❌ Error: Not a valid cs-server setup (no shared/ directory)"
        echo "   Expected: $server_path/shared/"
        echo "   Run this script from the web-server/go-webrtc-server/client/ directory"
        exit 1
    fi
    
    # Check for essential game files
    if [ ! -f "$server_path/shared/wads"/*.wad ]; then
        echo "⚠️  Warning: No WAD files found in $server_path/shared/wads/"
        echo "   valve.zip may not work properly without game assets"
    fi
    
    echo "✅ Valid cs-server setup found"
}

package_from_server() {
    local server_path="$1"
    local output_file="$2"
    local force="$3"
    
    if [ -f "$output_file" ] && [ "$force" != "true" ]; then
        echo "❌ Error: $output_file already exists"
        echo "   Use --force to overwrite"
        exit 1
    fi
    
    echo "📦 Creating valve.zip from cs-server assets: $server_path/shared"
    
    # Clean up any previous temp directory
    rm -rf "$TEMP_DIR"
    mkdir -p "$TEMP_DIR/cstrike"
    
    # Copy shared assets to cstrike directory structure
    echo "📁 Copying game assets..."
    
    # Copy WAD files to cstrike root
    if ls "$server_path/shared/wads"/*.wad 1> /dev/null 2>&1; then
        cp "$server_path/shared/wads"/*.wad "$TEMP_DIR/cstrike/"
        echo "   ✅ WAD files copied"
    fi
    
    # Copy subdirectories
    for dir in maps models sound sprites resources overviews; do
        if [ -d "$server_path/shared/$dir" ]; then
            cp -r "$server_path/shared/$dir" "$TEMP_DIR/cstrike/"
            local count=$(find "$TEMP_DIR/cstrike/$dir" -type f | wc -l)
            echo "   ✅ $dir/ copied ($count files)"
        fi
    done
    
    # We need a basic valve directory for the client to work
    # Copy from Steam if available, otherwise create minimal structure
    if [ -d "/home/$(whoami)/snap/steam/common/.local/share/Steam/steamapps/common/Half-Life/valve" ]; then
        echo "📁 Copying valve/ directory from Steam..."
        cp -r "/home/$(whoami)/snap/steam/common/.local/share/Steam/steamapps/common/Half-Life/valve" "$TEMP_DIR/"
    else
        echo "📁 Creating minimal valve/ directory..."
        mkdir -p "$TEMP_DIR/valve"
        echo "// Minimal valve directory for CS client" > "$TEMP_DIR/valve/readme.txt"
    fi
    
    # Create the zip
    echo "🗜️  Creating $output_file..."
    cd "$TEMP_DIR"
    zip -r "../$output_file" valve/ cstrike/ > /dev/null
    cd ..
    
    # Clean up
    rm -rf "$TEMP_DIR"
    
    # Show results
    local size=$(du -h "$output_file" | cut -f1)
    echo "✅ Created $output_file ($size)"
    echo "📊 Contents include:"
    echo "   - $(ls "$server_path/shared/wads"/*.wad 2>/dev/null | wc -l) WAD files"
    echo "   - $(find "$server_path/shared/maps" -name "*.bsp" 2>/dev/null | wc -l) maps"
    echo "   - $(find "$server_path/shared/models" -name "*.mdl" 2>/dev/null | wc -l) models"
    echo "   - $(find "$server_path/shared/sound" -name "*.wav" 2>/dev/null | wc -l) sounds"
    echo "🚀 Restart web server to use new game content"
}

# Parse command line arguments
output_file="$VALVE_ZIP"
force="false"
server_dir="$CS_SERVER_DIR"

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -o|--output)
            output_file="$2"
            shift 2
            ;;
        -f|--force)
            force="true"
            shift
            ;;
        -s|--server-dir)
            server_dir="$2"
            shift 2
            ;;
        -*)
            echo "❌ Error: Unknown option '$1'"
            show_help
            exit 1
            ;;
        *)
            echo "❌ Error: Unexpected argument '$1'"
            show_help
            exit 1
            ;;
    esac
done

# Main execution
check_server_path "$server_dir"
package_from_server "$server_dir" "$output_file" "$force"
