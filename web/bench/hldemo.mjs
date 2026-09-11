// Plays a GoldSrc demo (HLDEMO, what Half-Life and Counter-Strike record) in the browser
// client: fetches the .dem — and its map, if named — from the relay into the engine's
// filesystem, runs playdemo, and reports what the engine said and drew.
//
//   node bench/hldemo.mjs kz_2007_patriotas kz_longjumps2     (content/demos/<demo>.dem, cs-server/shared/maps/<map>.bsp)
//   SECONDS=20 node bench/hldemo.mjs hl_2004_part5
import { launch, open, join, run, engineLog, clearEngineLog, fresh, line } from './lib.mjs';
import { writeFileSync } from 'node:fs';

const demo = process.argv[2];
const map = process.argv[3];
const seconds = Number(process.env.SECONDS ?? 10);
if (!demo) { console.error('usage: node bench/hldemo.mjs <demo> [map]'); process.exit(2); }

const browser = await launch();
const { page, context } = await open(browser, { name: fresh('hldemo') });
await join(page); // boots the engine; playdemo drops the server
await page.waitForTimeout(3_000);

const fetched = await page.evaluate(async ({ demo, map }) => {
    const FS = window.__xash.em.FS;
    const get = async (url, path) => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`${url}: ${r.status}`);
        const bytes = new Uint8Array(await r.arrayBuffer());
        FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
        FS.writeFile(path, bytes);
        return bytes.length;
    };
    const out = {};
    if (map) out.map = await get(`/raw/maps/${map}.bsp`, `/rodir/cstrike/maps/${map}.bsp`);
    out.demo = await get(`/content/demos/${demo}.dem`, `/rodir/cstrike/${demo}.dem`);
    return out;
}, { demo, map });
line('fetched', JSON.stringify(fetched));

await clearEngineLog(page);
await run(page, `playdemo ${demo}`);
const bare = () => page.evaluate(() => { const c = document.querySelector('canvas'); for (const e of document.body.children) if (!e.contains(c)) e.style.visibility = 'hidden'; });
const shots = [];
let waited = 0;
for (const at of [2, 5, 10, 20, 40].filter(s => s <= seconds)) {
    await page.waitForTimeout((at - waited) * 1000);
    waited = at;
    await bare();
    const path = new URL(`../../.bench-hldemo-${demo}-${at}s.png`, import.meta.url).pathname;
    await page.screenshot({ path });
    shots.push(path);
}
const log = await engineLog(page);
const logPath = new URL(`../../.bench-hldemo-${demo}.log`, import.meta.url).pathname;
writeFileSync(logPath, log.join('\n'));
const notable = log.filter(l => /demo|error|couldn't|protocol|goldsrc|host_error|map|section|loading|serverinfo|remote host|precache|missing/i.test(l)).map(l => l.trim());
line('engine', `${log.length} lines; ${notable.length} notable → ${logPath}`);
for (const l of notable.slice(0, 30)) console.log('      ' + l);
line('screenshots', shots.join(' '));
await context.close();
await browser.close();
