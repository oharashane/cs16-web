# CS1.6 WebRTC Relay System

A modern web-based Counter-Strike 1.6 experience using WebRTC for real-time game communication.

## 🎯 Features

- **Real-time CS1.6 Server Browser** - Live server discovery with player counts and maps
- **WebRTC Game Relay** - Browser-to-game server communication via WebRTC DataChannels  
- **Xash3D Web Client** - Full CS1.6 engine running in browser via WebAssembly
- **Comprehensive Monitoring** - Prometheus metrics and debug tools
- **Dockerized Architecture** - Clean separation of web relay and game server

## 🏗️ Architecture

```
Browser Client (WebRTC) 
    ↓ DataChannels
Go WebRTC Server :8080
    ↓ HTTP/WebSocket  
Python Relay :3000
    ↓ UDP
CS1.6 ReHLDS Server :27015
```

## 🚀 Quick Start

1. **Build and Start**
   ```bash
   cd cs16-webrtc
   ./scripts/build.sh
   ```

2. **Access Dashboard**
   - Open http://localhost:8080
   - Browse available CS1.6 servers
   - Click "Join" to launch Xash client

3. **Monitor System**
   - Debug tools: Built into dashboard
   - Metrics: http://localhost:3000/metrics
   - Logs: `docker-compose logs -f`

## 📁 Project Structure

```
cs16-webrtc/
├── services/
│   ├── web-relay/          # WebRTC relay service
│   │   ├── src/go/         # Go WebRTC server
│   │   ├── src/python/     # Python relay API
│   │   └── web/            # Dashboard + Xash client
│   └── cs16-server/        # CS1.6 ReHLDS server
├── scripts/                # Build/management scripts
├── docs/                   # All planning documentation
└── docker-compose.yml     # Main orchestration
```

## 🔧 Management

- **Start**: `./scripts/build.sh`
- **Stop**: `docker-compose down`
- **Clean**: `./scripts/clean.sh`
- **Logs**: `docker-compose logs -f [service]`

## 📊 Monitoring

The system includes comprehensive monitoring:
- **Pipeline Tests**: Verify packet flow through entire system
- **Server Discovery**: Real-time CS1.6 server scanning
- **Metrics**: Prometheus-compatible metrics for packet counts
- **Debug Console**: Integrated debugging tools

## 🎮 Gameplay

1. Start system with `./scripts/build.sh`
2. Open dashboard at http://localhost:8080
3. Wait for server discovery (automatic)
4. Click "Join" on any online server
5. Xash client opens in new tab with auto-connect

## 🧪 Testing

The dashboard includes a "Run Debug Suite" that tests:
- Basic connectivity (HTTP/UDP)
- WebRTC pipeline functionality  
- Packet flow metrics
- CS1.6 server queries

## 🏆 Status

**Current State**: Infrastructure Complete, Client Integration In Progress
- ✅ CS1.6 server browser with real-time data
- ✅ Proven packet pipeline (Go ↔ Python ↔ ReHLDS)
- ✅ WASM client loading fixed
- 🔄 End-to-end game testing in progress

See `docs/PLAN C 9 FALSE SUMMIT.md` for detailed progress documentation.