# PLAN C XX RETROSPECTIVE - ArrayBuffer Solution

## 🎉 SUCCESS: The Real ArrayBuffer Fix

**Date:** 2025-01-17  
**Issue:** `TypeError: Cannot perform Construct on a detached ArrayBuffer` blocking gameplay  
**Status:** ✅ RESOLVED

## 🔍 The Real Problem

### What We Thought Was the Issue
- Runtime `window.Module` configuration being ignored
- Wrong memory settings (256MB vs 512MB confusion from git history)
- Docker volume mount issues
- WASM recompilation needed

### What the ACTUAL Issue Was
**The compiled JavaScript (`main-CqZe0kYo.js`) had hardcoded INITIAL_MEMORY of 128MB that overrode ALL runtime configurations.**

```javascript
// HARDCODED in compiled JS:
INITIAL_MEMORY||134217728  // 128MB (134,217,728 bytes)

// This overrode our window.Module config completely!
```

## 🛠️ The Real Solution

**Direct patch of the compiled JavaScript file:**

```bash
# Replace hardcoded 128MB with 512MB in compiled JS
sed -i 's/INITIAL_MEMORY||134217728/INITIAL_MEMORY||536870912/g' \
  web-server/go-webrtc-server/client/assets/main-CqZe0kYo.js
```

**Before:** `INITIAL_MEMORY||134217728` (128MB)  
**After:** `INITIAL_MEMORY||536870912` (512MB)

## 🎯 Key Files Modified

### 1. `web-server/go-webrtc-server/client/assets/main-CqZe0kYo.js`
- **CRITICAL:** Hardcoded memory increased from 128MB to 512MB
- This is the ONLY change that actually mattered

### 2. `web-server/docker-compose.yml`
- Added volume mount: `./go-webrtc-server/client:/app/client:ro`
- **Purpose:** Ensures container serves host files, not baked-in files
- Without this, client changes are invisible to users

### 3. `web-server/go-webrtc-server/client/index.html`
- Contains `window.Module` config (cosmetic - gets overridden anyway)
- Test message to verify volume mount working

## 🚨 Critical Gotchas & Lessons Learned

### 1. **Docker Volume Mount Trap**
```yaml
# WITHOUT this volume mount, the container serves OLD files baked into the image
volumes:
  - ./go-webrtc-server/client:/app/client:ro
```
**Symptoms:** Changes to HTML/JS files don't take effect, mysterious regressions

### 2. **Compiled JavaScript Override Trap**
```javascript
// This looks like it should work but gets COMPLETELY IGNORED:
window.Module = {
  INITIAL_MEMORY: 536870912,  // Ignored!
  ALLOW_MEMORY_GROWTH: 0      // Ignored!
};
```
**Why:** Compiled JS has hardcoded values that override runtime configs

### 3. **Git History Misleading**
- Commit `985b069` showed 256MB config, but "working" repo actually had 512MB
- **Cause:** Container state didn't match committed source (caching issue)
- **Lesson:** Always verify ACTUAL container state, not just git commits

### 4. **Script Loading Order Red Herring**
- We spent time on script tag order (irrelevant)
- Runtime configs are ignored regardless of loading order

## 🔧 Technical Deep Dive

### The ArrayBuffer Error Chain
1. WASM starts with insufficient memory (128MB)
2. Network operations require more memory 
3. WASM tries to grow memory during network calls
4. Memory growth detaches existing ArrayBuffers
5. `Net.sendto()` tries to use detached ArrayBuffer → **CRASH**

### Why 512MB Fixed It
- Large enough initial memory prevents growth during network operations
- No memory reallocation = no ArrayBuffer detachment
- Game can complete network handshake without crashes

### The Override Hierarchy
```
1. Compiled JS hardcoded values    ← WINS (what we patched)
2. window.Module runtime config    ← IGNORED
3. Default WASM settings          ← IGNORED
```

## 📋 Verification Checklist

### ✅ Confirm Fix is Working
- [ ] Client loads to game engine (not menu redirect)
- [ ] Engine console logs appear
- [ ] No ArrayBuffer error during connection
- [ ] Full gameplay possible
- [ ] Test message appears (volume mount working)

### ✅ Prevent Future Issues
- [ ] Volume mount exists in web-server docker-compose.yml
- [ ] main-CqZe0kYo.js contains 536870912 (not 134217728)
- [ ] Git commit captures EXACT working state
- [ ] Documentation updated

## 🎯 Exact Working Configuration

### Docker Compose (web-server)
```yaml
volumes:
  - ./go-webrtc-server/client:/app/client:ro  # CRITICAL
network_mode: "host"
```

### Compiled JavaScript Patch
```bash
# Verify current state
grep "INITIAL_MEMORY||" web-server/go-webrtc-server/client/assets/main-CqZe0kYo.js

# Should show: INITIAL_MEMORY||536870912
# If it shows: INITIAL_MEMORY||134217728, run the patch again
```

### Required Files
- `web-server/go-webrtc-server/client/assets/main-CqZe0kYo.js` (patched)
- `web-server/go-webrtc-server/client/index.html` (any HTML is fine)
- `cs-server/reunion.cfg` (with SteamIdHashSalt)

## 🚀 Deployment Steps

1. **Patch the JavaScript:**
   ```bash
   sed -i 's/INITIAL_MEMORY||134217728/INITIAL_MEMORY||536870912/g' \
     web-server/go-webrtc-server/client/assets/main-CqZe0kYo.js
   ```

2. **Ensure volume mount exists:**
   ```yaml
   volumes:
     - ./go-webrtc-server/client:/app/client:ro
   ```

3. **Restart services:**
   ```bash
   docker-compose -f web-server/docker-compose.yml restart
   ```

4. **Test:** `http://localhost:8080/client?connect=127.0.0.1:27015`

## 🎉 Final Notes

**This was a perfect example of how the "obvious" solutions (runtime config, recompiling WASM) were completely wrong, and the real fix was a simple direct patch of the compiled code.**

The breakthrough came from:
1. Recognizing that `[FIX]` messages weren't appearing (runtime config ignored)
2. Searching the compiled JS for memory references
3. Finding the hardcoded 128MB value
4. Directly patching the compiled code

**Total time to debug:** Several hours of complex investigation  
**Total time to fix:** 1 line of sed command  
**Lesson:** Sometimes the simple, direct approach beats the "proper" solution.
