// What happens to the game when its tab is not the one in front: the browser stops the
// frame loop of a hidden page, the engine stops talking, and the server drops the player.
// Join, put another page in front, and watch: the page's frame rate, the datagrams, the
// server's status, and what the engine's console says meanwhile.
//
//   HEADED=1 xvfb-run -a node bench/hidden.mjs        # a real window, so the tab is really hidden
//   HEADED=1 MIN=6 PLAY_PATH=/next/ xvfb-run -a node bench/hidden.mjs
//
// Headless Chromium reports every page visible whatever is in front, so without HEADED
// this measures nothing.
import { launch, open, join, spawn, fromServer, rcon, primaryPort, engineLog, fresh, line, PLAY } from './lib.mjs';

const minutes = Number(process.env.MIN ?? 3);
const every = Number(process.env.EVERY ?? 15);
const port = await primaryPort();
const name = fresh('hidden');
const browser = await launch();
const { page, context } = await open(browser, { name });
await page.evaluate(() => {
    // Frames per second as the page sees them: requestAnimationFrame, and the engine's tick.
    let frames = 0;
    window.__fps = 0;
    (function tick() { frames++; requestAnimationFrame(tick); })();
    setInterval(() => { window.__fps = frames; frames = 0; }, 1000);
});
await join(page);
await spawn(page);
const onServer = () => { try { return new RegExp(`"${name}"`).test(rcon(port, 'status')); } catch { return '?'; } };
let logMark = (await engineLog(page)).length;
const sample = async label => {
    const now = await fromServer(page);
    const [state, fps] = await page.evaluate(() => [document.visibilityState, window.__fps]);
    line(label, `${state}  rAF ${fps}/s  datagrams ${now} (+${now - sample.last})  on server: ${onServer()}  joined=${await page.evaluate(() => window.__xash?.joined)}`);
    sample.last = now;
    const log = await engineLog(page);
    // Everything the engine said meanwhile, minus the chatter of a normal frame.
    for (const l of log.slice(logMark)) if (l.trim() && !/^\s*\[\d\d:\d\d:\d\d\]\s*$|precache|^\s*$|CL_ParseServerMessage|svc_/i.test(l)) console.log(`      engine: ${l.trim().slice(0, 120)}`);
    logMark = log.length;
};
sample.last = await fromServer(page);
await page.waitForTimeout(every * 1000);
await sample('tab in front');

const front = await context.newPage();
await front.goto('about:blank');
await front.bringToFront();
for (let i = 1; i <= (minutes * 60) / every; i++) {
    await front.waitForTimeout(every * 1000);
    await sample(`hidden ${((i * every) / 60).toFixed(2)} min`);
}
await page.bringToFront();
await page.waitForTimeout(5_000);
await sample('tab back in front');
console.log(`  ${PLAY}: ${onServer() ? 'still in the game' : 'dropped'} after ${minutes} min hidden`);
await browser.close();
