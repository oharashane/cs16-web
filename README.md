# CS1.6 Web — Browser Client with WebRTC Transport

This repository hosts a **browser-based Counter-Strike 1.6 client** using the **yohimik WebAssembly engine** with a **web-server container** that handles WebRTC transport. The system enables browser-based Counter-Strike 1.6 gameplay connecting to ReHLDS servers through WebRTC DataChannel transport.

## 🚀 **Key Features**
- **Browser Counter-Strike 1.6** — Complete WebAssembly-based game client
- **WebRTC Transport** — Server-initiated handshake with DataChannel communication
- **Web Server** — Single container hosting client, WebRTC server, and UDP relay
- **ReHLDS Compatible** — Works with existing Half-Life Dedicated Servers

## 🎯 **Quick Start**

### Quick Start

1. **Start the web server:**
```bash
docker-compose up -d web-server
```

2. **Start the CS server:**
```bash
cd cs-server
docker-compose up -d cs-server
```

3. **Play in browser:**
   - Open **http://localhost:8080/**
   - Browse available servers on the dashboard
   - Click on a server to start playing

**Port Assignment:**
- **8080**: Web server (dashboard + client files + WebRTC server)
- **3000**: UDP relay (internal, proxied through web server)
- **27015**: Counter-Strike game server (UDP)

## 🏗️ **Architecture**

The system consists of two main components:

### Unified Web Server (`relay/unified_server.py`)
- **Static File Serving**: Hosts yohimik client HTML/JS/WASM files
- **WebRTC Relay**: Provides server-initiated WebRTC handshake
- **DataChannel Bridge**: Forwards game traffic between browser and ReHLDS server
- **Single Container**: Everything needed for browser CS1.6 in one service

### ReHLDS Game Server (`server/rehlds/`)
- **Standard CS1.6 Server**: Uses ReHLDS for game logic
- **AMX Mod X**: Full plugin support with admin features
- **Custom Maps**: Includes popular community maps
- **Docker Deployment**: Easy setup with docker-compose

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
├── relay/
│   ├── unified_server.py      # Main server (client + relay)
│   ├── Dockerfile.unified     # Container build file
│   └── requirements.txt       # Python dependencies
├── yohimik-client/           # WebAssembly CS1.6 client files
│   ├── index.html           # Main client page
│   ├── assets/              # Game engine WASM files
│   └── valve.zip            # Game assets
├── server/rehlds/           # ReHLDS game server
│   ├── docker-compose.yml   # Server deployment
│   ├── server.cfg           # Game configuration
│   ├── maps/                # Game maps
│   └── addons/              # AMX Mod X plugins
└── debug_webrtc.py         # WebRTC debugging tool
```

## 🔬 **Development & Debugging**

### WebRTC Debugging Tool
Use the included CLI tool to test WebRTC connections:

```bash
python3 debug_webrtc.py --test-relay ws://localhost:8090/websocket
```

### Monitor WebRTC Traffic
Check packet flow metrics in real-time:

```bash
curl http://localhost:8090/metrics | grep pkt_
```

Expected output when working:
```
pkt_to_udp_total 15.0  # Client → Server packets
pkt_to_dc_total 23.0   # Server → Client packets
```

### Server Logs
Monitor the unified server for WebRTC handshake details:

```bash
docker logs -f cs16-unified-new
```

### Game Server Logs
Check game server status:

```bash
docker logs yohimik-complete    # Current setup
# OR
docker logs cs16_pub           # If using docker-compose
```

### Debug WebRTC Connection
Watch detailed packet flow:

```bash
docker logs -f cs16-unified-new | grep -E "(RELAY|DC->UDP|UDP->DC)"
```

## 🚧 **Current Status & Next Steps**

### ✅ **What's Working**
- ✅ **Unified server** hosting client + relay on port 8090
- ✅ **WebRTC handshake** completes successfully (server-initiated)
- ✅ **DataChannels** established (`read` and `write`)
- ✅ **Browser client** loads and connects to WebSocket
- ✅ **Game server** running and accessible

### ⚠️ **What Needs Completion**

#### 1. Console Access 🎯 **HIGH PRIORITY**
**Issue**: Cannot access developer console (~) in browser client  
**Need**: Enable console to run `connect 127.0.0.1:27015`  
**Status**: Console commands blocked in current client build

#### 2. Auto-Connection Alternative
**Options**:
- Modify client to auto-connect to server on startup
- Add "Connect to Server" button in web UI
- Enable console access for manual commands

#### 3. Packet Flow Verification
**Current**: Metrics show `pkt_to_udp_total: 0.0` and `pkt_to_dc_total: 0.0`  
**Need**: Verify game traffic flows through WebRTC DataChannels  
**Debug**: Server has detailed packet logging ready

### 🔧 **How to Complete**

1. **Enable Console** (preferred):
   - Find yohimik client console configuration
   - Add `-developer 1` or similar startup parameter
   - Test `connect 127.0.0.1:27015` command

2. **Alternative - Auto-connect**:
   - Modify unified server to inject auto-connect command
   - Update client startup parameters

3. **Test End-to-End**:
   - Verify packets flow (metrics should show > 0)
   - Confirm browser client joins game server
   - Test actual gameplay

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