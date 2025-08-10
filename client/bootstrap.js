// Deep-link bootstrap for signaling + target server
(function () {
  let netRef = null;
  const qs = new URLSearchParams(location.search);
  const signal = qs.get('signal');
  const host = qs.get('host');
  const port = Number(qs.get('port') || 27015);
  const token = qs.get('token') || '';
  const transport = (qs.get('transport') || 'webrtc').toLowerCase();
  const renderer = (qs.get('renderer') || 'gles3compat');

  const setStatus = (msg) => {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
    console.log('[client]', msg);
  };

  if (!signal || !host || !port) {
    setStatus('Missing ?signal, ?host or ?port.'); return;
  }

  const ws = new WebSocket(signal.replace(/^http/,'ws'));
  ws.onopen = () => {
    setStatus('Signaling connected.');
    ws.send(JSON.stringify({
      type: 'hello',
      token,
      backend: { host, port },
      features: { unordered: true, maxRetransmits: 0 }
    }));
  };

  let pc, dc;
  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.type === 'ready') {
      setStatus('Signaling ready. Creating RTCPeerConnection…');
      pc = new RTCPeerConnection({ iceServers: [] });
      dc = pc.createDataChannel('cs16', { ordered: false, maxRetransmits: 0 });
      dc.binaryType = 'arraybuffer';

      dc.onopen = () => {
        setStatus('DataChannel open. Initializing engine…');
        initEngine(dc).catch(e => setStatus('Engine error: ' + e.message));
      };
      dc.onclose = () => setStatus('DataChannel closed.');
      dc.onmessage = (e) => {
        if (!netRef) return;
        const dataPromise = e.data?.arrayBuffer ? e.data.arrayBuffer() : Promise.resolve(e.data);
        Promise.resolve(dataPromise).then((data) => {
          const buf = data instanceof ArrayBuffer ? new Int8Array(data) : data;
          netRef.incoming.enqueue({ data: buf });
        }).catch(() => {});
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) ws.send(JSON.stringify({ type: 'ice', candidate: e.candidate }));
      };

      const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription.sdp }));
    }

    if (msg.type === 'answer' && pc) {
      await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
      setStatus('Answer received. Establishing connection…');
    }

    if (msg.type === 'ice' && pc) {
      try { await pc.addIceCandidate(msg.candidate); } catch (_) {}
    }
  };

  async function initEngine(channel) {
    const canvas = document.getElementById('canvas');
    if (!canvas) return;
    canvas.style.display = 'block';

    // Dynamically load the minimal libs from CDN for now
    const libs = {
      xash: 'https://cdn.jsdelivr.net/npm/xash3d-fwgs@latest/dist/xash.wasm',
      filesystem: 'https://cdn.jsdelivr.net/npm/xash3d-fwgs@latest/dist/filesystem_stdio.wasm',
      gles3compat: 'https://cdn.jsdelivr.net/npm/xash3d-fwgs@latest/dist/libref_gles3compat.wasm',
      soft: 'https://cdn.jsdelivr.net/npm/xash3d-fwgs@latest/dist/libref_soft.wasm',
      client: 'https://cdn.jsdelivr.net/npm/cs16-client@latest/dist/cl_dll/client_emscripten_wasm32.wasm',
      menu: 'https://cdn.jsdelivr.net/npm/cs16-client@latest/dist/cl_dll/menu_emscripten_wasm32.wasm',
      server: 'https://cdn.jsdelivr.net/npm/cs16-client@latest/dist/dlls/cs_emscripten_wasm32.so',
    };

    // Load raw.js globally and use window.Xash3D like the upstream example
    function loadScript(src){
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = () => resolve();
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    // Load JSZip first to prepare assets before engine starts
    await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');

    // Prefetch and unpack cs16.zip so we can mount it in preRun synchronously
    setStatus('Loading assets…');
    const res = await fetch('/assets/games/cs16.zip');
    if (!res.ok) throw new Error('cs16.zip not found');
    const ab = await res.arrayBuffer();
    const zip = await window.JSZip.loadAsync(ab);
    const files = {};
    const entries = Object.keys(zip.files);
    for (const p of entries) {
      const file = zip.files[p];
      if (file.dir) continue;
      const path = `/rodir/${p}`;
      files[path] = await file.async('uint8array');
    }

    // Load engine after assets are prepared
    await loadScript('https://cdn.jsdelivr.net/npm/xash3d-fwgs@latest/dist/raw.js');
    const XashCreate = function(opts){
      const dynLibNames = [
        'filesystem_stdio.wasm',
        renderer === 'soft' ? 'libref_soft.wasm' : 'libref_gles3compat.wasm',
        'cl_dlls/menu_emscripten_wasm32.wasm',
        'dlls/cs_emscripten_wasm32.so',
        'cl_dlls/client_emscripten_wasm32.wasm'
      ];
      const locateFile = (p) => {
        switch (p) {
          case 'xash.wasm': return libs.xash;
          case 'filesystem_stdio.wasm': return libs.filesystem;
          case 'libref_gles3compat.wasm': return libs.gles3compat;
          case 'libref_soft.wasm': return libs.soft;
          case 'cl_dlls/menu_emscripten_wasm32.wasm': return libs.menu;
          case 'dlls/cs_emscripten_wasm32.so': return libs.server;
          case 'cl_dlls/client_emscripten_wasm32.wasm': return libs.client;
          default: return p;
        }
      };
      return window.Xash3D({
        arguments: opts.args,
        canvas,
        ctx: canvas.getContext('webgl2', {alpha:false, depth:true, stencil:true, antialias:true}),
        dynamicLibraries: dynLibNames,
        locateFile,
        preRun: [function(Module){
          try {
            for (const k of Object.keys(files)){
              const dir = k.split('/').slice(0, -1).join('/');
              Module.FS.mkdirTree(dir);
              Module.FS.writeFile(k, files[k]);
            }
            Module.FS.chdir('/rodir');
          } catch (e) {
            console.error('preRun FS mount error', e);
          }
        }],
        onRuntimeInitialized: opts.onRuntimeInitialized,
      });
    };

    // Minimal Net + Queue implementation inline (compatible with engine callbacks)
    class Queue {
      constructor(){ this.items = []; }
      enqueue(x){ this.items.push(x); }
      dequeue(){ return this.items.length ? this.items.shift() : undefined; }
    }

    class Net {
      constructor(){
        this.incoming = new Queue();
        this.em = undefined;
        this.sendtoCb = undefined;
        this.sendtoPointer = undefined;
        this.recvfromPointer = undefined;
      }
      run(em){
        if (this.em) return;
        this.em = em;
        this.registerRecvfromCallback();
        if (this.sendtoCb){
          const cb = this.sendtoCb; this.sendtoCb = undefined; this.registerSendtoCallback(cb);
        }
      }
      clearCallback(name, pointer){
        if (!pointer || !this.em) return false;
        this.em.Module.ccall(name, null, ['number'], [0]);
        this.em.removeFunction(pointer);
        return true;
      }
      registerSendtoCallback(cb){
        if (!this.em){ this.sendtoCb = cb; return; }
        const callback = (message, length, flags) => {
          const em = this.em; if (!em) return;
          const heap = em.HEAPU8; const end = message + length;
          if (!heap || length <= 0 || message < 0 || end > heap.length) return;
          const view = heap.subarray(message, end);
          cb({ data: view });
        };
        this.clearSendtoCallback();
        this.sendtoPointer = this.em.addFunction(callback, 'viii');
        this.em.Module.ccall('register_sendto_callback', null, ['number'], [this.sendtoPointer]);
      }
      clearSendtoCallback(){
        if (this.clearCallback('register_sendto_callback', this.sendtoPointer)){
          this.sendtoPointer = undefined;
        }
        this.sendtoCb = undefined;
      }
      registerRecvfromCallback(){
        if (!this.em || this.recvfromPointer) return;
        const recvfromCallback = (sockfd, buf, len, flags, src_addr, addrlen) => {
          const packet = this.incoming.dequeue();
          if (!packet) return -1;
          const em = this.em;
          const data = packet.data instanceof Uint8Array ? packet.data : new Uint8Array(packet.data);
          const copyLen = Math.min(len, data.length);
          if (copyLen > 0){ em.HEAPU8.set(data.subarray(0, copyLen), buf); }
          if (src_addr){
            const base8 = src_addr; const base16 = src_addr >> 1; const heap8 = em.HEAP8;
            em.HEAP16[base16] = 2; // AF_INET
            // port 27015 -> 0x6987 in network order
            heap8[base8 + 2] = 0x69;
            heap8[base8 + 3] = 0x87;
            heap8[base8 + 4] = 127; heap8[base8 + 5] = 0; heap8[base8 + 6] = 0; heap8[base8 + 7] = 1;
          }
          if (addrlen){ em.HEAP32[addrlen >> 2] = 16; }
          return copyLen;
        };
        this.recvfromPointer = this.em.addFunction(recvfromCallback, 'iiiiiii');
        this.em.Module.ccall('register_recvfrom_callback', null, ['number'], [this.recvfromPointer]);
      }
      clearRecvfromCallback(){
        if (this.clearCallback('register_recvfrom_callback', this.recvfromPointer)){
          this.recvfromPointer = undefined;
        }
      }
    }

    const net = new Net();
    netRef = net;

    net.registerSendtoCallback((packet) => {
      try { channel.send(packet.data); } catch (_) {}
    });

    const em = await XashCreate({
      args: ['-console', '-dev', '-windowed', '-game', 'cstrike'],
      onRuntimeInitialized: async function () {
        // Build Em adapter around Module and hook Net
        const Module = this;
        const emAdapter = {
          Module,
          HEAPU8: Module.HEAPU8,
          HEAP8: Module.HEAP8,
          HEAP16: Module.HEAP16,
          HEAP32: Module.HEAP32,
          addFunction: (fn, sig) => (Module.addFunction ? Module.addFunction(fn, sig) : (typeof addFunction !== 'undefined' ? addFunction(fn, sig) : (()=>{ throw new Error('addFunction unavailable')})())),
          removeFunction: (ptr) => (Module.removeFunction ? Module.removeFunction(ptr) : (typeof removeFunction !== 'undefined' ? removeFunction(ptr) : undefined)),
        };
        try { net.run(emAdapter); } catch (e) { setStatus('Net run error: ' + e.message); }
        setStatus('Engine initialized.');
      },
    });
    void em;
  }
})();
