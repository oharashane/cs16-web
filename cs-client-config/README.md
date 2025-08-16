# CS 1.6 Client Configuration

This directory contains client-side configuration files that need to be included in the `valve.zip` package.

## Files

### `userconfig.cfg`
- **Purpose**: Automatically executed by the CS 1.6 client when it starts
- **Location in valve.zip**: `cstrike/userconfig.cfg`
- **Features**:
  - FPS counter display (`cl_showfps 1`)
  - Network graph with detailed info (`net_graph 3`)
  - Network graph positioned at top-right (`net_graphpos 2`)
  - Enhanced movement settings
  - Performance optimizations

## Usage

After modifying any config files in this directory, update the `valve.zip`:

### **Easy Method (Recommended):**
```bash
# Run the update script from project root
./scripts/update-valve-zip.sh

# Restart web server  
cd web-server && docker compose restart
```

### **Manual Method:**
1. Navigate to client directory: `cd web-server/go-webrtc-server/client`
2. Backup: `cp valve.zip valve.zip.backup.$(date +%Y%m%d-%H%M%S)`
3. Extract: `mkdir temp && cd temp && unzip -q ../valve.zip`
4. Update: `cp ../../../cs-client-config/userconfig.cfg cstrike/`
5. Repackage: `zip -r ../valve.zip.new valve/ cstrike/ && cd .. && mv valve.zip.new valve.zip && rm -rf temp`
6. Restart: `cd ../../ && docker compose restart`

## Notes

- Changes to client configs require rebuilding the valve.zip
- Always create backups before modifying valve.zip
- Test client configs after any changes to ensure compatibility with Xash engine
