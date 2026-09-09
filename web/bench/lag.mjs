// Where the lag is, for one player with given client settings: the game ping the server
// reports for them (browser → relay → server and back, what they feel) sampled once a
// second, and the browser-to-relay half alone as ICE measures it. Same method as the
// room's measure_lag tool, driven from a browser here so a setting can be A/B'd.
//
//   node bench/lag.mjs
//   CVARS='cl_updaterate 20;cl_cmdrate 100' node bench/lag.mjs
//   SECONDS=20 node bench/lag.mjs
import { launch, open, join, spawn, run, rcon, primaryPort, fresh, line, RELAY, credentials } from './lib.mjs';

const cvars = (process.env.CVARS ?? '').split(';').map(s => s.trim()).filter(Boolean);
const seconds = Number(process.env.SECONDS ?? 10);
const port = await primaryPort();
const name = fresh('lag');
const browser = await launch();
const { page, context } = await open(browser, { name });
await join(page);
for (const c of cvars) await run(page, c);
await spawn(page, { settle: 8_000 });

const player = new RegExp(`^#\\s*\\d+\\s+"${name}"\\s+\\S+\\s+\\S+\\s+-?\\d+\\s+[\\d:]+\\s+(\\d+)\\s+(\\d+)`, 'm');
const pings = [], losses = [], rtts = [];
const auth = { Authorization: 'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64') };
for (let i = 0; i < seconds; i++) {
    if (i) await page.waitForTimeout(1_000);
    const m = player.exec(rcon(port, 'status'));
    if (m) { pings.push(Number(m[1])); losses.push(Number(m[2])); }
    try {
        const body = await (await fetch(RELAY + '/api/sessions', { headers: auth })).json();
        for (const s of body.sessions) if (s.port === port && s.rtt_ms > 0) rtts.push(s.rtt_ms);
    } catch { /* the relay's session list is a nicety here */ }
}
const spread = xs => xs.length ? `${Math.min(...xs)}/${[...xs].sort((a, b) => a - b)[xs.length >> 1]}/${Math.max(...xs)}` : 'n/a';
line(cvars.length ? cvars.join('; ') : 'as shipped',
    `game ping min/med/max ${spread(pings)} ms   loss ${losses.length ? Math.max(...losses) : 'n/a'}%   browser→relay median ${spread(rtts.map(x => Math.round(x * 10) / 10))} ms   (${pings.length} samples)`);
await context.close();
await browser.close();
