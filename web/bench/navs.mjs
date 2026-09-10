// Build the bots' navigation mesh for every map in the rotation, once, so the first bot
// on a map does not hold the server for the seconds it takes. A person must be on a
// team for a bot to join, so this joins one, asks for bots, and walks the rotation;
// each mesh lands in cs-server/navs/<map>.nav, which is kept in git. Changes the live
// server's map for everyone on it, and puts the settings back as it found them.
//
//   node bench/navs.mjs
import { readFileSync, existsSync } from 'node:fs';
import { launch, open, join, spawn, rcon, primaryPort, fresh, line, RELAY, credentials } from './lib.mjs';

const auth = { Authorization: 'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64') };
const settings = async body => {
    const r = await fetch(RELAY + '/api/settings', body ? { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) } : { headers: auth });
    if (!r.ok) throw new Error(`settings ${r.status}`);
    return r.json();
};
const navs = new URL('../../cs-server/navs/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('../../content/manifest.json', import.meta.url), 'utf8'));
const port = await primaryPort();
const before = (await settings()).current;

const browser = await launch();
const { page, context } = await open(browser, { name: fresh('navs') });
await join(page);
await spawn(page);
let built = 0, had = 0, failed = 0;
try {
    await settings({ ...before, bots: 2, botSkill: 0 });
    for (const m of manifest.maps) {
        const file = new URL(`${m.name}.nav`, navs);
        if (existsSync(file)) { had++; line(m.name, 'mesh already there'); continue; }
        await settings({ ...before, bots: 2, botSkill: 0, map: m.name });
        // The map loads, the person respawns, a bot joins and builds the mesh.
        let done = false;
        for (let i = 0; i < 12 && !done; i++) {
            await page.waitForTimeout(5_000);
            try { await page.evaluate(() => window.__xash.Cmd_ExecuteString('jointeam 2')); await page.evaluate(() => window.__xash.Cmd_ExecuteString('slot1')); } catch { /* between maps */ }
            done = existsSync(file);
        }
        if (done) { built++; line(m.name, 'mesh built'); } else { failed++; line(m.name, 'NO mesh after a minute'); }
    }
} finally {
    await settings(before);
    await context.close();
    await browser.close();
}
console.log(`  ${built} built, ${had} already there, ${failed} failed; settings put back`);
process.exit(failed ? 1 : 0);
