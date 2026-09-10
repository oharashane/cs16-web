import { test, expect, request, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// End to end on this machine: the relay is up, at least one game server is up, and the
// built client is what the relay serves. The tests play as far as a real player does
// before the first shot, and then do the things a real player does next — leave, come
// back, switch server, return tomorrow with their name still in the box.

/** A player name no earlier run can have left a ghost of on the server. */
const fresh = (base: string) => `${base}-${Date.now().toString(36).slice(-5)}`;

/** Which client to drive: /play/ (the published engine) or, with PLAY_PATH=/next/, the one
 *  built in engine/. Same tests, different bytes. */
const PLAY = process.env.PLAY_PATH ?? '/play/';

let ports: number[] = [];
let byMode: Record<string, number> = {};
let primary = 27015;

/** The server's password, from the file the server itself is given it in. Empty is fine —
 *  it means the server is open — but if it is set, the tests must type it like a player. */
function serverPassword(): string {
    try {
        const env = readFileSync(new URL('../../cs-server/.env', import.meta.url), 'utf8');
        return /^SV_PASSWORD=(.*)$/m.exec(env)?.[1]?.trim() ?? '';
    } catch {
        return '';
    }
}

test.beforeEach(async ({ baseURL }) => {
    const api = await request.newContext({ baseURL });
    const response = await api.get('/api/servers');
    test.skip(!response.ok(), `no relay at ${baseURL}`);
    const body = await response.json();
    const online = Object.values(body.servers as Record<string, { port: number; status: string; game_mode: string }>)
        .filter(s => s.status === 'online');
    ports = online.map(s => s.port).sort();
    byMode = Object.fromEntries(online.map(s => [s.game_mode, s.port]));
    primary = body.primary;
    test.skip(!online.some((s: { port: number }) => s.port === primary), 'the primary server is not running');

    // A previous test's browser closes its socket as this one begins and its session
    // lingers for a moment, so give it a breath. Tests no longer need an empty relay:
    // they identify their own session, and the family plays on this server.
    await new Promise(resolve => setTimeout(resolve, 1_500));
    test.skip(ports.length === 0, 'no game server is running');
});

/** Plays, waiting until the engine has the screen. The lobby offers one server; a port
 *  names another, which is how the older servers are still reachable. */
async function join(page: Page, port?: number) {
    const chosen = port ?? primary;
    // An invited browser has the password filled in and the box hidden.
    if (await page.locator('#password-field').isVisible()) await page.fill('#password', serverPassword());
    await expect(page.locator('#start')).toBeEnabled({ timeout: 30_000 });
    await page.click('#start');
    await expect(page.locator('#leave-bar')).toBeVisible({ timeout: 180_000 });
    await page.waitForFunction(() => (window as any).__xash?.joined === true, null, { timeout: 60_000 });
    return chosen;
}

/** Who is connected right now, so a test can tell its own session from a real player's. */
async function sessionIds(baseURL: string): Promise<Set<string>> {
    const api = await request.newContext({ baseURL });
    const body = await (await api.get('/api/sessions')).json();
    return new Set(body.sessions.map((s: any) => s.id));
}

/** How many packets the relay has seen pass each way for this test's own session. The
 *  family plays on the same server these tests use, and "any session on that port" was
 *  somebody in the next room. */
async function traffic(baseURL: string, port: number, others: Set<string> = new Set()) {
    const api = await request.newContext({ baseURL });
    const body = await (await api.get('/api/sessions')).json();
    const mine = body.sessions.find((s: any) => s.port === port && !others.has(s.id));
    return mine ? Math.min(mine.packets_to_server, mine.packets_from_server) : 0;
}

test('the lobby names the one server, without asking which', async ({ page }) => {
    await page.goto(PLAY);
    await expect(page.locator('#server-line')).not.toHaveClass(/offline/, { timeout: 30_000 });
    await expect(page.locator('#server-line')).toContainText('CS 1.6');
    await expect(page.locator('#start')).toBeEnabled();
    // Nothing to choose: a name, a picture, and Play.
    await expect(page.locator('#form input[name=server]')).toHaveCount(0);
});

test('a player reaches the game through the relay', async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    const engineLog: string[] = [];
    page.on('console', m => engineLog.push(m.text()));

    const since = new Date().toISOString();
    const others = await sessionIds(baseURL!);
    const player = fresh('playwright');
    await page.goto(PLAY);
    await page.fill('#username', player);
    const port = await join(page);

    await expect(page.locator('#notice')).toBeHidden();
    await expect(page.locator('#lobby')).toBeHidden();
    await expect(page.locator('#loading')).toBeHidden();
    await expect.poll(() => traffic(baseURL!, port, others), { timeout: 60_000 }).toBeGreaterThan(20);
    // Packets flowing only proves the relay works; the server saying so proves the player
    // got in — which a wrong or missing server password would prevent.
    await expect.poll(() => enteredTheGame('cs16-main', player, since), { timeout: 60_000 }).toBe(true);

    await page.screenshot({ path: `test-results/in-game-${port}.png` });
    expect(engineLog.some(l => /fatal|Sys_Error/i.test(l)), engineLog.filter(l => /error/i.test(l)).join('\n')).toBe(false);
});

test('the unpacked game is cached for the next visit', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto(PLAY);
    await page.fill('#username', 'cache-test');
    await join(page);
    // The worker unpacked the base (~3,800 files); the cache should now hold it under the
    // sha256 the manifest gives the bundle, and the current map beside it.
    const meta = await page.evaluate(() => new Promise<{ sha256?: string; count?: number }>(resolve => {
        const open = indexedDB.open('cs16-content', 1);
        open.onsuccess = () => {
            const db = open.result;
            const g = db.transaction('meta', 'readonly').objectStore('meta').get('bundle:base');
            g.onsuccess = () => resolve((g.result as { sha256?: string; count?: number }) ?? {});
            g.onerror = () => resolve({});
        };
        open.onerror = () => resolve({});
    }));
    const manifest = await (await page.request.get('/content/manifest.json')).json() as { base: { sha256: string; files: number } };
    expect(meta.count ?? 0, 'the content cache should hold the unpacked base').toBe(manifest.base.files);
    expect(meta.sha256, 'the cache should be keyed to the current base bundle').toBe(manifest.base.sha256);
});

test('leaving returns to the lobby, and coming back does not download the game again', async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    // The base is downloaded once per visit (in the unzip worker); maps arrive behind the
    // game, and rejoining must not fetch the base again.
    let downloads = 0;
    page.on('request', r => { if (r.url().endsWith('/content/base.zip') && r.method() === 'GET') downloads++; });

    const others = await sessionIds(baseURL!);
    await page.goto(PLAY);
    await page.fill('#username', 'playwright');
    const first = await join(page);

    await page.click('#leave');
    await expect(page.locator('#lobby')).toBeVisible();
    await expect(page.locator('#leave-bar')).toBeHidden();
    // The engine is still booted, so the lobby says so and the picture choice is fixed.
    await expect(page.locator('#picture')).toHaveAttribute('data-booted', 'true');
    await expect.poll(() => traffic(baseURL!, first, others), { timeout: 30_000 }).toBe(0);

    // Back in, to the same server: the engine is still booted, so this must cost nothing.
    await join(page, first);
    await expect.poll(() => traffic(baseURL!, first, others), { timeout: 60_000 }).toBeGreaterThan(20);

    expect(downloads, 'the base should be fetched once per visit, not once per join').toBe(1);
});

test('Escape frees the mouse and does not throw you out of the game', async ({ page }) => {
    // It is the key people press to get the mouse back, and the browser releases the
    // pointer on it by itself. Pressing it twice used to end the game.
    test.setTimeout(240_000);
    await page.goto(PLAY);
    await page.fill('#username', 'escape-test');
    await join(page);
    for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
    }
    await expect(page.locator('#lobby')).toBeHidden();
    await expect(page.locator('#leave-bar')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__xash?.joined)).toBe(true);
});

test('the name is still in the box on the next visit', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto(PLAY);
    await page.fill('#username', 'remembered-name');
    await join(page);

    await page.goto(PLAY);   // a fresh visit: new page, same browser
    await expect(page.locator('#username')).toHaveValue('remembered-name');
});

/** Whether the server's own console says this player got into the game — since a given
 *  moment, because the same names are used run after run and a line from the last run
 *  once satisfied this before the player in question had spawned at all. */
function enteredTheGame(container: string, name: string, since?: string): boolean {
    try {
        const window = since ? `--since ${since}` : '';
        const log = execFileSync('sh', ['-c', `docker logs ${window} ${container} 2>&1 | tail -400`], { encoding: 'utf8', maxBuffer: 16 << 20 });
        return log.includes(`"${name}<`) && new RegExp(`"${name}<[^"]*" entered the game`).test(log);
    } catch {
        return false;
    }
}

/** The server's own console since a moment ago. */
function serverLog(container: string, since: string): string {
    try {
        return execFileSync('sh', ['-c', `docker logs ${container} --since ${since} 2>&1`], { encoding: 'utf8', maxBuffer: 64 << 20 });
    } catch {
        return '';
    }
}

test('a player who vanishes does not hand their slot, and their name, to the next player', async ({ browser }) => {
    // Every browser used to reach the server from the relay's one address, and ReHLDS
    // takes a new connection from a known address as that player coming back once they
    // have been silent for ten seconds: the newcomer got the absent player's slot and
    // their name. Three people, one of them stalling, was enough to make the game
    // unplayable (6 September 2026). Now each session leaves the relay from an address
    // of its own, and the server tells the two apart.
    test.setTimeout(300_000);
    const since = new Date().toISOString();

    const vanisher = fresh('vanisher'), newcomer = fresh('newcomer');
    const gone = await browser.newPage();
    await gone.goto(PLAY);
    await gone.fill('#username', vanisher);
    await join(gone);
    await expect.poll(() => enteredTheGame('cs16-main', vanisher, since), { timeout: 60_000 }).toBe(true);
    await gone.context().close();          // the tab is closed; the server is not told
    await new Promise(resolve => setTimeout(resolve, 12_000));   // past ReHLDS's ten seconds

    const next = await browser.newPage();
    await next.goto(PLAY);
    await next.fill('#username', newcomer);
    await join(next);
    await expect.poll(() => enteredTheGame('cs16-main', newcomer, since), { timeout: 60_000 }).toBe(true);

    // The server's own account of it: two players, two addresses, two names. (A
    // ":reconnect" line is not the tell — the engine logs one when a client re-sends its
    // own connect packet, from the same address and port. The tell is one player's
    // address, or name, turning up as another's.)
    const log = serverLog('cs16-main', since);
    const addressOf = (name: string) => new RegExp(`"${name}<[^"]*" connected, address "([0-9.]+):`).exec(log)?.[1];
    expect(addressOf(vanisher), 'the vanished player never connected').toBeTruthy();
    expect(addressOf(newcomer), 'the newcomer never connected').toBeTruthy();
    expect(addressOf(newcomer), 'both players reached the server from one address').not.toBe(addressOf(vanisher));
    const afterNewcomer = log.slice(log.indexOf(`"${newcomer}<`));
    expect(afterNewcomer, 'the newcomer entered under the vanished player\'s name').not.toMatch(new RegExp(`"${vanisher}<[^"]*" entered the game`));
    await next.context().close();
});

/** How many times the server has crashed, from its own console output. */
function segfaults(container: string): number {
    try {
        // 2>&1, because a segfault is announced on the container's stderr and
        // execFileSync hands back only its stdout.
        const log = execFileSync('sh', ['-c', `docker logs ${container} 2>&1`], { encoding: 'utf8', maxBuffer: 128 << 20 });
        return (log.match(/Segmentation fault/g) ?? []).length;
    } catch {
        return -1;   // no docker, or no such container: the test skips on this
    }
}

test('joining a team on deathmatch does not take the server down', async ({ page }) => {
    // CSDM's free-for-all plugin segfaulted the server about two seconds after anyone
    // joined a team, on every join, for a year. It never looked like a crash from the
    // inside — hlds_run restarts within ten seconds, so the packets resume and the game
    // simply feels broken: a weapons menu that gives you nothing, because the server dies
    // before it can equip you. So this asks the server's own console, which is the only
    // place it says so.
    // Since 9 September 2026 there is one server with every mode's plugins loaded, so
    // this joins it in whatever mode it is in: the plugins that could crash it are
    // loaded either way, and csdm_ffa.amxx must never be among them.
    const before = segfaults('cs16-main');
    test.skip(before < 0, 'cannot read the server container log');
    test.setTimeout(240_000);

    await page.goto(PLAY);
    await page.fill('#username', fresh('regression'));
    await join(page);
    await page.waitForTimeout(8_000);

    const run = (command: string) => page.evaluate(c => (window as any).__xash.Cmd_ExecuteString(c), command);
    await run('jointeam 2');
    await page.waitForTimeout(2_000);
    await run('slot1');            // the appearance menu; text menus answer to slotN
    await page.waitForTimeout(12_000);

    expect(segfaults('cs16-main'), 'the server crashed after a team join').toBe(before);
});

test('a refused password is explained instead of dumping the player in a menu', async ({ page }) => {
    // The engine writes "connection refused" to its own console, drawn on the canvas where
    // no script can read it — so a wrong password used to look like the game deciding not
    // to start. The page counts what arrives instead: a server that accepts you streams,
    // one that turns you away sends a refusal and stops.
    test.skip(serverPassword() === '', 'the server has no password, so nothing can be refused');
    test.setTimeout(180_000);

    await page.goto(PLAY);
    await page.fill('#username', 'refused');
    await page.fill('#password', 'definitely-not-the-password');
    await page.click('#start');

    await expect(page.locator('#leave-bar')).toBeVisible({ timeout: 180_000 });
    await expect(page.locator('#notice')).toContainText('did not accept the connection', { timeout: 40_000 });
    // And the WebRTC session was fine all along — it is the game that said no.
    expect(await page.evaluate(() => (window as any).__xash.fromServer)).toBeLessThan(50);
});

// --- invitations ---------------------------------------------------------------------

/** The people API, as the family login (which is how the first admin is made). */
async function invite(baseURL: string, name: string, role: 'player' | 'admin') {
    const api = await request.newContext({ baseURL });
    const made = await api.post('/api/people', { data: { name, role } });
    expect(made.ok(), `inviting ${name}: ${made.status()}`).toBe(true);
    return await made.json() as { id: number; name: string; link: string; address: string };
}

test('an invitation makes the browser somebody: the lobby knows the name and the server sees their own seat', async ({ page, baseURL, context }) => {
    test.setTimeout(240_000);
    const name = fresh('invited');
    const person = await invite(baseURL!, name, 'player');
    expect(person.address).toMatch(/^127\.1\./);

    // Opening the link leaves the cookie and lands in the lobby, name filled in and the
    // server's password already known, so the password box is gone.
    await page.goto(person.link);
    await expect(page).toHaveURL(/\/play\/$/);
    await expect(page.locator('#username')).toHaveValue(name);
    await expect(page.locator('#whoami')).toBeVisible();
    await expect(page.locator('#password-field')).toBeHidden();
    await expect(page.locator('#password')).toHaveValue(serverPassword());

    // The relay's session carries the name, and the game server sees them from their own
    // address — so on the server they are this person, not VALVE_ID_LAN like everybody.
    // Typing a different name renames the person: the relay, the session and the server
    // all know the new one.
    const renamed = name + '-2';
    await page.fill('#username', renamed);
    const since = new Date().toISOString();
    await page.click('#start');
    await expect(page.locator('#leave-bar')).toBeVisible({ timeout: 180_000 });
    await page.waitForFunction(() => (window as any).__xash?.joined === true, null, { timeout: 60_000 });
    const api = await request.newContext({ baseURL });
    const listed = (await (await api.get('/api/people')).json()).people as { id: number; name: string }[];
    expect(listed.find(p => p.id === person.id)?.name).toBe(renamed);
    const sessions = (await (await api.get('/api/sessions')).json()).sessions as { name: string }[];
    expect(sessions.some(s => s.name === renamed)).toBe(true);
    await expect.poll(() => enteredTheGame('cs16-main', renamed, since), { timeout: 60_000 }).toBe(true);
    const status = execFileSync('python3', ['../scripts/rcon.py', '27015', 'status'], { encoding: 'latin1' });
    const line = status.split('\n').find(l => l.includes(`"${renamed}"`)) ?? '';
    expect(line, status).toContain(person.address);
    expect(line).not.toContain('VALVE_ID_LAN');

    // A revoked invitation stops working, for the link and for the cookie alike.
    expect((await api.delete(`/api/people/${person.id}`)).ok()).toBe(true);
    const again = await context.newPage();
    const answer = await again.goto(person.link);
    expect(answer?.status()).toBe(404);
});

test('the people page is for admins, and a player cannot reach it with their cookie alone', async ({ browser, baseURL }) => {
    const player = await invite(baseURL!, fresh('player'), 'player');
    const admin = await invite(baseURL!, fresh('admin'), 'admin');
    // A context with no family login: only the cookie speaks. The same door decides who
    // may change the game from the lobby.
    for (const [person, expected] of [[player, 403], [admin, 200]] as const) {
        const context = await browser.newContext({ baseURL });
        const page = await context.newPage();
        await page.goto(person.link);
        await expect(page.locator('#game')).toBeVisible();
        await expect(page.locator('#change')).toBeVisible({ visible: expected === 200 });
        expect(await page.locator('#mode').isDisabled(), person.name).toBe(expected !== 200);
        if (expected === 403) {   // the admin is not asked, because that would change the live game
            const changed = await page.request.post('/api/settings', { data: { mode: 'classic', map: 'de_dust2', gravity: 800 } });
            expect(changed.status(), `${person.name} changing the game`).toBe(403);
        }
        const answer = await page.goto('/people');
        expect(answer?.status(), person.name).toBe(expected);
        await context.close();
    }
    // Leave no test people behind in the family's list.
    const api = await request.newContext({ baseURL });
    for (const person of [player, admin]) await api.delete(`/api/people/${person.id}`);
});

test('a map change finds its bundle already there, and the game goes on', async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    // The game comes in bundles: the base and the current map before playing, the rest of
    // the rotation behind the game. A map change must find the new map's files in place.
    const api = await request.newContext({ baseURL });
    const manifest = await (await api.get('/content/manifest.json')).json() as { maps: { name: string }[] };
    const before = (await (await api.get('/api/settings')).json()).current as { mode: string; map: string; gravity: number; bhop: boolean; maxFunds: boolean };
    const target = manifest.maps.map(m => m.name).find(n => n !== before.map && /^(cs_office|fy_iceworld2k|aim_map|de_dust2)$/.test(n));
    test.skip(!target, 'no second map to change to');

    await page.goto(PLAY);
    await page.fill('#username', fresh('changer'));
    await join(page);
    // The rotation arrives behind the game; on this machine, in seconds.
    await expect.poll(() => page.evaluate(() => (window as any).__bundles.size), { timeout: 60_000 }).toBeGreaterThan(20);

    const changed = await api.post('/api/settings', { data: { ...before, map: target } });
    expect(changed.ok()).toBe(true);
    try {
        // The client loads the new map from its own files: still in the game, on the new map.
        await expect.poll(() => {
            try {   // the console does not answer while the server is between maps
                const status = execFileSync('python3', ['../scripts/rcon.py', '27015', 'status'], { encoding: 'latin1', stdio: ['ignore', 'pipe', 'ignore'] });
                return /^map\s*:\s*(\S+)/m.exec(status)?.[1];
            } catch { return undefined; }
        }, { timeout: 30_000 }).toBe(target);
        await page.waitForTimeout(8_000);
        expect(await page.evaluate(() => (window as any).__xash?.joined)).toBe(true);
        const log = await page.evaluate(() => (window as any).__xashLog.slice(-120) as string[]);
        expect(log.some(l => /couldn't load|not found|Missing map|Failed to load/i.test(l)), log.join('\n')).toBe(false);
        await expect(page.locator('#lobby')).toBeHidden();
    } finally {
        await api.post('/api/settings', { data: before });   // as it was
    }
});

test('the network settings reach the engine, and the client reports itself to the telemetry', async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    const admin = await invite(baseURL!, fresh('netadmin'), 'admin');
    await page.goto(admin.link);
    // Chosen in the lobby, remembered, applied when the engine is up.
    await page.selectOption('#network select[data-cvar=cl_updaterate]', '30');
    await page.selectOption('#network select[data-cvar=ex_interp]', '0.05');
    await join(page);
    await expect.poll(() => page.evaluate(() => (window as any).__xash.getCVar('cl_updaterate')), { timeout: 20_000 }).toBe('30');
    expect(await page.evaluate(() => (window as any).__xash.getCVar('ex_interp'))).toBe('0.05');
    // The pause card's copy shows the same, and changing it there takes effect at once.
    expect(await page.locator('#network-live select[data-cvar=cl_updaterate]').inputValue()).toBe('30');
    await page.evaluate(() => { const s = document.querySelector<HTMLSelectElement>('#network-live select[data-cvar=cl_updaterate]')!; s.value = '60'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await expect.poll(() => page.evaluate(() => (window as any).__xash.getCVar('cl_updaterate')), { timeout: 10_000 }).toBe('60');
    // Within twenty seconds the relay has a sample naming the person with those settings.
    const api = await request.newContext({ baseURL, extraHTTPHeaders: { Cookie: `cs16_person=${new URL(admin.link).pathname.split('/').pop()}` } });
    await expect.poll(async () => {
        const body = await (await api.get('/api/telemetry?minutes=5')).json() as { samples: { name: string; settings?: Record<string, string> }[] };
        return body.samples.find(s => s.name === admin.name && s.settings?.cl_updaterate === '60') ? 'sampled' : 'not yet';
    }, { timeout: 40_000 }).toBe('sampled');
    expect((await api.get('/telemetry')).status()).toBe(200);
    await api.delete(`/api/people/${admin.id}`);
});

test('an admin can ask for bots, and one turns up to play', async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    const api = await request.newContext({ baseURL });
    const before = (await (await api.get('/api/settings')).json()).current as Record<string, unknown>;
    try {
        // Fill the server to two players: with one person in, one bot joins.
        const changed = await api.post('/api/settings', { data: { ...before, bots: 2, botSkill: 1 } });
        expect(changed.ok()).toBe(true);
        const now = (await (await api.get('/api/settings')).json()).current as { bots: number; botSkill: number };
        expect(now.bots).toBe(2);
        expect(now.botSkill).toBe(1);

        await page.goto(PLAY);
        await page.fill('#username', fresh('botherder'));
        await join(page);
        // Bots wait for a person on a team (bot_join_after_player), not merely connected.
        await page.waitForTimeout(3_000);
        await page.evaluate(() => (window as any).__xash.Cmd_ExecuteString('jointeam 2'));
        await page.waitForTimeout(2_000);
        await page.evaluate(() => (window as any).__xash.Cmd_ExecuteString('slot1'));
        await expect.poll(() => {
            try {
                const status = execFileSync('python3', ['../scripts/rcon.py', '27015', 'status'], { encoding: 'latin1', stdio: ['ignore', 'pipe', 'ignore'] });
                return /<BOT>|\bBOT\b/.test(status) || (status.match(/^#\s*\d+\s+"/gm) ?? []).length >= 2 ? 'a bot is in' : 'no bot yet';
            } catch { return 'no answer'; }
        }, { timeout: 60_000 }).toBe('a bot is in');
    } finally {
        await api.post('/api/settings', { data: before });   // as it was: no bots
    }
});
