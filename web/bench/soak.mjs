// Play for a while — shoot, turn, walk, switch weapons — and report each minute what the
// memory did and whether anything took the player out of the game. This is the run that
// killed the fixed-heap engine at ~5,000 datagrams; the growing one survives it.
//
//   node bench/soak.mjs            # six minutes
//   MIN=20 node bench/soak.mjs
import { launch, open, join, spawn, run, memory, fromServer, fresh, line, PLAY } from './lib.mjs';

const minutes = Number(process.env.MIN ?? 6);
const browser = await launch();
const { page, context, errors } = await open(browser, { width: 1280, height: 800, name: fresh('soak') });
let died = null;
const note = t => { if (/OOM|Aborted|out of memory/i.test(t) && !died) died = t; };
page.on('console', m => note(m.text()));
page.on('pageerror', e => note(String(e)));
const notices = [];
const watch = setInterval(async () => {
    try {
        const t = (await page.locator('#notice').textContent({ timeout: 500 }))?.trim();
        if (t && !notices.includes(t)) { notices.push(t); console.log(`  notice at ${new Date().toISOString().slice(11, 19)}: "${t}"`); }
    } catch { /* between pages */ }
}, 2_000);

await join(page);
await spawn(page);
console.log(`  ${PLAY}, in the game; ${minutes} minute(s) of shooting`);
line('at start', await describe());

for (let i = 0; i < minutes * 4 && !died; i++) {
    await run(page, '+attack'); await page.waitForTimeout(1_200); await run(page, '-attack');
    await run(page, '+right');  await page.waitForTimeout(400);   await run(page, '-right');
    await run(page, '+forward'); await page.waitForTimeout(600);  await run(page, '-forward');
    await run(page, 'weapon_knife'); await run(page, 'lastinv');
    await page.waitForTimeout(11_000);
    if (i % 4 === 3) line(`minute ${(i + 1) / 4}`, await describe());
}
clearInterval(watch);
console.log(died ? `  DIED: ${died.slice(0, 170)}` : '  survived');
if (errors.length) console.log('  page errors:\n' + errors.slice(0, 5).map(e => '    ' + e).join('\n'));
await context.close();
await browser.close();

async function describe() {
    const m = await memory(page);
    return `wasm ${m.wasmMB ?? '?'} MB   js ${m.jsMB ?? '?'} MB   datagrams ${await fromServer(page)}`;
}
