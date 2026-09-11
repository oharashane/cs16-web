// Can the engine record a demo of a GoldSrc-protocol session and play it back? The answer
// decides whether a GoldSrc .dem converter, or a reader, has anything to target: an Xash
// demo of our own game IS a GoldSrc-protocol demo in Xash framing (net protocol 48|128).
//
//   node bench/demo.mjs
//   HEADED=1 xvfb-run node bench/demo.mjs
import { launch, open, join, spawn, run, engineLog, clearEngineLog, fresh, line } from './lib.mjs';
import { writeFileSync } from 'node:fs';

const browser = await launch();
const { page, context } = await open(browser, { name: fresh('demo') });
await join(page);
await spawn(page, { settle: 3_000 });

clearEngineLog(page);
await run(page, 'record bench');
await run(page, '+forward');
await page.waitForTimeout(3_000);
await run(page, '+attack');
await page.waitForTimeout(5_000);
await run(page, '-attack');
await run(page, '-forward');
await page.waitForTimeout(1_000);
await run(page, 'stop');
await page.waitForTimeout(500);
line('record', (await engineLog(page)).filter(l => /demo|record/i.test(l)).map(l => l.trim()).join(' | ') || '(no console lines)');

// The file, as the engine wrote it into its own filesystem.
const header = await page.evaluate(() => {
    const FS = window.__xash.em.FS;
    for (const p of ['/rodir/cstrike/bench.dem', '/rodir/cstrike/demos/bench.dem', '/cstrike/bench.dem']) {
        try {
            const b = FS.readFile(p);
            const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
            return { path: p, bytes: b.length, magic: String.fromCharCode(...b.slice(0, 4)), demProtocol: dv.getInt32(4, true),
                netProtocol: dv.getInt32(8, true), map: new TextDecoder().decode(b.slice(20, 84)).replace(/\0.*$/, '') };
        } catch { /* not there */ }
    }
    return null;
});
line('file', header ? `${header.path}  ${header.bytes} bytes  magic ${header.magic}  demo protocol ${header.demProtocol}  net protocol ${header.netProtocol}  map ${header.map}` : 'NOT FOUND');

// Play it back: the engine drops the server, opens the file, parses the recorded packets.
clearEngineLog(page);
await run(page, 'playdemo bench');
// Only the canvas: the page's own overlays sit on top once pointer lock is gone.
const bare = () => page.evaluate(() => { const c = document.querySelector('canvas'); for (const e of document.body.children) if (!e.contains(c)) e.style.visibility = 'hidden'; });
const shots = [];
for (const at of [2_000, 5_000]) {
    await page.waitForTimeout(at - (shots.length ? 2_000 : 0));
    await bare();
    const path = new URL(`../../.bench-demo-${at / 1000}s.png`, import.meta.url).pathname;
    await page.screenshot({ path });
    shots.push(path);
}
const log = await engineLog(page);
writeFileSync(new URL('../../.bench-demo.log', import.meta.url).pathname, log.join('\n'));
const state = await page.evaluate(() => ({ joined: window.__xash?.joined, canvas: !!document.querySelector('canvas') }));
line('playback', log.filter(l => /demo|error|playing|complete/i.test(l)).map(l => l.trim()).slice(0, 12).join(' | ') || '(no demo lines)');
line('state', JSON.stringify(state));
line('screenshots', shots.join(' '));
await context.close();
await browser.close();
