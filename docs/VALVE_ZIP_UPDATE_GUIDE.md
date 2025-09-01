# Valve.zip Update Guide

## Overview
This guide documents the process for updating the valve.zip file used by the webxash client to prevent client downloads and ensure proper Counter-Strike loading.

## ⚠️ IMPORTANT: Our Strategy

### **We Do NOT Build valve.zip from cs-server/shared**
- The cs-server/shared directory (1.6GB) contains Steam content we copied for reference
- **We only use tiny portions** of this content (specific maps/assets we add)
- **Our valve.zip is built from the working backup**, not from cs-server/shared

### **What We Actually Do**
1. **Start with working backup** (362MB) - this has the correct structure
2. **Add only specific new content** (maps, sounds, models, etc.) to it
3. **Result**: Modified working backup (418MB) that preserves the working structure

## Key Principles Learned

### 1. **Start with Working Backup**
- **NEVER** try to create valve.zip from scratch
- **ALWAYS** start with the working backup (`valve.zip.backup`)
- The working backup (362MB) has the correct structure that loads Counter-Strike

### 2. **Preserve Working Structure**
- The working backup has BOTH `valve/` (Half-Life) and `cstrike/` (Counter-Strike) directories
- This dual structure is essential for proper game loading
- Don't try to remove the `valve/` directory - it's needed

### 3. **Add Content Carefully**
- Extract the working backup completely
- Add new content to the extracted structure
- Recreate the zip file (don't modify in place)

## Complete Update Process

### Step 1: Prepare Working Environment
```bash
cd /home/shane/Desktop/cs16-web/web-server/go-webrtc-server/client
mkdir -p temp_update
cd temp_update
```

### Step 2: Extract Working Backup
```bash
unzip ../valve.zip.backup
```

### Step 3: Add New Content
Add the specific content you need:

#### Maps (BSP files)
```bash
cp ../../../../cs-server/shared/maps/de_dust2_2020.bsp cstrike/maps/
cp ../../../../cs-server/shared/maps/cs_bikini.bsp cstrike/maps/
cp ../../../../cs-server/shared/maps/de_vegas.bsp cstrike/maps/
cp ../../../../cs-server/shared/maps/dusty_scouts.bsp cstrike/maps/
cp ../../../../cs-server/shared/maps/awp_forest_cs.bsp cstrike/maps/
cp ../../../../cs-server/shared/maps/cs_agency_csgo.bsp cstrike/maps/
cp ../../../../cs-server/shared/maps/fy_simpsons.bsp cstrike/maps/
cp ../../../../cs-server/shared/maps/fy_matrix.bsp cstrike/maps/
cp ../../../../cs-server/shared/maps/de_hogwarts.bsp cstrike/maps/
```

#### Sounds
```bash
# Gungame sounds
cp -r ../../../../cs-server/shared/sound/gungame/ cstrike/sound/

# Map-specific sounds (e.g., de_dust2_2020)
cp -r ../../../../cs-server/shared/sound/de_dust2_2020/ cstrike/sound/
```

#### Models
```bash
# Map-specific models (e.g., de_dust2_2020)
cp -r ../../../../cs-server/shared/models/de_dust2_2020/ cstrike/models/
```

#### Overviews
```bash
# Map-specific overviews (e.g., de_dust2_2020)
cp ../../../../cs-server/shared/overviews/de_dust2_2020* cstrike/overviews/
```

#### Sprites
```bash
# Map-specific sprites (e.g., de_dust2_2020)
cp -r ../../../../cs-server/shared/sprites/de_dust2_2020/ cstrike/sprites/
```

### Step 4: Create New Valve.zip
```bash
zip -r ../valve.zip .
```

### Step 5: Clean Up
```bash
cd ..
rm -rf temp_update
```

### Step 6: Restart Web Server
```bash
cd /home/shane/Desktop/cs16-web/web-server
docker-compose restart go-webrtc-server
```

## What NOT to Do

### ❌ Don't Create from Scratch
- Don't try to build valve.zip from the cs-server/shared directory
- Don't exclude the `valve/` directory
- Don't try to modify the working backup in place

### ❌ Don't Overwhelm the Client
- Don't add unnecessary content
- Don't make the file too large (keep it under 500MB if possible)
- Don't change the directory structure

### ❌ Don't Ignore Dependencies
- Maps often need sounds, models, overviews, and sprites
- Check what the client downloads and add those assets
- Common dependencies: sounds, models, sprites, overviews, WADs

## Troubleshooting

### Problem: Client Loads Half-Life Instead of Counter-Strike
**Cause**: Corrupted valve.zip structure or missing `valve/` directory
**Solution**: Restore working backup and start over

### Problem: Client Downloads Assets
**Cause**: Missing dependencies in valve.zip
**Solution**: Add the specific assets being downloaded

### Problem: "Couldn't find game directory 'cstrike'"
**Cause**: Incorrect directory structure in valve.zip
**Solution**: Ensure `cstrike/` directory is at the root level

## File Size Guidelines

- **Working backup**: 362MB
- **Acceptable additions**: +100MB max (total ~462MB)
- **Warning threshold**: 500MB+ (may cause issues)

## Current Valve.zip Contents

**Size**: 418MB
**Structure**: 
- `valve/` (Half-Life assets)
- `cstrike/` (Counter-Strike assets)
  - Maps: All 9 requested maps
  - Sounds: Gungame + de_dust2_2020
  - Models: de_dust2_2020
  - Overviews: de_dust2_2020
  - Sprites: de_dust2_2020

## Future Updates

When adding new maps or content:
1. Follow the same process
2. Start with current working valve.zip (not backup)
3. Add only the specific assets needed
4. Test to ensure Counter-Strike still loads
5. Document any new dependencies discovered

## Backup Strategy

- Keep `valve.zip.backup` as the original working version
- Before major updates, create a backup of current working valve.zip
- Test updates before deploying to production

## ⚠️ About cs-server/shared Directory

### **What It Is**
- 1.6GB of Steam content we copied for reference
- Contains all the original Counter-Strike assets
- **We only use tiny portions** of this content

### **What We Actually Use**
- **Maps**: Only the 9 new maps we added
- **Assets**: Only map-specific dependencies (sounds, models, overviews, sprites)
- **Total usage**: ~56MB out of 1.6GB

### **Could We Clean It Up?**
- **Potentially yes**, but we need to be careful
- We could remove unused WADs, textures, and other assets
- **However**, we might need them for future map additions
- **Recommendation**: Keep it for now, but document what's actually needed
