yes—that monorepo really does include a WebRTC path, but it’s aimed at talking to a Xash‑FWGS dedicated server (or a proxy), not vanilla ReHLDS directly. So your “DC↔UDP relay” is still the right glue for ReHLDS.

Here’s what I can verify from the code/docs:

    The repo’s README explicitly lists a “WebRTC Online Mod” section and a TODO that says “Support connection to servers (only xash3d‑fwgs dedicated server)”, which implies the WebRTC client stack exists but expects a matching server (or a bridge).
    GitHub

    The same README shows a clean JS API (Xash3D, Cmd_ExecuteString, etc.) and points you to examples/ for runnable demos—i.e., you don’t need to hack WASM imports; there’s a sanctioned way to drive the engine from JS.
    https://github.com/yohimik/webxash3d-fwgs

    On Reddit, the author (yohimik) says “websockets and webrtc work just fine over LAN” and that there’s a “webrtc example server in my repository,” and links the npm packages (xash3d-fwgs, hlsdk-portable, cs16-client) for quick start. That’s first‑party confirmation of a working DC transport example.
    Reddit+1

    There’s also a Docker image described as “Counter‑Strike 1.6 Web Client + WebRTC Dedicated Server,” which is consistent with the client‑expects‑WebRTC‑server story. (The page is finicky to load for me, but the title/summary indicate that pairing.)
    Docker Hub
    https://hub.docker.com/r/yohimik/cs-web-server
    docker pull yohimik/cs-web-server:0.0.0-i386


    Another community frontend (webXash) notes that multiplayer requires a proxy and even points to a Go wrapper/dedicated‑server path—again: client transport exists, but you need a compatible server or bridge.
    GitHub

    The author also advertises a Go CGO wrapper with a WebRTC example for the dedicated server side, which matches the “WebRTC client ↔ WebRTC server (or proxy)” model.
    Reddit

What this means for your repo

    You do not have to keep reverse‑engineering JS hooks into the stock engine. Instead, lift the WebRTC transport usage from their example (the one referenced in the README/Reddit) and initialize it in your client. Let your aiortc relay handle DC↔UDP to ReHLDS.

    Expect their example to create an RTCPeerConnection + DataChannel and bridge packets to the engine via exported functions (the README’s API implies the engine is callable from JS). Your relay should be drop‑in once the client pushes bytes over DC.

Quick sanity checklist (when you open their example tree)

Look for:

    new RTCPeerConnection / createDataChannel usage and onmessage/send wiring.

    Module.ccall/cwrap or direct exported symbols used to pass incoming/outgoing packets between JS and WASM (e.g., _register_sendto_callback, _register_recvfrom_callback, or bespoke webrtc_push functions).

    A minimal signaling WS client (they sometimes bundle an example server).



