// The tour's visuals, made rather than pasted: a thirty-second clip of a real recording
// (the demo page under video capture) and its poster into web/public/tour/, then a
// screenshot of every chapter of the built tour into a directory for a look.
//
//   node bench/tour.mjs clip        makes public/tour/clip.webm and clip.jpg (rebuild the page after)
//   OUT=/tmp/x node bench/tour.mjs shots   screenshots each chapter of /tour
import { launch, line, RELAY, credentials } from './lib.mjs';
import { mkdirSync, statSync } from 'node:fs';

const what = process.argv[2] ?? 'shots';
const browser = await launch();
if (what === 'clip') {
    const dir = new URL('../public/tour/', import.meta.url).pathname;
    mkdirSync(dir, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 960, height: 540 }, httpCredentials: credentials });
    const page = await context.newPage();
    await page.goto(`${RELAY}/demos/hltv_2022_dust2.dem`);
    await page.waitForFunction(() => !document.getElementById('demo-bar').hidden, null, { timeout: 240_000 });
    await page.waitForFunction(() => { try { const s = JSON.parse(window.__xash.em.Module.ccall('Demo_WebState', 'string', [], [])); return s.playing && s.section > 0 && s.time > 1; } catch { return false; } }, null, { timeout: 60_000 });
    // a busy minute of the match, through one player's eyes
    await page.evaluate(() => { const x = window.__xash; x.Cmd_ExecuteString('demo_seek 520'); });
    await page.waitForFunction(() => { try { const s = JSON.parse(window.__xash.em.Module.ccall('Demo_WebState', 'string', [], [])); return !s.seeking && s.time >= 520; } catch { return false; } }, null, { timeout: 60_000 });
    await page.evaluate(() => { const x = window.__xash; x.Cmd_ExecuteString('spec_autodirector 0'); x.Cmd_ExecuteString('spec_mode 4'); for (const e of document.body.children) if (!e.contains(document.querySelector('canvas'))) e.style.visibility = 'hidden'; });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: dir + 'clip.jpg', type: 'jpeg', quality: 80 });
    // the canvas itself, recorded by the page for thirty seconds: no loading screen, no bar
    const base64 = await page.evaluate(seconds => new Promise((resolve, reject) => {
        const stream = document.querySelector('canvas').captureStream(30);
        const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 2_500_000 });
        const chunks = [];
        rec.ondataavailable = e => chunks.push(e.data);
        rec.onstop = () => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.onerror = reject; r.readAsDataURL(new Blob(chunks, { type: 'video/webm' })); };
        rec.start(1000);
        setTimeout(() => rec.stop(), seconds * 1000);
    }), 30);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(dir + 'clip.webm', Buffer.from(base64, 'base64'));
    line('clip', `${dir}clip.webm · ${(statSync(dir + 'clip.webm').size / 1048576).toFixed(1)} MB`);
    await context.close();
} else {
    const OUT = process.env.OUT ?? '.';
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, httpCredentials: credentials });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    await page.goto(`${RELAY}/tour`);
    await page.waitForSelector('.chapter');
    // Every widget mounts when it is scrolled near, and mounting makes the page taller —
    // so walk it more than once, slowly enough for the fetches each widget makes.
    for (let pass = 0; pass < 3; pass++) {
        await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 250)); } });
        await page.waitForTimeout(2500);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1500);
    const ids = await page.$$eval('.chapter', cs => cs.map(c => c.id));
    for (const id of ids) {
        await page.evaluate(id => document.getElementById(id).scrollIntoView(), id);
        await page.waitForTimeout(1500);
        await page.locator('#' + id).screenshot({ path: `${OUT}/tour-${id}.png` });
        line(id, `${OUT}/tour-${id}.png`);
    }
    line('page errors', errors.length ? errors.slice(0, 6).join(' | ') : 'none');
    await context.close();
}
await browser.close();
