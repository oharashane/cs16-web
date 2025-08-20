# CSDM 2.1.3d Setup Guide

## Overview
This document records the successful setup of CSDM (Counter-Strike Deathmatch) 2.1.3d on the deathmatch server, following the official installation steps from the CSDM source package.

## ⚠️ **Important: Follow Official Steps**

**The key to success is following the official CSDM installation steps exactly.** Do not attempt to:
- Write custom plugins
- Modify CSDM internals
- Use unofficial configuration formats
- Mix CSDM 1.x and 2.x components

## Official Installation Steps

### 1. **Extract CSDM Package**
The CSDM 2.1.3d package should be extracted to provide these files:
```
csdm_2.1.3d_KWo/
├── configs/
│   ├── csdm.cfg              # Official CSDM configuration
│   └── plugins-csdm.ini      # Official plugin list
├── modules/
│   └── csdm_amxx_i386.so    # CSDM module
└── plugins/
    ├── csdm_main.amxx        # Main CSDM plugin (required)
    ├── csdm_equip.amxx       # Weapons and equipment menus
    ├── csdm_spawn_preset.amxx # Preset spawning
    ├── csdm_misc.amxx        # Miscellaneous features
    ├── csdm_stripper.amxx    # Extra objective removals
    ├── csdm_protection.amxx  # Spawn protection
    └── csdm_ffa.amxx         # Free-for-all mode
```

### 2. **Copy Official Files to Server**

#### **Configuration Files**
```bash
# Copy official CSDM configuration
docker cp /path/to/csdm_2.1.3d_KWo/configs/csdm.cfg cs-server-dm:/home/steam/data/cstrike/addons/amxmodx/configs/

# Copy official plugin list
docker cp /path/to/csdm_2.1.3d_KWo/configs/plugins-csdm.ini cs-server-dm:/home/steam/data/cstrike/addons/amxmodx/configs/
```

#### **CSDM Module**
```bash
# Copy CSDM module
docker cp /path/to/csdm_2.1.3d_KWo/modules/csdm_amxx_i386.so cs-server-dm:/home/steam/data/cstrike/addons/amxmodx/modules/
```

#### **CSDM Plugins**
```bash
# Copy all CSDM plugins
for plugin in /path/to/csdm_2.1.3d_KWo/plugins/*.amxx; do 
  docker cp "$plugin" cs-server-dm:/home/steam/data/cstrike/addons/amxmodx/plugins/
done
```

### 3. **Configure Server**

#### **modules.ini**
```ini
; CSDM Module (required)
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

#### **plugins.ini**
**Use the official `plugins-csdm.ini` file, not a custom one.**

The official file contains:
```ini
;Main plugin, required for most cases
csdm_main.amxx

;Weapons and equipment menus
csdm_equip.amxx

;Enables preset spawning and the preset spawning editor
;Map config files are located in configs/csdm
csdm_spawn_preset.amxx

;Miscellanious extra features, such as ammo refills
; and basic objective removals
csdm_misc.amxx

; Extra objective removals
csdm_stripper.amxx

;Spawn protection
csdm_protection.amxx

;Adds free-for-all mode (must be enabled in csdm.cfg too)
;csdm_ffa.amxx
```

### 4. **Critical: Docker `/home/steam/data` Directory**

The Steam startup script has this logic:
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

**This means the `/home/steam/data` directory overwrites our configuration on every restart.**

**Solution**: Copy the correct CSDM files to `/home/steam/data` so they persist across restarts.

## Working Configuration

### **Files Required in Container**
```
/home/steam/data/cstrike/addons/amxmodx/
├── configs/
│   ├── modules.ini          # CSDM module enabled, conflicting modules disabled
│   ├── plugins-csdm.ini     # Official CSDM plugin list
│   └── csdm.cfg             # Official CSDM configuration
├── modules/
│   └── csdm_amxx_i386.so   # CSDM module
└── plugins/
    ├── csdm_main.amxx       # Main CSDM plugin (required)
    ├── csdm_equip.amxx      # Weapons and equipment menus
    ├── csdm_spawn_preset.amxx # Preset spawning
    ├── csdm_misc.amxx       # Miscellaneous features
    ├── csdm_stripper.amxx   # Extra objective removals
    ├── csdm_protection.amxx # Spawn protection
    └── csdm_ffa.amxx        # Free-for-all mode
```

## Expected Server Logs

When CSDM is working correctly, you should see:
```
L 08/20/2025 - 20:27:22: Server cvar "csdm_active" = "1"
L 08/20/2025 - 20:27:22: Server cvar "csdm_version" = "2.1.3c-KWo"
L 08/20/2025 - 20:27:23: [csdm_main.amxx] CSDM spawn mode set to preset
L 08/20/2025 - 20:27:23: Menu item 1 added to Menus Front-End: "CSDM Menu" from plugin "CSDM Main"
```

## Features Available

- ✅ **Automatic respawn** after death
- ✅ **Free-for-all mode** (no teams)
- ✅ **Weapon selection menu** (type `guns` or `/guns` in chat)
- ✅ **CSDM admin menu** (accessible via admin commands)
- ✅ **Spawn protection**
- ✅ **Automatic armor and equipment**

## In-Game Commands

- `guns` or `/guns` - Open weapon selection menu
- `csdm_es_menu` - CSDM admin menu (admin only)

## Troubleshooting

### **Common Issues**

1. **Server crashes on player join**
   - **Cause**: Incorrect CSDM setup, not following official steps
   - **Solution**: Use official files and configuration exactly as documented

2. **CSDM not loading**
   - **Cause**: Wrong plugin list or missing modules
   - **Solution**: Use `plugins-csdm.ini` from official package

3. **Configuration not persisting**
   - **Cause**: `/home/steam/data` directory overwriting files
   - **Solution**: Copy correct files to `/home/steam/data` directory

### **What NOT to Do**

- ❌ Don't write custom plugins
- ❌ Don't mix CSDM 1.x and 2.x
- ❌ Don't modify CSDM internals
- ❌ Don't ignore official documentation

## References

- **Official CSDM Source**: `/home/shane/Downloads/csdm_2.1.3d_KWo/`
- **Official Documentation**: `/home/shane/Downloads/csdm_2.1.3d_KWo/documentation/csdm_readme.htm`
- **Official Installation**: Follow the steps in the documentation exactly

## Notes for Future Maintenance

1. **Always use official CSDM files** from the source package
2. **Follow official installation steps** exactly
3. **The `/home/steam/data` fix** is persistent within the container but will be lost on full rebuilds
4. **Configuration changes** require copying updated files to `/home/steam/data` directory
5. **Plugin updates** require copying new plugins to `/home/steam/data/addons/amxmodx/plugins/`

---

**Remember**: CSDM 2.1.3d is a well-established, stable plugin. If you're having issues, you're probably not following the official setup correctly. Always refer back to the official documentation first.
