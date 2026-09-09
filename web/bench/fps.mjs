// Frames per second on the current map, at one or more window sizes, with optional
// console settings applied first. Headless Chromium draws on the CPU and caps at 60, so
// a map that reads 60 is "fast enough here"; the number means something below that.
//
//   node bench/fps.mjs                       # 640x400, as shipped
//   SIZES=512x320,1024x640 node bench/fps.mjs
//   CVARS='r_decals 0;r_dynamic 0' node bench/fps.mjs
//   MAP=cs_agency_csgo node bench/fps.mjs    # changes the live server's map for everyone
//   PLAY_PATH=/next/ node bench/fps.mjs      # the canary build instead of /play
import { launch, open, join, spawn, fps, rcon, primaryPort, currentMap, fresh, line, PLAY } from './lib.mjs';

const sizes = (process.env.SIZES ?? '640x400').split(',').map(s => s.split('x').map(Number));
const cvars = (process.env.CVARS ?? '').split(';').map(s => s.trim()).filter(Boolean);
const seconds = Number(process.env.SECONDS ?? 9);
const port = await primaryPort();

if (process.env.MAP) {
    rcon(port, `changelevel ${process.env.MAP}`);
    await new Promise(r => setTimeout(r, 12_000));
}
console.log(`  ${PLAY} on ${currentMap(port)}${cvars.length ? ' with ' + cvars.join('; ') : ''}`);

const browser = await launch();
for (const [width, height] of sizes) {
    const { page, context } = await open(browser, { width, height, name: fresh('fps') });
    await join(page);
    await spawn(page);
    for (const c of cvars) await run(page, c);
    if (cvars.length) await page.waitForTimeout(4_000);
    line(`${width}×${height}`, `${(await fps(page, seconds)).toFixed(1)} fps`);
    await context.close();
}
await browser.close();

async function run(page, c) { await page.evaluate(x => window.__xash.Cmd_ExecuteString(x), c); }
