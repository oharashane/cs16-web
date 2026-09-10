# WebRTC CS 1.6 Implementation Status

**Date**: 2025-01-12  
**Current State**: CRITICAL ISSUE - Engine Instability (Unreachable Errors)

## 🎯 Project Goal
Create a browser-based Counter-Strike 1.6 client that connects to a ReHLDS server via WebRTC DataChannel → UDP relay, bypassing browser UDP restrictions.

## 🔴 CRITICAL FINDING
**The "unreachable" errors occur even with the ORIGINAL xash3d-fwgs engine (before any WebRTC modifications)**

This means:
- ❌ **NOT** caused by our WebRTC transport layer
- ❌ **NOT** caused by our C/H file modifications  
- ✅ **IS** a fundamental build/environment/configuration issue

## 📋 Current Architecture Status

### ✅ Working Components
1. **Relay Server** (FastAPI + aiortc)
   - WebRTC signaling functional
   - DataChannel ↔ UDP bridging works
   - Successfully connects to ReHLDS server
   - Metrics endpoint operational

2. **ReHLDS Game Server**  
   - Running in Docker
   - Accepting connections on 127.0.0.1:27015
   - Compatible with standard CS 1.6 clients

3. **WebRTC Signaling**
   - Client ↔ Relay WebRTC connection establishes
   - DataChannel opens successfully  
   - Ready for data transmission

### ❌ Broken Component  
**WebAssembly Engine (xash3d-fwgs)**
- Consistent "RuntimeError: unreachable" crashes
- Occurs during `Touch_Init()` phase
- Prevents engine from completing initialization
- **Affects BOTH custom and original builds**

## 🔬 Exact Error Messages

### Latest Error (Original Engine - No WebRTC Modifications)
```
[20:15:57] Touch_Init()
xash.wasm:0x11ccba Uncaught (in promise) RuntimeError: unreachable
    at xash.wasm:0x11ccba
    at wrapper (xash.js:17760:20)
    at Object.doRewind (xash.js:17875:16)
    at xash.js:17909:47
    at xash.js:7442:22
$__main_argc_argv @ xash.wasm:0x11ccba
```

### Secondary Error (Same Session)
```
xash.wasm:0x1a10d1 Uncaught (in promise) RuntimeError: unreachable
    at xash.wasm:0x1a10d1
    at xash.wasm:0xda32d
    at xash.wasm:0x11cc68
$func727 @ xash.wasm:0x1a10d1
$Host_Main @ xash.wasm:0xda32d
```

### Pattern Analysis
- Errors consistently occur after `Touch_Init()` log
- Function addresses vary between builds but pattern is consistent
- Call stack involves `$Host_Main` → `$dlopen` → `$GiveFnptrsToDll`
- Multiple "unreachable" hits in different functions

## 📈 Implementation History

### Phase 1: JavaScript Interception Attempts (FAILED)
**Commits**: `b783a63`, `34c76b4`
- Attempted to intercept `NET_SendPacketEx` at JavaScript level
- Tried patching `addFunction`, `sendto`, `recvfrom`, `WebSocket` objects
- **Result**: Engine networking happens entirely within WASM - no JS surface

### Phase 2: Engine Modification (IMPLEMENTED)
**Commits**: `e88bc2c`, `3ffe343`, `0620810`

**Added Files**:
- `engine/common/net_transport.h` - Transport abstraction interface  
- `engine/common/net_transport.c` - Default UDP transport + manager
- `engine/common/net_transport_webrtc.c` - WebRTC DataChannel transport (Emscripten only)
- `client/library_webrtc.js` - JavaScript bridge for Emscripten

**Modified Files**:
- `engine/common/net_ws.c` - Integrated transport layer calls
- `engine/wscript` - Added build flags and library linking
- `client/bootstrap.js` - WebRTC transport initialization

**Technical Implementation**:
```c
// Transport interface
typedef struct net_transport_s {
    const char *name;
    net_transport_init_fn init;
    net_transport_shutdown_fn shutdown; 
    net_transport_send_fn send;
    net_transport_poll_fn poll;
    net_transport_recv_fn recv;
} net_transport_t;

// WebRTC functions exported to JavaScript
EMSCRIPTEN_KEEPALIVE int webrtc_init(void);
EMSCRIPTEN_KEEPALIVE void webrtc_push(const uint8_t *data, int len);
```

### Phase 3: Console Command Export Issues  
**Commits**: `654a04a`, `579fc11`
- Attempted to export `Cmd_ExecuteString` with `EMSCRIPTEN_KEEPALIVE`
- Hit repeated build and export issues
- **Discovered**: Function was available but not callable via `ccall`

### Phase 4: Debugging & Isolation (CURRENT)
- Reverted to original engine (commit `7c8e2a5`)
- **CRITICAL FINDING**: Same unreachable errors persist
- Confirmed WebRTC code is NOT the cause

## 🛠️ Technical Details

### Build Environment
- **Emscripten**: Latest from emsdk
- **Target**: WebAssembly (WASM)
- **Build Tool**: WAF
- **Platform**: Ubuntu Linux

### Emscripten Build Flags (Current)
```bash
linkflags += ['-sEXPORTED_RUNTIME_METHODS=["addFunction","removeFunction","ccall","cwrap","wasmTable"]']
linkflags += ['-sINITIAL_MEMORY=134217728', '-sALLOW_MEMORY_GROWTH=1', '-sSTACK_SIZE=16777216']
linkflags += ['-sASYNCIFY=1']
```

### Build Warnings (Suspicious)
```
em++: warning: EXPORTED_FUNCTIONS is not valid with LINKABLE set (normally due to SIDE_MODULE=1/MAIN_MODULE=1) since all functions are exported this mode.
file_packager: warning: file packager is creating an asset bundle of 674 MB. this is very large, and browsers might have trouble loading it.
```

## 🔍 Debugging Attempts

### Tried Solutions
1. ✅ **WebRTC Transport Removal** - Reverted to original engine
2. ✅ **Build Flag Experimentation** - Various Emscripten options
3. ✅ **Function Export Testing** - `EMSCRIPTEN_KEEPALIVE` additions
4. ✅ **Bootstrap Simplification** - Minimal initialization code  
5. ✅ **Systematic Isolation** - Tested original vs modified builds

### Current Debugging Status
- **Engine Loads**: ✅ WASM and JS files load successfully
- **Emscripten Runtime**: ✅ Module initialization works
- **File System**: ✅ Game data (xash.data) loads correctly  
- **Library Loading**: ❌ Crashes during dynamic library initialization
- **Console Commands**: ❌ Not available (secondary issue)

## 🚨 Next Steps Required

### Immediate Investigation Needed
1. **Emscripten Version Compatibility**
   - Check if xash3d-fwgs has known working Emscripten version
   - Verify build environment matches FWGS CI/CD

2. **Dynamic Library Loading**
   - `dlopen` calls in stack trace suggest library loading issues
   - Investigate client DLL loading (`cs_emscripten_wasm32.so`)
   - Check if all required libraries are available

3. **Memory/Stack Issues**  
   - Large 674MB asset bundle might cause memory pressure
   - Stack overflow during library initialization
   - WebAssembly memory limits

4. **Build Configuration**
   - SIDE_MODULE vs MAIN_MODULE settings
   - Asyncify configuration with library loading
   - Missing or incorrect build dependencies

### Alternative Approaches
1. **Use Official FWGS Build**
   - Test with pre-built WASM from official releases
   - Add WebRTC transport as post-build modification

2. **Minimal Engine Build**
   - Strip unnecessary components to reduce complexity
   - Build without game-specific DLLs for testing

3. **Native Testing**
   - Build same code for Linux to verify logic
   - Isolate WebAssembly-specific issues

## 📊 Success Metrics
- [ ] Engine completes initialization without unreachable errors
- [ ] Console commands (`Cmd_ExecuteString`) become available  
- [ ] WebRTC transport can be initialized
- [ ] Packets flow: Client → DataChannel → Relay → ReHLDS

## 🔧 Repository State

### Git Status
- **Main Repo**: `579fc11` - Latest bootstrap.js changes
- **Submodule**: `7c8e2a5` - Original xash3d-fwgs (pre-WebRTC)
- **WebRTC Files**: Currently deleted from submodule (testing original)

### Key Files
- `client/bootstrap.js` - WebRTC initialization + debugging
- `client/library_webrtc.js` - JavaScript bridge (unused in current test)
- `xash3d-fwgs/build/engine/xash.*` - Engine build artifacts
- `client/build/xash.*` - Local engine copy

---

**CONCLUSION**: The core issue is NOT our WebRTC implementation. The xash3d-fwgs engine has fundamental stability issues in the current build environment that must be resolved before WebRTC transport can be tested.
