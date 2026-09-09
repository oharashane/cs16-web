import { loadAsync } from 'jszip';
import { ContentCache } from './cache';
import xashURL from 'xash3d-fwgs/xash.wasm?url';
import gl4esURL from 'xash3d-fwgs/libref_webgl2.wasm?url';
import filesystemURL from 'xash3d-fwgs/filesystem_stdio.wasm?url';
import menuURL from 'cs16-client/cl_dll/menu_emscripten_wasm32.wasm?url';
import clientURL from 'cs16-client/cl_dll/client_emscripten_wasm32.wasm?url';
import serverURL from 'cs16-client/dlls/cs_emscripten_wasm32.wasm?url';
import extrasURL from 'cs16-client/extras.pk3?url';
import { CONNECT_COMMAND, ConnectionEvent, Xash3DWebRTC } from './webrtc';

// The page: pick a name and a server, play, and come back. The engine boots once per
// visit — the 274 MB of game files are downloaded and unpacked once — so leaving a server
// and joining another is a new WebRTC session and nothing more.

type ServerEntry = { port: number; name: string; map: string; players: number; max_players: number; status: string; game_mode: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const lobby = $('lobby'), form = $<HTMLFormElement>('form'), username = $<HTMLInputElement>('username');
const serverLine = $('server-line'), start = $<HTMLButtonElement>('start');
const password = $<HTMLInputElement>('password');
const loading = $('loading'), loadingText = $('loading-text'), progress = $<HTMLProgressElement>('progress');
const notice = $('notice'), leaveBar = $('leave-bar'), leaveButton = $<HTMLButtonElement>('leave');
const modeBox = $<HTMLSelectElement>('mode'), mapBox = $<HTMLSelectElement>('map'), gravityBox = $<HTMLSelectElement>('gravity');
const bhopBox = $<HTMLInputElement>('bhop'), fundsBox = $<HTMLInputElement>('funds'), fundsRow = $('funds-row');
const paused = $('paused'), resumeButton = $<HTMLButtonElement>('resume');
const changeButton = $<HTMLButtonElement>('change');
const picture = $('picture');

const remembered = {
    get name() { return localStorage.getItem('username') ?? ''; },
    set name(value: string) { localStorage.setItem('username', value); },
    get sharp() { return localStorage.getItem('sharp') === 'true'; },
    set sharp(value: boolean) { localStorage.setItem('sharp', String(value)); },
    // Remembered so the family types it once. It is a door key for a game on a home
    // network, kept where the browser keeps such things and nowhere else.
    get password() { return localStorage.getItem('password') ?? ''; },
    set password(value: string) { localStorage.setItem('password', value); },
};

let engine: Xash3DWebRTC | undefined;
/** The picture setting the engine booted with; changing it needs a reload. */
let bootedSharp = false;
// One server, chosen by the relay. ?server=<port> overrides it, which is how the older
// servers are reached while they still exist.
const asked = Number(new URLSearchParams(location.search).get('server')) || 0;
let chosenPort = asked;

function say(text: string) { notice.textContent = text; notice.hidden = false; }
function quiet() { notice.hidden = true; }

// --- what the engine says -------------------------------------------------------------

/** The last of the engine's console, kept so a failure can be explained after the fact. */
const engineLog: string[] = [];

function record(line: string) {
    engineLog.push(line);
    if (engineLog.length > 400) engineLog.shift();
    const message = explain(line);
    if (message) say(message);
}

/**
 * Watches the first seconds of a game for the one failure the page cannot otherwise see.
 *
 * The engine writes "connection refused" to its own console, which is drawn on the canvas
 * and readable by nobody. But a server that accepts you streams updates continuously, and
 * one that turns you away sends a refusal and stops — so the count of datagrams arriving
 * is the difference between being in the game and staring at a menu.
 */
function watchJoin() {
    const playing = engine!;
    const before = playing.fromServer;
    setTimeout(() => {
        // Gone back to the lobby, or joined something else since: not ours to report on.
        if (!lobby.hidden || playing !== engine || !playing.joined) return;
        if (playing.fromServer - before < 50) {
            say('The server did not accept the connection. The usual reason is the server password — check it and press Play again.');
        }
    }, 12_000);
}

/**
 * Turns a line of engine console into something worth showing a player, or nothing.
 *
 * The rule here is to repeat what the server said rather than to guess what it meant. The
 * server has its own reasons and its own words for them — "For killing too many teammates"
 * — and a page that pattern-matches those into a menu of canned sentences will sooner or
 * later tell somebody they are banned when they are not. That happened on 7 September
 * 2026. So: the server's words, verbatim, with a hint added only where the engine's own
 * wording explains nothing.
 */
function explain(line: string): string | undefined {
    // "Server issued disconnect. Reason: Kicked :"For killing too many teammates""
    const disconnect = /Server issued disconnect\.\s*Reason:\s*(.+?)\s*$/i.exec(line);
    if (disconnect) return `The server disconnected you: ${tidy(disconnect[1])}`;
    // "Kicked by Console: "For killing too many teammates""
    const kicked = /^Kicked by ([^:]+):\s*(.+?)\s*$/i.exec(line);
    if (kicked) return `${kicked[1].trim() === 'Console' ? 'The server' : kicked[1].trim()} kicked you: ${tidy(kicked[2])}`;
    if (/bad password|invalid password/i.test(line) || (/password/i.test(line) && /fail|invalid|incorrect|wrong/i.test(line)))
        return 'The server refused that password. Check the password box and press Play again.';
    if (/server is full|server full/i.test(line)) return 'The server is full.';
    if (/connection (failed|refused|rejected)|couldn.t connect|no response from/i.test(line))
        return `Could not reach the game server. ${tidy(line)}`;
    return undefined;
}

/** The server's own words, with the engine's punctuation cleaned off. */
function tidy(reason: string): string {
    return reason.replace(/^Kicked\s*:?\s*/i, '').replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim();
}

/** Whether the engine has actually got into a game, as its own console reports it. */
function inGame(): boolean {
    return engineLog.some(line => /Connection accepted|Spawning server|precach|begin\b/i.test(line));
}

// --- how the server plays ------------------------------------------------------------

type Settings = { mode: string; map: string; gravity: number; bhop: boolean; maxFunds: boolean };
type SettingsReply = {
    modes: { Name: string; Display: string; Purpose: string; Maps: string[] }[];
    gravities: number[]; current: Settings; playingOn: string; applied?: string; problem?: string;
};

let mapsByMode: Record<string, string[]> = {};
/** What the server said it was, so Play can tell whether anything was actually changed. */
let asFound: Settings | undefined;

/** Reads the settings into the form. Failure is quiet: the controls simply stay empty and
 *  Play still works, because playing matters more than choosing. */
async function loadSettings() {
    let reply: SettingsReply;
    try {
        const response = await fetch('/api/settings');
        if (!response.ok) throw new Error(String(response.status));
        reply = await response.json();
    } catch {
        $('game').hidden = true;
        return;
    }
    mapsByMode = Object.fromEntries(reply.modes.map(m => [m.Name, m.Maps ?? []]));
    modeBox.replaceChildren(...reply.modes.map(m => new Option(m.Display, m.Name)));
    gravityBox.replaceChildren(...reply.gravities.map(g =>
        new Option(g === 800 ? '800 — normal' : String(g), String(g))));
    asFound = reply.current;
    show(reply.current);
    watchChanges();
}

function show(settings: Settings) {
    modeBox.value = settings.mode;
    fillMaps(settings.map);
    gravityBox.value = String(settings.gravity);
    bhopBox.checked = settings.bhop;
    fundsBox.checked = settings.maxFunds;
    fundsRow.hidden = settings.mode !== 'classic';
}

function fillMaps(chosen: string) {
    const maps = mapsByMode[modeBox.value] ?? [];
    mapBox.replaceChildren(...maps.map(name => new Option(name, name)));
    if (maps.includes(chosen)) mapBox.value = chosen;
}

/** What the form says now. */
function chosen(): Settings {
    return { mode: modeBox.value, map: mapBox.value, gravity: Number(gravityBox.value),
             bhop: bhopBox.checked, maxFunds: fundsBox.checked };
}

function sameAsFound(want: Settings): boolean {
    return asFound !== undefined && (Object.keys(want) as (keyof Settings)[])
        .every(key => want[key] === asFound![key]);
}

/** Sends the settings, but only when they differ from what the server already has —
 *  pressing Play without touching anything must not restart the map under the people
 *  already playing. */
async function applySettings(): Promise<string | undefined> {
    const want = chosen();
    if (sameAsFound(want)) return undefined;
    const response = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(want),
    });
    const reply: SettingsReply = await response.json();
    asFound = reply.current;
    return reply.problem;
}

/** The Change button is only worth pressing when something differs from the server. */
function watchChanges() {
    const update = () => { changeButton.disabled = sameAsFound(chosen()); };
    for (const control of [modeBox, mapBox, gravityBox, bhopBox, fundsBox]) {
        control.addEventListener('change', update);
    }
    modeBox.addEventListener('change', () => {
        fundsRow.hidden = modeBox.value !== 'classic';
        fillMaps(asFound?.map ?? '');
        update();
    });
    update();
}

// --- paused ---------------------------------------------------------------------------

// Letting go of the pointer does not stop the engine reading the mouse, so a loose cursor
// still swings the view. This covers the canvas until the player asks to go back in.
function watchPointer() {
    document.addEventListener('pointerlockchange', () => {
        const playing = !leaveBar.hidden && engine?.joined === true;
        paused.hidden = !playing || document.pointerLockElement !== null;
    });
}

function resume() {
    paused.hidden = true;
    document.querySelector('canvas')?.requestPointerLock();
}

// --- the lobby -----------------------------------------------------------------------

async function refreshServers() {
    // While playing, the lobby is hidden and the poll is just noise on the relay.
    if (lobby.hidden) return;
    try {
        const body = await (await fetch('/api/servers')).json() as { servers: Record<string, ServerEntry>; primary: number };
        const list = Object.values(body.servers);
        chosenPort = asked || body.primary;
        renderServer(list.find(s => s.port === chosenPort));
    } catch {
        serverLine.textContent = 'The relay is not answering.';
        serverLine.classList.add('offline');
        start.disabled = true;
    }
}

function renderServer(server: ServerEntry | undefined) {
    const online = server?.status === 'online';
    serverLine.classList.toggle('offline', !online);
    if (!server) {
        serverLine.textContent = asked
            ? `Nothing is running on port ${asked}.`
            : 'The server is not running. Ask for it to be started.';
    } else if (!online) {
        serverLine.textContent = `${server.name} is not answering.`;
    } else {
        serverLine.innerHTML = `${escape(server.name)}<span class="detail">${escape(server.map)} · ${server.players}/${server.max_players} playing</span>`;
    }
    start.disabled = !online;
}

const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function showLobby() {
    leaveBar.hidden = true;
    loading.hidden = true;
    lobby.hidden = false;
    // Once the engine has booted, the picture setting is fixed until a reload.
    if (engine) picture.setAttribute('data-booted', 'true');
    refreshServers();
}

function showGame() {
    lobby.hidden = true;
    loading.hidden = true;
    leaveBar.hidden = false;
}

// --- playing -------------------------------------------------------------------------

async function fetchWithProgress(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`${url}: ${response.status}`);
    const total = Number(response.headers.get('Content-Length')) || 0;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total) progress.value = received / total;
    }
    return new Blob(chunks as BlobPart[]).arrayBuffer();
}

/** Boots the engine and loads the game's files. Once per visit. */
/** The identity of the current /valve.zip — its length and last-modified — so a new
 *  content build invalidates the cache. A cheap HEAD, no body. */
async function contentKey(): Promise<string | null> {
    try {
        const head = await fetch('/valve.zip', { method: 'HEAD' });
        if (!head.ok) return null;
        return `${head.headers.get('Last-Modified') ?? ''}|${head.headers.get('Content-Length') ?? ''}`;
    } catch {
        return null;
    }
}

function writeFileTo(fs: any, path: string, bytes: Uint8Array) {
    const full = '/rodir/' + path;
    fs.mkdirTree(full.slice(0, full.lastIndexOf('/')));
    fs.writeFile(full, bytes);
}

/** Populate the engine's filesystem with the game's files: from the cache if this build is
 *  there, otherwise downloaded and unpacked (and cached for next time). */
async function loadGameFiles(fs: any): Promise<void> {
    const key = await contentKey();
    const cache = await ContentCache.open();

    if (cache && key && (await cache.storedKey()) === key) {
        loadingText.textContent = 'Loading the game…';
        progress.value = 0;
        await cache.readInto((path, bytes) => writeFileTo(fs, path, bytes), f => (progress.value = f));
        return;
    }

    if (cache) { try { await cache.clear(); } catch { /* best effort */ } }
    await unpackWithWorker(fs, cache, key);
}

/** Download and inflate /valve.zip in a worker, writing each file into the engine's
 *  filesystem as it arrives and, in batches, into the cache. Falls back to the main
 *  thread if a worker cannot be made, so loading never depends on it. */
function unpackWithWorker(fs: any, cache: ContentCache | null, key: string | null): Promise<void> {
    let worker: Worker;
    try {
        worker = new Worker(new URL('./unzip.worker.ts', import.meta.url), { type: 'module' });
    } catch {
        return unpackInline(fs);
    }
    return new Promise<void>((resolve, reject) => {
        let batch: [string, Uint8Array][] = [];
        let chain: Promise<void> = Promise.resolve();
        const flush = () => {
            if (!cache || batch.length === 0) return;
            const pending = batch;
            batch = [];
            chain = chain.then(() => cache.putBatch(pending)).catch(() => { /* cache is optional */ });
        };
        worker.onmessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === 'progress') {
                loadingText.textContent = message.phase === 'download' ? 'Downloading the game…' : 'Unpacking the game…';
                progress.value = message.fraction;
            } else if (message.type === 'file') {
                writeFileTo(fs, message.path, message.bytes);           // into MEMFS now
                if (cache) { batch.push([message.path, message.bytes]); if (batch.length >= 150) flush(); }
            } else if (message.type === 'done') {
                flush();
                chain.then(() => (cache && key ? cache.commit(key, message.count) : undefined))
                    .catch(() => { /* cache is optional */ })
                    .finally(() => { worker.terminate(); resolve(); });
            } else if (message.type === 'error') {
                worker.terminate();
                reject(new Error(message.message));
            }
        };
        worker.onerror = () => { worker.terminate(); reject(new Error('the unpacker failed')); };
        worker.postMessage({ url: '/valve.zip' });
    });
}

/** The old path, kept as a fallback: download and inflate on this thread. */
async function unpackInline(fs: any): Promise<void> {
    loadingText.textContent = 'Downloading the game…';
    progress.value = 0;
    const zip = await fetchWithProgress('/valve.zip').then(loadAsync);
    loadingText.textContent = 'Unpacking the game…';
    progress.value = 0;
    const files = Object.entries(zip.files).filter(([, file]) => !file.dir);
    for (let i = 0; i < files.length; i++) {
        const [path, file] = files[i];
        writeFileTo(fs, path, await file.async('uint8array'));
        if (i % 50 === 0) { progress.value = i / files.length; await new Promise(r => setTimeout(r, 0)); }
    }
}

async function boot(name: string, sharp: boolean) {
    loading.hidden = false;
    loadingText.textContent = 'Downloading the game…';
    progress.value = 0;

    // Retina: the engine draws one pixel per CSS pixel unless told the screen is denser.
    // "Fast" tells it the screen is ordinary, which is a quarter of the work on a 2x
    // display. It is read when the renderer starts, so it cannot change after this.
    if (!sharp) {
        try { Object.defineProperty(window, 'devicePixelRatio', { get: () => 1, configurable: true }); } catch { /* fine */ }
    }
    bootedSharp = sharp;

    const x = new Xash3DWebRTC(onConnection, {
        canvas: $<HTMLCanvasElement>('canvas'),
        arguments: ['-windowed', '-game', 'cstrike'],
        // The engine's console. Without this it goes nowhere — not even to the browser's
        // console — and a refused connection looks like the game simply deciding not to
        // start. It is the only place the engine says why.
        module: { print: record, printErr: record },
        libraries: { filesystem: filesystemURL, xash: xashURL, menu: menuURL, server: serverURL, client: clientURL, render: { gl4es: gl4esURL } },
        dynamicLibraries: ['dlls/cs_emscripten_wasm32.wasm', '/rodir/filesystem_stdio.wasm'],
        filesMap: { 'dlls/cs_emscripten_wasm32.wasm': serverURL, '/rodir/filesystem_stdio.wasm': filesystemURL },
    });
    (window as unknown as { __xash: Xash3DWebRTC; __xashLog: string[] }).__xash = x;
    (window as unknown as { __xashLog: string[] }).__xashLog = engineLog;

    // The engine's filesystem must exist before anything is written into it; extras.pk3 is
    // a hashed, immutable asset the browser caches, so it rides along with init.
    const [, extras] = await Promise.all([x.init(), fetch(extrasURL).then(r => r.arrayBuffer())]);
    if (x.exited) throw new Error('the engine stopped while loading');

    // The game's files: from the IndexedDB cache when this build is already unpacked there,
    // otherwise downloaded and inflated in a worker (which keeps this thread free) and
    // cached on the way past.
    await loadGameFiles(x.em!.FS);

    const fs = x.em!.FS;
    fs.writeFile('/rodir/cstrike/extras.pk3', new Uint8Array(extras));
    fs.chdir('/rodir');

    x.main();
    x.Cmd_ExecuteString('_vgui_menus 0');
    // Without this the engine puts "[Xash3D]" in front of every name on a GoldSrc server.
    x.Cmd_ExecuteString('cl_advertise_engine_in_name 0');
    x.Cmd_ExecuteString(`name "${name.replace(/"/g, '')}"`);
    // One key for the server's own menu, which is otherwise a console command nobody
    // remembers. Nothing in Counter-Strike binds i.
    x.Cmd_ExecuteString('bind i amxmodmenu');
    engine = x;
}

function onConnection(event: ConnectionEvent, detail?: string) {
    if (event === 'connected') quiet();
    // A connection that drops mid-game returns to the lobby rather than to a frozen screen.
    if (event === 'closed' && !lobby.hidden === false && engine && !engine.joined) {
        say('The connection to the game closed.');
        showLobby();
    }
    if (event === 'failed') say(`Could not reach the game: ${detail ?? 'unknown'}.`);
}

async function play(name: string, port: number, sharp: boolean, secret: string, change = false) {
    quiet();
    if (change) {
        const problem = await applySettings().catch(() => 'the settings could not be sent');
        if (problem) { say(problem); return; }
    }
    remembered.name = name;
    remembered.sharp = sharp;
    remembered.password = secret;

    if (engine && sharp !== bootedSharp) {
        // The renderer read the pixel ratio when it started; only a reload can change it.
        location.reload();
        return;
    }

    if (!engine) await boot(name, sharp);
    else engine.Cmd_ExecuteString(`name "${name.replace(/"/g, '')}"`);

    loading.hidden = false;
    loadingText.textContent = 'Connecting…';
    progress.removeAttribute('value');       // indeterminate: there is nothing to measure
    await engine!.join(port);
    progress.value = 0;

    // Before connecting, not after: the server asks for it during the handshake.
    engine!.Cmd_ExecuteString(secret.length > 0 ? `password "${secret.replace(/"/g, '')}"` : 'password ""');
    engine!.Cmd_ExecuteString(CONNECT_COMMAND);
    showGame();
    watchJoin();
    startRefreshing();
}

function leave() {
    stopRefreshing();
    engine?.leave();
    showLobby();
}

// --- keeping the engine under its ceiling ----------------------------------------------

// The published engine was built with a fixed heap and leaks about 50 KB of its network
// pool for every datagram it receives — 64 MB a minute of ordinary play, measured. Left
// alone it aborts with Aborted(OOM) after a few minutes and takes the tab with it. But
// dropping the connection frees the pool with the map, so before the ceiling arrives the
// game is dropped and taken again: a few seconds in a loading screen instead of a crash.
// The real fix is a rebuilt engine; see docs/review.
// Datagrams are a cheap standing estimate of how much has leaked (about 50 KB each); the
// engine's own memlist is the true figure but costs a few hundred lines of console, so it
// is only consulted once the estimate says we are anywhere near the ceiling.
const LEAK_PER_DATAGRAM = 52 * 1024;
const ASK_THE_ENGINE = 600 * 1024 * 1024;   // estimate above which we start measuring
const POOL_LIMIT = 1200 * 1024 * 1024;      // measured pool at which we refresh
const BLIND_LIMIT = 1250 * 1024 * 1024;     // estimate to act on if measuring fails
let leakBaseline = 0;
let refreshing: ReturnType<typeof setInterval> | undefined;
let checks = 0;

function startRefreshing() {
    stopRefreshing();
    leakBaseline = engine?.fromServer ?? 0;
    checks = 0;
    refreshing = setInterval(async () => {
        if (!engine?.joined || !lobby.hidden) return;
        const estimate = (engine.fromServer - leakBaseline) * LEAK_PER_DATAGRAM;
        if (estimate < ASK_THE_ENGINE) return;
        if (checks++ % 3 !== 0) return;             // measure every third tick, not every one
        const pool = await measurePool();
        // A map change frees the pool by itself, so a reading that has fallen means one
        // happened and nothing needs doing: start counting again from here.
        if (pool !== undefined && pool < ASK_THE_ENGINE) {
            leakBaseline = engine.fromServer;
            return;
        }
        if (pool === undefined ? estimate >= BLIND_LIMIT : pool >= POOL_LIMIT) refreshConnection();
    }, 15_000);
}

function stopRefreshing() {
    if (refreshing !== undefined) clearInterval(refreshing);
    refreshing = undefined;
}

/** What the engine says its network pool holds, in bytes, or nothing if it did not say. */
async function measurePool(): Promise<number | undefined> {
    const playing = engine;
    if (!playing) return undefined;
    playing.Cmd_ExecuteString('memlist');
    await new Promise(resolve => setTimeout(resolve, 900));
    const units: Record<string, number> = { bytes: 1, Kb: 1024, Mb: 1024 * 1024 };
    // Backwards, so this is the reading just asked for. (Not a slice from a remembered
    // length: engineLog is a ring, and memlist's three hundred lines shift it.)
    for (let i = engineLog.length - 1; i >= 0; i--) {
        const found = /([\d.]+)\s*(bytes|Kb|Mb)\s.*Network Pool/.exec(engineLog[i]);
        if (found) return parseFloat(found[1]) * units[found[2]];
    }
    return undefined;
}

/** Drop the game and take it again, which hands the engine's leaked memory back. */
function refreshConnection() {
    const playing = engine;
    if (!playing) return;
    leakBaseline = playing.fromServer;          // before the reconnect, so this fires once
    say('Freeing up the game\u2019s memory \u2014 back in a moment.');
    playing.Cmd_ExecuteString('disconnect');
    setTimeout(() => {
        if (playing !== engine || !playing.joined) return;
        const secret = remembered.password;
        playing.Cmd_ExecuteString(secret.length > 0 ? `password "${secret.replace(/"/g, '')}"` : 'password ""');
        playing.Cmd_ExecuteString(CONNECT_COMMAND);
        leakBaseline = playing.fromServer;
        setTimeout(() => { if (playing === engine && playing.joined) quiet(); }, 6_000);
    }, 700);
}

// --- wiring --------------------------------------------------------------------------

username.value = remembered.name;
password.value = remembered.password;
// An invited browser is somebody: the relay says who, and the name is not up for typing.
fetch('/api/me').then(r => r.ok ? r.json() : null).then((me: { name?: string; role?: string } | null) => {
    if (!me?.name) return;
    username.value = me.name;
    username.readOnly = true;
    $('whoami').hidden = false;
    if (me.role === 'admin') $('whoami').textContent = 'Invited as this person — an admin here; i in the game opens the menu.';
}).catch(() => { /* not invited, or offline: the box stays a box */ });
for (const radio of picture.querySelectorAll<HTMLInputElement>('input[name=dpr]')) {
    radio.checked = (radio.value === '0') === remembered.sharp;
}

/** Join, or change the game and then join: the same path, one flag apart. */
function go(change: boolean) {
    const sharp = (form.elements.namedItem('dpr') as RadioNodeList).value === '0';
    start.disabled = true;
    changeButton.disabled = true;
    play(username.value.trim(), chosenPort, sharp, password.value, change)
        .catch(error => {
            showLobby();
            say(`The game could not start: ${error?.message ?? error}`);
        })
        .finally(() => { refreshServers(); });
}

form.addEventListener('submit', event => { event.preventDefault(); go(false); });
changeButton.addEventListener('click', () => go(true));

leaveButton.addEventListener('click', leave);
paused.addEventListener('click', resume);
resumeButton.addEventListener('click', event => { event.stopPropagation(); resume(); });
watchPointer();
loadSettings();
// Escape used to leave the game if the mouse was already free. It is the key people press
// to get the mouse back — the browser releases the pointer on it by itself — and pressing
// it twice, which happens by accident all the time, threw them out of the game. Now only
// the button leaves.

// Only warn about closing the tab while there is a game to lose.
window.addEventListener('beforeunload', event => {
    if (engine?.joined) event.preventDefault();
});

refreshServers();
setInterval(refreshServers, 5000);
