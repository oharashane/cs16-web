// How long from Join to in the game, on a first visit and on the next one, and the worst
// stall the main thread suffered on the way (a 20 ms timer that notices when it is late).
// The phases are the loading text as it changed.
//
//   node bench/load.mjs             # first visit = whatever the browser has cached
//   CLEAR=1 node bench/load.mjs     # first visit = nothing cached, as a new player sees it
import { chromium } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as join_ } from 'node:path';
import { join, fresh, line, serverPassword, credentials, RELAY, PLAY } from './lib.mjs';

// A second engine in the same renderer needs more JS heap than headless Chromium allows by
// default: the game's files live in MEMFS, which is JavaScript memory (~270 MB), beside
// the wasm heap. Without this the second visit's renderer is killed and the page closes.
// Two browsers on one profile, one after the other: the first visit downloads and writes
// the cache, the second finds it — the way a player's next day goes. Not two visits in one
// browser: a second engine boot from the cache in the same browser session crashes
// headless Chromium (a CHECK in the browser process; see the journal, 9 September).
const dir = mkdtempSync(join_(tmpdir(), 'cs16-load-'));

async function visit(label) {
    const context = await chromium.launchPersistentContext(dir, {
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        httpCredentials: credentials, viewport: { width: 900, height: 560 },
    });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(RELAY + PLAY);
    if (process.env.CLEAR && label === 'first visit') {
        await page.evaluate(() => new Promise(r => { const d = indexedDB.deleteDatabase('cs16-content'); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
        await page.goto(RELAY + PLAY);
    }
    await page.fill('#username', fresh('load'));
    await page.fill('#password', serverPassword());
    await page.evaluate(() => {
        let last = performance.now();
        window.__maxGap = 0;
        window.__phases = [];
        setInterval(() => { const n = performance.now(); if (n - last - 20 > window.__maxGap) window.__maxGap = n - last - 20; last = n; }, 20);
        const el = document.getElementById('loading-text');
        const rec = () => { const t = el.textContent; if (t !== window.__phases.at(-1)) window.__phases.push(t); };
        new MutationObserver(rec).observe(el, { childList: true, subtree: true, characterData: true });
        rec();
    });
    const seconds = await join(page);
    const [gap, phases] = await page.evaluate(() => [Math.round(window.__maxGap), window.__phases]);
    line(label, `${seconds.toFixed(1)} s to joined   worst stall ${gap} ms`);
    console.log(`      ${phases.join(' → ')}`);
    await page.waitForTimeout(3_000);          // let the cache writes land
    await context.close();
}

await visit('first visit');
await visit('second visit');
rmSync(dir, { recursive: true, force: true });
