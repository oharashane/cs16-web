# NEW PLAN — Browser WebRTC Transport, Stable Bring-up

## 0) Stabilize engine startup (1–2 hours)

- Temporarily bypass touch on web builds:

```c
// Touch_Init()
#ifdef __EMSCRIPTEN__
return 1;
#endif
```

- Build flags for visibility & headroom:
  - `-sASSERTIONS=2 -sSAFE_HEAP=1 -sSTACK_OVERFLOW_CHECK=2`
  - `-sINITIAL_MEMORY=512MB -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=32MB`
  - `-g3 --emit-symbol-map --profiling-funcs`

## 1) Add a tiny transport switch (half a day)

- Minimal transport API:
```c
// net_transport.h
typedef struct {
  int  (*send)(const uint8_t*, int);
  int  (*poll)(void);
  int  (*recv)(uint8_t*, int);
} net_transport_t;

void NET_SetTransport(net_transport_t* t);
```

- Default stays UDP. For `__EMSCRIPTEN__`, compile a WebRTC transport with:
```c
EMSCRIPTEN_KEEPALIVE void webrtc_push(const uint8_t* data, int len); // JS → engine
EMSCRIPTEN_KEEPALIVE int  webrtc_enable(void); // flips to WebRTC transport
```

- Implement a small ring buffer for incoming DC bytes; poll/recv read from it; send calls into a JS import `webrtc_send(ptr, len)`.

## 2) JS glue (1 hour)

- `library_webrtc.js`:
```js
mergeInto(LibraryManager.library, {
  webrtc_send: function(ptr, len) {
    const view = HEAPU8.slice(ptr, ptr+len);
    Module.__dc && Module.__dc.send(view);
    return len;
  }
});
```

- In `bootstrap.js` after DC opens:
```js
Module.__dc = dc;
Module.ccall('webrtc_enable', 'number', [], []);

dc.onmessage = (e) => {
  const u8 = e.data instanceof ArrayBuffer ? new Uint8Array(e.data)
                                           : new Uint8Array(e.data);
  const p = Module._malloc(u8.length);
  Module.HEAPU8.set(u8, p);
  Module.ccall('webrtc_push', null, ['number','number'], [p, u8.length]);
  Module._free(p);
};
```

## 3) Wire it in two places only (2–4 hours)

- In the send and receive choke points used by GoldSrc networking, call through the active transport for `__EMSCRIPTEN__`:
```c
#ifdef __EMSCRIPTEN__
  return active->send(buf, len);
#else
  // existing UDP path
#endif
```

- Same for poll/recv.

## 4) Tight acceptance loop (same day)

- Start engine → DC opens → `webrtc_enable()` called.
- Hit connect → relay `/metrics` shows traffic both ways.
- Engine no longer touches sockets on web build.
- Optional debug echo: tag first packet, verify in relay and engine recv.


