# CS1.6 Web — Browser Client with WebRTC Transport

This repository hosts a **browser-based Counter-Strike 1.6 client** using the **yohimik WebAssembly engine** with a **web-server container** that handles WebRTC transport. The system enables browser-based Counter-Strike 1.6 gameplay connecting to ReHLDS servers through WebRTC DataChannel transport.

## 🚀 **Key Features**
- **Browser Counter-Strike 1.6** — Complete WebAssembly-based game client
- **WebRTC Transport** — Server-initiated handshake with DataChannel communication
- **Web Server** — Single container hosting client, WebRTC server, and UDP relay
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
```

### 2. **Start CS Game Server**

```bash
cd cs-server
./setup.sh                    # Generates server.cfg with your RCON password
docker-compose up -d cs-server
```

### 3. **Start Web Server**

```bash
cd ../web-server
docker-compose up -d web-server
```

### 4. **Play in Browser**

- **Dashboard**: http://localhost:8080/
- **Direct Client**: http://localhost:8080/client
- Browse available servers and click to connect!

**Port Assignment:**
- **8080**: Web server (dashboard + client files + WebRTC server)
- **3000**: UDP relay (internal, proxied through web server)
- **27015**: Counter-Strike game server (UDP)

## 🏗️ **Architecture**

The system consists of two main components:

### Web Server (`web-server/`)
- **Go WebRTC Server**: Handles WebRTC signaling and serves static files
- **Python UDP Relay**: Bridges WebRTC DataChannels ↔ UDP game traffic  
- **Browser Client**: WebAssembly CS1.6 client (from yohimik project)
- **Dashboard**: Server browser and connection interface
- **Single Container**: Multi-process container managed by supervisord

### CS Game Server (`cs-server/`)
- **timoxo/cs1.6 Image**: ReHLDS-based Counter-Strike 1.6 server
- **AMX Mod X**: Full plugin support with admin features
- **Custom Maps**: Includes popular community maps
- **Environment-Driven**: RCON password and settings via .env files

## 🔧 **Technical Implementation**

### WebRTC Protocol Flow
1. **Client Connection**: Browser connects to WebSocket at `/websocket`
2. **Server Offer**: Relay creates and sends WebRTC offer to client
3. **Client Answer**: Browser responds with WebRTC answer
4. **DataChannel Setup**: Two channels created (`read` and `write`)
5. **Game Traffic**: UDP packets bridged through DataChannels

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
├── web-server/              # Web server container
│   ├── docker-compose.yml   # Web server deployment
│   ├── Dockerfile           # Multi-process container build
│   ├── supervisord.conf     # Process manager config
│   ├── go-webrtc-server/    # Go WebRTC signaling server
│   │   ├── *.go             # Go source files
│   │   ├── dashboard.html   # Server browser interface
│   │   └── client/          # WebAssembly CS1.6 client
│   │       ├── index.html   # Game client page
│   │       └── assets/      # WASM game engine files
│   └── python-udp-relay/    # Python UDP bridge
│       ├── udp_relay.py     # Main relay server
│       └── requirements.txt # Python dependencies
├── cs-server/               # CS game server
│   ├── docker-compose.yml   # Game server deployment
│   ├── setup.sh             # Config generation script
│   ├── server.cfg.template  # Server config template
│   ├── addons/              # AMX Mod X plugins
│   └── maps/                # Game maps
└── docs/                    # Project documentation
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

## 📝 **Notes**
- **WebRTC DataChannel** provides reliable packet delivery over DTLS
- **Server-initiated handshake** required for yohimik client compatibility  
- **Unified architecture** simplifies deployment and management
- **ReHLDS compatibility** enables existing CS1.6 server configurations
- **Browser gameplay** works without plugins or additional software

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
- **Protocol Bridge**: WebRTC DataChannel ↔ UDP packet translation
- **Memory Management Fixes**: Resolved WASM ArrayBuffer detachment issues  
- **Server Architecture**: Unified deployment with Docker containerization
- **Network Transport**: Go-based WebRTC server with Python UDP relay

## 📄 **License**

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.

The project includes components from various open-source projects, each maintaining their respective licenses. See LICENSE.md for full attribution details.