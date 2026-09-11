// The recording page: /demos/<name> boots the engine, fetches the demo and its map, plays
// it, and the bar under the picture is the transport. This drives that bar the way a
// person would and says what the engine reported at each step.
//
//   node bench/demopage.mjs kz_2007_patriotas.dem
import { launch, line, RELAY, credentials } from './lib.mjs';
import { writeFileSync } from 'node:fs';

const name = process.argv[2] ?? 'kz_2007_patriotas.dem';
const OUT = process.env.OUT ?? '.';
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 620 }, httpCredentials: credentials });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
const started = Date.now();
await page.goto(`${RELAY}/demos/${encodeURIComponent(name)}`);
await page.waitForFunction(() => !document.getElementById('demo-bar').hidden, null, { timeout: 240_000 });
line('bar shown after', `${((Date.now() - started) / 1000).toFixed(1)} s`);
const state = () => page.evaluate(() => JSON.parse(window.__xash.em.Module.ccall('Demo_WebState', 'string', [], [])));
await page.waitForFunction(() => { try { const s = JSON.parse(window.__xash.em.Module.ccall('Demo_WebState', 'string', [], [])); return s.playing && s.section > 0 && s.time > 1; } catch { return false; } }, null, { timeout: 60_000 });
line('playing', JSON.stringify(await state()));
const steps = await page.evaluate(() => (window.__loadSteps ?? []).map(s => `${s.text} (${(s.ms / 1000).toFixed(1)}s)`));
for (const s of steps) console.log('      ' + s);
const shot = (tag) => page.screenshot({ path: `${OUT}/page-${tag}.png` });
await shot('playing');
await page.click('#demo-play'); await page.waitForTimeout(800); const p1 = await state(); await page.waitForTimeout(1200); const p2 = await state();
line('paused', `${p1.time} → ${p2.time}, button says "${await page.textContent('#demo-play')}"`);
await page.click('#demo-play');
await page.evaluate(() => { const s = document.getElementById('demo-scrub'); s.value = '333'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); });
await page.waitForTimeout(1500); const after = await state(); line('scrubbed to a third', `time ${after.time} of ${after.length}`);
await page.selectOption('#demo-speed', '2'); await page.waitForTimeout(500); line('speed', `${(await state()).speed}× · status "${await page.textContent('#demo-status')}"`);
await page.selectOption('#demo-speed', '1');
await page.click('#demo-details-open'); await page.waitForTimeout(300); await shot('details');
line('details title', await page.textContent('#demo-details-title')); await page.click('#demo-details-close');
const buttons = await page.$$eval('#demo-view button', bs => bs.map(b => b.textContent));
line('perspective', buttons.length ? buttons.join(' · ') : await page.textContent('#demo-view'));
if (buttons.length) {
    await page.click('#demo-view button:has-text("Eyes")'); await page.waitForTimeout(1500); await shot('eyes');
    await page.click('#demo-view button:has-text("Next")'); await page.waitForTimeout(1500); await shot('next');
    await page.click('#demo-view button:has-text("Overview")'); await page.waitForTimeout(1500); await shot('overview');
}
const before = (await state()).time; await page.keyboard.press('ArrowRight'); await page.waitForTimeout(1200); line('arrow right', `${before} → ${(await state()).time}`);
line('page errors', errors.length ? errors.join(' | ') : 'none');
const all = await page.evaluate(() => (window.__xashLog ?? []));
writeFileSync(`${OUT}/page-engine.log`, all.join('\n'));
for (const l of all.filter(l => /demo|error|host_error|missing|couldn't/i.test(l) && !/NET_QueuePacket/.test(l)).slice(-10)) console.log('      ' + l.trim());
await context.close(); await browser.close();
