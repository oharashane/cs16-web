// The all-seeing eye, tried: join a public server outside the house through the relay's
// bridge, wait for the engine to say it is in, read the console for what the server
// said, and leave. Twenty seconds on somebody else's server, once.
//
//   node bench/eye.mjs 144.48.106.220:27015
import { launch, RELAY, credentials, serverPassword, line } from './lib.mjs';

const to = process.argv[2];
if (!to) { console.error('usage: node bench/eye.mjs host:port'); process.exit(2); }
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 900, height: 560 }, httpCredentials: credentials });
const page = await context.newPage();
page.on('dialog', d => { console.log('  DIALOG: ' + d.message().slice(0, 200)); d.dismiss().catch(() => {}); });
await page.goto(RELAY + '/play/?server=' + encodeURIComponent(to));
await page.waitForFunction(() => !document.getElementById('start').disabled || /did not answer|does not have/.test(document.getElementById('server-line')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
line('lobby says', await page.evaluate(() => document.getElementById('server-line')?.innerText.replace(/\s+/g, ' ')));
await page.fill('#username', 'museum-eye');
const started = Date.now();
await page.click('#start');
const joined = await page.waitForFunction(() => window.__xash?.joined === true, null, { timeout: 120000 }).then(() => true).catch(() => false);
line('joined', joined ? `yes, in ${((Date.now() - started) / 1000).toFixed(1)} s` : 'no');
await page.waitForTimeout(joined ? 15000 : 3000);
const log = await page.evaluate(() => (window.__xashLog || []).slice());
line('console lines', log.length + ' · datagrams from the server: ' + (await page.evaluate(() => window.__xash?.fromServer)));
for (const l of log.slice(-40)) console.log('      ' + l.trim().slice(0, 170));
await page.screenshot({ path: new URL('../../.bench-eye.png', import.meta.url).pathname });
await page.evaluate(() => window.__xash?.Cmd_ExecuteString('disconnect')).catch(() => {});
await browser.close();
