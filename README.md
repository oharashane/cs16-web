# CS1.6 Web — Browser Client with WebRTC Transport

This repository hosts a **browser-based Counter-Strike 1.6 client** with a **custom WebRTC transport layer** and a **WebRTC→UDP relay**. It includes a **modified xash3d-fwgs engine** with WebRTC DataChannel networking for seamless browser gameplay.

## 🚀 **Key Features**
- **WebRTC Transport Layer** — Custom C implementation in the engine for browser networking
- **Clean Architecture** — Transport abstraction layer with UDP fallback for native builds  
- **Zero JavaScript Hacks** — Proper C-level integration, no runtime patching
- **Full Compatibility** — Works with existing Half-Life mods and ReHLDS servers

## What's included
- `client/` — static web client with WebRTC transport integration
- `client/library_webrtc.js` — Emscripten JavaScript bridge for DataChannel communication
- `xash3d-fwgs/` — **modified engine submodule** with WebRTC transport layer
- `relay/` — Python **aiortc** relay (FastAPI, `/signal`, `/metrics`)
- `server/rehlds/` — ReHLDS servers (27015/27016) for testing
- `local-test/` — **complete E2E test setup** (relay + ReHLDS on one machine)
- `docker-compose.yml` — Production deployment (Caddy, WireGuard, Relay)
- `scripts/` — DigitalOcean droplet bootstrap and deployment helpers

## 🔧 **Building the WebRTC Engine**

The engine uses a **git submodule** pointing to our fork with WebRTC transport layer:

### Prerequisites
```bash
# Install Emscripten (for WebAssembly builds)
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

### Build Steps
```bash
# Clone with submodules
git clone --recursive https://github.com/oharashane/cs16-web.git
cd cs16-web

# Build the engine with WebRTC transport
cd xash3d-fwgs
./waf configure --build-tests --enable-all-renderers
./waf build

# The build includes:
# - WebRTC transport layer (net_transport_webrtc.c)
# - JavaScript library bridge (library_webrtc.js)
# - Emscripten exports for DataChannel integration
```

### Transport Layer Files
- `engine/common/net_transport.h` — Transport interface
- `engine/common/net_transport.c` — UDP transport implementation  
- `engine/common/net_transport_webrtc.c` — WebRTC DataChannel transport
- `engine/common/net_ws.c` — Modified to use transport layer
- `engine/wscript` — Build configuration with WebRTC flags

## ⚡ **Quick start (local E2E)**
1. Start services: `docker compose -f local-test/docker-compose.yml up -d --build`
2. Start client dev server: `cd client && npm install && npm run dev`
3. Open web client: `http://localhost:5174/?signal=ws://localhost:8090/signal&host=127.0.0.1&port=27015&transport=webrtc`
4. Steam client: open console and run `connect 127.0.0.1:27015`

## Quick start (Droplet prod)
1. Copy `.env.example` → `.env` and edit values (`DOMAIN`, backend WG subnet, default host/port).
2. Provision a Droplet (SFO3 recommended). Add DNS A record (Cloudflare OK for HTTPS only).
3. Put your WireGuard **peer** as `./wg/wg0.conf` (see `scripts/generate_wireguard_keys.sh`).
4. SSH to the droplet and run `./scripts/deploy.sh`.
5. Deep-link to join:
```
https://YOUR_DOMAIN/client/?signal=wss://YOUR_DOMAIN/signal&host=10.13.13.2&port=27015&token=YOURTOKEN&transport=webrtc
```

## 🏗️ **Submodule Workflow**

This repository uses a **git submodule** for the modified engine:

```bash
# Working with submodules
git clone --recursive https://github.com/oharashane/cs16-web.git

# If already cloned without --recursive:
git submodule update --init --recursive

# Update submodule to latest:
cd xash3d-fwgs
git pull origin master
cd ..
git add xash3d-fwgs
git commit -m "Update engine submodule"
```

**Engine Fork**: [https://github.com/oharashane/xash3d-fwgs](https://github.com/oharashane/xash3d-fwgs)  
**Original Engine**: [https://github.com/FWGS/xash3d-fwgs](https://github.com/FWGS/xash3d-fwgs)

## 🔬 **Technical Details**

### WebRTC Transport Architecture
- **`NET_SendPacketEx()`** → Transport layer → WebRTC DataChannel
- **`NET_GetPacket()`** → Transport layer → Queued DC packets
- **Browser-native** — No complex JS interception or runtime patching
- **Backward compatible** — UDP transport used on native platforms

### Key Components
1. **Transport Interface** (`net_transport.h`) — Pluggable transport system
2. **WebRTC Implementation** (`net_transport_webrtc.c`) — DataChannel bridge with packet queue
3. **JavaScript Bridge** (`library_webrtc.js`) — Emscripten library for DC communication
4. **Engine Integration** — Clean modifications to existing networking code

### Emscripten Build Flags
- `-sEXPORT_TABLE=1` — Export WebAssembly function table
- `-sALLOW_TABLE_GROWTH=1` — Enable table growth for addFunction
- `-sEXPORTED_RUNTIME_METHODS` — Export ccall, cwrap, addFunction, removeFunction
- `--js-library library_webrtc.js` — Include WebRTC JavaScript bridge

## 📝 **Notes**
- **WebRTC DataChannel** provides reliable, ordered packet delivery over DTLS
- **WireGuard tunnel** removes the need for TURN servers in most cases
- **WebSocket fallback** can be added for UDP-hostile networks
- **Mods (AMX/CSDM)** are server-side; complex client plugins may need WASM consideration
- **Performance** — WebRTC adds ~5-10ms latency vs direct UDP but enables browser access
