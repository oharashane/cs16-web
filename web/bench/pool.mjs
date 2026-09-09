// The engine's own memory accounting (memlist) while playing: the Network Pool line and
// the total, twice, some seconds apart. A pool that grows while the player stands still
// is what an in-band file download looks like; idle it should read 0 bytes.
//
//   node bench/pool.mjs
//   INTERVAL=120 node bench/pool.mjs
import { launch, open, join, spawn, run, engineLog, fresh, line, PLAY } from './lib.mjs';

const interval = Number(process.env.INTERVAL ?? 30);
const browser = await launch();
const { page, context } = await open(browser, { name: fresh('pool') });
await join(page);
await spawn(page, { settle: 8_000 });
console.log(`  ${PLAY}`);
for (const t of [0, interval]) {
    if (t) await page.waitForTimeout(t * 1000);
    await run(page, 'memlist');
    await page.waitForTimeout(2_500);
    const lines = await engineLog(page);
    const pool = [...lines].reverse().find(l => /Network Pool/.test(l))?.trim() ?? 'no Network Pool line';
    const total = [...lines].reverse().find(l => /totalling/.test(l))?.trim() ?? '';
    line(`t+${t}s`, `${pool}   |   ${total}`);
}
await context.close();
await browser.close();
