#!/bin/bash
# Valve.zip Packaging Script
# Creates valve.zip from your legitimate CS 1.6 installation

set -e

VALVE_ZIP="valve.zip"
TEMP_DIR="temp_valve_packaging"

show_help() {
    echo "Usage: $0 [OPTIONS] <cs16-path>"
    echo ""
    echo "Package valve.zip from your legitimate CS 1.6 installation"
    echo ""
    echo "Arguments:"
    echo "  cs16-path             Path to your CS 1.6 installation directory"
    echo ""
    echo "Options:"
    echo "  -o, --output FILE     Output filename (default: valve.zip)"
    echo "  -f, --force           Overwrite existing valve.zip"
    echo "  -h, --help            Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 ~/.steam/steamapps/common/Half-Life"
    echo "  $0 /opt/cs16 --output my-valve.zip"
    echo "  $0 ~/cs16-server --force"
    echo ""
    echo "⚖️  LEGAL NOTICE:"
    echo "   You must own a legitimate copy of Counter-Strike 1.6"
    echo "   This script only packages YOUR existing game files"
}

check_cs16_path() {
    local cs16_path="$1"
    
    if [ ! -d "$cs16_path" ]; then
        echo "❌ Error: CS 1.6 path does not exist: $cs16_path"
        exit 1
    fi
    
    if [ ! -d "$cs16_path/valve" ]; then
        echo "❌ Error: Not a valid CS 1.6 installation (no valve/ directory)"
        echo "   Expected: $cs16_path/valve/"
        exit 1
    fi
    
    if [ ! -d "$cs16_path/cstrike" ]; then
        echo "❌ Error: Not a valid CS 1.6 installation (no cstrike/ directory)"
        echo "   Expected: $cs16_path/cstrike/"
        exit 1
    fi
    
    echo "✅ Valid CS 1.6 installation found"
}

package_valve() {
    local cs16_path="$1"
    local output_file="$2"
    local force="$3"
    
    if [ -f "$output_file" ] && [ "$force" != "true" ]; then
        echo "❌ Error: $output_file already exists"
        echo "   Use --force to overwrite"
        exit 1
    fi
    
    echo "📦 Creating valve.zip from: $cs16_path"
    
    # Clean up any previous temp directory
    rm -rf "$TEMP_DIR"
    mkdir -p "$TEMP_DIR"
    
    # Copy valve and cstrike directories
    echo "📁 Copying valve/ directory..."
    cp -r "$cs16_path/valve" "$TEMP_DIR/"
    
    echo "📁 Copying cstrike/ directory..."
    cp -r "$cs16_path/cstrike" "$TEMP_DIR/"
    
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
    echo "🚀 Restart web server to use new game content"
}

# Parse command line arguments
output_file="$VALVE_ZIP"
force="false"
cs16_path=""

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
        -*)
            echo "❌ Error: Unknown option '$1'"
            show_help
            exit 1
            ;;
        *)
            if [ -z "$cs16_path" ]; then
                cs16_path="$1"
            else
                echo "❌ Error: Too many arguments"
                show_help
                exit 1
            fi
            shift
            ;;
    esac
done

# Check required argument
if [ -z "$cs16_path" ]; then
    echo "❌ Error: CS 1.6 installation path required"
    show_help
    exit 1
fi

# Main execution
check_cs16_path "$cs16_path"
package_valve "$cs16_path" "$output_file" "$force"
