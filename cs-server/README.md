# CS 1.6 Multi-Server Docker Setup

This directory contains a multi-server CS 1.6 setup with three different game modes:
- **Classic** - Traditional competitive CS (port 27015)
- **Deathmatch** - CSDM-style respawn gameplay (port 27016) 
- **Gun Game** - Gun Game progression mode (port 27017)

## Quick Start

### Building Server Images

Build all three server types:
```bash
# Classic Server
SERVER_TYPE=classic docker-compose build

# Deathmatch Server  
SERVER_TYPE=deathmatch docker-compose build

# Gun Game Server
SERVER_TYPE=gungame docker-compose build
```

### Running Servers

Start any server type with environment variables:
```bash
# Classic Server (port 27015)
SERVER_TYPE=classic CS_SERVER_PORT=27015 RCON_PASSWORD=yoursecret docker-compose up -d

# Deathmatch Server (port 27016)
SERVER_TYPE=deathmatch CS_SERVER_PORT=27016 RCON_PASSWORD=yoursecret docker-compose up -d

# Gun Game Server (port 27017)
SERVER_TYPE=gungame CS_SERVER_PORT=27017 RCON_PASSWORD=yoursecret docker-compose up -d
```

### Managing Servers

```bash
# View server logs
docker logs cs-server-classic
docker logs cs-server-deathmatch
docker logs cs-server-gungame

# Stop servers
docker-compose down

# Rebuild after config changes
SERVER_TYPE=deathmatch docker-compose build
SERVER_TYPE=deathmatch CS_SERVER_PORT=27016 docker-compose up -d
```

## Architecture

### Directory Structure
```
cs-server/
├── shared/                 # Shared assets for all servers
│   ├── wads/              # WAD texture files (103 files)
│   ├── maps/              # Map files (251 .bsp files)
│   ├── sound/             # Sound assets (448 files)
│   ├── models/            # 3D models (294 files)
│   ├── sprites/           # Sprite graphics (133 files)
│   ├── resources/         # Resource files
│   ├── overviews/         # Map overview images
│   ├── addons/            # AMX Mod X framework
│   ├── reunion.cfg        # Reunion anti-cheat config
│   └── motd.txt           # Message of the day
├── classic/               # Classic server configs
│   ├── server.cfg         # Classic game settings
│   ├── mapcycle.txt       # Classic map rotation
│   └── addons/            # Classic-specific plugins
├── deathmatch/            # Deathmatch server configs
│   ├── server.cfg         # CSDM game settings
│   ├── mapcycle.txt       # Deathmatch map rotation
│   └── addons/            # CSDM plugins
└── gungame/               # Gun Game server configs
    ├── server.cfg         # Gun Game settings
    ├── mapcycle.txt       # Gun Game map rotation
    └── addons/            # Gun Game plugins
```

### Build Process
1. **Shared Layer**: Base AMX Mod X + all game assets copied into image
2. **Server-Specific Layer**: Server type configs overwrite shared defaults
3. **Runtime**: Environment variables (RCON_PASSWORD) substituted at startup

### Port Configuration
- **Classic**: 27015 (default CS port)
- **Deathmatch**: 27016 
- **Gun Game**: 27017

## Environment Variables

Set these in your `.env.local` file or pass directly:

```bash
# Required
RCON_PASSWORD=your_secure_password_here
SERVER_TYPE=classic|deathmatch|gungame
CS_SERVER_PORT=27015|27016|27017

# Optional
CS_SERVER_MAXPLAYERS=16
CS_SERVER_MAP=de_dust2
```

## Server Discovery

Servers are auto-discovered by the web client via the Go WebRTC server's API:
- `GET http://localhost:8080/api/servers`
- Shows online servers with player counts and current maps

## Plugin Configuration

Each server type has its own `plugins.ini` configuration that loads appropriate plugins.

### Classic Server
- Standard AMX Mod X admin plugins
- Map voting and rotation
- Competitive game settings
- Traditional CS rules

### Deathmatch Server  
- Configured for CSDM-style gameplay (basic setup)
- Administrative plugins for server management
- **For full CSDM functionality**: 
  1. Download `csdm.amxx` from [AlliedModders CSDM Forum](https://forums.alliedmods.net/showthread.php?t=47306)
  2. Place in `deathmatch/addons/amxmodx/plugins/`
  3. Uncomment `csdm.amxx` line in `deathmatch/plugins.ini`
  4. Rebuild: `SERVER_TYPE=deathmatch docker-compose build`
  5. **Weapon config**: Pre-configured in `deathmatch/addons/amxmodx/configs/csdm.cfg`

### Gun Game Server
- Configured for Gun Game progression (basic setup)
- Administrative plugins for server management
- **For full Gun Game functionality**:
  1. Download `gungame.amxx` from [AlliedModders Gun Game Forum](https://forums.alliedmods.net/showthread.php?t=93977)
  2. Place in `gungame/addons/amxmodx/plugins/`
  3. Uncomment `gungame.amxx` line in `gungame/plugins.ini`
  4. Rebuild: `SERVER_TYPE=gungame docker-compose build`
  5. **Weapon progression**: Pre-configured in `gungame/addons/amxmodx/configs/gungame.cfg`

### Plugin Installation Notes
- **Shared plugins** (admin tools) are in `shared/addons/amxmodx/plugins/`
- **Server-specific plugins** go in `[servertype]/addons/amxmodx/plugins/`
- **Server-specific configs** go in `[servertype]/addons/amxmodx/configs/`
- **Plugin lists** are in `[servertype]/plugins.ini`
- **Example**: CSDM plugin goes in `deathmatch/addons/amxmodx/plugins/csdm.amxx`

## Troubleshooting

### Server Won't Start
```bash
# Check logs for errors
docker logs cs-server-[type]

# Verify port availability
netstat -tulpn | grep 2701[567]
```

### RCON Not Working
- Verify RCON_PASSWORD environment variable is set
- Check server logs for substitution confirmation: `✅ RCON password configured`

### Map Issues
- All mapcycle entries validated against actual .bsp files in `shared/maps/`
- Custom maps automatically included from Steam installation

## Development

### Adding New Server Types
1. Create new directory: `newtype/`
2. Add `server.cfg` and `mapcycle.txt`
3. Build: `SERVER_TYPE=newtype docker-compose build`

### Updating Game Assets
1. Modify files in `shared/` directories
2. Rebuild: `SERVER_TYPE=classic docker-compose build` (rebuilds for all types)
3. Assets are baked into image for consistency

---
*Built with Docker 🐳 | Powered by AMX Mod X 🔧 | CS 1.6 Forever 🎮*