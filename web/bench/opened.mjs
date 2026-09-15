// Which of the game's files does the engine ever open? Every file the client unpacks is
// in the engine's filesystem; this hooks the filesystem's open and plays a session — join,
// spawn, every weapon slot, the buy menu, the radio, a spray, a death, a second map with
// hostages, and a recording — then writes the union to content/opened.txt. The packager
// reads that list (package-valve.py --opened) to keep in the base only what is opened and
// what two maps share, and to send the rest with the map that names it.
//
//   node bench/opened.mjs
import { chromium } from '@playwright/test';
import { RELAY, PLAY, credentials, serverPassword, run, rcon, primaryPort, line } from './lib.mjs';
import { writeFileSync, readFileSync } from 'node:fs';

const port = await primaryPort();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=4096'] });
const context = await browser.newContext({ viewport: { width: 900, height: 560 }, httpCredentials: credentials });
// The hook goes in before the page's own script: it waits for the engine's filesystem and
// wraps open, so the very first file the engine reads is on the list.
await context.addInitScript(() => {
    window.__opened = new Set();
    const t = setInterval(() => {
        const FS = window.__xash && window.__xash.em && window.__xash.em.FS;
        if (!FS || FS.__hooked) return;
        FS.__hooked = true; clearInterval(t);
        const open = FS.open.bind(FS);
        // reads only: the client writes every file in with the same call
        const reading = f => typeof f === 'string' ? /^r/.test(f) : (Number(f) & 3) === 0;
        FS.open = (path, flags, mode) => { try { if (reading(flags)) window.__opened.add(typeof path === 'string' ? path : path.path); } catch {} return open(path, flags, mode); };
    }, 2);
});
const opened = new Set();
const collect = async page => { for (const p of await page.evaluate(() => [...window.__opened])) opened.add(p.replace(/^\/rodir\//, '').replace(/^\//, '')); };

const page = await context.newPage();
page.on('dialog', d => { console.log('  DIALOG ' + d.message().slice(0, 200)); d.dismiss().catch(() => {}); });
rcon(port, 'changelevel de_dust2');
await page.waitForTimeout(8000);
await page.goto(RELAY + PLAY);
await page.fill('#username', 'opened-bench');
await page.fill('#password', serverPassword());
await page.click('#start');
await page.waitForFunction(() => window.__xash?.joined === true, null, { timeout: 240_000 });
line('joined', 'de_dust2');
const play = async seconds => {
    const acts = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', '+attack', '-attack', '+reload', '-reload', '+jump', '-jump', '+duck', '-duck', 'impulse 100', 'impulse 201', 'radio1', 'slot1', 'radio2', 'slot3', 'radio3', 'slot2', 'buy', 'slot1', 'buyequip', 'slot1', '+showscores', '-showscores', 'say hello', '+use', '-use', 'nightvision', 'drop', 'lastinv', '+forward', '-forward', '+moveleft', '-moveleft', 'kill'];
    const until = Date.now() + seconds * 1000;
    let i = 0;
    while (Date.now() < until) { await run(page, acts[i++ % acts.length]).catch(() => {}); await page.waitForTimeout(700); }
};
for (const team of [2, 1]) {
    await page.waitForTimeout(3000); await run(page, `jointeam ${team}`); await page.waitForTimeout(2000); await run(page, 'slot1');
    await play(45);
}
await collect(page);
line('opened after dust2', opened.size);
rcon(port, 'changelevel cs_assault');
await page.waitForTimeout(25000);
await run(page, 'jointeam 1'); await page.waitForTimeout(2000); await run(page, 'slot1');
await play(40);
await collect(page);
line('opened after cs_assault', opened.size);
await page.close();

// a recording: HLTV's own way through the same files
const demo = await context.newPage();
demo.on('dialog', d => d.dismiss().catch(() => {}));
await demo.goto(RELAY + '/recordings/hltv_2022_dust2.dem');
try { await demo.waitForFunction(() => window.__xash && !document.getElementById('demo-bar').hidden, null, { timeout: 240_000 }); await demo.waitForTimeout(40000); } catch (e) { console.log('  the recording did not start: ' + e.message.split('\n')[0]); }
await collect(demo);
line('opened after a recording', opened.size);
await browser.close();

const list = [...opened].sort();
writeFileSync(new URL('../../content/opened.txt', import.meta.url).pathname, list.join('\n') + '\n');
// what that means for the base: opened or not, by the first two directories
try {
    const manifest = JSON.parse(readFileSync(new URL('../../content/manifest.json', import.meta.url).pathname, 'utf8'));
    line('manifest', `base ${(manifest.base?.bytes / 1048576).toFixed(0)} MB`);
} catch {}
line('written', `content/opened.txt (${list.length} paths)`);
