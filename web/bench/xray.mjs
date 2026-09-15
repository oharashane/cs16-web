// Does the recording's wallhack show? Plays hltv_2022_dust2 from the chase camera, seeks
// to a few times, and counts the orange pixels with r_demo_xray on and off. The HUD is
// orange too, so the baseline is a few hundred; a hidden player adds to it. The
// screenshots land in the repo root as .bench-xray-<time>-{on,off}.png for a look.
//
//   node bench/xray.mjs
import { launch, RELAY, credentials, line } from './lib.mjs';

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 900, height: 560 }, httpCredentials: credentials });
const page = await context.newPage();
page.on('dialog', d => { console.log('  DIALOG ' + d.message().slice(0, 200)); d.dismiss().catch(() => {}); });
await page.goto(RELAY + '/demos/hltv_2022_dust2.dem');
await page.waitForFunction(() => window.__xash && !document.getElementById('demo-bar').hidden, null, { timeout: 240_000 });
await page.waitForTimeout(4000);
const run = c => page.evaluate(c => window.__xash.Cmd_ExecuteString(c), c);
// only the canvas: the page's own overlays sit on top once pointer lock is gone
await page.evaluate(() => { const c = document.querySelector('canvas'); for (const e of document.body.children) if (!e.contains(c)) e.style.visibility = 'hidden'; });
await run('spec_autodirector 0'); await run('spec_mode 2');
const orange = buf => page.evaluate(src => new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 140 && d[i + 1] < 230 && d[i + 2] < 80) n++;
        resolve(n);
    };
    img.src = src;
}), 'data:image/png;base64,' + buf.toString('base64'));
for (const at of [25, 45, 70, 90, 120, 150, 210]) {
    await run(`demo_seek ${at}`);
    await page.waitForTimeout(6000);
    const counts = {};
    for (const on of [1, 0]) {
        await run(`r_demo_xray ${on}`); await page.waitForTimeout(300);
        const path = new URL(`../../.bench-xray-${at}-${on ? 'on' : 'off'}.png`, import.meta.url).pathname;
        counts[on] = await orange(await page.screenshot({ path }));
    }
    line(`t=${at}`, `orange pixels: on ${counts[1]}, off ${counts[0]}${counts[1] - counts[0] > 60 ? '  ← someone behind a wall' : ''}`);
    await run('r_demo_xray 1');
}
await browser.close();
