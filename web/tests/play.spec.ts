import { test, expect, request } from '@playwright/test';

// End to end on this machine: the relay is up, at least one game server is up, and the
// built client is what the relay serves. The test plays as far as a real player does
// before the first shot: lobby → download → unpack → engine boot → WebRTC → in the game.

test.beforeEach(async ({ baseURL }) => {
    const api = await request.newContext({ baseURL });
    const servers = await api.get('/api/servers');
    test.skip(!servers.ok(), `no relay at ${baseURL}`);
    const body = await servers.json();
    test.skip(body.count === 0, 'no game server is running');
});

test('the lobby lists the servers the relay knows', async ({ page }) => {
    await page.goto('/client/');
    await expect(page.locator('#servers .choice')).not.toHaveCount(0);
    await expect(page.locator('#start')).toBeEnabled();
});

test('a player reaches the game through the relay', async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    const engineLog: string[] = [];
    page.on('console', m => engineLog.push(m.text()));

    await page.goto('/client/');
    await page.fill('#username', 'playwright');
    const first = page.locator('#servers .choice input:not([disabled])').first();
    await first.check();
    const port = Number(await first.getAttribute('value'));
    await page.click('#start');

    // The loading screen shows both phases, and goes away when the engine has the screen.
    await expect(page.locator('#loading')).toBeVisible();
    await expect(page.locator('#loading-text')).toHaveText(/Unpacking/, { timeout: 120_000 });
    await expect(page.locator('#loading')).toBeHidden({ timeout: 120_000 });

    // Engine running, WebRTC up, and the engine — not the lobby — has the screen.
    await page.waitForFunction(() => (window as any).__xash?.running === true, null, { timeout: 60_000 });
    await expect(page.locator('#notice')).toBeHidden();
    await expect(page.locator('#lobby')).toBeHidden();
    await expect(page.locator('#loading')).toBeHidden();

    // And the relay sees a session that is exchanging packets with that server.
    const api = await request.newContext({ baseURL });
    await expect.poll(async () => {
        const body = await (await api.get('/api/sessions')).json();
        const mine = body.sessions.find((s: any) => s.port === port);
        return mine ? Math.min(mine.packets_to_server, mine.packets_from_server) : 0;
    }, { timeout: 60_000 }).toBeGreaterThan(20);

    await page.screenshot({ path: `test-results/in-game-${port}.png` });
    expect(engineLog.some(l => /fatal|Sys_Error/i.test(l)), engineLog.filter(l => /error/i.test(l)).join('\n')).toBe(false);
});
