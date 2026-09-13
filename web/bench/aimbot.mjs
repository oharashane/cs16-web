// The lab's aimbot, logged: a player on the lab whose aim the server takes over
// (mm_forceaim, museum.amxx) for thirty seconds among bots, while the server writes their
// view angles command by command (mm_aimlog) — the raw material of every server-side
// aim detector. The log comes out of the container to web/bench/out/aim-<label>.csv;
// a control run (the same player, aim untouched, mostly still) beside it.
// scripts/aim-signature.py reads both, and the 2014 human recordings for comparison.
//
//   SERVER=27016 node bench/aimbot.mjs      (the lab; never main)
import { launch, open, join, spawn, run, fresh, line, rcon, SERVER } from './lib.mjs';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const port = 27016;
if (SERVER !== port) { console.error('run with SERVER=27016: this is for the lab only'); process.exit(2); }
const seconds = Number(process.env.SECONDS ?? 30);
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
rcon(port, 'changelevel fy_iceworld'); await new Promise(r => setTimeout(r, 12_000));
rcon(port, 'bot_quota 6'); rcon(port, 'bot_difficulty 1'); rcon(port, 'mp_freezetime 0');

const browser = await launch();
for (const [label, aim] of [['control', ''], ['aimbot', 'aimlab']]) {
    const name = fresh('aimlab-' + label);   // a name of its own: a player who left is on the server for sv_timeout
    const { page, context } = await open(browser, { name });
    line(label + ' join', `${(await join(page)).toFixed(1)} s`);
    await spawn(page);
    execFileSync('docker', ['exec', 'cs16-lab', 'sh', '-c', 'rm -f cstrike/addons/amxmodx/logs/aim.csv']);
    rcon(port, `mm_forceaim "${aim ? name : ''}"`);
    rcon(port, `mm_aimlog "${name}"`);
    // a little of the player's own movement either way: walk forward and back
    for (let i = 0; i < seconds; i++) { await run(page, i % 2 ? '+forward' : '-forward'); await page.waitForTimeout(1000); }
    rcon(port, 'mm_aimlog ""'); rcon(port, 'mm_forceaim ""');
    const csv = execFileSync('docker', ['exec', 'cs16-lab', 'sh', '-c', 'cat cstrike/addons/amxmodx/logs/aim.csv 2>/dev/null || true'], { encoding: 'utf8' });
    const out = new URL(`./out/aim-${label}.csv`, import.meta.url);
    (await import('node:fs')).writeFileSync(out, csv);
    line(label + ' commands logged', csv.split('\n').filter(Boolean).length);
    await context.close();
}
rcon(port, 'bot_quota 0');
await browser.close();
