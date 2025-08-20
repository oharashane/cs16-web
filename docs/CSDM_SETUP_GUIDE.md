# CSDM 2.1.3d Setup Guide

## Overview
This document records the successful setup of CSDM (Counter-Strike Deathmatch) 2.1.3d on the deathmatch server, including troubleshooting steps and final working configuration.

## CSDM 2.1.3d Architecture

### Components
CSDM 2.1.3d consists of **two main components**:

1. **CSDM2 Metamod Plugin** (`CSDM2.dll`)
   - Loaded by Metamod
   - Handles core CSDM functionality
   - Provides the CSDM API for plugins

2. **CSDM AMX Mod X Plugins** (`.amxx` files)
   - Loaded by AMX Mod X
   - Provide specific features like weapon menus, spawn protection, etc.
   - Use the CSDM API provided by the Metamod plugin

### Key Insight
The **AMX Mod X module** (`csdm_amxx_i386.so`) is **redundant** when the Metamod plugin is loaded. The error:
```
[META] ERROR: dll: Failed to load plugin 'csdm_amxx_i386.so'
```
is **expected behavior** and can be ignored.

## Final Working Configuration

### Files Required
```
deathmatch/addons/amxmodx/
├── configs/
│   ├── modules.ini          # CSDM module enabled, conflicting modules disabled
│   ├── plugins.ini          # CSDM plugins enabled
│   └── csdm.cfg             # CSDM 2.x INI configuration
├── modules/
│   └── csdm_amxx_i386.so    # CSDM module (optional, Metamod plugin handles this)
└── plugins/
    ├── csdm_main.amxx       # Main CSDM plugin (required)
    ├── csdm_equip.amxx      # Weapons and equipment menus
    ├── csdm_spawn_preset.amxx # Preset spawning
    ├── csdm_misc.amxx       # Miscellaneous features
    ├── csdm_stripper.amxx   # Extra objective removals
    ├── csdm_protection.amxx # Spawn protection
    └── csdm_ffa.amxx        # Free-for-all mode
```

### Critical Configuration Files

#### modules.ini
```ini
; CSDM Module
csdm

; Standard modules (normally auto-detected)
; fun      ; Disabled - already loaded by Metamod
; engine   ; Disabled - already loaded by Metamod
; fakemeta ; Disabled - already loaded by Metamod
; geoip    ; Disabled - already loaded by Metamod
; sockets  ; Disabled - already loaded by Metamod
; regex    ; Disabled - already loaded by Metamod
; nvault   ; Disabled - already loaded by Metamod
; hamsandwich ; Disabled - already loaded by Metamod
; cstrike  ; Disabled - already loaded by Metamod
```

#### plugins.ini
```ini
; CSDM 2.1.3d Deathmatch Server Plugins
; Official CSDM configuration

; Admin Base - Always required
admin.amxx              ; admin base (required for any admin-related)

; Basic Admin Commands
admincmd.amxx           ; basic admin console commands
adminhelp.amxx          ; help command for admin console commands
adminslots.amxx         ; slot reservation
multilingual.amxx       ; Multi-Lingual management

; Admin Menus
menufront.amxx          ; front-end for admin menus
cmdmenu.amxx            ; command menu (speech, settings)
plmenu.amxx             ; players menu (kick, ban, client cmds.)
mapsmenu.amxx           ; maps menu (vote, changelevel)
pluginmenu.amxx         ; Menus for commands/cvars organized by plugin

; Utility Plugins
timeleft.amxx           ; time left display
antiflood.amxx          ; anti-flood protection

; CSDM 2.1.3d Plugins (Official)
csdm_main.amxx          ; Main CSDM plugin (required)
csdm_equip.amxx         ; Weapons and equipment menus
csdm_spawn_preset.amxx  ; Preset spawning and spawn editor
csdm_misc.amxx          ; Miscellaneous features (ammo refills, objectives)
csdm_stripper.amxx      ; Extra objective removals
csdm_protection.amxx    ; Spawn protection
csdm_ffa.amxx           ; Free-for-all mode
```

## Critical Issue: Docker `/home/steam/data` Directory

### Problem
The Steam startup script (`/home/steam/start_server.sh`) has this logic:
```bash
if [ -z "$(ls -A /home/steam/data)" ]; then 
  # First startup: copy from /home/steam/csserver to /home/steam/data
  cp -r /home/steam/csserver/cstrike/addons/* /home/steam/data/cstrike/addons
else 
  # Subsequent startups: copy from /home/steam/data to /home/steam/csserver
  rm -r /home/steam/csserver/cstrike/addons 
  cp -rf /home/steam/data/* /home/steam/csserver/ 
fi
```

### Solution
The `/home/steam/data` directory contains **old shared configuration** that overwrites our **deathmatch-specific configuration** on every server restart.

**Fix**: Copy the correct deathmatch files to `/home/steam/data`:
```bash
# Copy correct modules.ini
docker cp deathmatch/addons/amxmodx/configs/modules.ini cs-server-dm:/home/steam/data/cstrike/addons/amxmodx/configs/

# Copy correct plugins.ini
docker cp deathmatch/plugins.ini cs-server-dm:/home/steam/data/cstrike/addons/amxmodx/configs/

# Copy CSDM module
docker cp deathmatch/addons/amxmodx/modules/csdm_amxx_i386.so cs-server-dm:/home/steam/data/cstrike/addons/amxmodx/modules/

# Copy CSDM plugins
for plugin in csdm_main.amxx csdm_equip.amxx csdm_spawn_preset.amxx csdm_misc.amxx csdm_stripper.amxx csdm_protection.amxx csdm_ffa.amxx; do 
  docker cp deathmatch/addons/amxmodx/plugins/$plugin cs-server-dm:/home/steam/data/cstrike/addons/amxmodx/plugins/
done

# Copy CSDM config
docker cp deathmatch/addons/amxmodx/configs/csdm.cfg cs-server-dm:/home/steam/data/cstrike/addons/amxmodx/configs/
```

## Troubleshooting Steps Taken

### 1. Initial Crashes
- **Problem**: Server crashing with segmentation faults
- **Solution**: Disabled conflicting AMX Mod X modules in `modules.ini`

### 2. CSDM Module Loading Issues
- **Problem**: `[META] ERROR: dll: Failed to load plugin 'csdm_amxx_i386.so'`
- **Solution**: This is expected behavior - the Metamod plugin handles CSDM functionality

### 3. Configuration Persistence Issues
- **Problem**: Docker layer caching preventing config changes
- **Root Cause**: `/home/steam/data` directory overwriting configurations
- **Solution**: Copy correct files to `/home/steam/data` directory

### 4. Plugin Loading Issues
- **Problem**: CSDM plugins not loading
- **Root Cause**: Wrong `plugins.ini` in `/home/steam/data`
- **Solution**: Copy deathmatch-specific `plugins.ini` to `/home/steam/data`

## Final Working Status

### Server Logs (Expected)
```
L 08/20/2025 - 20:11:08: Server cvar "csdm_active" = "1"
L 08/20/2025 - 20:11:08: Server cvar "csdm_version" = "2.1.3c-KWo"
L 08/20/2025 - 20:11:09: [csdm_main.amxx] CSDM spawn mode set to preset
L 08/20/2025 - 20:11:09: Menu item 1 added to Menus Front-End: "CSDM Menu" from plugin "CSDM Main"
```

### Features Available
- ✅ **Automatic respawn** after death
- ✅ **Free-for-all mode** (no teams)
- ✅ **Weapon selection menu** (type `guns` or `/guns` in chat)
- ✅ **CSDM admin menu** (accessible via admin commands)
- ✅ **Spawn protection**
- ✅ **Automatic armor and equipment**

### In-Game Commands
- `guns` or `/guns` - Open weapon selection menu
- `csdm_es_menu` - CSDM admin menu (admin only)

## Notes for Future Maintenance

1. **Docker Rebuilds**: The `/home/steam/data` fix is persistent within the container but will be lost on full rebuilds
2. **Configuration Changes**: Always copy updated configs to `/home/steam/data` directory
3. **Plugin Updates**: Copy new plugins to `/home/steam/data/addons/amxmodx/plugins/`
4. **Module Conflicts**: Keep conflicting modules disabled in `modules.ini`

## References
- CSDM 2.1.3d source: `/home/shane/Downloads/csdm_2.1.3d_KWo/`
- Documentation: `/home/shane/Downloads/csdm_2.1.3d_KWo/documentation/csdm_readme.htm`
