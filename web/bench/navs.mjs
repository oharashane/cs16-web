// Build the bots' navigation mesh for every map in the rotation, once, so the first bot
// on a map does not hold the server for the seconds it takes. The server builds a mesh
// when a bot is *added by hand* (bot_add) on a map that has none — the quota path joins
// bots but never builds — so this changes the map, adds a bot, and waits for the file.
// Each mesh lands in cs-server/navs/<map>.nav, which is kept in git. Changes the live
// server's map for everyone on it, and puts the settings back as it found them.
//
//   node bench/navs.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { rcon, primaryPort, line, RELAY, credentials } from './lib.mjs';

const auth = { Authorization: 'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64') };
const settings = async body => {
    const r = await fetch(RELAY + '/api/settings', body ? { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) } : { headers: auth });
    if (!r.ok) throw new Error(`settings ${r.status}`);
    return r.json();
};
const navs = new URL('../../cs-server/navs/', import.meta.url);
// Case-insensitive, as the game's filesystem is (cs_1337_assault plays with the
// content's cs_1337_ASSAULT.nav); a link to the content's copy counts.
const haveMesh = name => readdirSync(navs).some(f => f.toLowerCase() === `${name}.nav`.toLowerCase());
const manifest = JSON.parse(readFileSync(new URL('../../content/manifest.json', import.meta.url), 'utf8'));
const port = await primaryPort();
const before = (await settings()).current;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const say = c => { try { return rcon(port, c); } catch { return ''; } };

let built = 0, had = 0, failed = 0;
try {
    for (const m of manifest.maps) {
        if (haveMesh(m.name)) { had++; line(m.name, 'mesh already there'); continue; }
        const applied = await settings({ ...before, bots: 0, map: m.name });
        if (applied.problem) { failed++; line(m.name, `not applied: ${applied.problem}`); continue; }
        await sleep(12_000);                       // the map loads
        say('bot_add');                            // builds the mesh when there is none, then joins
        let done = false;
        for (let i = 0; i < 24 && !done; i++) {    // up to two minutes; large maps take a while
            await sleep(5_000);
            done = haveMesh(m.name);
        }
        say('bot_kick');
        if (done) { built++; line(m.name, 'mesh built'); } else { failed++; line(m.name, 'NO mesh after two minutes'); }
    }
} finally {
    await settings(before);
    // The server writes the meshes as root, 640; make them readable here so git can keep them.
    try { execFileSync('docker', ['exec', 'cs16-main', 'sh', '-c', "find /navs -maxdepth 1 -type f -name '*.nav' -exec chmod 644 {} +"]); } catch { /* no docker here: chmod by hand */ }
}
console.log(`  ${built} built, ${had} already there, ${failed} failed; settings put back`);
process.exit(failed ? 1 : 0);
