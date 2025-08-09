// Deep-link bootstrap for signaling + target server
(function () {
  const qs = new URLSearchParams(location.search);
  const signal = qs.get('signal');
  const host = qs.get('host');
  const port = Number(qs.get('port') || 27015);
  const token = qs.get('token') || '';
  const transport = (qs.get('transport') || 'webrtc').toLowerCase();

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
      pc = new RTCPeerConnection({
        iceServers: [{ urls: (window.STUN_SERVERS || 'stun:stun.l.google.com:19302') }]
      });
      dc = pc.createDataChannel('cs16', { ordered: false, maxRetransmits: 0 });
      dc.binaryType = 'arraybuffer';

      dc.onopen = () => setStatus('DataChannel open. (TODO: hook engine send/recv here)');
      dc.onclose = () => setStatus('DataChannel closed.');
      dc.onmessage = (e) => {
        // TODO: feed e.data (ArrayBuffer) into engine's recv path
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) ws.send(JSON.stringify({ type: 'ice', candidate: e.candidate }));
      };

      const offer = await pc.createOffer();
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
})();
