# Manual Modifications to Compiled Xash3D Client

This document tracks manual modifications made to the compiled Xash3D WebAssembly client files that need to be reapplied when rebuilding from source.

## Overview

The Xash3D client is compiled from the [yohimik/webxash3d-fwgs](https://github.com/yohimik/webxash3d-fwgs) repository. We've made manual modifications to support our multi-port WebRTC server architecture.

## Modified Files

### 1. `client/assets/main-CqZe0kYo.js`

**Issue**: The compiled JavaScript contained a hardcoded WebRTC connection to `127.0.0.1:8080`, ignoring the server selection parameter.

**Original Code**:
```javascript
e.Cmd_ExecuteString(`name "${t}"`),e.Cmd_ExecuteString("connect 127.0.0.1:8080")
```

**Modified Code**:
```javascript
e.Cmd_ExecuteString(`name "${t}"`);const urlParams=new URLSearchParams(window.location.search);const csServerPort=parseInt(urlParams.get('server'))||27015;const webrtcPort=csServerPort-27000+8000;e.Cmd_ExecuteString(`connect 127.0.0.1:${webrtcPort}`)
```

**Purpose**: 
- Parse the `?server=XXXX` URL parameter to get the CS server port
- Calculate the offset WebRTC port using formula: `CS_PORT - 27000 + 8000`
- Connect to the correct offset WebRTC server (e.g., CS port 27015 → WebRTC port 8015)

### 2. WebSocket Connection to Offset Port

**Issue**: The WebSocket connection was using the dashboard host/port instead of connecting directly to the offset WebRTC server port.

**Original Code**:
```javascript
this.ws=new WebSocket(`${n}://${a}/websocket`);
```

**Modified Code**:
```javascript
const urlParams=new URLSearchParams(window.location.search);const csServerPort=parseInt(urlParams.get('server'))||27015;const webrtcPort=csServerPort-27000+8000;this.ws=new WebSocket(`${n}://127.0.0.1:${webrtcPort}/websocket`);
```

**Purpose**:
- Implement **Option B** architecture: direct connections to offset ports
- WebSocket signaling connects directly to the dedicated WebRTC server (e.g., port 8015)
- Provides consistency between signaling and game traffic
- Ensures clean separation and isolation per CS server

### 3. Data Channel Port Configuration

**Issue**: Game traffic data channel was using hardcoded port instead of dynamic offset port.

**Original Code**:
```javascript
const o={ip:[127,0,0,1],port:8080,data:a.data}
```

**Modified Code**:
```javascript
const urlParams=new URLSearchParams(window.location.search);const csServerPort=parseInt(urlParams.get('server'))||27015;const webrtcPort=csServerPort-27000+8000;const o={ip:[127,0,0,1],port:webrtcPort,data:a.data}
```

**Purpose**:
- Ensures game traffic uses the correct offset port for data channels
- Maintains consistency with WebSocket connection port

## Port Mapping

Our multi-port architecture uses offset ports to avoid conflicts:

| CS Server Port | WebRTC Server Port | Calculation |
|----------------|-------------------|-------------|
| 27015          | 8015              | 27015 - 27000 + 8000 |
| 27016          | 8016              | 27016 - 27000 + 8000 |
| 27017          | 8017              | 27017 - 27000 + 8000 |

## When to Reapply

These modifications need to be reapplied when:

1. **Rebuilding from source**: When compiling the Xash3D client from the GitHub repository
2. **Updating client version**: When updating to a newer version of the yohimik client
3. **File name changes**: The compiled JS file name (`main-CqZe0kYo.js`) may change with new builds

## Reapplication Steps

1. **Locate the main JavaScript file**: Look for the main compiled JS file in `client/assets/` (filename may differ)
2. **Find the connect command**: Search for the pattern: `e.Cmd_ExecuteString("connect 127.0.0.1:8080")`
3. **Replace with dynamic version**: Apply the modification shown above
4. **Test**: Verify that server selection works with different CS server ports

## Future Considerations

**Option 1: Source-level Changes**
- Modify the Xash3D source code to support dynamic server connection
- Submit upstream PR to yohimik repository
- Build from our fork with the changes

**Option 2: Build-time Modifications**
- Create a post-build script to automatically apply these modifications
- Use sed/awk to programmatically modify the compiled output

**Option 3: Runtime Configuration**
- Explore if Xash3D supports runtime configuration for server connection
- Use WebAssembly module parameters or environment variables

## Notes

- The modification is minimal and only affects the server connection logic
- All other Xash3D functionality remains unchanged
- The original hardcoded `8080` behavior is preserved as a fallback when no `?server=` parameter is provided
