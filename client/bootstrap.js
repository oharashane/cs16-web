// Deep-link bootstrap for signaling + target server
(function () {
  let netRef = null;
  const qs = new URLSearchParams(location.search);
  const signal = qs.get('signal');
  const host = qs.get('host');
  const port = Number(qs.get('port') || 27015);
  const token = qs.get('token') || '';
  const transport = (qs.get('transport') || 'webrtc').toLowerCase(); // Default to WebRTC with NetworkingAdapter
  const renderer = (qs.get('renderer') || 'gles3compat');
  const playerName = (qs.get('name') || 'Web Player').slice(0, 31);

  const setStatus = (msg) => {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
    console.log('[client]', msg);
  };

  if (!signal || !host || !port) {
    setStatus('Missing ?signal, ?host or ?port.'); return;
  }

  // WebSocket proxy approach - bypass WebAssembly networking entirely
  if (transport === 'websocket') {
    setStatus('Connecting via WebSocket proxy...');
    const wsUrl = signal.replace('/signal', '/proxy');
    const ws = new WebSocket(wsUrl + `?host=${host}&port=${port}&token=${token}`);
    
    ws.onopen = () => {
      setStatus('WebSocket proxy connected. Initializing engine...');
      // Use direct WebSocket connection instead of WebRTC
      initEngineWithWebSocket(ws).catch(e => setStatus('Engine error: ' + e.message));
    };
    
    ws.onclose = () => setStatus('WebSocket proxy closed.');
    ws.onerror = (e) => setStatus('WebSocket proxy error: ' + e.message);
    return;
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
        console.log('[DEBUG] 📨 DataChannel received message, type:', typeof e.data, 'size:', e.data?.byteLength || e.data?.length || 'unknown');
        const dataPromise = e.data?.arrayBuffer ? e.data.arrayBuffer() : Promise.resolve(e.data);
        Promise.resolve(dataPromise).then((data) => {
          const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
          console.log('[DEBUG] 📨 Processing incoming packet via NetworkingAdapter, size:', buf.length);
          console.log('[DEBUG] 📨 Packet data (first 16 bytes):', Array.from(buf.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '));
          
          // Use networking adapter to queue the packet
          if (window.networkingAdapter) {
            window.networkingAdapter.enqueuePacket(buf);
          }
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
    const VERS = { xash: '0.0.4', cs: '0.0.2' };
    await loadScript(`https://cdn.jsdelivr.net/npm/xash3d-fwgs@${VERS.xash}/dist/raw.js`);
    
    // Load our networking adapter with a safer approach
    const { networkingAdapter } = await import('./networking_adapter.js');
    await networkingAdapter.initialize();
    console.log('[DEBUG] NetworkingAdapter initialized');
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
          case 'xash.wasm': return `https://cdn.jsdelivr.net/npm/xash3d-fwgs@${VERS.xash}/dist/xash.wasm`;
          case 'filesystem_stdio.wasm': return `https://cdn.jsdelivr.net/npm/xash3d-fwgs@${VERS.xash}/dist/filesystem_stdio.wasm`;
          case 'libref_gles3compat.wasm': return `https://cdn.jsdelivr.net/npm/xash3d-fwgs@${VERS.xash}/dist/libref_gles3compat.wasm`;
          case 'libref_soft.wasm': return `https://cdn.jsdelivr.net/npm/xash3d-fwgs@${VERS.xash}/dist/libref_soft.wasm`;
          case 'cl_dlls/menu_emscripten_wasm32.wasm': return `https://cdn.jsdelivr.net/npm/cs16-client@${VERS.cs}/dist/cl_dll/menu_emscripten_wasm32.wasm`;
          case 'dlls/cs_emscripten_wasm32.so': return `https://cdn.jsdelivr.net/npm/cs16-client@${VERS.cs}/dist/dlls/cs_emscripten_wasm32.so`;
          case 'cl_dlls/client_emscripten_wasm32.wasm': return `https://cdn.jsdelivr.net/npm/cs16-client@${VERS.cs}/dist/cl_dll/client_emscripten_wasm32.wasm`;
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

    // Simplified setup without complex networking hooks
    let netRef = null;

    console.log('[DEBUG] Preparing for engine initialization...');
    
    // Set up DataChannel packet forwarding
    window.sendPacketViaDataChannel = (packet) => {
      console.log('[DEBUG] 🚀 Sending packet via DataChannel, size:', packet.length);
      console.log('[DEBUG] 🚀 Packet data (first 16 bytes):', Array.from(packet.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '));
      try { 
        channel.send(packet); 
        console.log('[DEBUG] 🚀 Packet sent successfully');
      } catch (e) {
        console.log('[DEBUG] ❌ Failed to send packet:', e.message);
      }
    };

    const em = await XashCreate({
      args: ['-console', '-dev', '-windowed', '-game', 'cstrike'],
      onRuntimeInitialized: async function () {
        // Build Em adapter around Module and hook Net
        const Module = this;
        
        console.log('[DEBUG] Engine module loaded, proceeding with NetworkingAdapter...');
        // Log available network functions for debugging
        const moduleFunctions = Object.keys(Module).filter(k => typeof Module[k] === 'function');
        const networkFunctions = moduleFunctions.filter(k => 
          k.includes('recv') || k.includes('send') || k.includes('net') || k.includes('callback') || k.includes('socket')
        );
        console.log('[DEBUG] Available network-related functions in engine:', networkFunctions);
        // Try to setup NetworkingAdapter without cross-instance callbacks
        console.log('[DEBUG] Attempting NetworkingAdapter integration...');
        
        // Make adapter available globally for DataChannel callback
        window.networkingAdapter = networkingAdapter;
        
        try {
          // Don't register callbacks directly - use alternative approach
          const success = networkingAdapter.setupEngineHooks(Module);
          
          if (success) {
            setStatus('Engine initialized with NetworkingAdapter! Connecting…');
            console.log('[DEBUG] ✅ NetworkingAdapter integrated successfully!');
          } else {
            setStatus('Engine initialized. NetworkingAdapter setup failed. Connecting…');
            console.log('[DEBUG] ❌ NetworkingAdapter integration failed - using fallback');
          }
        } catch (e) { 
          console.log('[DEBUG] NetworkingAdapter error:', e);
          setStatus('Engine initialized with errors. Connecting…'); 
        }
        try {
          const doConnect = () => {
            console.log('[DEBUG] Setting player name and connecting to server...');
            Module.ccall('Cmd_ExecuteString', null, ['string'], [`name "${playerName}"`]);
            Module.ccall('Cmd_ExecuteString', null, ['string'], [`connect ${host}:${port}`]);
            
            // Show helpful message about networking status
            console.log('[DEBUG] Engine is set up with NetworkingAdapter - should use WebRTC');
            setTimeout(() => {
              setStatus('🚀 NetworkingAdapter active - WebRTC relay should intercept traffic!');
            }, 2000);
          };
          // Delay connect slightly to avoid pool init race
          setTimeout(doConnect, 1200);
        } catch (e) {
          setStatus('Connect error: ' + e.message);
        }
      },
    });
    void em;
  }
})();
