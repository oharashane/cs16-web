# PLAN E 1: MULTISERVER ARCHITECTURE 🚀

**Date**: August 18, 2025  
**Status**: 🔥 **TODAY PROJECT**  
**Objective**: Enhance Go RTC Server with UDP relay functionality and automatic CS server discovery

## 🎯 **Big Picture Vision**

### Current Architecture (Hybrid Go+Python)
```
WebXash Client ←→ Go WebRTC Server ←→ Python UDP Relay ←→ Single CS Server (27015)
```

### Target Architecture (Enhanced Go)
```
                        ┌─ CS Classic (27015)
WebXash Client ←→ Go RTC Server ←→ CS Deathmatch (27016)
                        └─ CS GunGame (27017)
```

**Core Philosophy**: Go RTC Server incorporating UDP relay and automatic server discovery.

## 🚨 **Why This Architecture**

### Validated Decisions
1. **Keep Go WebRTC Server**: Originally from [yohimik repository](https://github.com/yohimik/webxash3d-fwgs/tree/main/docker/cs-web-server/src/server), perfectly tuned for yohimik's server-initiated handshake
2. **Eliminate Python Redundancy**: Two complete WebRTC implementations is wasteful
3. **Go Performance**: More efficient for concurrent RTC connections
4. **VPS for WebRTC ICE**: Public IP required for proper WebRTC peer connections (Cloudflare tunnels won't work)

### **Updated Deployment Architecture**
```
┌─────────────────┐    ┌─────────────────────────────┐    ┌─────────────────┐
│ Cloudflare Pages│    │          VPS                │    │  Your Home      │
│ (Future)        │    │                             │    │                 │
│ • Static Assets │◄──►│ Go RTC Web Server           │◄──►│ CS Servers      │
│ • Museum/Browse │    │ • Dashboard & Xash Client   │    │ • Classic:27015 │
└─────────────────┘    │ • WebRTC Signaling API      │    │ • DM:27016      │
        HTTPS          │ • UDP Relay (incorporated)  │    │ • GunGame:27017 │
                       │ • Server Discovery          │    │ • Auto-discovery│
                       │ • TURN Server (future)      │    │ • 27000-27030   │
                       │ • Public IP for ICE         │    └─────────────────┘
                       └─────────────────────────────┘           VPN/WireGuard
                                 WebRTC
```

### Rejected Alternatives
- ❌ **Port Go to Python**: Would lose yohimik handshake compatibility
- ❌ **Relay per CS Server**: Creates unnecessary container sprawl
- ❌ **Keep Hybrid Architecture**: Adds latency and complexity

## 📋 **Milestone Goals**

### **Milestone 1: Enhanced Go RTC Server** 
**Goal**: Incorporate UDP relay functionality into Go RTC Server
- ✅ Go RTC Server handles WebRTC + UDP relay internally
- ✅ Preserve existing yohimik handshake compatibility
- ✅ Eliminate Python dependency and HTTP/WebSocket overhead

### **Milestone 2: Multi-Server Discovery**
**Goal**: Dynamic CS server detection and management
- ✅ Port range scanning (27000-27030) every 3 seconds
- ✅ CS1.6 server info query protocol
- ✅ Real-time server status tracking
- ✅ Game mode detection (Classic/DM/GunGame)

### **Milestone 3: Server Selection Protocol**
**Goal**: Route clients to specific CS servers
- ✅ Dashboard server browser integration
- ✅ WebRTC handshake server selection
- ✅ Dynamic client-to-server mapping
- ✅ Graceful server failover

### **Milestone 4: Local Multi-Server Testing**
**Goal**: Validate full system with multiple CS instances
- ✅ Classic + DM + GunGame servers running simultaneously
- ✅ Dashboard shows all servers with real-time info
- ✅ Clients can connect to any server via WebRTC
- ✅ Performance testing and optimization

### **Milestone 5: VPS Deployment**
**Goal**: Production deployment with Go RTC server on VPS
- ✅ Go RTC server deployed to VPS (WebRTC ICE requires public IP)
- ✅ Dashboard/client served from Cloudflare Pages
- ✅ Go server connects to home CS servers via secure tunnel/VPN
- ✅ Global accessibility testing

## 🔧 **Technical Implementation**

### **Server Discovery System**
```go
type ServerConfig struct {
    ID          string    `json:"id"`           // "127.0.0.1:27015"
    Host        string    `json:"host"`         // "127.0.0.1"
    Port        int       `json:"port"`         // 27015
    GameMode    string    `json:"game_mode"`    // "classic", "deathmatch", "gungame"
    Name        string    `json:"name"`         // From server hostname cvar
    Map         string    `json:"map"`          // Current map
    Players     int       `json:"players"`      // Current players
    MaxPlayers  int       `json:"max_players"`  // Server capacity
    Status      string    `json:"status"`       // "online", "offline"
    LastSeen    time.Time `json:"last_seen"`    // Last successful query
}

type ServerManager struct {
    servers map[string]*ServerConfig
    mutex   sync.RWMutex
}

// Discovery runs every 3 seconds
func (sm *ServerManager) DiscoverServers() {
    for port := 27000; port <= 27030; port++ {
        go sm.queryServer("127.0.0.1", port)
    }
}
```

### **Client-Server Routing**
```go
type ClientConnection struct {
    IP           [4]byte      // Client identifier  
    ServerID     string       // Target CS server
    UDPSocket    *net.UDPConn // UDP connection to CS server
    WriteChannel io.Writer    // WebRTC DataChannel back to client
    LastActivity time.Time    // For cleanup
}

var clientConnections = make(map[[4]byte]*ClientConnection)
```

### **WebRTC Server Selection**
```go
// During WebSocket handshake:
// ws://localhost:8080/signal?server=127.0.0.1:27016

func websocketHandler(w http.ResponseWriter, r *http.Request) {
    serverID := r.URL.Query().Get("server")
    if serverID == "" {
        serverID = sm.GetDefaultServer() // First available
    }
    
    server := sm.GetServer(serverID)
    if server == nil || server.Status != "online" {
        http.Error(w, "Server unavailable", http.StatusNotFound)
        return
    }
    
    // Continue with existing WebRTC setup
    // Associate this client with selected server
}
```

## 🗂️ **Features to Port from Python**

### **Critical Features** (Must Have)
1. **Server Info Queries** - CS1.6 packet protocol, challenge handling
2. **Health Checks** - Real-time server monitoring  
3. **Metrics** - Prometheus counters for monitoring
4. **Server Discovery** - Auto-detection of new CS servers
5. **UDP Socket Management** - Per-client socket handling

### **Nice-to-Have Features** (Later)
1. **WebRTC Testing Endpoints** - Debug/testing API
2. **Server Browser API** - Rich server information
3. **Connection Diagnostics** - Pipeline testing tools

## 📊 **Port Range Configuration**

### **Scan Range**: 27000-27030 (31 ports)
- **Classic CS**: Typically 27015
- **Additional Servers**: 27016, 27017, 27018...
- **Custom Ports**: Allow non-standard configurations
- **Discovery Interval**: Every 3 seconds
- **Query Timeout**: 1 second per server
- **Concurrent Queries**: All ports scanned in parallel

### **Game Mode Detection**
```go
func detectGameMode(serverInfo *ServerInfo) string {
    hostname := strings.ToLower(serverInfo.Name)
    
    if strings.Contains(hostname, "deathmatch") || strings.Contains(hostname, "dm") {
        return "deathmatch"
    }
    if strings.Contains(hostname, "gungame") || strings.Contains(hostname, "gg") {
        return "gungame"  
    }
    return "classic" // Default
}
```

## 🎮 **Game Mode Support**

### **Target Game Modes**
- **Classic**: Traditional CS1.6 gameplay
- **Deathmatch**: Continuous respawn, weapon spawns
- **GunGame**: Progressive weapon advancement

### **Server Configuration**
Each game mode runs as separate CS server:
```bash
# Classic server
docker run -p 27015:27015/udp timoxo/cs1.6:1.9.0817

# Deathmatch server  
docker run -p 27016:27015/udp -v ./deathmatch:/opt/cs16 timoxo/cs1.6:1.9.0817

# GunGame server
docker run -p 27017:27015/udp -v ./gungame:/opt/cs16 timoxo/cs1.6:1.9.0817
```

## 🚀 **Dashboard Integration**

### **Server Browser UI**
```javascript
// Fetch available servers
const servers = await fetch('/api/servers').then(r => r.json());

// Display server list
servers.forEach(server => {
    displayServer({
        name: server.name,
        gameMode: server.game_mode,
        map: server.map,
        players: `${server.players}/${server.max_players}`,
        status: server.status,
        connectUrl: `/client?server=${server.id}`
    });
});
```

### **Connection Flow**
1. **User selects server** from dashboard
2. **Dashboard redirects** to `/client?server=127.0.0.1:27016`
3. **Client connects** to WebSocket with server parameter
4. **Go server validates** server availability  
5. **WebRTC handshake** proceeds with server association
6. **Game packets routed** to correct CS server

## 📈 **Performance Expectations**

### **Local Network**
- **Discovery Latency**: <100ms per server
- **Connection Setup**: <2 seconds
- **Game Latency**: <5ms (LAN)
- **Concurrent Players**: 50-100 per server

### **VPS Deployment**
- **Discovery Latency**: <200ms per server (via VPN to home)
- **Connection Setup**: <3 seconds
- **Game Latency**: 30-150ms (VPS to client + VPS to home)
- **Concurrent Players**: Limited by VPS specs and home bandwidth

## 🔄 **Development Phases (TODAY!)**

### **Phase 1: Foundation** (Morning ☕)
- [ ] Add UDP relay functionality to Go RTC Server
- [ ] Port Python server discovery logic to Go
- [ ] Implement CS1.6 server query protocol
- [ ] Test single server compatibility

### **Phase 2: Multi-Server** (Lunch 🍕)  
- [ ] Implement server manager with discovery
- [ ] Add client-server routing
- [ ] Create server selection protocol
- [ ] Test with multiple CS servers

### **Phase 3: Dashboard** (Afternoon ⚡)
- [ ] Update dashboard for server browser
- [ ] Implement server selection UI
- [ ] Add real-time server status
- [ ] Test full user experience

### **Phase 4: Testing** (Evening 🧪)
- [ ] Performance testing and tuning
- [ ] Error handling and recovery
- [ ] Multi-server validation
- [ ] Local deployment testing

### **Phase 5: VPS Prep** (Tonight 🌙)
- [ ] VPS deployment planning
- [ ] VPN/tunnel configuration for CS servers
- [ ] Documentation for production deployment
- [ ] Ready for tomorrow's VPS setup

## 🎯 **Success Metrics**

### **Technical Goals**
- ✅ Single Go binary replaces Go+Python hybrid
- ✅ Sub-5-second server discovery for new CS servers
- ✅ Zero-downtime server failover
- ✅ <20ms additional latency vs direct UDP

### **User Experience Goals**
- ✅ Dashboard shows all available servers
- ✅ One-click connect to any game mode
- ✅ Seamless switching between servers
- ✅ Clear server status indicators

### **Operational Goals**
- ✅ Single container deployment
- ✅ Cloudflare tunnel compatibility
- ✅ Prometheus metrics for monitoring
- ✅ Automated server health checks

---

## 📋 **Next Steps**

1. **Start Phase 1**: Begin porting Python UDP relay to Go
2. **Create server discovery prototype**: Test port scanning and CS1.6 queries
3. **Design server selection protocol**: Plan WebSocket parameter handling
4. **Update project structure**: Prepare for unified Go server

---

## 📌 **Footnote: PLAN F**

**Future Vision**: PLAN F will split the dashboard and WebXash client into a dedicated Next.js web server for Cloudflare Pages deployment. This will create a rich CS1.6 "museum" experience with:
- **Map Browser**: Visual exploration of CS1.6 maps
- **Server Creation**: Dynamic CS server spawning interface  
- **Community Features**: Server ratings, player statistics
- **Global Deployment**: Worldwide accessibility via Cloudflare

PLAN F builds upon PLAN E's solid multi-server foundation to create the ultimate browser-based Counter-Strike experience.

---

---

## 🚀 **VPS Production Deployment Guide**

This section provides comprehensive guidance for deploying the multi-server system on a VPS for production use.

### **VPS Architecture Options**

#### **Option A: CS Servers on Home Network via VPN**
```
┌─────────────────┐    ┌─────────────────────────────┐    ┌─────────────────┐
│ Cloudflare CDN  │    │          VPS                │    │  Your Home      │
│ (Static Assets) │◄──►│ Go WebRTC Server           │◄──►│ CS Servers      │
└─────────────────┘    │ • Dashboard & Client        │    │ • Classic:27015 │
                       │ • WebRTC on 8000-8030      │    │ • DM:27016      │
                       │ • Public IP for ICE         │    │ • GunGame:27017 │
                       └─────────────────────────────┘    └─────────────────┘
                                 WebRTC                           VPN/WireGuard
```

**Benefits:**
- CS servers stay on your home network (low latency to your machines)
- VPS provides public IP for WebRTC (required for ICE)
- Secure VPN tunnel protects game traffic
- Home bandwidth only used for actual gameplay

#### **Option B: CS Servers on Same VPS**
```
┌─────────────────────────────┐
│          VPS                │
│ ┌─────────────────────────┐ │
│ │ Go WebRTC Server        │ │
│ │ • Dashboard (8080)      │ │
│ │ • WebRTC (8000-8030)    │ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ CS Servers              │ │
│ │ • Classic:27015         │ │
│ │ • DM:27016              │ │
│ │ • GunGame:27017         │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

**Benefits:**
- Everything on one VPS (simple deployment)
- Low latency between WebRTC server and CS servers
- No VPN configuration needed
- Scales with VPS resources

### **VPS Deployment Steps**

#### **1. VPS Prerequisites**
- **Operating System**: Ubuntu 20.04+ or similar Linux distribution
- **Resources**: Minimum 2GB RAM, 2 CPU cores, 20GB storage
- **Ports**: Ability to open ports 8080 and 8000-8030
- **Docker**: Docker and Docker Compose installed

#### **2. Initial VPS Setup**
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker and Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose (if not included)
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Log out and back in for Docker group membership
```

#### **3. Clone and Configure**
```bash
# Clone repository on VPS
git clone https://github.com/your-repo/cs16-web.git
cd cs16-web/web-server

# Create VPS environment file
cp .env.example .env.vps
nano .env.vps
```

#### **4. Environment Configuration**
```bash
# .env.vps - Critical settings for VPS deployment
WEBRTC_HOST_IP=YOUR_VPS_PUBLIC_IP        # Replace with actual VPS IP
CS_SERVER_HOST=host.docker.internal       # For Option B (CS on same VPS)
# CS_SERVER_HOST=10.0.0.100              # For Option A (CS via VPN)

# Security settings
RELAY_ALLOWED_BACKENDS=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16

# Optional: Specific server list if auto-discovery fails
# SERVER_LIST=10.0.0.100:27015,10.0.0.100:27016

# Production logging
LOG_LEVEL=INFO
METRICS_ENABLED=true
```

#### **5. Deploy with VPS Configuration**
```bash
# Deploy using VPS-specific compose file
docker-compose -f docker-compose.vps.yml up -d

# Monitor startup
docker-compose -f docker-compose.vps.yml logs -f

# Verify servers are discovered (wait 10-15 seconds for discovery)
curl -s http://localhost:8080/api/servers | jq .

# Check health
curl -s http://localhost:8080/api/heartbeat
```

#### **6. Firewall Configuration**
```bash
# Configure UFW firewall
sudo ufw enable
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH (adjust port if needed)
sudo ufw allow 22/tcp

# Allow web server ports
sudo ufw allow 8080/tcp                  # Dashboard and API
sudo ufw allow 8000:8030/tcp             # WebRTC server range

# Optional: Allow specific IP ranges only
# sudo ufw allow from 203.0.113.0/24 to any port 8080

# Verify configuration
sudo ufw status numbered

# Test external access
curl -s http://YOUR_VPS_IP:8080/api/heartbeat
```

#### **7. Optional: Reverse Proxy Setup**
For production use, consider placing nginx in front of the dashboard:

```nginx
# /etc/nginx/sites-available/cs16-web
server {
    listen 80;
    server_name yourdomain.com;
    
    # Dashboard and API
    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # Health check endpoint
    location /api/heartbeat {
        proxy_pass http://localhost:8080;
        access_log off;
    }
}

# Note: WebRTC ports 8000-8030 need direct access (no proxy)
# These ports cannot be proxied as they handle WebRTC connections
```

### **VPS Networking Deep Dive**

#### **Docker Networking Differences**

**Local Development (docker-compose.yml):**
```yaml
network_mode: "host"                    # Container shares host network
CS_SERVER_HOST: "127.0.0.1"           # Direct localhost access
# Pros: Simple, works immediately
# Cons: No network isolation, security risk on VPS
```

**VPS Production (docker-compose.vps.yml):**
```yaml
networks: ["cs16-vps-network"]          # Isolated bridge network
ports: ["8000-8030:8000-8030"]         # Explicit port mapping
CS_SERVER_HOST: "host.docker.internal" # Bridge gateway access
extra_hosts: ["host.docker.internal:host-gateway"]
# Pros: Security isolation, production-ready
# Cons: Requires proper configuration
```

#### **Port Range Management**

**Dynamic Port Allocation:**
- WebRTC servers only created for **discovered** CS servers
- No wasted resources on unused ports
- Automatic cleanup when CS servers go offline
- Supports full range 8000-8030 (31 simultaneous servers)

**Port Conflict Resolution:**
- Offset calculation prevents CS/WebRTC port conflicts
- CS servers use UDP, WebRTC servers use TCP
- Clear separation: CS 27xxx, WebRTC 8xxx
- No manual port management required

#### **Security Considerations**

**Container Isolation:**
```yaml
# VPS configuration provides security layers
networks: ["cs16-vps-network"]    # Isolated from other containers
user: "cs16:1001"                 # Non-root user in container
read_only: true                   # Read-only filesystem (where possible)
```

**Network Restrictions:**
```yaml
# Environment variable controls relay access
RELAY_ALLOWED_BACKENDS: "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
# Only allows relay to private IP ranges, blocks public internet
```

**Firewall Best Practices:**
- Only expose necessary ports (8080, 8000-8030)
- Consider IP whitelisting for admin access
- Use fail2ban for SSH protection
- Monitor logs for suspicious activity

### **Option A: VPN Configuration (CS Servers at Home)**

If you choose to keep CS servers on your home network, you'll need a VPN connection.

#### **WireGuard Setup Example**
```bash
# On VPS - Install WireGuard
sudo apt install wireguard

# Generate keys
wg genkey | tee vps-private.key | wg pubkey > vps-public.key
# Share public key with home network

# Configure WireGuard on VPS
sudo nano /etc/wireguard/wg0.conf
```

```ini
# /etc/wireguard/wg0.conf on VPS
[Interface]
PrivateKey = <VPS_PRIVATE_KEY>
Address = 10.0.0.1/24
ListenPort = 51820

[Peer]
PublicKey = <HOME_PUBLIC_KEY>
AllowedIPs = 10.0.0.0/24
Endpoint = YOUR_HOME_PUBLIC_IP:51820
PersistentKeepalive = 25
```

```bash
# Start WireGuard
sudo systemctl enable wg-quick@wg0
sudo systemctl start wg-quick@wg0

# Update CS_SERVER_HOST in .env.vps
CS_SERVER_HOST=10.0.0.100  # Home server IP via VPN
```

### **Monitoring and Maintenance**

#### **Log Management**
```bash
# View container logs
docker-compose -f docker-compose.vps.yml logs -f

# View specific service logs
docker logs cs16-webrtc-server-vps

# Monitor server discovery
docker logs cs16-webrtc-server-vps | grep -E "(Discovery|WebRTC|Server)"
```

#### **Performance Monitoring**
```bash
# Check server health
curl -s http://localhost:8080/api/heartbeat | jq .

# Monitor discovered servers
curl -s http://localhost:8080/api/servers | jq .

# Check metrics (if enabled)
curl -s http://localhost:8080/api/metrics
```

#### **Container Management**
```bash
# Update deployment
git pull
docker-compose -f docker-compose.vps.yml build --no-cache
docker-compose -f docker-compose.vps.yml up -d

# Restart services
docker-compose -f docker-compose.vps.yml restart

# Clean up old images
docker system prune -a
```

### **Troubleshooting Common VPS Issues**

#### **WebRTC Connection Failures**
```bash
# Check if WEBRTC_HOST_IP is set correctly
echo $WEBRTC_HOST_IP

# Verify external port access
nmap -p 8015 YOUR_VPS_IP

# Check container networking
docker exec cs16-webrtc-server-vps ip route show
```

#### **CS Server Discovery Issues**
```bash
# Check if CS_SERVER_HOST is reachable from container
docker exec cs16-webrtc-server-vps ping -c 3 $CS_SERVER_HOST

# Verify CS servers are bound to accessible interface
netstat -tuln | grep :270

# Test manual server query
docker exec cs16-webrtc-server-vps nc -u -w 5 $CS_SERVER_HOST 27015
```

#### **Firewall Problems**
```bash
# Check UFW status
sudo ufw status verbose

# Test specific port access
telnet YOUR_VPS_IP 8080
nc -zv YOUR_VPS_IP 8015

# Check iptables rules
sudo iptables -L -n
```

---

**Ready to deploy browser-based Counter-Strike to the world!** 🌍🎮
