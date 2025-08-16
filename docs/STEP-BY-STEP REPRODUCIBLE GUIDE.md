# Step-by-Step Reproducible Guide: CS1.6 WebRTC Setup

## 🎯 Goal
Create a fully functional CS1.6 browser-based game using WebRTC, from scratch, following our exact successful path.

## 📋 Prerequisites
- Docker and Docker Compose installed
- Linux environment (tested on Ubuntu/similar)
- Basic command line knowledge
- Modern web browser (Chromium 138+ tested working)

---

## 🔧 Part 1: CS1.6 ReHLDS Server Setup

### 1.1 Use the Working Docker Image
```bash
# We confirmed this specific timoxo image works
docker pull timoxo/cs1.6:1.9.0817
```

### 1.2 Create CS Server Configuration
Create `cs-server/docker-compose.yml`:
```yaml
services:
  cs-server:
    image: timoxo/cs1.6:1.9.0817
    container_name: cs-server
    network_mode: "host"  # CRITICAL for proper networking
    restart: unless-stopped
    volumes:
      - ./reunion.cfg:/home/steam/data/reunion.cfg:ro  # ReUnion plugin config
```

### 1.3 Fix ReUnion Plugin (CRITICAL)
Create `cs-server/reunion.cfg`:
```
# CRITICAL: Required for non-Steam client support
SteamIdHashSalt = MySecretSaltForXashClients123456789012345678901234567890
AuthVersion = 3
```

**Without this, clients cannot connect - ReUnion plugin will reject them.**

### 1.4 Start CS Server
```bash
cd cs-server/
docker-compose up -d
```

### 1.5 Verify CS Server
```bash
# Should show server running on port 27015
netstat -ulpn | grep 27015

# Test server query (should respond)
echo -e '\xFF\xFF\xFF\xFFTSource Engine Query\x00' | nc -u -w1 127.0.0.1 27015
```

---

## 🌐 Part 2: WebRTC Client Setup

### 2.1 Use the Working Container
**IMPORTANT:** We could never get the source code from the GitHub repo to work. Only the pre-built Docker container works:

```bash
# This is the ONLY container that worked for us
docker pull yohimik/cs-web-server:latest
```

**Source:** https://hub.docker.com/r/yohimik/cs-web-server  
**Based on:** https://github.com/yohimik/webxash3d-fwgs/tree/main/docker/cs-web-server/src/client

### 2.2 Extract Client Files from Container
```bash
# Create a temporary container to extract files
docker create --name temp-extract yohimik/cs-web-server:latest
docker cp temp-extract:/app/client ./web-server/go-webrtc-server/client
docker rm temp-extract
```

### 2.3 Create Web Server Configuration
Create `web-server/docker-compose.yml`:
```yaml
services:
  web-server:
    image: yohimik/cs-web-server:latest
    container_name: web-server
    network_mode: "host"  # CRITICAL for WebRTC
    restart: unless-stopped
    environment:
      - RELAY_DEFAULT_BACKEND_HOST=127.0.0.1
      - RELAY_DEFAULT_BACKEND_PORT=27015
      - SERVER_LIST=127.0.0.1:27015
    volumes:
      - ./go-webrtc-server/client:/app/client:ro  # CRITICAL: Live file updates
```

**The volume mount is CRITICAL - without it, changes to client files are invisible.**

---

## ⚡ Part 3: The ArrayBuffer Fix (CRITICAL)

### 3.1 The Problem
The extracted client has a hardcoded 128MB memory limit in the compiled JavaScript, causing:
```
TypeError: Cannot perform Construct on a detached ArrayBuffer
```

### 3.2 The Solution: Direct JavaScript Patch
```bash
# Verify current memory setting (should show 134217728 = 128MB)
grep -o "INITIAL_MEMORY||[0-9]*" web-server/go-webrtc-server/client/assets/main-CqZe0kYo.js

# Apply the critical patch: 128MB → 512MB
sed -i 's/INITIAL_MEMORY||134217728/INITIAL_MEMORY||536870912/g' \
  web-server/go-webrtc-server/client/assets/main-CqZe0kYo.js

# Verify patch applied (should show 536870912 = 512MB)
grep -o "INITIAL_MEMORY||[0-9]*" web-server/go-webrtc-server/client/assets/main-CqZe0kYo.js
```

### 3.3 Add Test Message (Optional)
Edit `web-server/go-webrtc-server/client/index.html` and add:
```html
<script>
console.log("🧪 TEST: Volume mount working - file served from host");
</script>
```

---

## 🚀 Part 4: Launch and Test

### 4.1 Start All Services
```bash
# Start CS server
cd cs-server/
docker-compose up -d

# Start web server  
cd ../web-server/
docker-compose up -d
```

### 4.2 Test the Game
Navigate to: `http://localhost:8080/client?connect=127.0.0.1:27015`

### 4.3 Expected Working Console Output
```
🧪 TEST: Volume mount working - file served from host
[15:53:34] FS_AddGameHierarchy( valve )
[15:53:34] Adding directory: /rodir/valve/
[15:53:34] FS_AddGameHierarchy( cstrike )
[15:53:35] Setting up renderer...
[15:53:36] Note: VoiceCapture_Init: capture device creation success
[15:56:00] This server is using AMX Mod X
[15:56:37] Scoring will not start until both teams have players
[15:59:00] Welcome to CS1.6 Test Server
```

**NO ArrayBuffer errors should appear!**

---

## 🔍 Part 5: Verification

### 5.1 Use Our Verification Script
```bash
# Download and run our verification script
curl -O https://raw.githubusercontent.com/[repo]/verify-working-state.sh
chmod +x verify-working-state.sh
./verify-working-state.sh
```

Should output:
```
🎉 ALL CHECKS PASSED - ArrayBuffer fix properly applied!
```

---

## 🚨 Critical Success Factors

### What Made This Work
1. **timoxo/cs1.6:1.9.0817** - Only CS server image that worked
2. **yohimik/cs-web-server** - Only WebRTC container that worked (source never worked)
3. **ReUnion SteamIdHashSalt** - Absolutely required for client connections
4. **network_mode: "host"** - Required for both containers
5. **Volume mount** - Required for live client file updates
6. **JavaScript memory patch** - The key fix for ArrayBuffer errors

### What Didn't Work
- ❌ Building from GitHub source code
- ❌ hldsdocker/rehlds-cstrike image  
- ❌ Runtime `window.Module` memory configurations
- ❌ Bridge networking mode
- ❌ Port mapping instead of host networking

---

## 🔬 Technical Deep Dive

### Why the JavaScript Patch Works
```javascript
// The compiled JS has hardcoded memory that overrides everything:
INITIAL_MEMORY||134217728  // 128MB - causes ArrayBuffer detachment

// Our patch increases it to prevent memory growth during network ops:
INITIAL_MEMORY||536870912  // 512MB - no growth needed = no detachment
```

### Why Source Code Building Failed
The [GitHub source](https://github.com/yohimik/webxash3d-fwgs/tree/main/docker/cs-web-server/src/client) appears to be missing critical build configurations or dependencies. The pre-built Docker container has the working compiled assets.

---

## 📈 Our Journey: Key Milestones

### Historical Context
Our path to success involved multiple attempts and discoveries:

**Early Attempts (Failed):**
- Building from GitHub source - never worked
- Various CS server images - only timoxo worked  
- Different networking modes - only host mode worked
- Runtime memory configurations - completely ignored

**Breakthrough Commits:**
- `985b069` - "some signs of life" - Fixed ReUnion plugin, got engine logs
- `22dae66` - "omfg it works" - Client could connect but had ArrayBuffer errors  
- `660ecdb` - "ARRAYBUFFER FIX COMPLETE" - Final solution with memory patch

**Key Discovery:** The [yohimik Docker Hub container](https://hub.docker.com/r/yohimik/cs-web-server) contains working compiled assets that we could never reproduce from the [GitHub source](https://github.com/yohimik/webxash3d-fwgs/tree/main/docker/cs-web-server/src/client).

### What We Learned
1. **Pre-built containers > Source builds** - Sometimes the container just works when source doesn't
2. **Network mode matters** - Host networking was essential for WebRTC
3. **Memory is everything** - Small memory limits cause catastrophic failures
4. **Docker volume mounts** - Critical for development but easy to forget
5. **Hardcoded values override everything** - Runtime configs can be completely ignored

---

## 📝 Known Working Versions

- **CS Server:** `timoxo/cs1.6:1.9.0817` (only image that worked for us)
- **WebRTC Server:** `yohimik/cs-web-server:latest` (as of 2025-01-17, from Docker Hub)
- **Browser:** Chromium 138.0.7204.183 (verified working)
- **OS:** Linux (Ubuntu/similar with Docker)
- **Commit:** `660ecdb` - Complete working state preserved

---

## 🎯 Success Criteria

✅ Client loads game engine (not menu redirect)  
✅ Engine console logs appear  
✅ No ArrayBuffer errors in browser console  
✅ Can connect to CS server  
✅ Full gameplay possible  
✅ Multiple players can join  

**If any of these fail, review the critical steps above.**
