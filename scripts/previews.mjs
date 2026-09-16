// The pictures for what is on display, made offline so the wings open instantly: for
// every map on display, three views (the whole map from above at an angle, a CT spawn
// and a T spawn looking the way the mapper pointed them) drawn by the fly-through page
// (hlviewer.js: the BSP and its wads, no engine), and the plan from above drawn by the
// maps wing's own code. They land in content/previews as <id>.jpg, <id>-2.jpg, <id>-3.jpg
// and <id>-plan.png, by the record's id, which is what the pages look up.
//
//   node scripts/previews.mjs              every map on display without a picture yet
//   node scripts/previews.mjs --force      all of them again
//   node scripts/previews.mjs de_dust2     by name
//   node scripts/previews.mjs --lobby      the lobby's door pictures
//
// Needs the relay running (RELAY_URL, default http://127.0.0.1:27100) and Playwright,
// which the benches installed.
import { chromium } from '/home/shane/Desktop/cs16-web/web/node_modules/@playwright/test/index.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'content', 'previews');
mkdirSync(OUT, { recursive: true });
const RELAY = process.env.RELAY_URL ?? 'http://127.0.0.1:27100';
const env = Object.fromEntries(readFileSync(join(ROOT, '.relay.env'), 'utf8').split('\n').filter(l => /^\w+=/.test(l)).map(l => l.split(/=(.*)/s).slice(0, 2)));
const credentials = { username: env.RELAY_USER, password: env.RELAY_PASSWORD };
const args = process.argv.slice(2);
const force = args.includes('--force'), lobby = args.includes('--lobby');
const names = args.filter(a => !a.startsWith('--'));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 960, height: 600 }, httpCredentials: credentials });
const page = await context.newPage();
const api = async path => { const r = await page.request.get(RELAY + '/api/museum' + path); if (!r.ok()) throw new Error(await r.text()); return r.json(); };

async function shown() {
  const all = [];
  for (let p = 1; p < 10; p++) { const d = await api(`/artifacts?kind=map&shown=1&size=200&page=${p}`); all.push(...d.items); if (all.length >= d.total) break; }
  return all;
}

// Three poses from the map's own entities: the spawns say where people stand and which
// way the fight goes; the extent says how far back to stand to see it all.
function poses(entities, bounds) {
  const vec = o => (Array.isArray(o) ? o : String(o).split(/\s+/)).map(Number);
  const at = re => entities.filter(e => re.test(e.classname || '') && e.origin).map(e => vec(e.origin)).filter(v => v.length === 3 && v.every(Number.isFinite));
  const mean = pts => pts.length ? pts.reduce((a, b) => a.map((v, i) => v + b[i]), [0, 0, 0]).map(v => v / pts.length) : null;
  const ct = at(/^info_player_start$/), t = at(/^info_player_deathmatch$/);
  const centre = mean([...ct, ...t]) || bounds.centre;
  const look = (from, to) => { const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2]; return { position: from, rotation: [Math.atan2(-dz, Math.hypot(dx, dy)), Math.atan2(dy, dx), 0] }; };
  // a spawn faces the way the mapper pointed it (angles "pitch yaw roll"); failing that,
  // towards the other team
  const spawnEntity = re => entities.find(e => re.test(e.classname || '') && e.origin);
  const fromSpawn = (e, others) => {
    const p = vec(e.origin), eye = [p[0], p[1], p[2] + 40];
    const yaw = e.angles ? vec(e.angles)[1] : NaN;
    if (!Number.isNaN(yaw)) return { position: eye, rotation: [0, yaw * Math.PI / 180, 0] };
    return look(eye, others.length ? mean(others) : centre);
  };
  // the whole map first, from above at an angle: the picture on the card
  const span = Math.max(bounds.size[0], bounds.size[1]);
  const out = [look([bounds.centre[0] - span * 0.55, bounds.centre[1] - span * 0.55, bounds.centre[2] + span * 0.7], bounds.centre)];
  const ctSpawn = spawnEntity(/^info_player_start$/), tSpawn = spawnEntity(/^info_player_deathmatch$/);
  if (ctSpawn) out.push(fromSpawn(ctSpawn, t));
  if (tSpawn) out.push(fromSpawn(tSpawn, ct));
  while (out.length < 3) out.push(out[out.length - 1]);
  return out.slice(0, 3);
}

async function pictures(a) {
  const path = a.store === 'server' ? a.name : a.path;
  await page.goto(`${RELAY}/fly?path=${encodeURIComponent(path)}&still=1`);
  try {
    await page.waitForFunction(() => window.hlv && window.hlv.game.worldScene && window.hlv.game.worldScene.bsp, null, { timeout: 60_000 });
  } catch { console.log(`  ${a.name}: the viewer did not load it`); return false; }
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const g = window.hlv.game, bsp = g.worldScene.bsp;
    const ents = g.entities.map(e => ({ classname: e.classname, origin: e.origin, angles: e.angles }));
    // hlviewer keeps no vertex list; the entities' origins — spawns, lights, items, spread over
    // the map — bound it well enough for a camera
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const verts = ents.filter(e => e.origin).map(e => (Array.isArray(e.origin) ? e.origin : String(e.origin).split(/\s+/)).map(Number)).filter(o => o.length === 3 && o.every(Number.isFinite));
    for (const v of verts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
    if (verts.length < 2) { lo = [-1024, -1024, -256]; hi = [1024, 1024, 256]; }
    return { ents, bounds: { centre: lo.map((v, i) => (v + hi[i]) / 2), size: hi.map((v, i) => v - lo[i]) } };
  });
  const ps = poses(info.ents, info.bounds);
  for (let i = 0; i < ps.length; i++) {
    await page.evaluate(p => { const c = window.hlv.game.camera; c.position[0] = p.position[0]; c.position[1] = p.position[1]; c.position[2] = p.position[2]; c.rotation[0] = p.rotation[0]; c.rotation[1] = p.rotation[1]; c.rotation[2] = 0; }, ps[i]);
    await page.waitForTimeout(500);
    await page.locator('#hlv canvas').first().screenshot({ path: join(OUT, `${a.id}${i === 0 ? '' : '-' + (i + 1)}.jpg`), type: 'jpeg', quality: 82 });
  }
  // the card's picture is the first; an indoor map is black from above, so the brightest
  // view takes its place when the first is dark
  const brightness = await page.evaluate(async files => {
    const out = [];
    for (const f of files) { const img = new Image(); img.src = f + '?' + Date.now(); await new Promise(r => { img.onload = r; img.onerror = r; }); const c = document.createElement('canvas'); c.width = 64; c.height = 40; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 64, 40); const d = x.getImageData(0, 0, 64, 40).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; out.push(s / (d.length / 4) / 3); }
    return out;
  }, [1, 2, 3].map(n => `/content/previews/${a.id}${n === 1 ? '' : '-' + n}.jpg`));
  const best = brightness.indexOf(Math.max(...brightness));
  if (brightness[0] < 28 && best > 0) { const first = join(OUT, `${a.id}.jpg`), other = join(OUT, `${a.id}-${best + 1}.jpg`), tmp = other + '.tmp'; copyFileSync(first, tmp); copyFileSync(other, first); copyFileSync(tmp, other); unlinkSync(tmp); }
  return true;
}

async function plans(list) {
  await page.goto(RELAY + '/maps'); await page.waitForTimeout(1500);
  for (const a of list) {
    try {
      const data = await page.evaluate(async a => { const c = await drawPlan(a, null); return c.toDataURL('image/png'); }, a);
      writeFileSync(join(OUT, `${a.id}-plan.png`), Buffer.from(data.split(',')[1], 'base64'));
    } catch (e) { console.log(`  ${a.name}: no plan (${e.message.split('\n')[0]})`); }
  }
}

if (lobby) {
  // the doors' pictures: one thing from each wing
  const maps = await shown();
  const dust = maps.find(m => m.name === 'de_dust2') || maps[0];
  if (dust && existsSync(join(OUT, `${dust.id}.jpg`))) copyFileSync(join(OUT, `${dust.id}.jpg`), join(OUT, 'lobby-maps.jpg'));
  const shot = async (url, file, clip, wait = 2500) => { await page.goto(RELAY + url); await page.waitForTimeout(wait); await page.screenshot({ path: join(OUT, file), type: 'jpeg', quality: 80, clip }); };
  await shot('/curators', 'lobby-curators.jpg', { x: 0, y: 140, width: 960, height: 540 });
  await shot('/world', 'lobby-world.jpg', { x: 0, y: 120, width: 960, height: 540 }, 6000);
  await shot('/engine#patches', 'lobby-engine.jpg', { x: 220, y: 60, width: 740, height: 416 }, 4000);
  await shot('/story#history', 'lobby-story.jpg', { x: 220, y: 60, width: 740, height: 416 }, 4000);
  await shot('/recordings', 'lobby-recordings.jpg', { x: 0, y: 150, width: 960, height: 540 });
  // a player skin, turning: the first on display, else the first in the backlog
  const model = (await api('/artifacts?kind=model&family=player&shown=1&size=1')).items[0] || (await api('/artifacts?kind=model&family=player&size=1&q=gign')).items[0];
  if (model) {
    await page.goto(RELAY + '/models'); await page.waitForTimeout(1000);
    const data = await page.evaluate(async a => { const box = document.createElement('div'); document.body.append(box); await drawModel(a, box); await new Promise(r => setTimeout(r, 900)); return box.querySelector('canvas').toDataURL('image/jpeg', 0.85); }, model);
    writeFileSync(join(OUT, 'lobby-models.jpg'), Buffer.from(data.split(',')[1], 'base64'));
  }
  const play = join(ROOT, '.bench-xray-150-off.png');
  if (existsSync(play)) { await page.goto('about:blank'); await page.setContent(`<img src="data:image/png;base64,${readFileSync(play).toString('base64')}" style="width:960px;display:block">`); await page.locator('img').screenshot({ path: join(OUT, 'lobby-play.jpg'), type: 'jpeg', quality: 82 }); }
  console.log('lobby pictures written');
} else {
  const list = names.length ? (await shown()).filter(a => names.includes(a.name)) : await shown();
  const todo = list.filter(a => force || !existsSync(join(OUT, `${a.id}.jpg`)));
  console.log(`${list.length} on display, ${todo.length} to picture`);
  let done = 0;
  for (const a of todo) { try { if (await pictures(a)) done++; } catch (e) { console.log(`  ${a.name}: ${e.message.split('\n')[0]}`); } process.stdout.write(`\r  ${done}/${todo.length} ${a.name}          `); }
  console.log();
  await plans(list.filter(a => force || !existsSync(join(OUT, `${a.id}-plan.png`))));
  console.log(`${done} pictured; plans drawn.`);
}
await browser.close();
