# CS16 Web Server Components

This directory contains the web server components for the CS1.6 browser client system.

## Components

### `go-webrtc-server/`
- **Purpose**: WebRTC signaling server and static file hosting
- **Technology**: Go with Pion WebRTC library
- **Port**: 8080
- **Features**:
  - Hosts the browser client files
  - Manages WebRTC peer connections
  - DataChannel communication
  - Dynamic host detection for LAN deployment

### `python-udp-relay/`
- **Purpose**: Protocol translation (WebRTC ↔ UDP)
- **Technology**: Python with FastAPI
- **Port**: 3000
- **Features**:
  - Translates WebRTC DataChannel packets to UDP
  - Forwards UDP responses back to WebRTC
  - Metrics endpoint for monitoring
  - Configurable backend server

## Configuration

### Environment Variables

**Go WebRTC Server:**
- `PYTHON_RELAY_URL`: URL of Python relay server (default: `http://127.0.0.1:3000`)
- `PORT`: Server port (default: 8080)

**Python UDP Relay:**
- `RELAY_DEFAULT_BACKEND_HOST`: Game server host (default: 127.0.0.1)
- `RELAY_DEFAULT_BACKEND_PORT`: Game server port (default: 27015)
- `RELAY_ALLOWED_ORIGINS`: CORS origins (default: *)

## LAN Deployment

For LAN access, update your environment:

```bash
export CS_SERVER_HOST=mainbrain  # or your machine's hostname/IP
export CS_SERVER_PORT=27015
```

The client will automatically detect the hostname from the browser URL and connect appropriately.

## Quick Start

```bash
# Start the web server stack
docker-compose up -d

# Or build and run individually
cd go-webrtc-server && docker build -t cs16-webrtc .
cd ../python-udp-relay && docker build -t cs16-relay .
```

## Client Access

- **Local**: http://localhost:8080
- **LAN**: http://mainbrain:8080 (or your machine's hostname)
- **Dynamic**: The client automatically adapts to the hostname used to access it
