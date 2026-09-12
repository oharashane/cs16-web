// Inside a model: drop a .mdl, or pick one of ours, and the page reads its header — the
// bones, the sequences with their frame rates, the body parts, the textures drawn from
// their 8-bit palettes. Layout: studio.h of the Half-Life SDK, studio version 10.
type Seq = { label: string; fps: number; frames: number; blends: number };
type Tex = { name: string; width: number; height: number; flags: number; index: number };
function parse(buf: ArrayBuffer) {
    const dv = new DataView(buf), b = new Uint8Array(buf);
    const str = (o: number, n: number) => { let s = ''; for (let i = 0; i < n && b[o + i]; i++) s += String.fromCharCode(b[o + i]); return s; };
    const i32 = (o: number) => dv.getInt32(o, true), f32 = (o: number) => dv.getFloat32(o, true);
    if (str(0, 4) !== 'IDST') throw new Error(str(0, 4) === 'IDSQ' ? 'a sequence group file (the animations of a split model), not a model' : 'not a studio model (no IDST magic)');
    const version = i32(4), name = str(8, 64);
    if (version !== 10) throw new Error(`studio version ${version}; Half-Life models are 10`);
    const numbones = i32(140), boneindex = i32(144), numseq = i32(164), seqindex = i32(168), numtextures = i32(180), textureindex = i32(184), numskinfamilies = i32(196), numbodyparts = i32(204), bodypartindex = i32(208), numattachments = i32(212), numhitboxes = i32(156);
    const bones: { name: string; parent: number }[] = [];
    for (let i = 0; i < numbones && i < 256; i++) { const o = boneindex + i * 112; bones.push({ name: str(o, 32), parent: i32(o + 32) }); }
    const seqs: Seq[] = [];
    for (let i = 0; i < numseq && i < 512; i++) { const o = seqindex + i * 176; seqs.push({ label: str(o, 32), fps: f32(o + 32), frames: i32(o + 56), blends: i32(o + 120) }); }
    const texs: Tex[] = [];
    for (let i = 0; i < numtextures && i < 128; i++) { const o = textureindex + i * 80; texs.push({ name: str(o, 64), flags: i32(o + 64), width: i32(o + 68), height: i32(o + 72), index: i32(o + 76) }); }
    const parts: { name: string; models: number }[] = [];
    for (let i = 0; i < numbodyparts && i < 32; i++) { const o = bodypartindex + i * 76; parts.push({ name: str(o, 64), models: i32(o + 64) }); }
    return { name, version, bones, seqs, texs, parts, numskinfamilies, numattachments, numhitboxes, bytes: buf.byteLength, raw: b };
}
function drawTexture(t: Tex, raw: Uint8Array): HTMLCanvasElement {
    const c = document.createElement('canvas'); c.width = t.width; c.height = t.height;
    const ctx = c.getContext('2d')!; const img = ctx.createImageData(t.width, t.height);
    const pal = t.index + t.width * t.height;
    for (let i = 0; i < t.width * t.height; i++) { const p = raw[t.index + i]; img.data[i * 4] = raw[pal + p * 3]; img.data[i * 4 + 1] = raw[pal + p * 3 + 1]; img.data[i * 4 + 2] = raw[pal + p * 3 + 2]; img.data[i * 4 + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    return c;
}
const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export function mount(root: HTMLElement) {
    const drop = document.createElement('div'); drop.className = 'drop';
    drop.innerHTML = '<span>Drop a <code>.mdl</code> here, or</span>';
    const pick = document.createElement('input'); pick.type = 'file'; pick.accept = '.mdl'; pick.style.font = 'inherit';
    const ours = document.createElement('select'); ours.innerHTML = '<option value="">one of ours…</option>' + ['gign', 'arctic', 'gsg9', 'sas', 'leet', 'guerilla', 'terror', 'urban', 'vip'].map(n => `<option value="models/player/${n}/${n}.mdl">${n}</option>`).join('');
    drop.append(pick, ours); root.append(drop);
    const out = document.createElement('div'); root.append(out);
    const show = (buf: ArrayBuffer, title: string) => {
        out.replaceChildren();
        try {
            const m = parse(buf);
            const fig = document.createElement('div'); fig.className = 'figure';
            fig.innerHTML = `<b>${escape(title)}</b> — <code>${escape(m.name)}</code>, studio version ${m.version}, ${(m.bytes / 1024).toFixed(0)} KB<div class="note" style="margin:6px 0 10px">${m.bones.length} bones · ${m.seqs.length} sequences · ${m.parts.length} body parts (${m.parts.map(p => `${escape(p.name)}: ${p.models}`).join(', ')}) · ${m.texs.length} textures in ${m.numskinfamilies} skin${m.numskinfamilies === 1 ? '' : 's'} · ${m.numhitboxes} hitboxes · ${m.numattachments} attachments${m.texs.length === 0 ? ' — the textures live in the T.mdl beside it' : ''}</div>`;
            const texRow = document.createElement('div'); texRow.className = 'textures';
            for (const t of m.texs.slice(0, 24)) { const f = document.createElement('figure'); const c = drawTexture(t, m.raw); c.title = t.name; f.append(c, document.createTextNode(`${t.name} ${t.width}×${t.height}${t.flags & 2 ? ' chrome' : ''}${t.flags & 32 ? ' additive' : ''}${t.flags & 64 ? ' masked' : ''}`)); texRow.append(f); }
            fig.append(texRow);
            const seqTable = document.createElement('details'); seqTable.innerHTML = `<summary class="note">the ${m.seqs.length} sequences</summary>`;
            const t = document.createElement('table'); t.className = 't'; t.innerHTML = '<tr><th>#</th><th>sequence</th><th class="n">frames</th><th class="n">fps</th><th class="n">blends</th></tr>' + m.seqs.map((s, i) => `<tr><td class="n">${i}</td><td>${escape(s.label)}</td><td class="n">${s.frames}</td><td class="n">${s.fps.toFixed(0)}</td><td class="n">${s.blends}</td></tr>`).join('');
            seqTable.append(t); fig.append(seqTable);
            const boneTable = document.createElement('details'); boneTable.innerHTML = `<summary class="note">the ${m.bones.length} bones</summary><p class="note" style="font-family:ui-monospace,Menlo,monospace;font-size:12px">${m.bones.map(b => escape(b.name) + (b.parent >= 0 ? ' ← ' + escape(m.bones[b.parent]?.name ?? '?') : '')).join(' · ')}</p>`;
            fig.append(boneTable);
            out.append(fig);
        } catch (err) { out.innerHTML = `<p class="missing">${escape(String((err as Error).message ?? err))}</p>`; }
    };
    pick.addEventListener('change', async () => { const f = pick.files?.[0]; if (f) show(await f.arrayBuffer(), f.name); });
    ours.addEventListener('change', async () => { if (!ours.value) return; out.innerHTML = '<p class="note">fetching…</p>'; const r = await fetch('/raw/' + ours.value); if (!r.ok) { out.innerHTML = `<p class="missing">${ours.value} is not among the server's files (${r.status}); the stock models are inside the base bundle, which the browser unpacks for the game, not for this page</p>`; return; } show(await r.arrayBuffer(), ours.value); });
    // one of ours to begin with: the first the server can serve
    (async () => { for (const n of ['gign', 'arctic', 'gsg9', 'sas', 'leet']) { const path = `models/player/${n}/${n}.mdl`; const r = await fetch('/raw/' + path).catch(() => null); if (r?.ok) { ours.value = path; show(await r.arrayBuffer(), path); return; } } })();
    for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); });
    for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); });
    drop.addEventListener('drop', async e => { const f = e.dataTransfer?.files?.[0]; if (f) show(await f.arrayBuffer(), f.name); });
}
