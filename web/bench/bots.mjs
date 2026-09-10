// Do the bots play each game type, and with what? For each mode: bots filling to four,
// one person joined and on a team, ninety seconds, then the server's log — every kill
// names its weapon — says whether the bots fought and what they carried. Changes the
// live server's mode and map; puts the settings back as it found them.
//
//   node bench/bots.mjs
//   MODES=ffa-dm,gungame WEAPONS=pistols node bench/bots.mjs
//   MODES=ffa-dm MAP=de_dust2 node bench/bots.mjs      # the same map for every mode
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { launch, open, join, spawn, rcon, primaryPort, fresh, line, RELAY, credentials } from './lib.mjs';

const auth = { Authorization: 'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64') };
const settings = async body => {
    const r = await fetch(RELAY + '/api/settings', body ? { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) } : { headers: auth });
    if (!r.ok) throw new Error(`settings ${r.status}`);
    return r.json();
};
const logDir = new URL('../../cs-server/logs/main/', import.meta.url);
const logsSince = mark => readdirSync(logDir).map(f => new URL(f, logDir)).filter(f => statSync(f).mtimeMs >= mark)
    .flatMap(f => readFileSync(f, 'latin1').split('\n'));
const modes = (process.env.MODES ?? 'team-dm,ffa-dm,gungame,classic').split(',');
const weapons = process.env.WEAPONS ?? 'all';
const seconds = Number(process.env.SECONDS ?? 90);
const port = await primaryPort();
const found = await settings();
const before = found.current;
const starts = Object.fromEntries(JSON.parse(readFileSync(new URL('../../cs-server/main/modes/modes.json', import.meta.url), 'utf8')).modes.map(m => [m.name, m.first]));

const browser = await launch();
try {
    for (const mode of modes) {
        const applied = await settings({ ...before, mode, map: process.env.MAP || starts[mode], bots: 4, botSkill: 1, botWeapons: weapons });
        if (applied.problem) { line(mode, `not applied: ${applied.problem}`); continue; }
        await new Promise(r => setTimeout(r, 12_000));
        const mark = Date.now() - 1000;
        const { page, context } = await open(browser, { name: fresh('ref') });
        await join(page);
        await spawn(page, { settle: 2_000 });
        await page.waitForTimeout(seconds * 1000);
        const status = rcon(port, 'status');
        const bots = [...status.matchAll(/^#\s*\d+\s+"([^"]*)"\s+\d+\s+BOT\s+(-?\d+)/gm)].map(m => `${m[1]} ${m[2]}`);
        const kills = logsSince(mark).filter(l => /<BOT>/.test(l) && / killed /.test(l));
        const weaponsUsed = {};
        for (const k of kills) { const w = /with "([^"]+)"/.exec(k)?.[1] ?? '?'; if (/^L .*?\d\d:\d\d:\d\d: "[^"]*<\d+><BOT>/.test(k)) weaponsUsed[w] = (weaponsUsed[w] ?? 0) + 1; }
        line(`${mode} (${weapons})`, `bots on server: ${bots.length} [${bots.join(', ')}]  kills by bots: ${Object.values(weaponsUsed).reduce((a, b) => a + b, 0)}  weapons: ${Object.entries(weaponsUsed).map(([w, n]) => `${w}×${n}`).join(' ') || 'none'}`);
        await context.close();
    }
} finally {
    await settings(before);
    await browser.close();
}
