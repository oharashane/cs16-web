# PLAN E 1: MULTISERVER ARCHITECTURE 🚀

**Date**: January 20, 2025  
**Status**: 🔥 **TODAY PROJECT**  
**Objective**: Transform single-server architecture into unified Go-based multi-server system

## 🎯 **Big Picture Vision**

### Current Architecture (Hybrid Go+Python)
```
WebXash Client ←→ Go WebRTC Server ←→ Python UDP Relay ←→ Single CS Server (27015)
```

### Target Architecture (Unified Go)
```
                    ┌─ CS Classic (27015)
WebXash Client ←→ Go RTC Server ←→ CS Deathmatch (27016)
                    └─ CS GunGame (27017)
```

**Core Philosophy**: One relay container managing multiple CS containers with dynamic discovery.

## 🚨 **Why This Architecture**

### Validated Decisions
1. **Keep Go WebRTC Server**: Originally from [yohimik repository](https://github.com/yohimik/webxash3d-fwgs/tree/main/docker/cs-web-server/src/server), perfectly tuned for yohimik's server-initiated handshake
2. **Eliminate Python Redundancy**: Two complete WebRTC implementations is wasteful
3. **Go Performance**: More efficient for concurrent RTC connections
4. **VPS for WebRTC ICE**: Public IP required for proper WebRTC peer connections (Cloudflare tunnels won't work)

### **Updated Deployment Architecture**
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Cloudflare Pages│    │     VPS         │    │  Your Home      │
│                 │    │                 │    │                 │
│ • Dashboard     │◄──►│ Go RTC Server   │◄──►│ CS Servers      │
│ • Xash Client   │    │ • WebRTC/ICE    │    │ • Classic:27015 │
│ • Static Assets │    │ • UDP Relay     │    │ • DM:27016      │
└─────────────────┘    │ • Public IP     │    │ • GunGame:27017 │
        HTTPS          └─────────────────┘    └─────────────────┘
                             WebRTC                WireGuard/VPN
```

### Rejected Alternatives
- ❌ **Port Go to Python**: Would lose yohimik handshake compatibility
- ❌ **Relay per CS Server**: Creates unnecessary container sprawl
- ❌ **Keep Hybrid Architecture**: Adds latency and complexity

## 📋 **Milestone Goals**

### **Milestone 1: Unified Go Server** 
**Goal**: Eliminate Python dependency, port UDP relay to Go
- ✅ Single Go binary handles WebRTC + UDP relay
- ✅ Preserve existing yohimik handshake compatibility
- ✅ Match Python performance and features

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
- [ ] Create unified Go server structure
- [ ] Port Python UDP relay to Go
- [ ] Implement basic server discovery
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

**Ready to build the future of browser-based Counter-Strike!** 🎮
