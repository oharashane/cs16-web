// Does this build boot and join at all, and what did the engine say on the way? The first
// thing to run against a new engine, before any of the measurements.
//
//   node bench/boot.mjs
//   PLAY_PATH=/next/ SHOT=/tmp/boot.png node bench/boot.mjs
import { launch, open, join, engineLog, fresh, line, PLAY } from './lib.mjs';

const browser = await launch();
const { page, context, errors } = await open(browser, { width: 640, height: 400, name: fresh('boot') });
let seconds = null;
try { seconds = await join(page, 150_000); } catch { /* reported below */ }
const log = await engineLog(page);
console.log(`  ${PLAY}: ${seconds === null ? 'did NOT join' : `joined in ${seconds.toFixed(1)} s`}`);
line('notice', JSON.stringify((await page.locator('#notice').textContent().catch(() => ''))?.trim() ?? ''));
line('loading text', JSON.stringify((await page.locator('#loading-text').textContent().catch(() => ''))?.trim() ?? ''));
const interesting = log.filter(l => /ref_|render|gl4es|webgl|LIBGL|error|fail|dlopen|couldn|can't|Aborted/i.test(l)).slice(-12);
if (interesting.length) console.log('  engine said:\n' + interesting.map(l => '    ' + l.slice(0, 150)).join('\n'));
if (seconds === null) console.log('  last engine lines:\n' + log.slice(-20).map(l => '    ' + l.slice(0, 150)).join('\n'));
if (errors.length) console.log('  page errors:\n' + errors.slice(0, 6).map(e => '    ' + e).join('\n'));
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
await context.close();
await browser.close();
process.exit(seconds === null ? 1 : 0);
