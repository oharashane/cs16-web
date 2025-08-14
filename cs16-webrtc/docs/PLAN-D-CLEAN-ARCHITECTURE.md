# PLAN D: Clean Architecture Proposal

## Current Problems
- Multiple overlapping directories (`go-webrtc-server/`, `relay/`, `web-client/`, `yohimik-client/`)
- Scattered Docker files (`Dockerfile`, `Dockerfile.debug`, multiple `docker-compose.yml`)
- Duplicate/obsolete files across directories
- No clear separation between web server and CS1.6 server concerns

## Proposed Clean Structure

```
cs16-webrtc/
├── docs/                           # All planning docs
│   ├── PLAN-A-STATUS.md
│   ├── PLAN-B.md  
│   ├── PLAN-C-*.md
│   └── README.md
├── services/
│   ├── web-relay/                  # WebRTC relay service
│   │   ├── Dockerfile
│   │   ├── docker-compose.yml
│   │   ├── src/
│   │   │   ├── go/                 # Go WebRTC server
│   │   │   │   ├── main.go
│   │   │   │   ├── sfu.go
│   │   │   │   └── go.mod
│   │   │   └── python/             # Python relay API
│   │   │       ├── relay_server.py
│   │   │       └── requirements.txt
│   │   └── web/                    # Web assets
│   │       ├── dashboard.html
│   │       └── client/             # Xash client files
│   │           ├── index.html
│   │           ├── assets/
│   │           └── rwdir/
│   └── cs16-server/                # CS1.6 game server
│       ├── Dockerfile
│       ├── docker-compose.yml
│       ├── rehlds/                 # ReHLDS server
│       ├── maps/
│       ├── configs/
│       └── addons/
├── scripts/                        # Build/deploy scripts
│   ├── build.sh
│   ├── start.sh
│   └── clean.sh
└── docker-compose.yml              # Main orchestration
```

## Benefits
1. **Clear separation**: Web relay vs CS1.6 server
2. **Single Docker composition**: One main `docker-compose.yml`
3. **Logical grouping**: Related files together
4. **Easy deployment**: Simple build/start scripts
5. **Clean docs**: All planning in one place

## Implementation Steps
1. Create new structure
2. Move working files to correct locations
3. Update Docker configurations
4. Test functionality
5. Remove obsolete files