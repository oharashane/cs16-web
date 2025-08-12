# CS1.6 Web — Browser Client with WebRTC Transport

This repository hosts a **browser-based Counter-Strike 1.6 client** using the **yohimik WebAssembly engine** with a **unified WebRTC relay server**. The system enables browser-based Counter-Strike 1.6 gameplay connecting to ReHLDS servers through WebRTC DataChannel transport.

## 🚀 **Key Features**
- **Browser Counter-Strike 1.6** — Complete WebAssembly-based game client
- **WebRTC Transport** — Server-initiated handshake with DataChannel communication
- **Unified Server** — Single container hosting both client and relay functionality
- **ReHLDS Compatible** — Works with existing Half-Life Dedicated Servers

## 🎯 **Quick Start**

### 1. Start the unified CS1.6 web server:
```bash
cd relay
docker build -f Dockerfile.unified -t cs16-unified .
docker run -d -p 8090:8090 --name cs16-unified cs16-unified
```

### 2. Start the ReHLDS game server:
```bash
cd server/rehlds
docker-compose up -d cs16_pub
```

### 3. Play in browser:
Open **http://localhost:8090/** and click START to begin playing Counter-Strike 1.6 in your browser!

**Port Assignment:**
- **8090**: Unified server (client files + WebRTC relay)
- **27015**: ReHLDS game server (UDP)

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

### Server Logs
Monitor the unified server for WebRTC handshake details:

```bash
docker logs -f cs16-unified
```

### Game Server Logs
Check ReHLDS server status:

```bash
docker logs cs16_pub
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