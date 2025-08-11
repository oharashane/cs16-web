# PLAN — Browser CS1.6 with WebRTC Transport Layer

## Goal
Run a browser-based CS 1.6 client with a **custom WebRTC transport layer** integrated directly into the xash3d-fwgs engine. The client connects to real ReHLDS servers through a WebRTC→UDP relay, providing seamless browser gameplay without JavaScript networking hacks.

## ✅ **Implementation Status: COMPLETE**
- **✅ WebRTC Transport Layer** — Clean C implementation in engine  
- **✅ Transport Abstraction** — Pluggable system with UDP fallback
- **✅ JavaScript Bridge** — Emscripten library for DataChannel integration
- **✅ Engine Integration** — Modified NET_SendPacketEx/NET_GetPacket
- **✅ Build System** — Automated WebRTC flags and library linking
- **✅ E2E Testing** — Local test environment with relay + ReHLDS

## Architecture
- **Client (WASM)** served via Caddy at `https://relay.example.com/client/`.
- **Relay (Python aiortc + FastAPI)** exposes `/signal` for WebRTC, bridges DataChannel↔UDP.
- **WireGuard** tunnel from Droplet→home LAN; relay targets game server via WG IP.
- **ReHLDS** runs on home machine (or local test) via Docker, ports 27015/27016, host networking.

## 🔄 **WebRTC Transport Flow**
1) **Player** opens client: `/client/?signal=wss://relay.../signal&host=10.13.13.2&port=27015&transport=webrtc`
2) **WebRTC Signaling** — `bootstrap.js` establishes DataChannel via `/signal` endpoint
3) **Engine Initialization** — `webrtc_init()` switches from UDP to WebRTC transport
4) **Game Networking** — `NET_SendPacketEx()` → WebRTC transport → DataChannel → Relay
5) **Packet Bridge** — Relay forwards DataChannel ↔ UDP (WireGuard IP:port)
6) **Incoming Data** — UDP → DataChannel → `webrtc_push()` → Engine packet queue

## 🏗️ **Technical Implementation**

### Engine Transport Layer
```c
// net_transport.h - Transport abstraction
typedef struct net_transport_s {
    int (*init)(void);
    void (*shutdown)(void);
    int (*send)(const uint8_t *buf, int len, const netadr_t *to);
    int (*poll)(void);
    int (*recv)(uint8_t *buf, int maxlen, netadr_t *from);
    const char *name;
} net_transport_t;
```

### WebRTC Implementation  
- **`net_transport_webrtc.c`** — Ring buffer, packet queue, C exports for JS
- **`library_webrtc.js`** — Emscripten bridge, DataChannel send/receive
- **Build Integration** — Automatic flags: `EXPORT_TABLE`, `EXPORTED_RUNTIME_METHODS`

### JavaScript Integration
```javascript
// bootstrap.js - Clean DataChannel integration
dc.onmessage = (e) => {
  const buf = new Uint8Array(e.data);
  const ptr = Module._malloc(buf.length);
  Module.HEAPU8.set(buf, ptr);
  Module.ccall('webrtc_push', null, ['number', 'number'], [ptr, buf.length]);
  Module._free(ptr);
};
```

## 📦 **Deliverables (COMPLETE)**
- **✅ `client/`** — WebRTC-enabled client with clean bootstrap integration
- **✅ `client/library_webrtc.js`** — Emscripten JavaScript bridge for DataChannel
- **✅ `xash3d-fwgs/`** — Modified engine submodule with WebRTC transport layer
- **✅ `relay/`** — aiortc FastAPI with `/signal`, `/metrics` and UDP bridge
- **✅ `server/rehlds/`** — Docker configs for CS servers (27015/27016)
- **✅ `local-test/`** — Complete E2E test environment (relay + ReHLDS)
- **✅ `docker-compose.yml`** — Production deployment (Caddy, WireGuard, Relay)
- **✅ `scripts/`** — DigitalOcean provisioning and deployment automation

## 🚀 **Ready to Use**

### Quick Start (Local Testing)
```bash
# Start E2E environment
docker compose -f local-test/docker-compose.yml up -d --build

# Start client
cd client && npm run dev

# Open browser
http://localhost:5174/?signal=ws://localhost:8090/signal&host=127.0.0.1&port=27015&transport=webrtc
```

### Production Deployment
```bash
# Configure environment
cp .env.example .env  # Edit with your domain/WG settings

# Deploy to DigitalOcean
./scripts/deploy.sh

# Access client
https://YOUR_DOMAIN/client/?signal=wss://YOUR_DOMAIN/signal&host=10.13.13.2&port=27015&transport=webrtc
```

### Building Custom Engine
```bash
# Clone with engine submodule
git clone --recursive https://github.com/oharashane/cs16-web.git

# Build WebRTC-enabled engine
cd xash3d-fwgs
./waf configure --build-tests --enable-all-renderers  
./waf build
```

## 🏆 **Achievement: Zero-Compromise Browser Gaming**
- **Native performance** with clean C implementation
- **Full compatibility** with existing Half-Life mods
- **Professional architecture** using transport abstraction
- **Production ready** with complete deployment automation
