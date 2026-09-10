#!/bin/bash
# CS1.6 Client Name Prefix Customizer
# Changes the player name prefix from [Xash3D] to something else

set -e

ASSETS_DIR="assets"
WASM_FILE="$ASSETS_DIR/xash-dpb4Gdqz.wasm"
BACKUP_FILE="$WASM_FILE.backup"

# Default values
DEFAULT_PREFIX="[noob]  "  # Note: padded to same length as [Xash3D]
ORIGINAL_PREFIX="[Xash3D]"

show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -p, --prefix PREFIX   Set custom prefix (max 8 chars, will be padded)"
    echo "  -r, --restore         Restore original [Xash3D] prefix"
    echo "  -s, --status          Show current prefix in WASM file"
    echo "  -h, --help            Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 --prefix '[noob]'     # Changes to [noob]"
    echo "  $0 --prefix '[epic]'     # Changes to [epic]"
    echo "  $0 --restore             # Restores to [Xash3D]"
    echo "  $0 --status              # Shows current setting"
}

show_status() {
    if [ -f "$WASM_FILE" ]; then
        echo "Current prefix in WASM file:"
        strings "$WASM_FILE" | grep -E "setinfo.*\[.*\].*%s" | head -1 || echo "No prefix pattern found"
    else
        echo "WASM file not found: $WASM_FILE"
    fi
}

restore_original() {
    if [ -f "$BACKUP_FILE" ]; then
        echo "🔄 Restoring original WASM file..."
        cp "$BACKUP_FILE" "$WASM_FILE"
        echo "✅ Restored to original [Xash3D] prefix"
    else
        echo "❌ Backup file not found: $BACKUP_FILE"
        echo "Cannot restore original. You may need to re-download the client files."
        exit 1
    fi
}

set_prefix() {
    local new_prefix="$1"
    
    # Ensure we have a backup
    if [ ! -f "$BACKUP_FILE" ]; then
        echo "📦 Creating backup of original WASM file..."
        cp "$WASM_FILE" "$BACKUP_FILE"
    fi
    
    # Pad the prefix to exactly 8 characters (same as [Xash3D])
    local padded_prefix=$(printf "%-8s" "$new_prefix")
    
    echo "🔧 Changing prefix to: '$padded_prefix'"
    
    # First restore from backup to avoid double-patching
    cp "$BACKUP_FILE" "$WASM_FILE"
    
    # Apply the new prefix
    sed -i "s/\[Xash3D\]/$padded_prefix/g" "$WASM_FILE"
    
    echo "✅ Player name prefix changed!"
    echo "🚀 Restart the web server to apply changes"
}

# Parse command line arguments
case "${1:-}" in
    -h|--help)
        show_help
        exit 0
        ;;
    -s|--status)
        show_status
        exit 0
        ;;
    -r|--restore)
        restore_original
        exit 0
        ;;
    -p|--prefix)
        if [ -z "${2:-}" ]; then
            echo "❌ Error: --prefix requires a value"
            show_help
            exit 1
        fi
        set_prefix "$2"
        exit 0
        ;;
    "")
        # Default: set to [noob]
        set_prefix "$DEFAULT_PREFIX"
        exit 0
        ;;
    *)
        echo "❌ Error: Unknown option '$1'"
        show_help
        exit 1
        ;;
esac
