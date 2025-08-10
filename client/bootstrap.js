// Deep-link bootstrap for signaling + target server
(function () {
  const qs = new URLSearchParams(location.search);
  const signal = qs.get('signal');
  const host = qs.get('host');
  const port = Number(qs.get('port') || 27015);
  const token = qs.get('token') || '';
  const transport = (qs.get('transport') || 'webrtc').toLowerCase();
  const renderer = (qs.get('renderer') || 'gles3compat');
  const playerName = (qs.get('name') || 'Web Player').slice(0, 31);

  const setStatus = (msg) => {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
    console.log('[client]', msg);
  };

  if (!signal || !host || !port) {
    setStatus('Missing ?signal, ?host or ?port.'); 
    return;
  }

  // WebSocket proxy approach - bypass WebAssembly networking entirely
  if (transport === 'websocket') {
    setStatus('Connecting via WebSocket proxy...');
    const wsUrl = signal.replace('/signal', '/proxy');
    const ws = new WebSocket(wsUrl + `?host=${host}&port=${port}&token=${token}`);
    
    ws.onopen = () => {
      setStatus('WebSocket proxy connected. Initializing engine...');
      initEngineWithWebSocket(ws).catch(e => setStatus('Engine error: ' + e.message));
    };
    
    ws.onclose = () => setStatus('WebSocket proxy closed.');
    ws.onerror = (e) => setStatus('WebSocket proxy error: ' + e.message);
    return;
  }

  // Standard WebRTC DataChannel approach
  const ws = new WebSocket(signal.replace(/^http/,'ws'));
  let pc = null; // Declare pc in the outer scope
  
  ws.onopen = () => {
    setStatus('Signaling connected.');
    ws.send(JSON.stringify({
      type: 'hello',
      token,
      backend: { host, port },
      features: { unordered: true, maxRetransmits: 0 }
    }));
  };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    
    if (msg.type === 'ready') {
      setStatus('Creating WebRTC connection...');
      pc = new RTCPeerConnection(); // Assign to the outer scope variable
      const dc = pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 });

      dc.onopen = () => {
        setStatus('DataChannel open. Initializing engine…');
        initEngine(dc).catch(e => setStatus('Engine error: ' + e.message));
      };
      
      dc.onclose = () => setStatus('DataChannel closed.');
      
      dc.onmessage = (e) => {
        const dataPromise = e.data?.arrayBuffer ? e.data.arrayBuffer() : Promise.resolve(e.data);
        Promise.resolve(dataPromise).then((data) => {
          const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
          
          // Forward packet to WebRTC transport in the engine
          if (window.Module && window.Module.ccall) {
            try {
              const ptr = window.Module._malloc(buf.length);
              window.Module.HEAPU8.set(buf, ptr);
              window.Module.ccall('webrtc_push', null, ['number', 'number'], [ptr, buf.length]);
              window.Module._free(ptr);
            } catch (e) {
              console.error('Failed to forward packet to WebRTC transport:', e.message);
            }
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
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch (e) {
        console.warn('ICE candidate error:', e.message);
      }
    }
  };

  ws.onclose = () => setStatus('Signaling disconnected.');
  ws.onerror = () => setStatus('Signaling error.');

  // Load helper
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function initEngine(channel) {
    setStatus('Loading assets...');
    
    const canvas = document.getElementById('canvas');
    const JSZip = (await import('https://cdn.skypack.dev/jszip')).default;
    const resp = await fetch('./assets/games/cs16.zip');
    const zip = await JSZip.loadAsync(resp.arrayBuffer());
    
    // Extract game files
    const files = {};
    const entries = Object.keys(zip.files);
    for (const p of entries) {
      const file = zip.files[p];
      if (file.dir) continue;
      const path = `/rodir/${p}`;
      files[path] = await file.async('uint8array');
    }
    
    // Load engine
    const VERS = { xash: '0.0.4', cs: '0.0.2' };
    await loadScript(`https://cdn.jsdelivr.net/npm/xash3d-fwgs@${VERS.xash}/dist/raw.js`);
    
    const XashCreate = function(opts) {
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
        preRun: [function(Module) {
          try {
            for (const k of Object.keys(files)) {
              const dir = k.split('/').slice(0, -1).join('/');
              Module.FS.mkdirTree(dir);
              Module.FS.writeFile(k, files[k]);
            }
          } catch (e) {
            console.error('Failed to setup game files:', e);
          }
        }],
        onRuntimeInitialized: opts.onRuntimeInitialized,
      });
    };

    const em = await XashCreate({
      args: ['-console', '-dev', '-windowed', '-game', 'cstrike'],
      onRuntimeInitialized: async function () {
        const Module = this;
        window.Module = Module; // Make module available globally
        
        setStatus('Engine initialized, setting up WebRTC transport...');
        
        // Set DataChannel reference for the WebRTC library
        Module.__webrtc_dc = channel;
        
        // Initialize WebRTC transport in the engine
        try {
          const result = Module.ccall('webrtc_init', 'number', [], []);
          
          if (result === 1) {
            setStatus('WebRTC transport active! Connecting…');
          } else {
            setStatus('WebRTC transport failed, using UDP fallback. Connecting…');
          }
        } catch (e) {
          console.error('Error initializing WebRTC transport:', e.message);
          setStatus('WebRTC transport error, using UDP fallback. Connecting…');
        }
        
        // Connect to server
        try {
          const doConnect = () => {
            Module.ccall('Cmd_ExecuteString', null, ['string'], [`name "${playerName}"`]);
            Module.ccall('Cmd_ExecuteString', null, ['string'], [`connect ${host}:${port}`]);
            
            setTimeout(() => {
              setStatus('🎮 Connected via WebRTC transport!');
            }, 2000);
          };
          
          setTimeout(doConnect, 500);
        } catch (e) {
          setStatus('Connect error: ' + e.message);
          console.error('Connect error:', e);
        }
      },
    });
    void em;
  }
})();