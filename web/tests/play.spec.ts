import { test, expect, request, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// End to end on this machine: the relay is up, at least one game server is up, and the
// built client is what the relay serves. The tests play as far as a real player does
// before the first shot, and then do the things a real player does next — leave, come
// back, switch server, return tomorrow with their name still in the box.

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

    // Start from a clean slate. A previous test's browser closes its socket as this one
    // begins, and its session lingers for a moment — long enough for a test that asks
    // "is anyone connected" to find somebody else's and believe it is their own.
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        if ((await (await api.get('/api/sessions')).json()).count === 0) break;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    test.skip(ports.length === 0, 'no game server is running');
});

/** Plays, waiting until the engine has the screen. The lobby offers one server; a port
 *  names another, which is how the older servers are still reachable. */
async function join(page: Page, port?: number) {
    const chosen = port ?? primary;
    await page.fill('#password', serverPassword());
    await expect(page.locator('#start')).toBeEnabled({ timeout: 30_000 });
    await page.click('#start');
    await expect(page.locator('#leave-bar')).toBeVisible({ timeout: 180_000 });
    await page.waitForFunction(() => (window as any).__xash?.joined === true, null, { timeout: 60_000 });
    return chosen;
}

/** How many packets the relay has seen pass each way for one server's session. */
async function traffic(baseURL: string, port: number) {
    const api = await request.newContext({ baseURL });
    const body = await (await api.get('/api/sessions')).json();
    const mine = body.sessions.find((s: any) => s.port === port);
    return mine ? Math.min(mine.packets_to_server, mine.packets_from_server) : 0;
}

test('the lobby names the one server, without asking which', async ({ page }) => {
    await page.goto('/play/');
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

    await page.goto('/play/');
    await page.fill('#username', 'playwright');
    const port = await join(page);

    await expect(page.locator('#notice')).toBeHidden();
    await expect(page.locator('#lobby')).toBeHidden();
    await expect(page.locator('#loading')).toBeHidden();
    await expect.poll(() => traffic(baseURL!, port), { timeout: 60_000 }).toBeGreaterThan(20);
    // Packets flowing only proves the relay works; the server saying so proves the player
    // got in — which a wrong or missing server password would prevent.
    await expect.poll(() => enteredTheGame('cs16-main', 'playwright'), { timeout: 60_000 }).toBe(true);

    await page.screenshot({ path: `test-results/in-game-${port}.png` });
    expect(engineLog.some(l => /fatal|Sys_Error/i.test(l)), engineLog.filter(l => /error/i.test(l)).join('\n')).toBe(false);
});

test('leaving returns to the lobby, and coming back does not download the game again', async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    let downloads = 0;
    page.on('request', r => { if (r.url().endsWith('/valve.zip')) downloads++; });

    await page.goto('/play/');
    await page.fill('#username', 'playwright');
    const first = await join(page);

    await page.click('#leave');
    await expect(page.locator('#lobby')).toBeVisible();
    await expect(page.locator('#leave-bar')).toBeHidden();
    // The engine is still booted, so the lobby says so and the picture choice is fixed.
    await expect(page.locator('#picture')).toHaveAttribute('data-booted', 'true');
    await expect.poll(() => traffic(baseURL!, first), { timeout: 30_000 }).toBe(0);

    // Back in, to the same server: the engine is still booted, so this must cost nothing.
    await join(page, first);
    await expect.poll(() => traffic(baseURL!, first), { timeout: 60_000 }).toBeGreaterThan(20);

    expect(downloads, 'valve.zip should be fetched once per visit, not once per join').toBe(1);
});

test('the name is still in the box on the next visit', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('/play/');
    await page.fill('#username', 'remembered-name');
    await join(page);

    await page.goto('/play/');   // a fresh visit: new page, same browser
    await expect(page.locator('#username')).toHaveValue('remembered-name');
});

/** Whether the server's own console says this player got into the game. */
function enteredTheGame(container: string, name: string): boolean {
    try {
        const log = execFileSync('sh', ['-c', `docker logs ${container} 2>&1 | tail -400`], { encoding: 'utf8', maxBuffer: 16 << 20 });
        return log.includes(`"${name}<`) && new RegExp(`"${name}<[^"]*" entered the game`).test(log);
    } catch {
        return false;
    }
}

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
    test.skip(byMode.deathmatch === undefined, 'the deathmatch server is not running');
    const before = segfaults('cs16-deathmatch');
    test.skip(before < 0, 'cannot read the deathmatch container log');
    test.setTimeout(240_000);

    await page.goto('/play/?server=' + byMode.deathmatch);
    await page.fill('#username', 'regression');
    await join(page, byMode.deathmatch);
    await page.waitForTimeout(8_000);

    const run = (command: string) => page.evaluate(c => (window as any).__xash.Cmd_ExecuteString(c), command);
    await run('jointeam 2');
    await page.waitForTimeout(2_000);
    await run('slot1');            // the appearance menu; text menus answer to slotN
    await page.waitForTimeout(12_000);

    expect(segfaults('cs16-deathmatch'), 'the server crashed after a team join').toBe(before);
});

test('a refused password is explained instead of dumping the player in a menu', async ({ page }) => {
    // The engine writes "connection refused" to its own console, drawn on the canvas where
    // no script can read it — so a wrong password used to look like the game deciding not
    // to start. The page counts what arrives instead: a server that accepts you streams,
    // one that turns you away sends a refusal and stops.
    test.skip(serverPassword() === '', 'the server has no password, so nothing can be refused');
    test.setTimeout(180_000);

    await page.goto('/play/');
    await page.fill('#username', 'refused');
    await page.fill('#password', 'definitely-not-the-password');
    await page.click('#start');

    await expect(page.locator('#leave-bar')).toBeVisible({ timeout: 180_000 });
    await expect(page.locator('#notice')).toContainText('did not accept the connection', { timeout: 40_000 });
    // And the WebRTC session was fine all along — it is the game that said no.
    expect(await page.evaluate(() => (window as any).__xash.fromServer)).toBeLessThan(50);
});
