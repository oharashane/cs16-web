# CS1.6 Web — Multi-Server Browser Client with WebRTC Transport

This repository hosts a **browser-based Counter-Strike 1.6 client** using the **yohimik WebAssembly engine** with an **enhanced Go WebRTC server** that supports multiple CS servers simultaneously. The system enables browser-based Counter-Strike 1.6 gameplay connecting to multiple ReHLDS servers through WebRTC DataChannel transport with dynamic server discovery.

## 🚀 **Key Features**
- **Browser Counter-Strike 1.6** — Complete WebAssembly-based game client
- **Multi-Server Support** — Automatic discovery and connection to multiple CS servers
- **WebRTC Transport** — Server-initiated handshake with DataChannel communication  
- **Enhanced Go Server** — Single container with integrated UDP relay and server discovery
- **Dynamic Port Management** — Automatic WebRTC server creation for discovered CS servers
- **VPS Ready** — Production deployment configurations for cloud hosting
- **ReHLDS Compatible** — Works with existing Half-Life Dedicated Servers

## 🎯 **Quick Start**

### 1. **Environment Setup**

Copy and configure your environment:
```bash
# Copy the template
cp .env.example .env.local

# Edit your settings
nano .env.local
# Set CS_SERVER_HOST=mainbrain (or your machine's hostname/IP)
# Set RCON_PASSWORD=your_secure_password  
# Optionally set WEBRTC_HOST_IP if auto-detection fails
```

### 2. **Start CS Game Servers**

The system supports multiple CS servers running different game modes:

```bash
cd cs-server

# Start multiple servers for different game modes
./setup.sh                              # Generates server configs
docker-compose up -d cs-classic         # Classic CS (27015)
docker-compose up -d cs-deathmatch      # Deathmatch (27016) 
docker-compose up -d cs-gungame         # Gun Game (27017)

# Or start all servers at once
docker-compose up -d

# Verify servers are running
docker logs cs-classic | tail -10
curl -s localhost:8080/api/servers | jq .  # Check server discovery
```

**Multi-Server Setup:**
- **Port Range**: Servers can run on ports 27000-27030
- **Auto-Discovery**: Web server automatically detects online CS servers  
- **Game Modes**: Classic, Deathmatch, Gun Game supported
- **Dynamic WebRTC**: Each CS server gets its own WebRTC endpoint
- **Server Health**: Real-time monitoring and status tracking

### 3. **Start Web Server**

```bash
cd ../web-server
docker-compose up -d web-server
```

### 4. **Add Game Content**

The client needs game assets (maps, sounds, textures) from your legitimate CS 1.6 installation:

```bash
cd web-server/go-webrtc-server/client

# From Steam installation
./package-valve.sh ~/.steam/steamapps/common/Half-Life

# From standalone CS 1.6 installation  
./package-valve.sh /path/to/your/cs16

# Add custom maps to cs-server/maps/ then repackage
./package-valve.sh /path/to/cs16-with-custom-maps --force
```

### 5. **Play in Browser**

- **Dashboard**: http://localhost:8080/
- **Direct Client**: http://localhost:8080/client
- Browse available servers and click to connect!

**Port Assignment:**
- **8080**: Dashboard and API server
- **8000-8030**: Dynamic WebRTC servers (offset from CS server ports)
  - CS server 27015 → WebRTC server 8015
  - CS server 27016 → WebRTC server 8016  
  - CS server 27017 → WebRTC server 8017
- **27000-27030**: Counter-Strike game servers (UDP)

## 🏗️ **Architecture**

The system consists of two main components:

### Enhanced Web Server (`web-server/`)
- **Go WebRTC Server**: Handles WebRTC signaling, UDP relay, and server discovery
- **Multi-Port Architecture**: Dynamic WebRTC servers for each discovered CS server
- **Server Manager**: Automatic CS server discovery and health monitoring
- **Browser Client**: WebAssembly CS1.6 client (from yohimik project)
- **Dashboard**: Server browser with real-time server status
- **Single Container**: Pure Go implementation for performance and reliability

### CS Game Servers (`cs-server/`)
- **timoxo/cs1.6 Image**: ReHLDS-based Counter-Strike 1.6 servers
- **Multiple Game Modes**: Classic, Deathmatch, Gun Game configurations
- **AMX Mod X**: Full plugin support with admin features
- **Auto-Discovery**: Servers automatically appear in web dashboard
- **Port Range**: Supports 27000-27030 for unlimited server expansion

## 🔧 **Technical Implementation**

### Multi-Server Architecture

The Go server automatically discovers CS servers and creates dedicated WebRTC endpoints:

#### Port Mapping Strategy
```
CS Server Port → WebRTC Port
27015 → 8015    (Classic)
27016 → 8016    (Deathmatch)  
27017 → 8017    (Gun Game)
...
27030 → 8030    (Max range)
```

#### Discovery Process
1. **Scan Range**: Checks ports 27000-27030 every 3 seconds
2. **Server Query**: Uses CS1.6 protocol to get server info
3. **Dynamic Creation**: Starts WebRTC server on offset port
4. **Health Monitoring**: Removes offline servers automatically

### Server-Initiated Handshake
The yohimik client expects the **server to send the WebRTC offer first**, unlike standard WebRTC flows:

```javascript
// Client waits for server offer
{
  "event": "offer",
  "data": {
    "type": "offer", 
    "sdp": "v=0\r\no=- ..."
  }
}

// Client responds with answer
{
  "event": "answer",
  "data": {
    "type": "answer",
    "sdp": "v=0\r\no=- ..."
  }
}
```

## 📁 **Project Structure**

```
cs16-web/
├── .env.example              # Environment template (safe for git)
├── .env.local               # Your actual config (git ignored)
├── web-server/              # Enhanced web server container
│   ├── docker-compose.yml   # Local development deployment  
│   ├── docker-compose.vps.yml # VPS production deployment
│   ├── Dockerfile           # Single Go binary container
│   ├── go-webrtc-server/    # Enhanced Go WebRTC server
│   │   ├── *.go             # Go source files (server, discovery, relay)
│   │   ├── *_test.go        # Unit tests for multi-server functionality
│   │   ├── dashboard.html   # Enhanced server browser interface
│   │   └── client/          # WebAssembly CS1.6 client
│   │       ├── index.html   # Game client page  
│   │       ├── assets/      # WASM game engine files
│   │       └── MANUAL_MODIFICATIONS.md # Client modification docs
├── cs-server/               # Multi-server CS setup
│   ├── docker-compose.yml   # Multi-server deployment
│   ├── setup.sh             # Config generation script
│   ├── server.cfg.template  # Server config template
│   ├── addons/              # AMX Mod X plugins
│   └── maps/                # Game maps
└── docs/                    # Project documentation
    └── PLAN E 1 MULTISERVER.md # Architecture design document
```

## 🔬 **Development & Debugging**

### Built-in Debug Dashboard
The web server includes a comprehensive debug suite:

1. **Open the dashboard**: http://localhost:8080/
2. **Click "Debug & Testing"** 
3. **Run "Comprehensive Debug Suite"** - tests all components

### Monitor WebRTC Traffic
Check packet flow metrics in real-time:

```bash
curl http://localhost:8080/api/heartbeat    # Component status
curl http://localhost:8080/api/servers      # Server discovery  
curl http://localhost:3000/metrics          # Detailed metrics
```

### Container Logs
Monitor the services:

```bash
# Web server (Go + Python)
docker logs -f web-server

# CS game server
docker logs -f cs-server
```

### Environment Validation
Check your .env.local configuration:

```bash
# Verify environment variables are loaded
cd web-server && docker-compose config

# Check CS server setup
cd ../cs-server && ./setup.sh --dry-run
```

### Debug WebRTC Connection
Watch detailed packet flow:

```bash
# Monitor web server logs for WebRTC activity
docker logs -f web-server | grep -E "(WebRTC|DataChannel|UDP)"
```

## 🚀 **Production Deployment**

For VPS/cloud deployment, use the production configuration:

```bash
# Deploy with VPS-optimized settings
docker-compose -f docker-compose.vps.yml up -d
```

**Key Features:**
- **Secure Networking**: Bridge networking with container isolation
- **Port Range Support**: Full 8000-8030 WebRTC port range exposed  
- **Environment Flexibility**: Configurable for VPN or local CS servers
- **Production Ready**: Resource limits, logging, and monitoring

📖 **See `docs/PLAN E 1 MULTISERVER.md`** for detailed VPS deployment guide, networking configurations, and architecture options.

## ⚖️ **Legal & Content Notes**

### **Copyrighted Game Content**
This repository contains **NO copyrighted Valve content**. You must provide your own:
- **Game assets**: `valve.zip` (maps, sounds, textures, models)
- **Source**: Extract from your legitimate Steam/retail CS 1.6 installation
- **Server files**: Use your own CS 1.6 server files in `cs-server/`

### **What's Included (Legal)**
- ✅ **Open source code** - Go WebRTC server, Python UDP relay
- ✅ **yohimik WebAssembly engine** - MIT licensed browser client
- ✅ **Configuration templates** - Server configs, environment files
- ✅ **AMX Mod X plugins** - GPL licensed admin tools

**Personal Use**: This setup is intended for personal/private use with your legitimately owned CS 1.6 copy.

### **Game Content Setup Guide**

**Required Files:** You need `valve.zip` containing game assets from your legitimate CS 1.6 installation.

#### **Method 1: Use Our Packaging Script (Recommended)**
```bash
cd web-server/go-webrtc-server/client

# From Steam CS 1.6 installation
./package-valve.sh ~/.steam/steamapps/common/Half-Life

# From standalone CS 1.6 installation
./package-valve.sh /path/to/your/cs16

# With custom content (maps, sounds, etc.)
./package-valve.sh /path/to/cs16-with-custom-content --force

# Restart to use new content
cd ../../ && docker-compose restart web-server
```

#### **Method 2: Manual Setup**
If you already have `valve.zip`:
```bash
# Place your valve.zip in the client directory
cp /path/to/your/valve.zip web-server/go-webrtc-server/client/
```

#### **Adding Custom Maps**
1. Add `.bsp` files to `cs-server/maps/`
2. Add overview files to `cs-server/overviews/` 
3. Update `cs-server/mapcycle.txt`
4. Repackage with `./package-valve.sh --force` to include client-side map assets

## 📝 **Technical Notes**

### **Core Features**
- **Multi-Server Support**: Automatic discovery of CS servers on ports 27000-27030
- **Dynamic WebRTC**: Creates offset WebRTC ports (CS 27015 → WebRTC 8015)
- **Pure Go Implementation**: Single binary replacing hybrid Go+Python architecture
- **Server-Initiated WebRTC**: Custom handshake flow for yohimik client compatibility
- **Production Ready**: Both local development and VPS deployment configurations

## 🎮 **Game Features**
- **Full Counter-Strike 1.6** gameplay in browser
- **Multiplayer support** via ReHLDS server
- **Custom maps** and community content
- **Admin system** with AMX Mod X plugins
- **WebRTC transport** for browser networking

## 🙏 **Attribution & Credits**

This project builds upon several excellent open-source projects:

### **Core Components**
- **[yohimik's WebAssembly Xash3D Engine](https://github.com/yohimik/webxash3d-fwgs)** (MIT License)
  - Provides the WebAssembly Counter-Strike 1.6 client running in browsers
  - WebRTC transport implementation for browser-to-server communication
  - We use and extend the `examples/react-typescript-cs16-webrtc` components

### **Game Server Technology**
- **[ReHLDS](https://github.com/dreamstalker/rehlds)** (GPL License)
  - Modern reverse-engineered Half-Life Dedicated Server
- **[AMX Mod X](https://github.com/alliedmodders/amxmodx)** (GPL License)
  - Server administration and game modification framework

### **Our Contributions**
- **Multi-Server Architecture**: Enhanced Go server supporting multiple CS servers simultaneously  
- **Dynamic Server Discovery**: Automatic CS1.6 server detection and WebRTC endpoint creation
- **Protocol Bridge**: WebRTC DataChannel ↔ UDP packet translation with direct relay
- **Memory Management Fixes**: Resolved WASM ArrayBuffer detachment issues
- **VPS Deployment**: Production-ready Docker configurations with network isolation
- **Offset Port Strategy**: Elegant solution for WebRTC/CS server port conflict resolution
- **Client Modifications**: Dynamic server connection logic in compiled WebAssembly client

## 📄 **License**

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.

The project includes components from various open-source projects, each maintaining their respective licenses. See LICENSE.md for full attribution details.