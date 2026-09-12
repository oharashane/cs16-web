// Inside a map: a BSP file is fifteen lumps, and two of them tell you most of what a map
// is. The entity lump is plain text — every spawn point, bomb site, hostage, light and
// door, with its position — and the vertex lump is the geometry, which drawn from above
// is the map's own floor plan. Both read here, from the server's copy of the file.
import { esc } from '../fmt';

const LUMPS = ['entities', 'planes', 'textures', 'vertexes', 'visibility', 'nodes', 'texinfo', 'faces', 'lighting', 'clipnodes', 'leaves', 'marksurfaces', 'edges', 'surfedges', 'models'];
const MARKS: { match: RegExp; colour: string; label: string }[] = [
    { match: /^info_player_start$/, colour: '#6cb4ff', label: 'counter-terrorist spawn' },
    { match: /^info_player_deathmatch$/, colour: '#ff8a6c', label: 'terrorist spawn' },
    { match: /^info_vip_start$/, colour: '#d0a0ff', label: 'VIP start' },
    { match: /bomb_target/, colour: '#f0b429', label: 'bomb site' },
    { match: /^hostage_entity$/, colour: '#8ae08a', label: 'hostage' },
    { match: /^func_hostage_rescue$|^info_hostage_rescue$/, colour: '#8ae0d0', label: 'rescue zone' },
    { match: /^func_buyzone$/, colour: '#9a9a9a', label: 'buy zone' },
    { match: /^func_vip_safetyzone$/, colour: '#d0a0ff', label: 'VIP safety zone' },
    { match: /^func_escapezone$/, colour: '#e0d08a', label: 'escape zone' },
];
type Ent = Record<string, string>;
function entities(text: string): Ent[] {
    const out: Ent[] = [];
    const re = /\{([^}]*)\}/g; let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        const e: Ent = {}; const pairs = /"([^"]*)"\s+"([^"]*)"/g; let p: RegExpExecArray | null;
        while ((p = pairs.exec(m[1]))) e[p[1]] = p[2];
        if (e.classname) out.push(e);
    }
    return out;
}
export async function mount(root: HTMLElement) {
    const ctl = document.createElement('div'); ctl.className = 'controls';
    ctl.innerHTML = '<span>Read a map from the server:</span>';
    const pick = document.createElement('select'); pick.innerHTML = '<option value="">loading…</option>';
    const go = document.createElement('button'); go.className = 'quiet'; go.textContent = 'read it';
    ctl.append(pick, go); root.append(ctl);
    const out = document.createElement('div'); root.append(out);
    try {
        const cat = await fetch('/content/catalogue.json', { cache: 'no-store' }).then(r => r.json()) as { maps: { name: string; bytes: number; inRotation: boolean }[] };
        const rot = cat.maps.filter(m => m.inRotation).sort((a, b) => a.bytes - b.bytes);
        pick.innerHTML = rot.map(m => `<option value="${esc(m.name)}">${esc(m.name)} · ${(m.bytes / 1048576).toFixed(1)} MB</option>`).join('');
        if (rot.some(m => m.name === 'de_dust2')) pick.value = 'de_dust2';
    } catch { pick.innerHTML = '<option value="de_dust2">de_dust2</option>'; }

    const read = async () => {
        const name = pick.value; if (!name) return;
        out.innerHTML = '<p class="note">fetching the map…</p>';
        const r = await fetch(`/raw/maps/${encodeURIComponent(name)}.bsp`);
        if (!r.ok) { out.innerHTML = `<p class="missing">${name}.bsp: ${r.status}</p>`; return; }
        const buf = await r.arrayBuffer(), dv = new DataView(buf), b = new Uint8Array(buf);
        const version = dv.getInt32(0, true);
        const lumps = LUMPS.map((n, i) => ({ name: n, offset: dv.getInt32(4 + i * 8, true), length: dv.getInt32(8 + i * 8, true) }));
        const entText = new TextDecoder('latin1').decode(b.subarray(lumps[0].offset, lumps[0].offset + lumps[0].length));
        const ents = entities(entText);
        const world = ents.find(e => e.classname === 'worldspawn') ?? {};
        const counts: Record<string, number> = {};
        for (const e of ents) counts[e.classname] = (counts[e.classname] ?? 0) + 1;
        // the geometry, from above
        const vs = lumps[3], n = Math.floor(vs.length / 12);
        const xs: number[] = [], ys: number[] = [];
        for (let i = 0; i < n; i++) { xs.push(dv.getFloat32(vs.offset + i * 12, true)); ys.push(dv.getFloat32(vs.offset + i * 12 + 4, true)); }
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        const W = 700, H = 420, pad = 18, sc = Math.min((W - 2 * pad) / (maxX - minX || 1), (H - 2 * pad) / (maxY - minY || 1));
        const c = document.createElement('canvas'); c.width = W; c.height = H; c.style.maxWidth = '100%'; c.style.background = '#0a0a0a'; c.style.borderRadius = '8px';
        const ctx = c.getContext('2d')!;
        const px = (x: number) => pad + (x - minX) * sc, py = (y: number) => H - pad - (y - minY) * sc;
        ctx.fillStyle = 'rgba(232,226,207,.16)';
        for (let i = 0; i < n; i++) ctx.fillRect(px(xs[i]), py(ys[i]), 1.3, 1.3);
        // A brush entity — a bomb site, a buy zone, a door — has no origin: it is a chunk of
        // the map's own geometry, named "*N", and the models lump says where that chunk is.
        const models = lumps[14], boxes: { mins: number[]; maxs: number[] }[] = [];
        for (let i = 0; i < Math.floor(models.length / 64); i++) {
            const o = models.offset + i * 64;
            boxes.push({ mins: [dv.getFloat32(o, true), dv.getFloat32(o + 4, true)], maxs: [dv.getFloat32(o + 12, true), dv.getFloat32(o + 16, true)] });
        }
        const place = (e: Ent): { x: number; y: number; w?: number; h?: number } | null => {
            if (e.origin) { const [x, y] = e.origin.split(/\s+/).map(Number); return { x, y }; }
            const m = /^\*(\d+)$/.exec(e.model ?? '');
            const box = m ? boxes[Number(m[1])] : undefined;
            if (!box) return null;
            return { x: (box.mins[0] + box.maxs[0]) / 2, y: (box.mins[1] + box.maxs[1]) / 2, w: Math.abs(box.maxs[0] - box.mins[0]), h: Math.abs(box.maxs[1] - box.mins[1]) };
        };
        const legend: string[] = [];
        for (const mark of MARKS) {
            const hits = ents.map(e => mark.match.test(e.classname) ? place(e) : null).filter(Boolean) as { x: number; y: number; w?: number; h?: number }[];
            if (!hits.length) continue;
            legend.push(`<span style="color:${mark.colour}">■</span> ${mark.label} ${hits.length}`);
            for (const h of hits) {
                if (h.w && h.h) {
                    ctx.fillStyle = mark.colour + '33'; ctx.strokeStyle = mark.colour; ctx.lineWidth = 1;
                    ctx.fillRect(px(h.x - h.w / 2), py(h.y + h.h / 2), h.w * sc, h.h * sc);
                    ctx.strokeRect(px(h.x - h.w / 2), py(h.y + h.h / 2), h.w * sc, h.h * sc);
                } else { ctx.fillStyle = mark.colour; ctx.beginPath(); ctx.arc(px(h.x), py(h.y), 4, 0, 7); ctx.fill(); }
            }
        }
        const fig = document.createElement('div'); fig.className = 'figure';
        fig.innerHTML = `<b>${esc(name)}.bsp</b> — version ${version}${version === 30 ? ' (Half-Life)' : ''} · ${(buf.byteLength / 1048576).toFixed(1)} MB · ${ents.length} entities · ${n.toLocaleString()} vertices${world.message ? ` · <span class="note">“${esc(world.message)}”</span>` : ''}`;
        fig.append(c);
        fig.insertAdjacentHTML('beforeend', `<p class="caption">${legend.join(' · ') || 'no spawns found'} — boxes are brush entities, placed from the map's own geometry; the pale dots are every vertex of it, seen from above.</p>
          <table class="t" style="margin-top:8px"><tr><th>lump</th><th class="n">KB</th><th></th></tr>${lumps.map(l => `<tr><td>${l.name}</td><td class="n">${(l.length / 1024).toFixed(0)}</td><td><div class="fill" style="width:${(l.length / buf.byteLength * 100).toFixed(1)}%;height:9px"></div></td></tr>`).join('')}</table>
          <details style="margin-top:8px"><summary class="note">the ${Object.keys(counts).length} kinds of entity in it</summary><p class="cmds">${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)} ${v}`).join(' · ')}</p></details>
          <details><summary class="note">what the map says about itself (worldspawn)</summary><p class="cmds">${Object.entries(world).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(' · ')}</p></details>`);
        out.replaceChildren(fig);
    };
    go.addEventListener('click', read);
    pick.addEventListener('change', read);
    void read();   // the widget only mounts once it is scrolled to, so read one straight away
}
