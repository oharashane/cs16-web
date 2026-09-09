// Every game type, proven: switch the server to each mode in turn, join it, spawn, and
// read back the cvars that make the mode what it is. The check after a server rebuild.
// It changes the live server's mode and map for everyone on it, and leaves it in the
// mode it found it in.
//
//   node bench/modes.mjs
//   MODES=classic,ffa-dm node bench/modes.mjs
import { readFileSync } from 'node:fs';
import { launch, open, join, spawn, rcon, primaryPort, currentMap, fresh, line, RELAY, credentials } from './lib.mjs';

/** Where each mode starts, from the file the server reads. */
const starts = Object.fromEntries(JSON.parse(readFileSync(new URL('../../cs-server/main/modes/modes.json', import.meta.url), 'utf8')).modes.map(m => [m.name, m.first]));

// The mode is switched the way the play page switches it — through the relay's settings
// API, which rewrites modes/current.cfg and applies it — because amxx.cfg re-execs
// current.cfg on every map load, so an exec by hand is undone at the changelevel.
const auth = { Authorization: 'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64') };
const settings = async (body) => {
    const r = await fetch(RELAY + '/api/settings', body ? { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) } : { headers: auth });
    if (!r.ok) throw new Error(`settings ${r.status}`);
    return r.json();
};
const port = await primaryPort();
const found = await settings();
const known = Object.fromEntries(found.modes.map(m => [m.Name, m]));
const wanted = process.env.MODES ? process.env.MODES.split(',') : Object.keys(known);
const before = found.current;
const cvar = name => /is "([^"]*)"/.exec(rcon(port, name))?.[1] ?? '?';

const browser = await launch();
let failures = 0;
for (const mode of wanted) {
    const map = starts[mode] ?? known[mode].Maps?.[0];
    const applied = await settings({ ...before, mode, map });
    if (applied.problem) { failures++; line(mode, `not applied: ${applied.problem}`); continue; }
    await new Promise(r => setTimeout(r, 12_000));
    const { page, context, errors } = await open(browser, { name: fresh(mode) });
    try {
        const seconds = await join(page);
        await spawn(page, { settle: 6_000 });
        const got = { map: currentMap(port), csdm: cvar('csdm_active'), gg: cvar('gg_enabled'), ffa: cvar('mp_freeforall'), gravity: cvar('sv_gravity'), cycle: cvar('mapcyclefile') };
        line(mode, `${seconds.toFixed(1)} s to join ${got.map}  csdm=${got.csdm} gg=${got.gg} ffa=${got.ffa} gravity=${got.gravity}  cycle=${got.cycle}${errors.length ? '  page errors: ' + errors.length : ''}`);
    } catch (e) {
        failures++;
        line(mode, `FAILED: ${e.message.split('\n')[0].slice(0, 100)}`);
    }
    await context.close();
}
await browser.close();
await settings(before);   // as it was found
console.log(failures ? `  ${failures} mode(s) failed` : '  every mode joined');
process.exit(failures ? 1 : 0);
