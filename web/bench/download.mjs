// Files the game's way: join a server on a map the browser has no bundle for, and watch
// the engine fetch it from sv_downloadurl through the page (engine patch 0008).
//
//   SERVER=27016 node bench/download.mjs
import { launch, open, join, spawn, fresh, line, engineLog } from './lib.mjs';
const browser = await launch();
const { page, context, errors } = await open(browser, { name: fresh('dl') });
const t = Date.now();
const ok = await join(page, 180_000).then(() => true).catch(() => false);
line('joined', ok ? `yes, in ${((Date.now() - t) / 1000).toFixed(1)} s` : 'no');
if (ok) await spawn(page).catch(() => {});
await page.waitForTimeout(Number(process.env.WAIT ?? 0) * 1000);
const log = await engineLog(page);
for (const l of log.filter(l => /HTTP|download|queued|fetch|Could not|Verifying|successfully|dlfile|Loading map|maps\/|frag|Netchan|error/i.test(l)).slice(0, 40)) console.log('      ' + l.trim().slice(0, 160));
line('files fetched the game\'s way', await page.evaluate(() => window.__downloads?.()));
line('map on disk in the engine', await page.evaluate(() => { try { return String(window.__xash.em.FS.stat('/rodir/cstrike/downloaded/maps/deathrun_bkm.bsp').size) + ' bytes'; } catch (e) { return 'no: ' + e; } }));
await page.screenshot({ path: new URL('../../.bench-download.png', import.meta.url).pathname });
if (errors.length) console.log('  page errors: ' + errors.slice(0, 3).join(' | '));
await context.close(); await browser.close();
