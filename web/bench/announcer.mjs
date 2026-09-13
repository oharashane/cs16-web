// Does the announcer reach the browser? Join, turn on the round-start shout for a moment,
// restart the round, and look in the engine's console for the sound being played — or
// for the engine complaining it could not find the file.
//
//   node bench/announcer.mjs
import { launch, open, join, spawn, fresh, line, rcon, primaryPort } from './lib.mjs';

const port = await primaryPort();
const browser = await launch();
const { page, context, errors } = await open(browser, { name: fresh('shout') });
line('join', `${(await join(page)).toFixed(1)} s`);
await spawn(page);
await page.evaluate(() => { window.__xashLog.length = 0; });
rcon(port, 'qs_prepare 1');
rcon(port, 'sv_restart 1');
await page.waitForTimeout(6000);
rcon(port, 'qs_prepare 0');
// The engine says nothing when it plays a sound and nothing when it cannot find one; but
// soundlist names every sound it has loaded, and a shout that arrived is in that list.
const loaded = async () => { await page.evaluate(() => { window.__xashLog.length = 0; window.__xash.Cmd_ExecuteString('soundlist'); }); await page.waitForTimeout(4000); return page.evaluate(() => window.__xashLog.filter(l => /QuakeSounds/i.test(l)).map(l => l.replace(/^.*sound\//, ''))); };
line('shouts the engine has played', (await loaded()).join(', ') || 'none — the server\'s spk did not arrive');
if (errors.length) console.log('  page errors: ' + errors.join(' | '));
await context.close();
await browser.close();
