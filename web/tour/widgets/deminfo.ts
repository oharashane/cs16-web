// Inside a recording: drop a .dem, or pick one of ours, and the page reads it — the
// header, the directory, every frame's kind, the server's own greeting, what it
// precached, what the recorder typed, and the path they walked, drawn from the view
// origin each frame carries. All of it here; the file never leaves the browser.
import { parseDemo, FRAME_KINDS, type Demo } from '../dem';
import { esc, mmss, kb } from '../fmt';

let last: Demo | null = null;
export const lastDemo = () => last;
const listeners: ((d: Demo) => void)[] = [];
export const onDemo = (fn: (d: Demo) => void) => { listeners.push(fn); if (last) fn(last); };

export async function mount(root: HTMLElement) {
    const drop = document.createElement('div'); drop.className = 'drop';
    drop.innerHTML = '<span>Drop a <code>.dem</code> here, or</span>';
    const pick = document.createElement('input'); pick.type = 'file'; pick.accept = '.dem'; pick.style.font = 'inherit';
    const ours = document.createElement('select'); ours.innerHTML = '<option value="">one of ours…</option>';
    drop.append(pick, ours); root.append(drop);
    const out = document.createElement('div'); root.append(out);
    let smallest: string | null = null;
    try {
        const list = await fetch('/api/demos', { cache: 'no-store' }).then(r => r.json()) as { demos: { name: string; bytes: number; map: string }[] };
        for (const d of [...list.demos].sort((a, b) => a.bytes - b.bytes)) { const o = document.createElement('option'); o.value = d.name; o.textContent = `${d.name} · ${d.map} · ${(d.bytes / 1048576).toFixed(1)} MB`; ours.append(o); smallest ??= d.name; }
    } catch { /* no list */ }

    const show = (buf: ArrayBuffer, title: string, playable?: string) => {
        out.replaceChildren();
        let d: Demo;
        try { d = parseDemo(buf); } catch (err) { out.innerHTML = `<p class="missing">${esc(String((err as Error).message ?? err))}</p>`; return; }
        last = d; for (const fn of listeners) fn(d);
        const play = d.sections.filter(s => s.type !== 0);
        const fig = document.createElement('div'); fig.className = 'figure';
        const who = d.hltv ? '<span class="pill hltv">HLTV</span> a spectator\'s recording — every player in it' : `<span class="pill pov">POV</span> ${esc(d.recorder || 'a player')}'s own view`;
        fig.innerHTML = `<b>${esc(title)}</b> — ${esc(d.map)} · ${esc(d.game)} · protocol ${d.protocol}${d.protocol < 48 ? ' <span class="pill old">before October 2008</span>' : ''} · ${mmss(d.seconds)} · ${(d.bytes / 1048576).toFixed(1)} MB
            <div class="facts" style="margin:8px 0">
              <div><b>Recording</b>${who}</div>
              <div><b>Server</b>${esc(d.server || '—')}${d.build ? ' · build ' + d.build : ''}${d.maxPlayers ? ' · ' + d.maxPlayers + ' slots' : ''}</div>
              <div><b>Movement</b>gravity ${d.gravity ?? '?'} · max speed ${d.maxSpeed ?? '?'} · sky ${esc(d.sky || '?')}</div>
              <div><b>Server messages</b>${kb(play.reduce((a, s) => a + s.netBytes, 0))}</div>
            </div>
            <table class="t"><tr><th>section</th><th class="n">seconds</th><th class="n">frames</th><th class="n">KB</th><th>frames by kind</th></tr>
            ${d.sections.map(s => `<tr><td>${esc(s.description)}</td><td class="n">${s.seconds.toFixed(1)}</td><td class="n">${s.frames.toLocaleString()}</td><td class="n">${(s.length / 1024).toFixed(0)}</td><td class="note">${s.counts.map((c, k) => c ? `${FRAME_KINDS[k]} ${c.toLocaleString()}` : '').filter(Boolean).join(' · ')}</td></tr>`).join('')}</table>`;
        const pts = play.flatMap(s => s.path);
        if (pts.length > 2) {
            const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
            const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
            const W = 640, H = 340, pad = 22, sc = Math.min((W - 2 * pad) / Math.max(1, maxX - minX), (H - 2 * pad) / Math.max(1, maxY - minY));
            const c = document.createElement('canvas'); c.width = W; c.height = H; c.style.maxWidth = '100%'; c.style.background = '#0a0a0a'; c.style.borderRadius = '8px'; c.style.marginTop = '10px';
            const ctx = c.getContext('2d')!;
            ctx.strokeStyle = '#f0b429'; ctx.lineWidth = 1.4; ctx.beginPath();
            pts.forEach((p, i) => { const x = pad + (p[0] - minX) * sc, y = H - pad - (p[1] - minY) * sc; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
            ctx.stroke();
            ctx.fillStyle = '#9cc4ff'; ctx.beginPath(); ctx.arc(pad + (pts[0][0] - minX) * sc, H - pad - (pts[0][1] - minY) * sc, 4, 0, 7); ctx.fill();
            ctx.fillStyle = '#9a9a9a'; ctx.font = '11px system-ui';
            ctx.fillText(`the view's path from above — ${pts.length} samples across ${Math.round(maxX - minX)} × ${Math.round(maxY - minY)} units; blue is the start`, pad, 15);
            fig.append(c);
        }
        const cmds = play.flatMap(s => s.commands), snds = play.flatMap(s => s.sounds);
        const byKind: Record<string, number> = {};
        for (const r of d.resources) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
        fig.insertAdjacentHTML('beforeend', `
            <details><summary class="note">what the server precached: ${d.resources.length} files (${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'})</summary><p class="cmds">${d.resources.slice(0, 400).map(r => esc(r.path)).join(' · ') || '—'}</p></details>
            <details><summary class="note">what the recorder typed: ${cmds.length} distinct commands</summary><p class="cmds">${cmds.map(esc).join(' · ') || '—'}</p></details>
            <details><summary class="note">sounds the recorder's client played: ${snds.length}</summary><p class="cmds">${snds.map(esc).join(' · ') || '—'}</p></details>
            <details><summary class="note">the mod's user messages: ${d.userMessages.length}</summary><p class="cmds">${d.userMessages.map(esc).join(' · ') || '—'}</p></details>
            ${d.parsedUpTo ? `<p class="note">The message parse stopped at ${esc(d.parsedUpTo)} — the frames above are read in full either way.</p>` : ''}
            ${playable ? `<p class="caption"><a href="/recordings/${encodeURIComponent(playable)}">Play this recording</a> — the game itself, about 200 MB the first time.</p>` : '<p class="caption">Upload it on <a href="/demos">the demos page</a> to play it.</p>'}`);
        out.append(fig);
    };
    pick.addEventListener('change', async () => { const f = pick.files?.[0]; if (f) { ours.value = ''; show(await f.arrayBuffer(), f.name); } });
    ours.addEventListener('change', async () => {
        if (!ours.value) return;
        out.innerHTML = '<p class="note">fetching…</p>';
        const r = await fetch('/content/demos/' + encodeURIComponent(ours.value));
        if (!r.ok) { out.innerHTML = `<p class="missing">${r.status}</p>`; return; }
        show(await r.arrayBuffer(), ours.value, ours.value);
    });
    if (smallest) { ours.value = smallest; ours.dispatchEvent(new Event('change')); }
    for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); });
    for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); });
    drop.addEventListener('drop', async e => { const f = (e as DragEvent).dataTransfer?.files?.[0]; if (f) { ours.value = ''; show(await f.arrayBuffer(), f.name); } });
}
