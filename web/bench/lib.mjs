// What every measurement shares: a browser that can draw without a GPU, the site's
// login and the server's password read from the files the services read them from
// (never printed, never on a command line), and a player that joins and spawns.
//
// Environment: RELAY_URL (default http://127.0.0.1:27100), PLAY_PATH (/play/ or /next/),
// SERVER (a port, to reach a server that is not the primary).

import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const RELAY = process.env.RELAY_URL ?? 'http://127.0.0.1:27100';
export const PLAY = process.env.PLAY_PATH ?? '/play/';
export const SERVER = process.env.SERVER ? Number(process.env.SERVER) : undefined;

const here = new URL('.', import.meta.url);
const root = new URL('../../', here);

function fromEnvFile(file, key) {
    try {
        return new RegExp(`^${key}=(.*)$`, 'm').exec(readFileSync(new URL(file, root), 'utf8'))?.[1]?.trim() ?? '';
    } catch {
        return '';
    }
}

/** The family login the site is behind. */
export const credentials = {
    username: process.env.RELAY_USER ?? fromEnvFile('.relay.env', 'RELAY_USER') ?? 'ohara',
    password: process.env.RELAY_PASSWORD ?? fromEnvFile('.relay.env', 'RELAY_PASSWORD'),
};

/** The game server's password; empty when it is open. */
export const serverPassword = () => fromEnvFile('cs-server/.env', 'SV_PASSWORD');

/** Headless Chromium draws with SwiftShader, a CPU rasteriser. Frame rates measured here
 *  are about the engine and the draw-call count, not about any GPU. */
export const launch = (extra = []) => chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...extra],
    // HEADED=1 under xvfb-run gives a real window, which is the only way a tab can be
    // *hidden*: headless Chromium reports every page visible, whatever is in front.
    headless: !process.env.HEADED,
});

/** A page on the play route, logged in, with the engine's console lines kept. */
export async function open(browser, { width = 900, height = 560, name } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, httpCredentials: credentials });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
    // A Host_Error is an alert() in the web build; without this the page would hang on it.
    page.on('dialog', d => { errors.push('dialog: ' + d.message().replace(/\s+/g, ' ').slice(0, 300)); console.log('  DIALOG: ' + d.message().replace(/\s+/g, ' ').slice(0, 300)); d.dismiss().catch(() => {}); });
    await page.goto(RELAY + PLAY + (SERVER ? `?server=${SERVER}` : ''));
    if (name) await page.fill('#username', name);
    await page.fill('#password', serverPassword());
    return { page, context, errors };
}

/** Clicks Join and waits until the engine says it is in. Returns the seconds it took. */
export async function join(page, timeout = 240_000) {
    const started = Date.now();
    await page.click('#start');
    try {
        await page.waitForFunction(() => window.__xash?.joined === true, null, { timeout });
    } catch (e) {
        // Say where it stopped, not just that it did. Once in a chain of ten runs on
        // 9 September a join sat the whole timeout out without ever reaching the relay.
        const where = await page.evaluate(() => ({
            loading: document.getElementById('loading-text')?.textContent,
            notice: document.getElementById('notice')?.textContent,
            lobby: document.getElementById('lobby')?.hidden,
            tail: (window.__xashLog ?? []).slice(-8),
        })).catch(() => null);
        console.log(`  join did not complete in ${timeout / 1000} s: ${JSON.stringify(where)}`);
        throw e;
    }
    return (Date.now() - started) / 1000;
}

/** A console command in the engine. */
export const run = (page, command) => page.evaluate(c => window.__xash.Cmd_ExecuteString(c), command);

/** Joins a team and picks up a weapon, which is what makes the map draw and the server
 *  send entities. Most measurements want this state, not the team-select screen. */
export async function spawn(page, { team = 2, settle = 5_000 } = {}) {
    await page.waitForTimeout(3_000);
    await run(page, `jointeam ${team}`);
    await page.waitForTimeout(2_000);
    await run(page, 'slot1');
    await page.waitForTimeout(settle);
}

/** The engine's console since the page started (or since it was last cleared). */
export const engineLog = page => page.evaluate(() => (window.__xashLog ?? []).slice());
export const clearEngineLog = page => page.evaluate(() => { if (window.__xashLog) window.__xashLog.length = 0; });

/** Datagrams received from the server so far, as the client counts them. */
export const fromServer = page => page.evaluate(() => window.__xash?.fromServer ?? -1).catch(() => -1);

/** Memory as the browser sees it: JS heap, and the wasm heap the engine grows into. */
export const memory = page => page.evaluate(() => {
    const x = window.__xash ?? {};
    const buffer = x.em?.HEAPU8?.buffer ?? x.em?.wasmMemory?.buffer ?? null;
    return {
        wasmMB: buffer ? Math.round(buffer.byteLength / 1048576) : null,
        jsMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    };
});

/** Frames per second over a window, counted by requestAnimationFrame. Headless Chromium
 *  caps at 60; a map that reads 60 is "fast enough here", not a measurement. */
export const fps = (page, seconds = 9) => page.evaluate(s => new Promise(resolve => {
    let frames = 0;
    const started = performance.now();
    (function tick() {
        frames++;
        if (performance.now() - started < s * 1000) requestAnimationFrame(tick);
        else resolve(frames / ((performance.now() - started) / 1000));
    })();
}), seconds);

/** One rcon command to a server on this machine, through scripts/rcon.py, which keeps the
 *  password in the file it lives in. */
export const rcon = (port, command) =>
    execFileSync('python3', [new URL('../../scripts/rcon.py', here).pathname, String(port), command], { encoding: 'latin1' });

/** The primary server's port, from the relay. */
export async function primaryPort() {
    const body = await (await fetch(RELAY + '/api/servers', {
        headers: { Authorization: 'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64') },
    })).json();
    return SERVER ?? body.primary;
}

/** The current map on a server, from its `status`. */
export const currentMap = port => /^map\s*:\s*(\S+)/m.exec(rcon(port, 'status'))?.[1] ?? '?';

/** A player name no earlier run can have left a ghost of on the server. */
export const fresh = base => `${base}-${Date.now().toString(36).slice(-5)}`;

export const line = (label, value) => console.log(`  ${String(label).padEnd(36)} ${value}`);
