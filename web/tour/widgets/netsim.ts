// The lag is not the network: a netcode simulator. The server knows where the target is;
// it sends a snapshot so many times a second; each takes half a ping to arrive; the client
// draws the world a little in the past — by ex_interp, or by one update when that is 0 —
// so it always has two snapshots to draw between. What you see is where the target was.
export function mount(root: HTMLElement) {
    const W = 900, H = 240;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; canvas.style.width = '100%'; canvas.style.maxWidth = W + 'px'; canvas.style.borderRadius = '8px'; canvas.style.background = '#0a0a0a';
    const ctl = document.createElement('div'); ctl.className = 'controls';
    const slider = (label: string, min: number, max: number, step: number, value: number, unit = '') => {
        const l = document.createElement('label'); const i = document.createElement('input'); i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(value);
        const v = document.createElement('span'); v.className = 'readout'; v.textContent = value + unit;
        i.addEventListener('input', () => { v.textContent = (i.value === '0' && label === 'ex_interp' ? 'auto' : i.value + unit); });
        l.append(label, i, v); ctl.append(l); return i;
    };
    const rate = slider('cl_updaterate', 10, 100, 1, 20, ' /s');
    const interp = slider('ex_interp', 0, 0.2, 0.01, 0.1, ' s');
    const ping = slider('ping', 0, 200, 5, 40, ' ms');
    const loss = slider('loss', 0, 30, 1, 0, ' %');
    interp.dispatchEvent(new Event('input'));
    const out = document.createElement('p'); out.className = 'caption';
    const fig = document.createElement('div'); fig.className = 'figure'; fig.append(canvas, ctl, out);
    root.append(fig);

    const ctx = canvas.getContext('2d')!;
    type Snap = { t: number; x: number; y: number; arrive: number };
    let snaps: Snap[] = [];
    let lastSend = 0;
    const truth = (t: number) => ({ x: W * 0.5 + Math.sin(t / 900) * W * 0.36 + Math.sin(t / 313) * 30, y: H * 0.5 + Math.cos(t / 700) * 40 });
    let shownDelay = 0, lastRender = { x: 0, y: 0 };
    const trail: { x: number; y: number }[] = [];
    let running = true;
    const io = new IntersectionObserver(es => { running = es.some(e => e.isIntersecting); });
    io.observe(canvas);

    function frame(now: number) {
        requestAnimationFrame(frame);
        if (!running) return;
        const r = Number(rate.value), ip = Number(interp.value) || 1 / r, pg = Number(ping.value), lo = Number(loss.value) / 100;
        // the server sends
        if (now - lastSend >= 1000 / r) {
            lastSend = now;
            if (Math.random() >= lo) { const p = truth(now); snaps.push({ t: now, ...p, arrive: now + pg / 2 + Math.random() * 3 }); }
        }
        snaps = snaps.filter(s => now - s.arrive < 3000);
        // the client draws the world at now - interp, from the snapshots that have arrived
        const renderTime = now - ip * 1000;
        const have = snaps.filter(s => s.arrive <= now);
        let a: Snap | undefined, b: Snap | undefined;
        for (const s of have) { if (s.t <= renderTime) a = s; else if (!b) { b = s; break; } }
        let pos: { x: number; y: number };
        if (a && b) { const f = (renderTime - a.t) / (b.t - a.t); pos = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; shownDelay = now - renderTime; }
        else if (a) { pos = { x: a.x, y: a.y }; shownDelay = now - a.t; }   // nothing newer yet: the target holds still
        else pos = lastRender;
        lastRender = pos;
        trail.push(pos); if (trail.length > 40) trail.shift();
        // draw
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#1c1c1c'; ctx.fillRect(0, H - 34, W, 34);
        for (const s of snaps) { const x = 30 + ((now - s.t) / 1500) * (W - 60); if (x > W - 30) continue; ctx.fillStyle = s.arrive <= now ? '#f0b429' : '#555'; ctx.beginPath(); ctx.arc(W - x, H - 17, 4, 0, 7); ctx.fill(); }
        ctx.fillStyle = '#9a9a9a'; ctx.font = '11px system-ui'; ctx.fillText('snapshots on the wire, newest at the right; grey ones have not arrived yet', 30, H - 40);
        const tr = truth(now);
        ctx.strokeStyle = '#2f2f2f'; ctx.lineWidth = 2; ctx.beginPath(); trail.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
        ctx.fillStyle = '#3a3a3a'; ctx.beginPath(); ctx.arc(tr.x, tr.y, 12, 0, 7); ctx.fill();
        ctx.fillStyle = '#9a9a9a'; ctx.fillText('where the target is (the server knows)', tr.x + 16, tr.y + 4);
        ctx.fillStyle = '#f0b429'; ctx.beginPath(); ctx.arc(pos.x, pos.y, 12, 0, 7); ctx.fill();
        ctx.fillStyle = '#e8e2cf'; ctx.fillText('where you see it', pos.x + 16, pos.y - 10);
        const behind = Math.hypot(tr.x - pos.x, tr.y - pos.y);
        out.innerHTML = `You see the target where it was <b class="readout">${shownDelay.toFixed(0)} ms</b> ago: half a ping (${(pg / 2).toFixed(0)}) plus the interpolation window (${(ip * 1000).toFixed(0)}, ${Number(interp.value) ? 'ex_interp' : 'one update at this rate'})${lo ? ', and lost snapshots make it hold still' : ''}. Right now that is ${behind.toFixed(0)} px behind. Bandwidth: about ${(r * 0.15).toFixed(1)} KB/s of snapshots at ${r} a second.`;
    }
    requestAnimationFrame(frame);
}
