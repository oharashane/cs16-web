now other clients are failing with "WebRTC using five or more STUN/TURN servers slows down discovery" and the xash engine fails to load 

[TURN FIX] RTCPeerConnection configured with TURN/STUN: 
[ { "urls": "stun:mainbrain:3478" }, { "urls": "turn:mainbrain:3478", "username": "lan", "credential": "lanpass" }, { "urls": "turn:mainbrain:3478?transport=tcp", "username": "lan", "credential": "lanpass" }, { "urls": "stun:stun.cloudflare.com:3478" }, { "urls": "stun:stun.l.google.com:19302" }, { "urls": "stun:stun1.l.google.com:19302" } ] 

it loads fine locally 

this is what cursor implemented if you want to revise



<!-- TURN/STUN Server Fix for WebRTC ICE Candidate Issues -->
   <script>
     // === TURN/STUN SERVER SHIM FOR PROBLEMATIC iMAC ===
     // This patches RTCPeerConnection to use local TURN server + fallback STUN
     // Fixes ICE candidate issues where host candidates fail on stubborn machines
     (function () {
       console.log('[TURN FIX] Initializing RTCPeerConnection TURN/STUN shim...');
       
       const OrigPC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
       if (!OrigPC) {
         console.warn('[TURN FIX] No RTCPeerConnection found - shim not applied');
         return;
       }
       
       // Your TURN/STUN servers on mainbrain + fallbacks
       const ICE_SERVERS = [
         // Local TURN server (primary solution for problematic iMac)
         { urls: 'stun:mainbrain:3478' },
         { urls: 'turn:mainbrain:3478', username: 'lan', credential: 'lanpass' },
         { urls: 'turn:mainbrain:3478?transport=tcp', username: 'lan', credential: 'lanpass' },
         
         // Fallback public STUN servers
         { urls: 'stun:stun.cloudflare.com:3478' },
         { urls: 'stun:stun.l.google.com:19302' },
         { urls: 'stun:stun1.l.google.com:19302' }
       ];

       // For the stubborn iMac, make it bulletproof: TURN-only at first
       const FORCE_TURN_ONLY = true; // Set to false once confirmed working
       
       function withTurnStun(cfg) {
         const base = Object.assign({}, cfg || {});
         
         // If the app already provides iceServers, keep them but append ours
         const existing = Array.isArray(base.iceServers) ? base.iceServers : [];
         base.iceServers = existing.concat(ICE_SERVERS);
         
         // Force relay-only for problematic machines
         if (FORCE_TURN_ONLY) {
           base.iceTransportPolicy = 'relay';
           console.log('[TURN FIX] FORCING relay-only mode for problematic iMac');
         }
         
         // Optimize ICE gathering
         if (base.iceCandidatePoolSize == null) base.iceCandidatePoolSize = 4;
         
         console.log('[TURN FIX] RTCPeerConnection configured with TURN/STUN:', base.iceServers);
         return base;
       }
       
       function PatchedPC(cfg, ...rest) {
         return new OrigPC(withTurnStun(cfg), ...rest);
       }
       
       // Copy prototype and static properties  
       PatchedPC.prototype = OrigPC.prototype;
       for (const k of Object.getOwnPropertyNames(OrigPC)) {
         try { 
           PatchedPC[k] = OrigPC[k]; 
         } catch (e) {
           // Ignore properties that can't be copied
         }
       }
       
       // Replace global constructors
       window.RTCPeerConnection = PatchedPC;
       window.webkitRTCPeerConnection = PatchedPC;
       
       console.log('[TURN FIX] RTCPeerConnection TURN/STUN shim successfully applied');
       console.log('[TURN FIX] Test with: new RTCPeerConnection().getConfiguration()');
     })();
   </script>



==================

You’re right—that shim is blasting too many ICE servers at every client. Chrome warns when you give it 5+ servers and (worse) your page is concatenating the list the app already supplies, so some clients end up with a big pile. Let’s fix this cleanly:

What we’ll do

Keep the server list tiny (≤3).

Replace the app’s iceServers instead of appending.

Only force TURN when you want (via a query flag), so other iMacs keep their fast direct path.

Keep everything on mainbrain; no per-machine edits.

1) Replace your shim with this minimal, scoped version

Put this before your compiled bundle in index.html on mainbrain (port 8080). It uses at most 3 ICE servers and overrides any existing ones. It also lets you enable TURN-only per session with ?relay=1.

<script>
/*
  Minimal ICE shim
  - Uses only local TURN/STUN on mainbrain (≤3 entries)
  - Replaces any existing iceServers (does NOT concat)
  - Optional TURN-only mode via ?relay=1
*/
(function () {
  const Orig = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (!Orig) return;

  // Tiny list: 1x STUN (optional), 1x TURN/UDP, 1x TURN/TCP
  const ICE_SERVERS = [
    { urls: 'stun:mainbrain:3478' },
    { urls: 'turn:mainbrain:3478', username: 'lan', credential: 'lanpass' },
    { urls: 'turn:mainbrain:3478?transport=tcp', username: 'lan', credential: 'lanpass' },
  ];

  // Enable TURN-only just for sessions with ?relay=1
  const FORCE_TURN_ONLY =
    /\brelay=1\b/.test(location.search) || /\brelay=1\b/.test(location.hash);

  function patchedConfig(cfg) {
    // Replace any existing servers to keep the list small
    const base = Object.assign({}, cfg);
    base.iceServers = ICE_SERVERS;
    if (FORCE_TURN_ONLY) base.iceTransportPolicy = 'relay';
    if (base.iceCandidatePoolSize == null) base.iceCandidatePoolSize = 2;
    return base;
  }

  function PC(cfg, ...rest) { return new Orig(patchedConfig(cfg), ...rest); }
  PC.prototype = Orig.prototype;
  for (const k of Object.getOwnPropertyNames(Orig)) { try { PC[k] = Orig[k]; } catch {} }

  window.RTCPeerConnection = PC;
  window.webkitRTCPeerConnection = PC;

  // Debug helper:
  console.log('[ICE] Using servers:', ICE_SERVERS,
              ' relayOnly=', FORCE_TURN_ONLY);
})();
</script>


