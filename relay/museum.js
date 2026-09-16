// The museum's shared script: the wings' nav, the record dialog (a map from above, a
// model turning, the stars, a curator's fields), the fly-through and the game in a
// dialog over the page, and the pictures. Every wing includes it; ME is who is here,
// injected by the relay. Everything lives in one scope and the wings' pages get what
// they use through the window, so a page's own helpers of the same name shadow rather
// than collide.
(() => {
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = id => document.getElementById(id);
const mb = b => (b / 1048576).toFixed(1);
const stars = (a, withCount = true) => a == null || (a.stars == null && a.rating == null) ? '<span class="stars muted">☆☆☆☆☆</span>'
  : `<span class="stars" title="${esc((a.stars ?? a.rating).toFixed ? (a.stars ?? a.rating).toFixed(1) : a.stars)} from ${a.votes || 0}">${'★'.repeat(Math.round(a.stars ?? a.rating))}${'☆'.repeat(5 - Math.round(a.stars ?? a.rating))}${withCount && a.votes ? `<small>${a.votes}</small>` : ''}</span>`;
const FAMILY_WORDS = { classic: 'Classic — bombs and hostages', arena: 'Arena — aim, awp, fy, gungame', climb: 'Climb — kz and bhop', surf: 'Surf', zombie: 'Zombie — zm, ze, biohazard', deathrun: 'Deathrun', 'hide-and-seek': 'Hide and seek', escape: 'Escape', jailbreak: 'Jailbreak', minigame: 'Minigames', other: 'Everything else', player: 'Player skins', weapon: 'Weapon models', prop: 'Props and map models', textures: 'Model textures', 'protocol-48': 'Recordings' };
const FAMILY_SHORT = { classic: 'classic', arena: 'arena', climb: 'climb', surf: 'surf', zombie: 'zombie', deathrun: 'deathrun', 'hide-and-seek': 'hide and seek', escape: 'escape', jailbreak: 'jailbreak', minigame: 'minigame', other: 'other', player: 'player skin', weapon: 'weapon', prop: 'prop', textures: 'textures' };
let ME = typeof __ME__ !== 'undefined' ? __ME__ : null;
let CURATOR = !!(ME && ME.curator);
// a page the relay does not write into (the story, the engine room) asks who is here
const meReady = ME !== null || typeof __ME__ !== 'undefined' ? Promise.resolve() : fetch('/api/me').then(r => r.ok ? r.json() : null).then(d => { if (d && d.name) { ME = { name: d.name, curator: d.role === 'admin' }; CURATOR = ME.curator; } }).catch(() => {});

async function api(path, opts) { const r = await fetch('/api/museum' + path, opts); if (!r.ok) throw new Error((await r.text()) || r.status); return r.json(); }
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// --- the wings' nav ----------------------------------------------------------------------
const WINGS = [['/', 'Lobby'], ['/play', 'Play'], ['/maps', 'Maps'], ['/models', 'Models'], ['/recordings', 'Recordings'], ['/story', 'The story'], ['/engine', 'The engine'], ['/world', 'The wider world'], ['/curators', 'The curators’ room']];
function navHtml(here) {
  return `<nav class="wings">${WINGS.map(([h, t]) => `<a href="${h}"${h === here ? ' class="here"' : ''}>${t}</a>`).join('')}<span class="who">${ME ? `${esc(ME.name)}${CURATOR ? ', curator' : ''}` : 'the family login'}</span></nav>`;
}
document.addEventListener('DOMContentLoaded', () => meReady.then(() => { const slot = document.querySelector('[data-nav]'); if (slot) slot.outerHTML = navHtml(slot.dataset.nav); }));

// --- the pictures --------------------------------------------------------------------------
// The previews are made offline (scripts/previews.mjs) and kept under content/previews by
// the record's id: <id>.jpg is the picture, <id>-plan.png the map from above.
const picture = a => `/content/previews/${a.id}.jpg`;
const planPicture = a => `/content/previews/${a.id}-plan.png`;
// which records have pictures, asked once, so a card without one asks for nothing
let PREVIEWS = null;
const previewsReady = fetch('/api/previews').then(r => r.ok ? r.json() : {}).then(d => { PREVIEWS = new Set(d.ids || []); }).catch(() => { PREVIEWS = new Set(); });
const hasPicture = a => PREVIEWS ? PREVIEWS.has(a.id) : false;

function cardHtml(a) {
  const fam = FAMILY_SHORT[a.family] || a.family || '';
  return `<a class="card" href="#a/${a.id}" data-a="${a.id}"><div class="pic">${hasPicture(a) ? `<img src="${picture(a)}" alt="" loading="lazy">` : ''}${fam ? `<span class="fam">${esc(fam)}</span>` : ''}</div><div class="body"><b>${esc(a.name)}</b><div class="line"><span>${stars(a)}</span><span>${a.kind === 'map' ? mb(a.bytes) + ' MB' : esc(a.selfDescription || '').slice(0, 24)}</span></div></div></a>`;
}

// --- the peek: a thing, a fly-through, or the game, over the page --------------------------
let dlg, frame, body;
function ensureDialog() {
  if (dlg) return;
  document.body.insertAdjacentHTML('beforeend', `<dialog id="peek"><div class="bar"><span id="peek-title"></span><button type="button" id="peek-link" class="quiet" title="Copy a link that opens this exhibit">copy link</button><a id="peek-open" href="#" target="_blank">open in a tab</a><button type="button" id="peek-close">close</button></div><div id="peek-frame-wrap" hidden><iframe id="peek-frame" allow="pointer-lock; fullscreen; autoplay"></iframe></div><div id="peek-body" class="body" hidden></div><p id="peek-say" class="say muted"></p></dialog>`);
  dlg = $('peek'); frame = $('peek-frame'); body = $('peek-body');
  $('peek-close').addEventListener('click', () => dlg.close());
  $('peek-link').addEventListener('click', () => { const link = dlg.dataset.link || location.href; navigator.clipboard?.writeText(link).then(() => say('Link copied: ' + link), () => say(link)); });
  dlg.addEventListener('close', () => { frame.src = 'about:blank'; body.innerHTML = ''; if (location.hash.startsWith('#a/')) history.replaceState(null, '', location.pathname + location.search + (window.__afterPeek || '')); if (window.onPeekClose) window.onPeekClose(); });
  const opened = new MutationObserver(() => { if (dlg.open && window.onPeekOpen) window.onPeekOpen(); });
  opened.observe(dlg, { attributes: true, attributeFilter: ['open'] });
}
function showFrame(url, title) { ensureDialog(); $('peek-title').textContent = title; $('peek-open').href = url; body.hidden = true; $('peek-frame-wrap').hidden = false; frame.src = url; $('peek-say').textContent = ''; if (!dlg.open) dlg.showModal(); }
function showBody(html, title, url) { ensureDialog(); $('peek-title').textContent = title; $('peek-open').href = url || '#'; frame.src = 'about:blank'; $('peek-frame-wrap').hidden = true; body.hidden = false; body.innerHTML = html; $('peek-say').textContent = ''; if (!dlg.open) dlg.showModal(); }
const say = t => { ensureDialog(); $('peek-say').textContent = t; };

// The game on a map: the lab for anyone with a name (with a bot to play against, if asked),
// the server everybody is on for a curator.
async function play(map, server, bots) {
  showFrame('about:blank', `${map} — ${server === 'main' ? 'the server' : 'the lab'}`);
  say('Changing the map…');
  try {
    const d = await post('/play', { map, server, bots: bots ? 1 : 0 });
    say(d.said + (bots ? ' — a bot joins as the map loads;' : ' —') + ' the game opens in a moment, and the map comes down as you join.');
    setTimeout(() => { frame.src = server === 'main' ? '/play' : '/play?server=27016'; }, 1500);
  } catch (e) { say('Could not: ' + e.message); }
}

// --- a map from above -----------------------------------------------------------------------
// The vertex lump drawn as lines is the map's own floor plan; its floors and roofs are
// filled with their textures' average colours (from the relay, which reads the wads);
// the spawns, the bomb sites and the hostages sit on top. Returns the canvas.
const rawOf = a => a.store === 'server' ? `/raw/maps/${encodeURIComponent(a.name)}.bsp` : '/drive/' + a.path.replace(/^.*\/organized\//, '').split('/').map(encodeURIComponent).join('/');
async function drawPlan(a, box) {
  try {
    const r = await fetch(rawOf(a)); if (!r.ok) throw new Error(r.status);
    const buf = await r.arrayBuffer(), dv = new DataView(buf);
    const lump = i => ({ offset: dv.getInt32(4 + i * 8, true), length: dv.getInt32(8 + i * 8, true) });
    const ents = new TextDecoder('latin1').decode(new Uint8Array(buf, lump(0).offset, lump(0).length));
    const entities = [...ents.matchAll(/\{([^}]*)\}/g)].map(m => Object.fromEntries([...m[1].matchAll(/"([^"]+)"\s*"([^"]*)"/g)].map(k => [k[1], k[2]])));
    const vs = lump(3), n = Math.floor(vs.length / 12);
    if (n < 8) throw new Error('no geometry');
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const xs = new Float32Array(n), ys = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = dv.getFloat32(vs.offset + i * 12, true), y = dv.getFloat32(vs.offset + i * 12 + 4, true); xs[i] = x; ys[i] = y; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const W = 800, H = Math.max(300, Math.min(800, Math.round(W * (maxY - minY) / ((maxX - minX) || 1)))), pad = 12;
    const sc = Math.min((W - 2 * pad) / ((maxX - minX) || 1), (H - 2 * pad) / ((maxY - minY) || 1));
    const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H);
    const px = x => pad + (x - minX) * sc, py = y => H - pad - (y - minY) * sc;
    const es = lump(12), ne = Math.floor(es.length / 4);
    try {
      const planQ = a.store === 'server' ? `map=${encodeURIComponent(a.name)}` : `path=${encodeURIComponent(a.path)}`;
      const colours = await (await fetch('/api/plan?' + planQ)).json();
      const tl = lump(2), ntex = dv.getInt32(tl.offset, true), texColour = [];
      for (let i = 0; i < ntex && i < 4096; i++) {
        const mo = tl.offset + dv.getInt32(tl.offset + 4 + i * 4, true);
        const name = mo > tl.offset && mo + 16 <= buf.byteLength ? new TextDecoder('latin1').decode(new Uint8Array(buf, mo, 16)).replace(/\0.*$/, '').toLowerCase() : '';
        texColour.push(/^(sky|aaatrigger|clip|origin|hint|skip|null|\{)/.test(name) ? null : (colours[name] || null));
      }
      const planes = lump(1), texinfo = lump(6), faces = lump(7), surfedges = lump(13);
      const nf = Math.floor(faces.length / 20), polys = [];
      for (let f = 0; f < nf; f++) {
        const fo = faces.offset + f * 20, plane = dv.getUint16(fo, true), first = dv.getInt32(fo + 4, true), count = dv.getInt16(fo + 8, true), ti = dv.getInt16(fo + 10, true);
        const nz = dv.getFloat32(planes.offset + plane * 20 + 8, true);
        if (Math.abs(nz) < 0.45 || count < 3 || count > 64) continue;
        const tex = dv.getInt32(texinfo.offset + ti * 40 + 32, true), colour = texColour[tex];
        if (!colour) continue;
        const pts = []; let zsum = 0;
        for (let k = 0; k < count; k++) {
          const se = dv.getInt32(surfedges.offset + (first + k) * 4, true);
          const vi = se >= 0 ? dv.getUint16(es.offset + se * 4, true) : dv.getUint16(es.offset + (-se) * 4 + 2, true);
          if (vi >= n) { pts.length = 0; break; }
          pts.push([xs[vi], ys[vi]]); zsum += dv.getFloat32(vs.offset + vi * 12 + 8, true);
        }
        if (pts.length >= 3) polys.push({ pts, z: zsum / pts.length, colour });
      }
      polys.sort((p, q) => p.z - q.z);
      for (const pl of polys) {
        ctx.fillStyle = `rgba(${pl.colour.map(v => Math.round(Math.min(255, v * 0.9 + 25))).join(',')},0.55)`;
        ctx.beginPath(); ctx.moveTo(px(pl.pts[0][0]), py(pl.pts[0][1]));
        for (let k = 1; k < pl.pts.length; k++) ctx.lineTo(px(pl.pts[k][0]), py(pl.pts[k][1]));
        ctx.closePath(); ctx.fill();
      }
    } catch (e) { /* the plan is still the edges */ }
    ctx.strokeStyle = 'rgba(232,226,207,.22)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < ne; i++) {
      const p1 = dv.getUint16(es.offset + i * 4, true), p2 = dv.getUint16(es.offset + i * 4 + 2, true);
      if (p1 >= n || p2 >= n) continue;
      ctx.moveTo(px(xs[p1]), py(ys[p1])); ctx.lineTo(px(xs[p2]), py(ys[p2]));
    }
    ctx.stroke();
    const models = lump(14), boxes = [];
    for (let i = 0; i < Math.floor(models.length / 64); i++) { const o = models.offset + i * 64; boxes.push([dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 12, true), dv.getFloat32(o + 16, true)]); }
    const marks = [[/^info_player_start$/, '#6fa8ff', 'CT spawn'], [/^info_player_deathmatch$/, '#ff7a6a', 'T spawn'], [/^(func|info)_bomb_target$/, '#ffd166', 'bomb site'], [/^hostage_entity$/, '#8fd694', 'hostage'], [/^info_vip_start$/, '#d9c37a', 'VIP'], [/^(func|info)_escapezone$/, '#8fd694', 'escape zone'], [/^func_buyzone$/, '#9a9a9a', 'buy zone']];
    const legend = [];
    for (const [re, colour, label] of marks) {
      let count = 0;
      for (const e of entities) {
        if (!re.test(e.classname || '')) continue;
        if (e.origin) { const [x, y] = e.origin.split(/\s+/).map(Number); ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(px(x), py(y), 5, 0, 7); ctx.fill(); count++; }
        else { const m = /^\*(\d+)$/.exec(e.model || ''); const b = m && boxes[Number(m[1])]; if (!b) continue; ctx.fillStyle = colour + '44'; ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.fillRect(px(b[0]), py(b[3]), (b[2] - b[0]) * sc, (b[3] - b[1]) * sc); ctx.strokeRect(px(b[0]), py(b[3]), (b[2] - b[0]) * sc, (b[3] - b[1]) * sc); count++; }
      }
      if (count) legend.push(`<span style="color:${colour}">●</span> ${label} ${count}`);
    }
    if (box) { box.innerHTML = ''; box.append(c); box.insertAdjacentHTML('beforeend', `<p>From above — the map's own floors and roofs in their textures' colours, low to high, and its ${ne.toLocaleString()} edges. ${legend.join(' · ')}</p>`); }
    return c;
  } catch (e) { if (box) box.innerHTML = `<p>No plan: ${esc(e.message)}</p>`; throw e; }
}

// --- a model, turning -------------------------------------------------------------------------
async function drawModel(a, box) {
  try {
    const url = wearUrl(a);
    const r = await fetch(url); if (!r.ok) throw new Error(r.status);
    const buf = await r.arrayBuffer(), dv = new DataView(buf), b = new Uint8Array(buf);
    const str = (o, n) => { let t = ''; for (let i = 0; i < n && b[o + i]; i++) t += String.fromCharCode(b[o + i]); return t; };
    const i32 = o => dv.getInt32(o, true), f32 = o => dv.getFloat32(o, true);
    if (str(0, 4) !== 'IDST') throw new Error(str(0, 4) === 'IDSQ' ? 'a sequence-group file: the animations of a split model, not the model' : 'not a studio model');
    const numbones = i32(140), boneindex = i32(144), numtextures = i32(180), textureindex = i32(184), numbodyparts = i32(204), bodypartindex = i32(208), numseq = i32(164);
    let texs = [];
    const readTex = (raw, dvx, count, index) => { const out = []; for (let i = 0; i < count && i < 64; i++) { const o = index + i * 80; const w = dvx.getInt32(o + 68, true), h = dvx.getInt32(o + 72, true), ti = dvx.getInt32(o + 76, true); const pal = ti + w * h; let rr = 0, gg = 0, bb = 0, n = 0; for (let k = 0; k < w * h; k += 7) { const p = raw[ti + k]; rr += raw[pal + p * 3]; gg += raw[pal + p * 3 + 1]; bb += raw[pal + p * 3 + 2]; n++; } out.push(n ? [rr / n, gg / n, bb / n] : [140, 140, 140]); } return out; };
    if (numtextures > 0) texs = readTex(b, dv, numtextures, textureindex);
    else { try { const rt = await fetch(url.replace(/\.mdl$/i, 'T.mdl')); if (rt.ok) { const tb = await rt.arrayBuffer(), tdv = new DataView(tb), traw = new Uint8Array(tb); texs = readTex(traw, tdv, tdv.getInt32(180, true), tdv.getInt32(184, true)); } } catch { /* grey then */ } }
    const mats = [];
    for (let i = 0; i < numbones; i++) {
      const o = boneindex + i * 112, parent = i32(o + 32);
      const v = [0, 1, 2, 3, 4, 5].map(k => f32(o + 64 + k * 4));
      const [cx, sx, cy, sy, cz, sz] = [Math.cos(v[3]), Math.sin(v[3]), Math.cos(v[4]), Math.sin(v[4]), Math.cos(v[5]), Math.sin(v[5])];
      const m = [[cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx, v[0]], [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx, v[1]], [-sy, cy * sx, cy * cx, v[2]]];
      if (parent >= 0 && mats[parent]) { const p = mats[parent], out = [[0,0,0,0],[0,0,0,0],[0,0,0,0]]; for (let r2 = 0; r2 < 3; r2++) for (let c = 0; c < 4; c++) { let t = 0; for (let k = 0; k < 3; k++) t += p[r2][k] * m[k][c]; if (c === 3) t += p[r2][3]; out[r2][c] = t; } mats.push(out); } else mats.push(m);
    }
    const xf = (m, v) => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2] + m[0][3], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2] + m[1][3], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2] + m[2][3]];
    const tris = [];
    for (let bp = 0; bp < numbodyparts; bp++) {
      const o = bodypartindex + bp * 76, nummodels = i32(o + 64), modelindex = i32(o + 72);
      if (nummodels < 1) continue;
      const mo = modelindex, nummesh = i32(mo + 72), meshindex = i32(mo + 76), numverts = i32(mo + 80), vertinfoindex = i32(mo + 84), vertindex = i32(mo + 88);
      const verts = [];
      for (let v = 0; v < numverts; v++) { const bone = b[vertinfoindex + v]; const p = [f32(vertindex + v * 12), f32(vertindex + v * 12 + 4), f32(vertindex + v * 12 + 8)]; verts.push(mats[bone] ? xf(mats[bone], p) : p); }
      for (let mi = 0; mi < nummesh; mi++) {
        const me = meshindex + mi * 20, triindex = i32(me + 4), skin = i32(me + 8);
        const colour = texs[skin] || [150, 150, 150];
        let p = triindex;
        for (;;) {
          let count = dv.getInt16(p, true); p += 2; if (count === 0) break;
          const fan = count < 0; count = Math.abs(count);
          const idx = []; for (let k = 0; k < count; k++) { idx.push(dv.getUint16(p, true)); p += 8; }
          for (let k = 2; k < idx.length; k++) {
            const t = fan ? [idx[0], idx[k - 1], idx[k]] : (k % 2 ? [idx[k - 1], idx[k - 2], idx[k]] : [idx[k - 2], idx[k - 1], idx[k]]);
            if (t.every(i => verts[i])) tris.push({ v: t.map(i => verts[i]), colour });
          }
        }
      }
    }
    if (!tris.length) throw new Error('no geometry to draw');
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const t of tris) for (const v of t.v) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
    const centre = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2), size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
    const W = 420, H = 420, c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
    box.innerHTML = ''; box.append(c);
    box.insertAdjacentHTML('beforeend', `<p>${tris.length.toLocaleString()} triangles · ${numbones} bones · ${numseq} sequences · ${texs.length} textures, in their rest pose, turning.</p>`);
    let angle = 0, alive = true;
    const light = [0.5, -0.6, 0.62];
    const frameFn = () => {
      if (!alive || !box.isConnected) { alive = false; return; }
      angle += 0.012;
      const ca = Math.cos(angle), sa = Math.sin(angle), sc = (W * 0.82) / size;
      const drawn = tris.map(t => {
        const pts = t.v.map(v => { const x = v[0] - centre[0], y = v[1] - centre[1], z = v[2] - centre[2]; const rx = x * ca - y * sa, ry = x * sa + y * ca; return [W / 2 + rx * sc, H / 2 - z * sc, ry]; });
        const ax = pts[1][0] - pts[0][0], ay = pts[1][1] - pts[0][1], az = pts[1][2] - pts[0][2], bx = pts[2][0] - pts[0][0], by = pts[2][1] - pts[0][1], bz = pts[2][2] - pts[0][2];
        const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, len = Math.hypot(nx, ny, nz) || 1;
        const shade = Math.max(0.55, Math.min(1.35, 0.9 + 0.5 * (nx / len * light[0] + ny / len * light[1] + nz / len * light[2])));
        return { pts, depth: (pts[0][2] + pts[1][2] + pts[2][2]) / 3, shade, colour: t.colour };
      }).sort((p, q) => q.depth - p.depth);
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, W, H);
      for (const d of drawn) { ctx.fillStyle = `rgb(${d.colour.map(cc => Math.min(255, Math.round((cc * 0.8 + 40) * d.shade))).join(',')})`; ctx.beginPath(); ctx.moveTo(d.pts[0][0], d.pts[0][1]); ctx.lineTo(d.pts[1][0], d.pts[1][1]); ctx.lineTo(d.pts[2][0], d.pts[2][1]); ctx.closePath(); ctx.fill(); }
      requestAnimationFrame(frameFn);
    };
    if (dlg) dlg.addEventListener('close', () => { alive = false; }, { once: true });
    requestAnimationFrame(frameFn);
  } catch (e) { box.innerHTML = `<p>No turntable: ${esc(e.message)}</p>`; }
}

// --- wearing a model --------------------------------------------------------------------------
const STOCK_PLAYERS = ['gign', 'gsg9', 'sas', 'urban', 'terror', 'leet', 'arctic', 'guerilla', 'vip'];
function wearOptions(a) {
  const file = a.path.split('/').pop();
  const name = file.replace(/\.mdl$/i, '');
  if (/T$/.test(name) && a.family === 'textures') return null;
  if (a.family === 'player' || /\/player\//i.test(a.path)) return { kind: 'player', file, choices: STOCK_PLAYERS.map(cls => ({ label: `as ${cls}`, dest: `models/player/${cls}/${cls}.mdl` })), guess: STOCK_PLAYERS.find(cls => name.toLowerCase().includes(cls)) };
  if (/^[vpw]_/i.test(name)) return { kind: 'weapon', file, choices: [{ label: `over ${file}`, dest: `models/${file}` }] };
  return null;
}
function wearUrl(a) {
  if (a.store === 'server') return `/raw/${a.path.split('/').map(encodeURIComponent).join('/')}`;
  const rel = a.path.startsWith('/') ? a.path.replace(/^.*\/organized\//, '') : 'content/' + a.path;
  return '/drive/' + rel.split('/').map(encodeURIComponent).join('/');
}
const worn = { get list() { try { return JSON.parse(localStorage.getItem('wear') || '[]'); } catch { return []; } }, set list(v) { localStorage.setItem('wear', JSON.stringify(v)); } };
function wearHtml(a) {
  const opt = wearOptions(a); if (!opt) return '';
  const current = worn.list;
  const mine = current.filter(w => w.url === wearUrl(a));
  return `<div class="wear"><b>Wear it</b> — your own screen only, as it always was: ${opt.choices.map(c => `<button type="button" data-wear="${esc(c.dest)}"${mine.some(w => w.dest === c.dest) ? ' class="on"' : ''}>${esc(c.label)}</button>`).join(' ')}${mine.length ? ` <button type="button" data-unwear="1" class="quiet">take it off</button>` : ''}<p class="muted" style="margin:.2rem 0 0">${opt.kind === 'player' ? 'A skin replaces one of the stock classes: choose which. Everyone sees their own choice, not yours.' : 'Replaces the stock model of the same name in your game.'} ${current.length ? `Wearing now: ${current.map(w => esc(w.name)).join(', ')}.` : ''} <a href="/play" target="_blank">Open the game</a> and it is on.</p></div>`;
}

// --- the record --------------------------------------------------------------------------------
// One thing in full: the picture and the plan or the turntable, the facts, the stars (anyone
// with a name votes; their latest replaces their earlier), and for a curator the fields —
// the note, the status, on display or not, where it came from.
async function artifact(id, opts = {}) {
  showBody('<p class="muted">loading…</p>', '…');
  const d = await api('/artifacts/' + id); const a = d.artifact;
  dlg.dataset.link = opts.link || (location.origin + location.pathname + '#a/' + id);
  const fly = a.kind === 'map' ? (a.store === 'server' ? `/fly?path=${encodeURIComponent(a.name)}` : `/fly?path=${encodeURIComponent(a.path)}`) : '';
  const rows = [['Family', FAMILY_WORDS[a.family] || a.family], ['Size', mb(a.bytes) + ' MB'], ['Says of itself', a.selfDescription], ['Sky', a.sky], ['Author', a.author], ['Year', a.year], ['Source', a.source ? `<a href="${esc(a.source)}" target="_blank">${esc(a.source)}</a>` : ''], ['Licence', a.license], ['Curator’s note', a.note], CURATOR ? ['Store', a.store] : null, CURATOR ? ['Status', a.status] : null, a.inRotation ? ['In the rotation', 'yes'] : null, CURATOR && d.twins.length ? ['Same content elsewhere', d.twins.map(t => `${esc(t.store)}: ${esc(t.name)}`).join(', ')] : null, CURATOR && d.sameName.length ? ['Same name elsewhere', d.sameName.map(t => `<a href="#a/${t.id}">${esc(t.store)}</a>${t.identical ? ' (identical)' : ' (a different version)'}`).join(', ')] : null].filter(r => r && r[1]);
  const monitor = opts.monitor && a.kind === 'map' && fly ? `<div class="monitor"><iframe src="${fly}&still=1" allow="pointer-lock" title="${esc(a.name)} through the museum's camera"></iframe><span class="cam">● CAM ${esc(a.name.toUpperCase())}</span><span class="hint">drag to look · WASD to fly · the camera stays on the wall</span></div>` : '';
  const html = `
    ${monitor}
    ${a.kind === 'map' ? '<div class="plan" id="plan"><p>drawing the map from above…</p></div>' : a.kind === 'model' ? '<div class="plan" id="plan"><p>reading the model…</p></div>' : ''}
    <p class="sub">${esc(a.kind)} · ${esc(FAMILY_SHORT[a.family] || a.family)} · ${stars(a)}${a.shown ? '' : ' · <span class="muted">in the backlog, not on display</span>'}</p>
    ${hasPicture(a) ? `<div class="shots" id="shots">${[1, 2, 3].map(n => `<img src="/content/previews/${a.id}${n === 1 ? '' : '-' + n}.jpg" alt="" onerror="this.remove()">`).join('')}</div>` : ''}
    <p class="doors">${fly ? `<a href="${fly}" data-fly-url="${fly}" data-title="${esc(a.name)} — fly-through">Fly through it</a>` : ''}${a.kind === 'map' && !a.fatal ? `<a href="#" data-play="${esc(a.name)}" data-bots="1">Play it against a bot</a><a href="#" data-play="${esc(a.name)}">Play it, empty (the lab)</a>` : ''}${a.kind === 'map' && !a.fatal && CURATOR && a.store === 'server' ? `<a href="#" data-play="${esc(a.name)}" data-server="main">Load it on the server, for everyone</a>` : ''}${a.kind === 'demo' && a.store === 'server' ? `<a href="/recordings/${encodeURIComponent(a.name)}.dem" target="_blank">Play the recording</a>` : ''}</p>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${typeof v === 'string' && v.startsWith('<') ? v : esc(v)}</dd>`).join('')}</dl>
    <p>${a.said.map(t => `<span class="tag said" title="${esc(t.by)}">${esc(t.value)}</span>`).join('')}${a.tags.filter(t => CURATOR || !/^(has|size):/.test(t)).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</p>
    ${a.kind === 'model' ? wearHtml(a) : ''}
    ${ME ? `<p class="rate"><b>Your stars</b> ${[1,2,3,4,5].map(n => `<button type="button" data-rate="${n}"${d.mine === n ? ' class="on"' : ''} title="${['not great','okay','good','really great','truly exceptional'][n-1]}">${'★'.repeat(n)}</button>`).join(' ')} <span class="muted small">${d.mine != null ? `you gave ${d.mine}` : 'one vote per person; your latest counts'}</span></p>` : '<p class="muted">Open the museum from your own invitation link to give it stars.</p>'}
    ${CURATOR ? `<form class="say" id="say">
      <label><span>On display</span><select name="shown"><option value="true"${a.shown ? ' selected' : ''}>yes — in the wings</option><option value="false"${a.shown ? '' : ' selected'}>no — the backlog</option></select></label>
      <label><span>Status</span><select name="status">${['untested','plays','missing-textures','broken','retired'].map(s => `<option${a.status === s ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
      <label><span>Curator’s note</span><textarea name="note" rows="2">${esc(a.note)}</textarea></label>
      <label><span>Author</span><input type="text" name="author" value="${esc(a.author)}"></label>
      <label><span>Year</span><input type="text" name="year" value="${esc(a.year ?? '')}" size="6"></label>
      <label><span>Source</span><input type="text" name="source" value="${esc(a.source)}"></label>
      <label><span>Licence</span><input type="text" name="license" value="${esc(a.license)}"></label>
      <label><span>Tags to add</span><input type="text" name="add" placeholder="comma-separated: favourite, needs-fixing"></label>
      <button type="submit">Save, as ${esc(ME.name)}</button></form>` : ''}
    ${CURATOR ? `<h3>What it needs <span class="muted">${d.deps.length}, ${d.deps.filter(x => x.location === 'missing').length} missing</span></h3>
    <table>${d.deps.map(x => `<tr><td>${esc(x.kind)}</td><td><code>${esc(x.path)}</code></td><td class="${x.location === 'missing' ? 'no' : ''}">${esc(x.location)}${x.fatal ? ' <b>fatal</b>' : ''}</td><td class="muted">${esc(x.note)}</td></tr>`).join('')}</table>` : (d.deps.some(x => x.location === 'missing') ? `<p class="muted small">${d.deps.filter(x => x.location === 'missing').length} of the files it names are nowhere; the game does without them.</p>` : '')}
    ${d.history.length && CURATOR ? `<h3>History</h3><p class="muted">${d.history.map(h => `${new Date(h.atUtc).toLocaleDateString()} ${esc(h.caller)}: ${esc(h.field)} → ${esc(String(h.to)).slice(0, 80)}`).join('<br>')}</p>` : ''}`;
  showBody(html, a.name, opts.open || ('/' + (a.kind === 'map' ? 'maps' : a.kind === 'model' ? 'models' : 'curators') + '#a/' + id));
  if (a.kind === 'map') drawPlan(a, body.querySelector('#plan')).catch(() => {});
  if (a.kind === 'model') drawModel(a, body.querySelector('#plan'));
  body.querySelectorAll('[data-wear]').forEach(btn => btn.addEventListener('click', () => {
    const dest = btn.dataset.wear, url = wearUrl(a);
    worn.list = [...worn.list.filter(w => w.dest !== dest && w.url !== url), { name: a.name, url, dest }];
    artifact(id).then(() => say(`Wearing ${a.name} as ${dest.replace(/^models\//, '')} — open the game and it is on.`));
  }));
  body.querySelector('[data-unwear]')?.addEventListener('click', () => { worn.list = worn.list.filter(w => w.url !== wearUrl(a)); artifact(id).then(() => say('Taken off.')); });
  body.querySelectorAll('[data-rate]').forEach(b => b.addEventListener('click', async () => {
    body.querySelectorAll('[data-rate]').forEach(x => x.classList.toggle('on', x === b));
    try { const r = await post('/artifacts/' + id + '/vote', { stars: Number(b.dataset.rate) }); say(r.said); body.querySelector('.sub .stars').outerHTML = stars(r); document.dispatchEvent(new CustomEvent('museum:changed', { detail: { id, stars: r } })); }
    catch (err) { say('Not counted: ' + err.message); }
  }));
  body.querySelector('#say')?.addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target;
    const said = { shown: f.shown.value === 'true', status: f.status.value, note: f.note.value, author: f.author.value, source: f.source.value, license: f.license.value, add: f.add.value };
    if (f.year.value.trim()) said.year = Number(f.year.value); else said.year = null;
    try { const r = await post('/artifacts/' + id + '/say', said); say(r.said); document.dispatchEvent(new CustomEvent('museum:changed', { detail: { id } })); setTimeout(() => artifact(id), 900); }
    catch (err) { say('Not saved: ' + err.message); }
  });
}

document.addEventListener('click', e => {
  const a = e.target.closest('a'); if (!a) return;
  if (a.dataset.play) { e.preventDefault(); play(a.dataset.play, a.dataset.server || 'lab', a.dataset.bots === '1'); }
  else if (a.dataset.fly) { e.preventDefault(); api('/artifacts/' + a.dataset.fly).then(d => { const x = d.artifact; showFrame(x.store === 'server' ? `/fly?path=${encodeURIComponent(x.name)}` : `/fly?path=${encodeURIComponent(x.path)}`, x.name + ' — fly-through'); }); }
  else if (a.dataset.flyUrl) { e.preventDefault(); showFrame(a.dataset.flyUrl, a.dataset.title); }
  else if (a.dataset.a) { e.preventDefault(); history.replaceState(null, '', location.pathname + location.search + '#a/' + a.dataset.a); artifact(a.dataset.a); }
});
// a record named in the hash opens on arrival, on any wing
document.addEventListener('DOMContentLoaded', () => { if (location.hash.startsWith('#a/')) artifact(location.hash.slice(3)); });

Object.assign(window, { esc, $, mb, stars, FAMILY_WORDS, FAMILY_SHORT, api, post, navHtml, picture, planPicture, previewsReady, hasPicture, cardHtml, showFrame, showBody, say, play, drawPlan, drawModel, wearOptions, wearUrl, wearHtml, artifact });
Object.defineProperty(window, 'ME', { get: () => ME });
Object.defineProperty(window, 'CURATOR', { get: () => CURATOR });
})();
