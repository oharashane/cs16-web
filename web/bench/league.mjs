// The 2011 league config experiment, end to end: join, open the network help, apply the
// config, and print what the page reports — which settings the engine took, which it
// kept, which it does not have, and the frame rate before and after. Headless Chromium
// draws on the CPU and caps at 60, so the frame rate here says whether it *costs*
// anything, not what it gains. Also checks the extras bundle (the announcer's sounds)
// reached the engine's filesystem.
//
//   node bench/league.mjs
import { launch, open, join, spawn, fresh, line } from './lib.mjs';

const browser = await launch();
const { page, context, errors } = await open(browser, { name: fresh('league') });
line('join', `${(await join(page)).toFixed(1)} s`);
await spawn(page);
line('extras in the engine', await page.evaluate(() => window.__bundles?.has('extras') ? 'yes' : 'no'));
line('a shout on disk', await page.evaluate(() => { try { return String(window.__xash.em.FS.stat('/rodir/cstrike/sound/QuakeSounds/monsterkill.wav').size) + ' bytes'; } catch (e) { return 'missing: ' + e; } }));
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await page.click('#network-help-open-live');
await page.click('#league-try');
const watch = setInterval(async () => { try { console.log('  … ' + (await page.evaluate(() => document.querySelector('[data-league-status]')?.textContent)).slice(0, 80)); } catch { /* gone */ } }, 6000);
await page.waitForFunction(() => /Frame rate/.test(document.querySelector('[data-league-status]')?.textContent ?? ''), null, { timeout: 90_000 });
clearInterval(watch);
const report = await page.evaluate(() => document.querySelector('[data-league-status]').innerText);
console.log(report.split('\n').map(l => '  ' + l).join('\n'));
await page.click('#league-undo');
await page.waitForTimeout(1500);
line('after undo', await page.evaluate(() => document.querySelector('[data-league-status]').innerText));
if (errors.length) console.log('  page errors: ' + errors.join(' | '));
await context.close();
await browser.close();
