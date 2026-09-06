# Understanding STUN and Why It Helps on LAN

## What is STUN?
**STUN** = *Session Traversal Utilities for NAT*.  
It’s a very simple UDP service: a client sends a small “binding request,” and the STUN server replies with the IP/port it saw. This lets a WebRTC peer discover **an address it can be reached at**.

- On the open Internet, this is how WebRTC learns your public NAT address.
- On a LAN, it’s not strictly necessary *if host candidates (10.0.0.x)* are working.
- But if the OS/browser fails to generate usable host candidates (as on your one iMac), adding a STUN server makes the browser generate an extra candidate type (**srflx = server reflexive**) in addition to host. That gives ICE another path to succeed.

So STUN doesn’t “relay” traffic. It just teaches the browser what address to try. Even on a LAN, it can unblock machines that won’t complete host checks.

---

## How This Fits Your Architecture

Your flow:

Browser (webxash client)
→ WebRTC signaling (WebSocket) → Go RTC server
→ WebRTC media/data (ICE/DTLS/SCTP) → Python aiortc relay
→ UDP → ReHLDS server


Where STUN helps:

- The **browser’s RTCPeerConnection** needs at least one working candidate to form a connection with the Go server (which also uses aiortc).
- On 4/5 iMacs, host candidates (`10.0.0.x`) work fine.
- On the broken iMac, the OS/WebRTC stack generates the host candidate string but **never sends connectivity checks** → ICE fails.
- If you add a STUN server to the **browser’s RTCPeerConnection config**, it will also create a `srflx` candidate. ICE can then succeed using that, even though host failed.

---

## Where to Add STUN

You don’t need to change the Go server or Python relay right away.  
The minimal fix is purely on the **browser side**:

### Shim Approach

Inject a shim **before** the precompiled `main-*.js` runs, so every `RTCPeerConnection` is created with `iceServers` pointing to public STUN:

```html
<script>
(function () {
  const OrigPC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (!OrigPC) return;
  function withStun(cfg) {
    const iceServers = (cfg && cfg.iceServers && cfg.iceServers.length)
      ? cfg.iceServers
      : [
          { urls: 'stun:stun.cloudflare.com:3478' },
          { urls: 'stun:stun.l.google.com:19302' }
        ];
    return Object.assign({}, cfg || {}, { iceServers });
  }
  function PatchedPC(cfg, ...rest) {
    return new OrigPC(withStun(cfg), ...rest);
  }
  PatchedPC.prototype = OrigPC.prototype;
  for (const k of Object.getOwnPropertyNames(OrigPC)) {
    try { PatchedPC[k] = OrigPC[k]; } catch {}
  }
  window.RTCPeerConnection = PatchedPC;
  window.webkitRTCPeerConnection = PatchedPC;
})();
</script>
<script type="module" crossorigin src="/assets/main-xxxx.js"></script>


```

This guarantees the precompiled bundle will always see iceServers set, even if it doesn’t pass any in its own constructor.

Why the Earlier Shims Didn’t Work

Your previous attempts (DPR clamp, canvas rescale) targeted Emscripten Module/Browser hooks.
The compiled main module overwrote those during initialization.
By contrast, this STUN shim patches the global constructor (RTCPeerConnection) itself — the bundle cannot override this without going out of its way. That’s why this one sticks.

Next Steps for Cursor

Implement the shim in index.html so it loads before the precompiled main-*.js.

Test on the problematic iMac:

Open Firefox → about:webrtc → confirm you now see srflx candidates (in addition to host/ipv6).

ICE state should move to connected/complete.

If it works, keep the shim in place. It won’t hurt the other iMacs — they’ll just ignore the srflx candidate and continue using host.

Optional:

Also add the same iceServers to the Python aiortc RTCPeerConnection objects for symmetry. It’s not required if the browser side already gets through, but it’s clean.

Summary

STUN is a discovery service that gives WebRTC another candidate type (srflx) in addition to host.

Even on LAN, it can salvage cases where the OS/browser’s host candidate logic is broken.

Fix = add a shim to set iceServers before the precompiled bundle runs.

This works around the one stubborn iMac without touching the Go/Python servers.

---

## ✅ IMPLEMENTATION COMPLETE

**Date**: August 17, 2025  
**Status**: STUN shim successfully implemented and deployed

### What Was Done

1. **Added STUN Server Shim** to `/web-server/go-webrtc-server/client/index.html`
2. **Shim Location**: Placed after `window.Module` config but before `main-*.js` script loads
3. **STUN Servers Used**:
   - `stun:stun.cloudflare.com:3478`
   - `stun:stun.l.google.com:19302` 
   - `stun:stun1.l.google.com:19302`

### Implementation Details

The shim patches the global `RTCPeerConnection` constructor to automatically inject STUN servers when no `iceServers` are configured. This ensures that even if the precompiled WebAssembly client doesn't specify STUN servers, they will be added automatically.

**Key Features**:
- ✅ **Non-invasive**: Doesn't break existing functionality
- ✅ **Automatic**: Works without client code changes
- ✅ **Logging**: Console logs for debugging ICE candidate generation
- ✅ **Fallback-safe**: Only adds STUN if no `iceServers` already configured

### Testing the Fix

To verify the STUN shim is working on the problematic iMac:

1. **Open Browser Dev Tools** (F12)
2. **Navigate to** `http://localhost:8080/client` 
3. **Check Console** for these messages:
   ```
   [STUN FIX] Initializing RTCPeerConnection STUN shim...
   [STUN FIX] RTCPeerConnection shim successfully applied
   [STUN FIX] RTCPeerConnection created with STUN servers: [...]
   ```
4. **Check about:webrtc** (Firefox) or **chrome://webrtc-internals/** (Chrome)
5. **Look for** `srflx` candidates in addition to `host` candidates
6. **ICE state** should progress to `connected` or `completed`

### Expected Behavior

- **Working iMacs**: Will continue to use `host` candidates, ignore `srflx`
- **Problematic iMac**: Will use `srflx` candidates when `host` candidates fail
- **Connection time**: Should complete WebRTC handshake within 3-5 seconds
- **No impact**: Does not affect Go/Python server components

### Troubleshooting

If the fix doesn't work:
- Check browser console for STUN shim logs
- Verify ICE candidate types in WebRTC internals
- Consider trying additional STUN servers:
  ```javascript
  { urls: 'stun:stun.stunprotocol.org:3478' }
  { urls: 'stun:stun.voiparound.com' }
  ```

The shim is now live and ready for testing on the problematic iMac!