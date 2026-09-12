// Inside a recording: drop a .dem, or pick one of ours, and the page reads it — the
// header, the directory, every frame's kind, what the recorder typed, the sounds their
// client played, and the path they walked, drawn from the view origin each frame carries.
// The same walk as relay/demoinfo.go, without the message decoding.
const kinds = ['netmsg (loading)', 'netmsg', 'demo start', 'command', 'client data', 'next section', 'event', 'weapon anim', 'sound', 'demo buffer'];
function parse(buf: ArrayBuffer) {
    const dv = new DataView(buf), b = new Uint8Array(buf);
    const str = (o: number, n: number) => { let s = ''; for (let i = 0; i < n && b[o + i]; i++) s += String.fromCharCode(b[o + i]); return s; };
    if (str(0, 6) !== 'HLDEMO') throw new Error('not a GoldSrc demo (no HLDEMO magic)');
    const demoProtocol = dv.getInt32(8, true), protocol = dv.getInt32(12, true), map = str(16, 260), game = str(276, 260), dirOffset = dv.getInt32(540, true);
    const n = dv.getInt32(dirOffset, true);
    const sections: { type: number; description: string; seconds: number; frames: number; offset: number; length: number; counts: number[]; commands: string[]; sounds: string[]; path: [number, number, number][]; yaw: number[] }[] = [];
    for (let i = 0; i < n && i < 64; i++) {
        const o = dirOffset + 4 + i * 92;
        const s = { type: dv.getInt32(o, true), description: str(o + 4, 64), seconds: dv.getFloat32(o + 76, true), frames: dv.getInt32(o + 80, true), offset: dv.getInt32(o + 84, true), length: dv.getInt32(o + 88, true), counts: new Array(10).fill(0) as number[], commands: [] as string[], sounds: [] as string[], path: [] as [number, number, number][], yaw: [] as number[] };
        let pos = s.offset, end = s.offset + s.length, seen = new Set<string>(), samples = 0;
        while (pos + 9 <= end) {
            const kind = b[pos]; pos += 9;
            if (kind < 10) s.counts[kind]++;
            switch (kind) {
                case 0: case 1: {
                    if (samples++ % 4 === 0) { s.path.push([dv.getFloat32(pos + 4, true), dv.getFloat32(pos + 8, true), dv.getFloat32(pos + 12, true)]); s.yaw.push(dv.getFloat32(pos + 20, true)); }
                    const len = dv.getInt32(pos + 436 + 28, true); pos += 436 + 28 + 4 + len; break;
                }
                case 3: { const c = str(pos, 64).trim(); if (c && !seen.has(c) && s.commands.length < 200) { seen.add(c); s.commands.push(c); } pos += 64; break; }
                case 4: pos += 32; break; case 6: pos += 84; break; case 7: pos += 8; break;
                case 8: { const len = dv.getInt32(pos + 4, true); const name = str(pos + 8, len); if (!s.sounds.includes(name) && s.sounds.length < 200) s.sounds.push(name); pos += 8 + len + 16; break; }
                case 9: pos += 4 + dv.getInt32(pos, true); break;
                case 2: case 5: break;
                default: pos = end;
            }
            if (kind === 5) break;
        }
        sections.push(s);
    }
    return { demoProtocol, protocol, map, game, sections, bytes: buf.byteLength };
}
const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const mmss = (s: number) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };
export async function mount(root: HTMLElement) {
    const drop = document.createElement('div'); drop.className = 'drop';
    drop.innerHTML = '<span>Drop a <code>.dem</code> here, or</span>';
    const pick = document.createElement('input'); pick.type = 'file'; pick.accept = '.dem'; pick.style.font = 'inherit';
    const ours = document.createElement('select'); ours.innerHTML = '<option value="">one of ours…</option>';
    drop.append(pick, ours); root.append(drop);
    let smallest: string | null = null;
    try { const list = await fetch('/api/demos', { cache: 'no-store' }).then(r => r.json()) as { demos: { name: string; bytes: number; map: string }[] }; for (const d of [...list.demos].sort((a, b) => a.bytes - b.bytes)) { const o = document.createElement('option'); o.value = d.name; o.textContent = `${d.name} · ${d.map} · ${(d.bytes / 1048576).toFixed(1)} MB`; ours.append(o); smallest ??= d.name; } } catch { /* no list */ }
    const out = document.createElement('div'); root.append(out);
    const show = (buf: ArrayBuffer, title: string) => {
        out.replaceChildren();
        try {
            const d = parse(buf);
            const fig = document.createElement('div'); fig.className = 'figure';
            const play = d.sections.filter(s => s.type !== 0);
            const total = play.reduce((a, s) => a + s.seconds, 0);
            fig.innerHTML = `<b>${escape(title)}</b> — ${escape(d.map)} · ${escape(d.game)} · protocol ${d.protocol}${d.protocol < 48 ? ' (before October 2008)' : ''} · ${mmss(total)} · ${(d.bytes / 1048576).toFixed(1)} MB
                <table class="t" style="margin-top:8px"><tr><th>section</th><th class="n">seconds</th><th class="n">frames</th><th class="n">KB</th><th>frames by kind</th></tr>${d.sections.map(s => `<tr><td>${escape(s.description)}</td><td class="n">${s.seconds.toFixed(1)}</td><td class="n">${s.frames.toLocaleString()}</td><td class="n">${(s.length / 1024).toFixed(0)}</td><td class="note">${s.counts.map((c, k) => c ? `${kinds[k]} ${c.toLocaleString()}` : '').filter(Boolean).join(' · ')}</td></tr>`).join('')}</table>`;
            // the path walked
            const pts = play.flatMap(s => s.path);
            if (pts.length > 2) {
                const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
                const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
                const W = 640, H = 360, pad = 20, sc = Math.min((W - 2 * pad) / Math.max(1, maxX - minX), (H - 2 * pad) / Math.max(1, maxY - minY));
                const c = document.createElement('canvas'); c.width = W; c.height = H; c.style.maxWidth = '100%'; c.style.background = '#0a0a0a'; c.style.borderRadius = '8px'; c.style.marginTop = '10px';
                const ctx = c.getContext('2d')!; ctx.strokeStyle = '#f0b429'; ctx.lineWidth = 1.5; ctx.beginPath();
                pts.forEach((p, i) => { const x = pad + (p[0] - minX) * sc, y = H - pad - (p[1] - minY) * sc; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
                ctx.stroke();
                ctx.fillStyle = '#9cc4ff'; const f = pts[0]; ctx.beginPath(); ctx.arc(pad + (f[0] - minX) * sc, H - pad - (f[1] - minY) * sc, 4, 0, 7); ctx.fill();
                ctx.fillStyle = '#9a9a9a'; ctx.font = '11px system-ui'; ctx.fillText(`the view's path, from above: ${pts.length} samples, ${Math.round(maxX - minX)} × ${Math.round(maxY - minY)} units; blue is the start`, pad, 14);
                fig.append(c);
            }
            const cmds = play.flatMap(s => s.commands), snds = play.flatMap(s => s.sounds);
            fig.insertAdjacentHTML('beforeend', `<details><summary class="note">what the recorder typed: ${cmds.length} distinct commands</summary><p class="note" style="font-family:ui-monospace,Menlo,monospace;font-size:12px">${cmds.map(escape).join(' · ') || '—'}</p></details>
                <details><summary class="note">sounds the recorder's client played: ${snds.length}</summary><p class="note" style="font-family:ui-monospace,Menlo,monospace;font-size:12px">${snds.map(escape).join(' · ') || '—'}</p></details>`);
            if (ours.value) fig.insertAdjacentHTML('beforeend', `<p class="caption"><a href="/demos/${encodeURIComponent(ours.value)}">Play this recording</a> — the game itself, about 200 MB the first time.</p>`);
            out.append(fig);
        } catch (err) { out.innerHTML = `<p class="missing">${escape(String((err as Error).message ?? err))}</p>`; }
    };
    pick.addEventListener('change', async () => { const f = pick.files?.[0]; if (f) { ours.value = ''; show(await f.arrayBuffer(), f.name); } });
    ours.addEventListener('change', async () => { if (!ours.value) return; out.innerHTML = '<p class="note">fetching…</p>'; const r = await fetch('/content/demos/' + encodeURIComponent(ours.value)); if (!r.ok) { out.innerHTML = `<p class="missing">${r.status}</p>`; return; } show(await r.arrayBuffer(), ours.value); });
    // the smallest of ours to begin with
    if (smallest) { ours.value = smallest; ours.dispatchEvent(new Event('change')); }
    for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); });
    for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); });
    drop.addEventListener('drop', async e => { const f = e.dataTransfer?.files?.[0]; if (f) { ours.value = ''; show(await f.arrayBuffer(), f.name); } });
}
