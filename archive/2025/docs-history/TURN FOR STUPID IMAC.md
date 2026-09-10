Let’s cut the noise and just get this one iMac working. We’ll do two things, all on mainbrain (Ubuntu):

run a local TURN server (coturn),

make your served page tell the browser to use it (via a tiny JS shim you add to your existing index.html on port 8080).

No editing on the iMac, no templates on the client. Everything is served from mainbrain, so all the paths still work.

A) Start a TURN server on mainbrain (Ubuntu)
1) Create a config

On mainbrain (host or inside the web container’s filesystem if that’s where you want it), make turnserver.conf:
# turnserver.conf
listening-ip=10.0.0.92
listening-port=3478
fingerprint
lt-cred-mech
realm=mainbrain
user=lan:lanpass
no-tls
# keep the relay ports tight so it’s easy to allow/observe
min-port=49160
max-port=49200

2) Run coturn (pick one)

Docker (quickest):
docker run --name coturn --restart unless-stopped -d \
  -v $PWD/turnserver.conf:/etc/turnserver.conf:ro \
  -p 3478:3478/tcp -p 3478:3478/udp \
  -p 49160-49200:49160-49200/udp \
  coturn/coturn

3) Open firewall (if ufw is on)
4) Sanity checks

From mainbrain:
sudo ss -lunpt | grep 3478

From the problem iMac:
nc -vz mainbrain 3478         # should say "succeeded" for TCP
# optional (on mainbrain): watch for UDP 3478/relay ports while testing
sudo tcpdump -n udp port 3478 &
sudo tcpdump -n udp portrange 49160-49200 &

If you don’t see packets when the page tries to connect, the client isn’t using the servers yet (next section fixes that).

B) Tell browsers to use your TURN (no rebuild)

You said you serve an index.html on port 8080. Edit that one file on mainbrain and insert this before your existing compiled script (the one like /assets/main-*.js). This wraps the global RTCPeerConnection so your precompiled client automatically uses your TURN.
<!-- TURN shim: put this BEFORE your compiled bundle -->
<script>
(function () {
  const Orig = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (!Orig) return;

  // Your TURN/STUN on mainbrain
  const ICE = [
    { urls: 'stun:mainbrain:3478' },
    { urls: 'turn:mainbrain:3478', username: 'lan', credential: 'lanpass' },
    { urls: 'turn:mainbrain:3478?transport=tcp', username: 'lan', credential: 'lanpass' },
  ];

  // For the stubborn iMac, make it bulletproof: TURN-only at first.
  const FORCE_TURN_ONLY = true;

  function patched(cfg) {
    const base = Object.assign({}, cfg || {});
    // If the app already provides iceServers, keep them but append ours
    const existing = Array.isArray(base.iceServers) ? base.iceServers : [];
    base.iceServers = existing.concat(ICE);
    if (FORCE_TURN_ONLY) base.iceTransportPolicy = 'relay'; // try 'all' later if this works
    if (base.iceCandidatePoolSize == null) base.iceCandidatePoolSize = 4;
    return base;
  }

  function PC(cfg, ...rest) { return new Orig(patched(cfg), ...rest); }
  PC.prototype = Orig.prototype;
  // copy static props
  for (const k of Object.getOwnPropertyNames(Orig)) { try { PC[k] = Orig[k]; } catch(e){} }
  window.RTCPeerConnection = PC;
  window.webkitRTCPeerConnection = PC;
})();
</script>

<!-- your existing line stays AFTER the shim: -->
<script type="module" crossorigin src="/assets/main-xxxx.js"></script>

This is server-side: you edit the index.html you already serve at http://mainbrain:8080. You do not copy HTML to the iMac; the iMac just reloads the same URL and gets the shim + your bundle together.

C) Test on the problem iMac

Firefox:

Open about:webrtc, then load http://mainbrain:8080.

You should see candidates with typ relay and a Selected Candidate Pair.

If it still says “add a TURN server,” the shim didn’t load before your bundle—double-check the script order.

Chrome:

If you still don’t get a mic prompt on http://mainbrain:8080, launch once with:

/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --unsafely-treat-insecure-origin-as-secure=http://mainbrain:8080 \
  --user-data-dir=/tmp/testchrome

Accept mic → quit → relaunch normally. (On your other iMacs, Chrome is looser; on this one, it’s strict. This forces the prompt just once.)

On mainbrain, you should now see UDP flows to 3478 and into your relay range 49160–49200 while the session runs:

sudo tcpdump -n udp port 3478
sudo tcpdump -n udp portrange 49160-49200

If this works, set FORCE_TURN_ONLY = false to let normal host/srflx candidates work on the good machines; the bad iMac will still fall back to relay.

If it still fails on that one iMac

Double-check the shim is definitely before the bundle (view source in the browser).

Open the DevTools Console and type:

new RTCPeerConnection().getConfiguration()


You should see your iceServers with turn:mainbrain:3478. If you don’t, the shim didn’t take—fix script order.

Confirm the iMac can reach mainbrain:3478 (the nc test). If TCP connects but no UDP shows in tcpdump, try the ?transport=tcp TURN line (already in the shim).

If Chrome still refuses mic on this iMac without the flag: that’s a local policy quirk on this install (your other boxes are just laxer). Keep the one-time flag or use an SSH tunnel so the origin is http://localhost:8080.

Why this will help (even on LAN)

You’ve got host candidates visible, but this one mac never finishes checks. TURN forces media over a single, friendly relay path. It’s what WebRTC uses when everything else is broken. The other four Macs will keep using direct host paths; this one will silently relay.