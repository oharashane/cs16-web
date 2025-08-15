# PLAN D 1: MAKE IT AWESOMER 🚀

**Date**: August 15, 2025  
**Status**: 🎯 **PLANNING PHASE**  
**Objective**: Scale from localhost proof-of-concept to production-ready deployment

## 🎯 **Immediate Goals**

### **Phase 1: LAN Access** 
Enable other computers on the local network to connect to the web client

### **Phase 2: Cloud Deployment**
Deploy the complete stack to a VPS and connect to local ReHLDS server

## 🏗️ **Current Limitations**

### **Problem 1: Localhost-Only Configuration**
- All services bound to `127.0.0.1`
- WebRTC server only accessible from same machine
- No external network connectivity

### **Problem 2: Hardcoded Local Addresses**
- Docker containers using localhost internally
- Client trying to connect to localhost addresses
- No dynamic host configuration

## 📋 **Phase 1: LAN Deployment**

### **Step 1.1: Identify Network Configuration**
```bash
# Get current machine's LAN IP
hostname -I
ip route get 1.1.1.1
```

### **Step 1.2: Update Service Bindings**
**Go WebRTC Server** (`go-webrtc-server/sfu.go`):
```go
// Change from localhost to all interfaces
addr = ":8080"  // Already correct
```

**Python Relay Server** (`unified_server.py`):
```python
# Update uvicorn binding
uvicorn.run(APP, host="0.0.0.0", port=3000)  # Instead of 127.0.0.1
```

**Docker Compose** (`docker-compose.hybrid.yml`):
```yaml
environment:
  - RELAY_DEFAULT_BACKEND_HOST=<LAN_IP>  # Instead of 127.0.0.1
  - RELAY_DEFAULT_BACKEND_PORT=27015
```

### **Step 1.3: Client Access Method**
**Option A**: Update HTML to use LAN IP
```html
<!-- In client, update connection string -->
<script>
  const serverUrl = 'ws://<LAN_IP>:8080/websocket';
</script>
```

**Option B**: Dynamic discovery via environment variable
```javascript
const serverHost = window.location.hostname;
const serverUrl = `ws://${serverHost}:8080/websocket`;
```

### **Step 1.4: Firewall Configuration**
```bash
# Allow required ports on host machine
sudo ufw allow 8080/tcp  # Go WebRTC server
sudo ufw allow 3000/tcp  # Python API server
sudo ufw allow 27015/udp # ReHLDS server
```

### **Step 1.5: Testing from LAN**
```bash
# From another machine on LAN
curl http://<LAN_IP>:8080/client
curl http://<LAN_IP>:3000/metrics
```

## 📋 **Phase 2: Cloud VPS Deployment**

### **Architecture Overview**
```
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│   Internet Users    │    │     VPS (Cloud)     │    │  Home Network       │
│                     │    │                     │    │                     │
│  - Web Browsers     │◄──►│  - Xash Web Client  │    │  - ReHLDS Server    │
│  - Any Location     │    │  - Go WebRTC Server │    │  - Local Network    │
│                     │    │  - Python Relay     │    │  - Port 27015       │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
        HTTPS/WSS               Docker Container            WireGuard VPN
```

### **Step 2.1: VPS Provider Selection**
**Option A: DigitalOcean**
- Droplet: 2GB RAM, 1 vCPU ($12/month)
- Good for WebRTC (unrestricted UDP)
- Easy Docker deployment

**Option B: Hetzner**
- VPS: 4GB RAM, 2 vCPU (~$4/month)
- Excellent performance/price
- Good European latency

### **Step 2.2: WireGuard VPN Setup**
**Purpose**: Secure tunnel from VPS to home ReHLDS server

**Home Network Setup**:
```bash
# Install WireGuard on home router/server
sudo apt install wireguard

# Generate keys
wg genkey | tee privatekey | wg pubkey > publickey

# Configure /etc/wireguard/wg0.conf
[Interface]
PrivateKey = <HOME_PRIVATE_KEY>
Address = 10.0.0.1/24
ListenPort = 51820

[Peer]
PublicKey = <VPS_PUBLIC_KEY>
AllowedIPs = 10.0.0.2/32
```

**VPS Setup**:
```bash
# Configure VPS WireGuard
[Interface]
PrivateKey = <VPS_PRIVATE_KEY>
Address = 10.0.0.2/24

[Peer]
PublicKey = <HOME_PUBLIC_KEY>
Endpoint = <HOME_PUBLIC_IP>:51820
AllowedIPs = 10.0.0.1/32
```

### **Step 2.3: VPS Docker Deployment**
**Updated Docker Compose** (`docker-compose.cloud.yml`):
```yaml
version: '3.8'

services:
  cs16-webrtc-relay:
    build: .
    environment:
      - PORT=3000
      - CLIENT_DIR=/app/client
      - RELAY_DEFAULT_BACKEND_HOST=10.0.0.1  # WireGuard home IP
      - RELAY_DEFAULT_BACKEND_PORT=27015
      - PUBLIC_HOST=${PUBLIC_HOST}  # VPS public IP/domain
    ports:
      - "80:8080"    # HTTP
      - "443:8080"   # HTTPS (with reverse proxy)
      - "3000:3000"  # API
    restart: unless-stopped

networks:
  default:
    name: cs16-cloud-network
```

### **Step 2.4: HTTPS/WSS Setup**
**Nginx Reverse Proxy** (`nginx.conf`):
```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;
    
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    
    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### **Step 2.5: Domain & SSL**
```bash
# Get free domain (or use existing)
# - Cloudflare
# - No-IP dynamic DNS
# - FreeDNS

# Setup Let's Encrypt SSL
sudo certbot --nginx -d your-domain.com
```

## 🔧 **Configuration Changes Required**

### **Environment Variable Support**
```bash
# Add to start.sh
export BACKEND_HOST=${RELAY_DEFAULT_BACKEND_HOST:-127.0.0.1}
export BACKEND_PORT=${RELAY_DEFAULT_BACKEND_PORT:-27015}
export PUBLIC_HOST=${PUBLIC_HOST:-localhost}
```

### **Dynamic Client Configuration**
```javascript
// Auto-detect server host
const isSecure = window.location.protocol === 'https:';
const wsProtocol = isSecure ? 'wss:' : 'ws:';
const serverHost = window.location.host;
const websocketUrl = `${wsProtocol}//${serverHost}/websocket`;
```

### **Health Checks & Monitoring**
```yaml
# Add to docker-compose
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
  interval: 30s
  timeout: 10s
  retries: 3
```

## 📊 **Expected Performance**

### **LAN Deployment**
- **Latency**: <5ms (local network)
- **Bandwidth**: Unlimited
- **Concurrent Users**: 10-20 (limited by hardware)

### **VPS Deployment**
- **Latency**: 20-100ms (depending on distance to VPS)
- **Bandwidth**: VPS-limited (usually 100Mbps+)
- **Concurrent Users**: 50-100 (2GB VPS estimate)

## 🛡️ **Security Considerations**

### **Network Security**
- WireGuard encryption for VPS ↔ Home tunnel
- HTTPS/WSS for client connections
- Firewall rules limiting access to required ports

### **Game Server Security**
- ReHLDS remains on private network
- Only VPS can access via WireGuard
- No direct internet exposure of game server

## 🚀 **Future Enhancements**

### **Scalability**
- Multiple VPS regions for global access
- Load balancing between VPS instances
- Auto-scaling based on player count

### **Features**
- Player authentication system
- Server browser integration
- Statistics and leaderboards
- Mobile-optimized interface

### **Operations**
- Automated deployment via GitHub Actions
- Monitoring and alerting
- Backup and disaster recovery

---

**Ready to make Counter-Strike 1.6 accessible to the world!** 🌍

This plan will transform our localhost proof-of-concept into a production-ready service that anyone can access from anywhere with just a web browser.
