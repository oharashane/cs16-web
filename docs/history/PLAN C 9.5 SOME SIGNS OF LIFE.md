
main-CqZe0kYo.js:13 [17:38:15] FS_AddGameHierarchy( valve )
main-CqZe0kYo.js:13 [17:38:15] Adding directory: /rodir/valve/
main-CqZe0kYo.js:13 [17:38:15] Adding directory: valve/
main-CqZe0kYo.js:13 [17:38:15] FS_AddGameHierarchy( cstrike )
main-CqZe0kYo.js:13 [17:38:15] Adding directory: /rodir/cstrike/
main-CqZe0kYo.js:13 [17:38:15] Adding directory: cstrike/downloaded/
main-CqZe0kYo.js:13 [17:38:15] Adding directory: cstrike/
main-CqZe0kYo.js:13 [17:38:15] Adding directory: cstrike/custom/
main-CqZe0kYo.js:13 [17:38:16] Setting up renderer...
main-CqZe0kYo.js:19 [Violation] 'requestAnimationFrame' handler took 1356ms
main-CqZe0kYo.js:28 Uncaught TypeError: Cannot perform Construct on a detached ArrayBuffer
    at Uint8Array.subarray (<anonymous>)
    at Net.sendto (main-CqZe0kYo.js:28:62571)
    at _sendto_js (main-CqZe0kYo.js:19:184695)
    at xash-dpb4Gdqz.wasm:0xf0963
    at xash-dpb4Gdqz.wasm:0xe93c5
    at xash-dpb4Gdqz.wasm:0x13a352
    at xash-dpb4Gdqz.wasm:0xb59dc
    at invoke_vd (main-CqZe0kYo.js:28:58391)
    at xash-dpb4Gdqz.wasm:0xc7077
    at a (main-CqZe0kYo.js:19:172572)
Net.sendto @ main-CqZe0kYo.js:28
_sendto_js @ main-CqZe0kYo.js:19



Huge! 🎉 ReUnion loading + you’re now seeing real Xash engine logs is a very good sign. That new error is actually a classic browser/WASM gotcha:

Uncaught TypeError: Cannot perform Construct on a detached ArrayBuffer (at Uint8Array.subarray inside Net.sendto → _sendto_js)

What that usually means (and why it happens here)

In the browser, a WebAssembly.Memory can grow during startup/map load. When it does, the old JS views (like HEAPU8) get detached and replaced with new ones.

If any code cached an old Uint8Array (e.g., const H = HEAPU8;) and later calls H.subarray(...) after a memory grow, you get exactly this detached ArrayBuffer error.

Your stack shows the crash inside the JS shim that implements sendto (Net.sendto → _sendto_js). That path typically reads bytes out of WASM memory (HEAPU8.subarray(ptr, ptr+len)) to send over the datachannel/bridge. If that HEAPU8 (or a cached alias) is stale, boom.

A second, less likely cause: moving the underlying ArrayBuffer across threads (e.g., posting it to a Worker with transfer) will also detach it. But this error almost always points to WASM memory growth + stale view.

Fastest path to confirm + unblock (no code surgery yet, just knobs & logging)
1) Prove memory is growing during early networking

In DevTools before the crash, run:
console.log(Module.HEAPU8?.byteLength, Module.wasmMemory?.buffer?.byteLength);
const oldBuf = Module.wasmMemory.buffer;
const oldLen = Module.HEAPU8.byteLength;
Module.onMemoryGrowth = () => {
  console.warn('[wasm] memory grew',
    'old=', oldLen, oldBuf,
    'new=', Module.HEAPU8.byteLength, Module.wasmMemory.buffer);
};


If you see [wasm] memory grew right before the Net.sendto call, you’ve found the trigger.

2) Quick mitigation: avoid growth during init

Give the engine more room up front so it doesn’t grow mid‑handshake:

If you control the loader config, set INITIAL_MEMORY bigger (e.g., 128–256 MB) and ALLOW_MEMORY_GROWTH=1 (still allow growth later, but avoid it during early connect).

If you have a JS config blob, set Module['INITIAL_MEMORY'] = 268435456; (256MB) before loading the wasm.

Re-test. If the error disappears, it confirms the “growth detaches view” hypothesis.

3) Instrument the offending code path

Find the sendto glue (_sendto_js / Net.sendto) in your bundled JS (the stack mentions main-*.js:28 and :19).

Add a one-liner right before the subarray call:
console.debug('sendto check', Module.HEAPU8 && !Module.HEAPU8.buffer.detached);

(In Chrome you can also test “detached” by trying a trivial Module.HEAPU8.byteLength access and catching an exception.)

If that log sometimes prints false or throws, the view’s stale.

Proper, durable fixes (what to change when you’re ready to tweak code)

Never cache HEAP* views.
Anywhere you have const H = HEAPU8 (or HEAP32, etc.) in module scope or a long‑lived closure, delete it. Always access Module.HEAPU8 at the moment you need it.

Hook memory growth to refresh any unavoidable caches.
If you must keep short‑lived aliases (e.g., for perf), register:
Module.onMemoryGrowth = () => {
  // refresh any cached typed arrays here if you keep them
  cachedHEAPU8 = new Uint8Array(Module.wasmMemory.buffer);
};

Defensive copy on network send (as a bandaid).
If you want a robust guard during bring‑up, make a copy right before dc.send:

// read from fresh HEAPU8 each time
const view = Module.HEAPU8.subarray(ptr, ptr + len);
const out  = new Uint8Array(len);
out.set(view);
dataChannel.send(out); // out has its own backing buffer


Copying costs a tiny bit of CPU but avoids mid‑call detach races while you iterate.

Don’t transfer WASM buffers to workers.
If any code does worker.postMessage(HEAPU8.buffer, [HEAPU8.buffer]), remove the transfer list. Use copy semantics (postMessage(obj) without transfer) or send plain slices you allocate yourself.

Why this popped exactly now

You fixed ReUnion (nice catch!), so the client pushed past menu idle into actual connect/signon work. That path tends to allocate, load resources, and send UDP‑like datagrams quickly; if memory growth occurs between allocating the send buffer and calling subarray, the previously captured view detaches and you see this error.

In other words: the transport & server auth were gatekeepers; once cleared, you hit a WASM memory/view lifecycle issue.

Checklist you can bang through in ~10–15 minutes




---------------------------------------------------------

L 08/15/2025 - 00:05:17: "[Xash3D]shane<5><STEAM_2:0:595492770><>" connected, address "127.0.0.1:54204"

The client successfully connected to the server! It shows:
✅ Player name: [Xash3D]shane
✅ Steam ID: STEAM_2:0:595492770 (generated by Reunion)
✅ Connection: connected, address "127.0.0.1:54204"
The client then timed out, but the connection handshake worked!
🎯 What This Means
Reunion is working - Generated a proper Steam ID for the Xash client
Network flow is working - Packets are flowing end-to-end
Connection handshake succeeded - Client actually connected to the server
The ArrayBuffer error is not blocking the connection - It's a client-side display/rendering issue
🔧 Next Steps
The client is connecting but then timing out. This could be:
Keepalive packets not being sent due to the ArrayBuffer error
Client-side rendering issues preventing proper game display
Network timing issues between client and server
The core connection is working! The ArrayBuffer error is likely preventing the client from sending keepalive packets or rendering properly, but the initial connection handshake is successful.
This is huge progress - we've gone from "no connection" to "successful connection but timeout"!


------------------------------------------

Yeah — this lines up exactly with what we suspected earlier:
✅ The transport is fine (ReUnion is generating a valid SteamID, your relay is bridging both ways, and ReHLDS sees the connect).
❌ The crash is entirely inside the browser-side WASM networking code (Net.sendto → _sendto_js) and is killing the client loop before it can send any keepalives or finish sign-on, so you time out.

Here’s what’s happening:

Why it’s failing now

Xash’s WASM build calls sendto from C, which the JS glue layer implements as HEAPU8.subarray(ptr, ptr+len) to grab the packet before handing it to your DC send.

The HEAPU8 it’s using is pointing at an ArrayBuffer that’s been detached. That happens when:

The WASM memory grew (WebAssembly.Memory.grow), replacing the old buffer, and

The glue code cached the old HEAPU8 view instead of re-reading it from Module.HEAPU8.

Once detached, any Uint8Array.subarray() call throws that exact “Cannot perform Construct on a detached ArrayBuffer” error.

Why INITIAL_MEMORY bump didn’t fix it

You gave it more headroom (256 MB), which reduces the chance of a growth during sign-on, but it’s still either:

Growing anyway later (e.g. when it starts loading map resources or textures right after “Setting up renderer…”), or

The view was already cached much earlier and became stale when any growth happened in a previous stage.

How to prove it immediately

Add right before the subarray in _sendto_js:
if (Module.HEAPU8.buffer.byteLength === 0) {
  console.error('[sendto] HEAPU8 detached');
}

Also hook:
Module.onMemoryGrowth = () => console.warn('[wasm] memory grew', Module.HEAPU8.byteLength);
If you see [wasm] memory grew in the seconds before the crash, that’s your smoking gun.

Two quick mitigation paths

1. Don’t cache HEAPU8 in Net.sendto
Edit the glue so that instead of:
const view = HEAPU8.subarray(ptr, ptr + len);
…it’s:
const view = Module.HEAPU8.subarray(ptr, ptr + len);

That way it always grabs the current live view.

2. Defensive copy before send
Even safer while debugging:
const heap = Module.HEAPU8;
const out = new Uint8Array(len);
out.set(heap.subarray(ptr, ptr + len));
dc.send(out);

That extra copy costs a bit of CPU but makes it immune to mid-call detach.

Why fixing this will also fix your timeout

Right now the client sends connect, gets a challenge/serverinfo, and then needs to start its sign-on message flood (keepalives, resource lists, delta packets). The first time it hits Net.sendto with a detached buffer, the exception bubbles up and kills the engine loop. No keepalives → server drops you → “connection timed out.”

Once sendto survives, you should see:

svc_serverinfo / svc_signonnum messages being processed

The client start requesting models/sounds

The renderer actually drawing the map instead of idling at “Setting up renderer…”



--------------------------------------------------

The file is being served correctly. The issue might be that the Module configuration isn't being applied because the WASM module is loading before our script runs, or there's a conflict with the module loading.
Let me try a different approach. Since the original yohimik client works without any memory configuration, let's try a simpler fix - let's just increase the initial memory significantly and disable memory growth entirely during the connection phase:
This is a much simpler approach:
512MB initial memory - Much larger to prevent growth during connection
Disable memory growth entirely - ALLOW_MEMORY_GROWTH: 0
Simple logging - Just to confirm the Module config is being applied
Try connecting to http://localhost:8080/client again
You should see:
[FIX] Runtime initialized with 512MB memory, growth disabled
If you still don't see this message, then there's a fundamental issue with how the Module configuration is being applied. If you do see it but still get the error, then the issue is more complex than just memory growth.
Test it and let me know what you see in the console!



-----------------------------------------


 IT WORKS!!!