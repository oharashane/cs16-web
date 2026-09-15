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
const loadingDetail = $('loading-detail'), loadingSteps = $('loading-steps');

// The loading screen, precisely: what is happening now (the phase and a detail line
// under the bar), and what has happened (a step per thing done, with how long it took).
// Shane wanted to watch; this is what there is to watch. window.__loadSteps keeps the
// list for the measurements.
const mb = (bytes: number) => (bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0) + ' MB';
const secs = (ms: number) => (ms / 1000).toFixed(ms < 10_000 ? 1 : 0) + ' s';
const screen = {
    since: 0,
    phaseSince: 0,
    steps: [] as { text: string; ms: number }[],
    begin() {
        this.since = this.phaseSince = performance.now();
        this.steps = [];
        loadingSteps.replaceChildren();
        loadingDetail.textContent = '';
        progress.value = 0;
    },
    phase(text: string) {
        loadingText.textContent = text;
        loadingDetail.textContent = '';
        this.phaseSince = performance.now();
    },
    detail(text: string) { loadingDetail.textContent = text; },
    fraction(f: number) { progress.value = Math.max(0, Math.min(1, f)); },
    /** A thing done: how long since the phase began, unless told otherwise. */
    step(text: string, ms?: number) {
        if (ms === undefined) ms = performance.now() - this.phaseSince;
        this.steps.push({ text, ms });
        const item = document.createElement('li');
        item.append(Object.assign(document.createElement('span'), { textContent: text }),
            Object.assign(document.createElement('span'), { textContent: secs(ms) }));
        loadingSteps.append(item);
        (window as unknown as { __loadSteps: unknown }).__loadSteps = this.steps;
    },
};
const notice = $('notice'), leaveBar = $('leave-bar'), leaveButton = $<HTMLButtonElement>('leave');
const modeBox = $<HTMLSelectElement>('mode'), mapBox = $<HTMLSelectElement>('map'), gravityBox = $<HTMLSelectElement>('gravity');
const bhopBox = $<HTMLInputElement>('bhop'), fundsBox = $<HTMLInputElement>('funds'), fundsRow = $('funds-row');
const botsBox = $<HTMLSelectElement>('bots'), botSkillBox = $<HTMLSelectElement>('bot-skill'), botSkillRow = $('bot-skill-row');
const botWeaponsBox = $<HTMLSelectElement>('bot-weapons'), botWeaponsRow = $('bot-weapons-row');
const paused = $('paused'), resumeButton = $<HTMLButtonElement>('resume');
const changeButton = $<HTMLButtonElement>('change');
const picture = $('picture');

const remembered = {
    get name() { return localStorage.getItem('username') ?? ''; },
    set name(value: string) { localStorage.setItem('username', value); },
    // The picture's scale: 0 is the screen's own (sharp), 1 one pixel per pixel, 0.5 half
    // resolution — a quarter of the work, and the game as it looked on a 2003 monitor.
    get scale() { const v = localStorage.getItem('scale'); if (v !== null) return Number(v); return localStorage.getItem('sharp') === 'true' ? 0 : 1; },
    set scale(value: number) { localStorage.setItem('scale', String(value)); },
    // Remembered so the family types it once. It is a door key for a game on a home
    // network, kept where the browser keeps such things and nowhere else.
    get password() { return localStorage.getItem('password') ?? ''; },
    set password(value: string) { localStorage.setItem('password', value); },
};

let engine: Xash3DWebRTC | undefined;
/** /demos/<name>: this page playing a recording instead of joining a server. */
const demoName = decodeURIComponent((location.pathname.match(/^\/demos\/([^/]+)$/) ?? [])[1] ?? '');
/** The picture setting the engine booted with; changing it needs a reload. */
let bootedScale = 1;
// One server, chosen by the relay. ?server=<port> overrides it, which is how the older
// servers are reached while they still exist.
const askedRaw = new URLSearchParams(location.search).get('server') || '';
const asked = Number(askedRaw) || 0;
/** A server outside the house, "host:port", from the eye; reached through the same bridge. */
const outside = askedRaw.includes(':') ? askedRaw : '';
let chosenPort = asked;
/** The map the chosen server is on, as /api/servers last said; its bundle must be in
 *  the engine's filesystem before connecting. */
let currentMap = '';

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

type Settings = { mode: string; map: string; gravity: number; bhop: boolean; maxFunds: boolean; bots: number; botSkill: number; botWeapons: string };
type SettingsReply = {
    modes: { Name: string; Display: string; Purpose: string; Maps: string[] }[];
    gravities: number[]; botCounts: number[]; current: Settings; playingOn: string; applied?: string; problem?: string;
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
    // Bots fill the server to a number of players and leave as people arrive.
    botsBox.replaceChildren(...(reply.botCounts ?? [0]).map(n =>
        new Option(n === 0 ? 'none' : `fill the server to ${n} players`, String(n))));
    asFound = reply.current;
    show(reply.current);
    watchChanges();
}

/** For everyone but an admin, the game's settings are there to read and not to touch. */
function lookOnly() {
    for (const control of [modeBox, mapBox, gravityBox, bhopBox, fundsBox, botsBox, botSkillBox, botWeaponsBox]) control.disabled = true;
    changeButton.hidden = true;
    $('game-legend').textContent = 'The game right now — an admin can change it';
}

function show(settings: Settings) {
    modeBox.value = settings.mode;
    fillMaps(settings.map);
    gravityBox.value = String(settings.gravity);
    bhopBox.checked = settings.bhop;
    fundsBox.checked = settings.maxFunds;
    fundsRow.hidden = settings.mode !== 'classic';
    botsBox.value = String(settings.bots ?? 0);
    botSkillBox.value = String(settings.botSkill ?? 0);
    botWeaponsBox.value = settings.botWeapons || 'all';
    botSkillRow.hidden = (settings.bots ?? 0) === 0;
    // Gun Game hands out the weapons; the choice does not apply there.
    botWeaponsRow.hidden = (settings.bots ?? 0) === 0 || settings.mode === 'gungame';
}

function fillMaps(chosen: string) {
    const maps = mapsByMode[modeBox.value] ?? [];
    mapBox.replaceChildren(...maps.map(name => new Option(name, name)));
    if (maps.includes(chosen)) mapBox.value = chosen;
}

/** What the form says now. */
function chosen(): Settings {
    return { mode: modeBox.value, map: mapBox.value, gravity: Number(gravityBox.value),
             bhop: bhopBox.checked, maxFunds: fundsBox.checked,
             bots: Number(botsBox.value), botSkill: Number(botSkillBox.value), botWeapons: botWeaponsBox.value };
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
    for (const control of [modeBox, mapBox, gravityBox, bhopBox, fundsBox, botsBox, botSkillBox, botWeaponsBox]) {
        control.addEventListener('change', update);
    }
    const botRows = () => { botSkillRow.hidden = botsBox.value === '0'; botWeaponsRow.hidden = botsBox.value === '0' || modeBox.value === 'gungame'; };
    botsBox.addEventListener('change', botRows);
    modeBox.addEventListener('change', botRows);
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
    if (outside) {
        // Somebody else's server: the house's game settings and the lab's are not for it.
        $('game').hidden = true;
        document.querySelector<HTMLElement>('.first-time-only')!.textContent = 'The game downloads about 270 MB the first time, then it is cached; a map the server has and we do not comes from the server as you join.';
        try {
            const r = await fetch(`/api/eye?to=${encodeURIComponent(outside)}`);
            if (!r.ok) throw new Error(await r.text());
            const s = await r.json() as { name: string; map: string; players: number; max: number; have_map: boolean };
            currentMap = s.map;
            renderServer({ port: 0, name: s.name, map: s.map, players: s.players, max_players: s.max, status: 'online', game_mode: 'outside' });
            if (!s.have_map) serverLine.innerHTML += `<span class="detail">${escape(s.map)} will be downloaded from the server</span>`;
        } catch (e) {
            serverLine.textContent = `${outside} did not answer: ${(e as Error).message}`;
            serverLine.classList.add('offline');
            start.disabled = true;
        }
        return;
    }
    try {
        const body = await (await fetch('/api/servers')).json() as { servers: Record<string, ServerEntry>; primary: number };
        const list = Object.values(body.servers);
        chosenPort = asked || body.primary;
        const chosen = list.find(s => s.port === chosenPort);
        // The game settings card is main's; on the lab it would be a lie.
        $('game').hidden = chosenPort !== body.primary;
        if (chosen?.map) currentMap = chosen.map;
        renderServer(chosen);
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
// --- the game's files, in bundles -------------------------------------------------------

function writeFileTo(fs: any, path: string, bytes: Uint8Array) {
    const full = '/rodir/' + path;
    fs.mkdirTree(full.slice(0, full.lastIndexOf('/')));
    fs.writeFile(full, bytes);
}

// --- what you wear ---------------------------------------------------------------------
//
// A player skin or a weapon model chosen in the museum is a file written over the stock
// one in this browser's engine filesystem, before the game starts: models/player/gign/
// gign.mdl becomes the chosen skin, v_ak47.mdl the chosen viewmodel. Your own choice, on
// your own screen, as it always was in Counter-Strike; nothing goes to the server. Kept in
// localStorage as [{ name, url, dest }], fetched fresh at every boot (small files, and
// never into the cache, where they would shadow the base bundle's own).
type Worn = { name: string; url: string; dest: string };
const worn = {
    get list(): Worn[] { try { return JSON.parse(localStorage.getItem('wear') || '[]'); } catch { return []; } },
    set list(v: Worn[]) { localStorage.setItem('wear', JSON.stringify(v)); },
};
async function wearChosenModels(fs: any) {
    const list = worn.list;
    if (!list.length) return;
    screen.phase('Putting on what you chose…');
    for (const w of list) {
        try {
            const r = await fetch(w.url, { credentials: 'same-origin' });
            if (!r.ok) throw new Error(String(r.status));
            const bytes = new Uint8Array(await r.arrayBuffer());
            writeFileTo(fs, 'cstrike/' + w.dest, bytes);
            // a player model's textures may sit beside it as <name>T.mdl; take that too if it is there
            const t = w.url.replace(/\.mdl$/i, 'T.mdl'), tDest = w.dest.replace(/\.mdl$/i, 'T.mdl');
            if (t !== w.url) { const rt = await fetch(t, { credentials: 'same-origin' }).catch(() => null); if (rt?.ok) writeFileTo(fs, 'cstrike/' + tDest, new Uint8Array(await rt.arrayBuffer())); }
            screen.step(`Wearing ${w.name} as ${w.dest}`);
        } catch (e) { screen.step(`Could not put on ${w.name}: ${(e as Error).message}`); }
    }
}
function renderWorn() {
    const line = document.getElementById('wearing');
    if (!line) return;
    const list = worn.list;
    line.hidden = list.length === 0;
    line.innerHTML = list.length ? `Wearing ${list.map(w => `<b>${escape(w.name)}</b> as ${escape(w.dest.replace(/^models\//, ''))}`).join(', ')} — from <a href="/museum">the museum</a>. <a href="#" id="wear-none">Take it all off</a>` : '';
    document.getElementById('wear-none')?.addEventListener('click', e => { e.preventDefault(); worn.list = []; renderWorn(); });
}
renderWorn();

// --- files the game's way -----------------------------------------------------------
//
// A server sends its resource list and its sv_downloadurl; the engine asks for what it
// lacks, one file at a time, through Module.http: fetch(id, url) starts one, poll(id)
// answers 0 while it runs, the size when it is done, -1 when it failed, and take(id, dest)
// writes the bytes into the engine's filesystem at dest (the game's downloaded/<path>)
// and says how many. A URL on another origin goes through the relay's proxy, since a
// browser may not fetch it directly; the relay's own /raw/ is same-origin. Every file
// fetched is kept in the browser's cache under the same path, so the next visit has it
// before the server asks.
type Fetching = { status: 'pending' | 'done' | 'failed'; bytes?: Uint8Array; url: string };
const engineFetches = new Map<number, Fetching>();
const httpForEngine = {
    fetch(id: number, url: string): boolean {
        let target = url;
        try {
            const u = new URL(url, location.href);
            if (u.origin !== location.origin) target = '/fetch?url=' + encodeURIComponent(u.href);
        } catch { return false; }
        const entry: Fetching = { status: 'pending', url };
        engineFetches.set(id, entry);
        fetch(target, { credentials: 'same-origin' }).then(async r => {
            if (!r.ok) throw new Error(String(r.status));
            entry.bytes = new Uint8Array(await r.arrayBuffer());
            entry.status = 'done';
        }).catch(() => { entry.status = 'failed'; });
        return true;
    },
    poll(id: number): number {
        const entry = engineFetches.get(id);
        if (!entry) return -1;
        if (entry.status === 'pending') return 0;
        if (entry.status === 'failed') { engineFetches.delete(id); return -1; }
        return entry.bytes!.length;
    },
    take(id: number, dest: string): number {
        const entry = engineFetches.get(id);
        engineFetches.delete(id);
        if (!entry?.bytes || !gameFS) return -1;
        const path = 'cstrike/' + dest.replace(/^\/+/, '');   // the game dir, under /rodir
        try { writeFileTo(gameFS, path, entry.bytes); } catch { return -1; }
        cache?.putBatch([[path, entry.bytes]]).catch(() => { /* the cache is a convenience */ });
        downloadedFiles++;
        return entry.bytes.length;
    },
};
let downloadedFiles = 0;
(window as unknown as { __downloads: () => number }).__downloads = () => downloadedFiles;   // for the tests

// content/manifest.json names the bundles: the base (most of the game) and one per map,
// each with the sha256 of its zip. The base and the map the server is on are what a
// player waits for; the rest of the rotation arrives behind the game, and every bundle
// is cached on its own, so a next visit reads them all back and a new map is a few
// megabytes rather than the whole game again.
type Bundle = { file: string; bytes: number; sha256: string; files: number };
type Manifest = { base: Bundle; extras?: Bundle | null; maps: (Bundle & { name: string })[] };
let manifest: Manifest | null = null;
/** Maps that came from the lab's manifest: fetched when the lab is on one, never prefetched. */
const labMaps = new Set<string>();
let cache: ContentCache | null = null;
/** Bundles whose files are in the engine's filesystem, by name ('base' or a map). */
const present = new Set<string>();
(window as unknown as { __bundles: Set<string> }).__bundles = present;   // for the tests
/** One fetch at a time; a bundle asked for twice is fetched once. */
const fetching = new Map<string, Promise<void>>();
let gameFS: any;

function bundleOf(name: string): Bundle | undefined {
    if (!manifest) return undefined;
    if (name === 'base') return manifest.base;
    if (name === 'extras') return manifest.extras ?? undefined;   // what the plugins want on the client: the announcer's sounds
    return manifest.maps.find(m => m.name === name);
}

/** The base and whatever the cache holds, then the current map. Once per visit. */
async function loadGameFiles(fs: any): Promise<void> {
    gameFS = fs;
    manifest = await fetch('/content/manifest.json', { cache: 'no-store' }).then(r => {
        if (!r.ok) throw new Error(`the game's manifest: ${r.status}`);
        return r.json();
    });
    // The lab's maps, bundled one at a time from the drive as the curator asks for them
    // (scripts/package-lab.py): listed after the main ones, so a name both have is main's.
    try {
        const lab = await fetch('/content/lab-manifest.json', { cache: 'no-store' });
        if (lab.ok) {
            const extra = (await lab.json() as Manifest).maps ?? [];
            const known = new Set(manifest!.maps.map(m => m.name));
            for (const m of extra) if (!known.has(m.name)) { manifest!.maps.push(m); labMaps.add(m.name); }
        }
    } catch { /* no lab */ }
    cache = await ContentCache.open();

    // Whatever an earlier visit left: read it all in, and note which bundles are still
    // the current ones. A stale base means a new build; start over.
    if (cache) {
        const cachedBase = await cache.bundleSha('base');
        if (cachedBase !== manifest!.base.sha256) {
            if (cachedBase !== null || (await cache.count().catch(() => 0)) > 0) {
                try { await cache.clear(); } catch { /* best effort */ }
            }
        } else {
            screen.phase('Loading the game…');
            screen.detail("from this browser's cache — no download");
            let files = 0;
            await cache.readInto((path, bytes) => writeFileTo(fs, path, bytes), (seen, total, path) => {
                files = total || seen;
                screen.fraction(total ? seen / total : 0);
                screen.detail(`${seen.toLocaleString()} of ${total.toLocaleString()} files from the cache · ${path}`);
            });
            screen.step(`Loaded ${files.toLocaleString()} files from the cache`);
            present.add('base');
            if (manifest!.extras && (await cache.bundleSha('extras')) === manifest!.extras.sha256) present.add('extras');
            for (const m of manifest!.maps) {
                if ((await cache.bundleSha(m.name)) === m.sha256) present.add(m.name);
            }
        }
    }
    await ensureBundle('base', true);
    if (manifest!.extras) await ensureBundle('extras', true);
    if (currentMap) await ensureBundle(currentMap, true);
}

/** Make sure a bundle's files are in the engine's filesystem, fetching it if not. With
 *  announce, the loading screen follows it; without, it happens behind the game. */
function ensureBundle(name: string, announce = false): Promise<void> {
    if (present.has(name)) return Promise.resolve();
    const bundle = bundleOf(name);
    if (!bundle || !gameFS) return Promise.resolve();   // a map the manifest does not know; the server will say so
    let pending = fetching.get(name);
    if (!pending) {
        pending = unpackWithWorker(gameFS, name, bundle, announce)
            .then(() => { present.add(name); })
            .finally(() => { fetching.delete(name); });
        fetching.set(name, pending);
    }
    return pending;
}

/** The rest of the rotation, behind the game: the maps after the current one first, so a
 *  map change finds its files there, then the others. One at a time. */
async function prefetchRotation(): Promise<void> {
    if (!manifest) return;
    const names = manifest.maps.map(m => m.name).filter(n => !labMaps.has(n));
    const from = Math.max(0, names.indexOf(currentMap));
    const order = [...names.slice(from + 1), ...names.slice(0, from)];
    for (const name of order) {
        if (present.has(name)) continue;
        try { await ensureBundle(name); } catch { /* the next map change will ask again */ }
        await new Promise(r => setTimeout(r, 300));
    }
}

/** While playing, the lobby's poll is off; this one only watches for the server changing
 *  map, so the new map's bundle is fetched at once if the prefetch has not reached it. */
let mapWatch: ReturnType<typeof setInterval> | undefined;
function watchMap() {
    if (mapWatch) clearInterval(mapWatch);
    mapWatch = setInterval(async () => {
        if (!lobby.hidden) return;
        try {
            const body = await (await fetch('/api/servers')).json() as { servers: Record<string, ServerEntry> };
            const chosen = Object.values(body.servers).find(s => s.port === chosenPort);
            if (chosen?.map && chosen.map !== currentMap) {
                currentMap = chosen.map;
                void ensureBundle(currentMap);
            }
        } catch { /* the relay will answer next time */ }
    }, 5_000);
}

/** Download and inflate one bundle in a worker, writing each file into the engine's
 *  filesystem as it arrives and, in batches, into the cache. Falls back to the main
 *  thread if a worker cannot be made, so loading never depends on it. */
function unpackWithWorker(fs: any, name: string, bundle: Bundle, announce: boolean): Promise<void> {
    const url = '/content/' + bundle.file;
    let worker: Worker;
    try {
        worker = new Worker(new URL('./unzip.worker.ts', import.meta.url), { type: 'module' });
    } catch {
        return unpackInline(fs, name, bundle, announce);
    }
    const what = name === 'base' ? 'the game' : name === 'extras' ? 'the extras' : `the map ${name}`;
    if (announce) {
        screen.phase(`Downloading ${what}…`);
        screen.detail(name === 'base' ? 'the game itself — models, sounds, textures; about 200 MB, once'
            : name === 'extras' ? `${mb(bundle.bytes)}: what the server's plugins add — the announcer's voice`
            : `${mb(bundle.bytes)}: the map, its textures and its sounds`);
    }
    return new Promise<void>((resolve, reject) => {
        let batch: [string, Uint8Array][] = [];
        let chain: Promise<void> = Promise.resolve();
        const flush = () => {
            if (!cache || batch.length === 0) return;
            const pending = batch;
            batch = [];
            chain = chain.then(() => cache!.putBatch(pending)).catch(() => { /* cache is optional */ });
        };
        let downloadedBytes = 0, unpacking = false, fileCount = 0;
        const downloadSince = performance.now();
        worker.onmessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === 'progress' && message.phase === 'download') {
                downloadedBytes = message.received;
                if (!announce) return;
                const rate = message.received / Math.max(0.05, (performance.now() - downloadSince) / 1000);
                screen.fraction(message.total ? message.received / message.total : 0);
                screen.detail(`${mb(message.received)} of ${message.total ? mb(message.total) : '?'} · ${mb(rate)}/s`);
            } else if (message.type === 'progress' && message.phase === 'unzip') {
                fileCount = message.count;
                if (!announce) return;
                if (!unpacking) {
                    unpacking = true;
                    screen.step(`Downloaded ${what}, ${mb(downloadedBytes)}`);
                    screen.phase(`Unpacking ${what}…`);
                }
                screen.fraction(message.index / message.count);
                screen.detail(`${message.index.toLocaleString()} of ${message.count.toLocaleString()} files · ${message.path}`);
            } else if (message.type === 'file') {
                writeFileTo(fs, message.path, message.bytes);           // into MEMFS now
                if (cache) { batch.push([message.path, message.bytes]); if (batch.length >= 150) flush(); }
            } else if (message.type === 'done') {
                if (announce) {
                    screen.step(`Unpacked ${(fileCount || message.count).toLocaleString()} files into memory`);
                    if (cache) { screen.phase('Keeping the game for next time…'); screen.detail("writing the files into this browser's storage"); }
                }
                flush();
                chain.then(() => (cache ? cache.commit(name, bundle.sha256, message.count) : undefined))
                    .catch(() => { /* cache is optional */ })
                    .finally(() => { if (announce && cache) screen.step('Cached for next time'); worker.terminate(); resolve(); });
            } else if (message.type === 'error') {
                worker.terminate();
                reject(new Error(message.message));
            }
        };
        worker.onerror = () => { worker.terminate(); reject(new Error('the unpacker failed')); };
        worker.postMessage({ url });
    });
}

/** The old path, kept as a fallback: download and inflate on this thread. */
async function unpackInline(fs: any, name: string, bundle: Bundle, announce: boolean): Promise<void> {
    if (announce) {
        screen.phase(`Downloading ${name === 'base' ? 'the game' : name === 'extras' ? 'the extras' : 'the map ' + name}…`);
        screen.detail('on the page itself — this browser could not start a worker');
    }
    const zip = await fetchWithProgress('/content/' + bundle.file).then(loadAsync);
    if (announce) { screen.step('Downloaded'); screen.phase('Unpacking…'); }
    const files = Object.entries(zip.files).filter(([, file]) => !file.dir);
    for (let i = 0; i < files.length; i++) {
        const [path, file] = files[i];
        writeFileTo(fs, path, await file.async('uint8array'));
        if (i % 50 === 0 && announce) {
            screen.fraction(i / files.length);
            screen.detail(`${i.toLocaleString()} of ${files.length.toLocaleString()} files · ${path}`);
            await new Promise(r => setTimeout(r, 0));
        }
    }
    if (announce) screen.step(`Unpacked ${files.length.toLocaleString()} files`);
}

async function boot(name: string, scale: number) {
    loading.hidden = false;
    screen.begin();
    screen.phase('Starting the engine…');
    screen.detail('fetching the engine, the game code and the menu');
    // Each piece of the engine is a fetch the browser times; reading those timings is how
    // the screen can say what arrived and how big it was without the engine's help.
    const seenParts = new Set<string>();
    const noteParts = () => {
        for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
            const file = entry.name.split('/').pop()?.split('?')[0] ?? '';
            if (!/\.wasm$|\.pk3$/.test(file) || seenParts.has(file) || entry.responseEnd === 0) continue;
            seenParts.add(file);
            const size = entry.transferSize || entry.decodedBodySize;
            const plain = file.replace(/-[A-Za-z0-9_-]{8}(?=\.)/, '');   // the build's hash, out of the name
            const what = { 'xash.wasm': 'the engine', 'filesystem_stdio.wasm': 'its filesystem', 'menu.wasm': 'the menu',
                'client.wasm': 'the game, client side', 'cs_emscripten_wasm32.wasm': 'the game, server side', 'extras.pk3': 'the extras' }[plain] ?? '';
            screen.step(`${plain}${what ? ' — ' + what : ''}${size ? ' · ' + mb(size) : ''}${entry.transferSize === 0 && entry.decodedBodySize ? ' (cached)' : ''}`, entry.duration);
        }
    };
    const partsTimer = setInterval(noteParts, 250);

    // Retina: the engine draws one pixel per CSS pixel unless told the screen is denser.
    // "Fast" tells it the screen is ordinary, which is a quarter of the work on a 2x
    // display. It is read when the renderer starts, so it cannot change after this.
    // The engine sizes its canvas by devicePixelRatio; telling it a smaller number is the
    // whole of the resolution setting. Below one, the browser scales the picture up, and
    // pixelated scaling keeps the pixels square rather than smeared.
    if (scale > 0) {
        try { Object.defineProperty(window, 'devicePixelRatio', { get: () => scale, configurable: true }); } catch { /* fine */ }
        if (scale < 1) $<HTMLCanvasElement>('canvas').style.imageRendering = 'pixelated';
    }
    bootedScale = scale;

    const x = new Xash3DWebRTC(onConnection, {
        canvas: $<HTMLCanvasElement>('canvas'),
        arguments: ['-windowed', '-game', 'cstrike'],
        // The engine's console. Without this it goes nowhere — not even to the browser's
        // console — and a refused connection looks like the game simply deciding not to
        // start. It is the only place the engine says why. And http: the engine's
        // fast-download layer in the web build (engine patch 0008) fetches through these.
        module: { print: record, printErr: record, http: httpForEngine },
        libraries: { filesystem: filesystemURL, xash: xashURL, menu: menuURL, server: serverURL, client: clientURL, render: { gl4es: gl4esURL } },
        dynamicLibraries: ['dlls/cs_emscripten_wasm32.wasm', '/rodir/filesystem_stdio.wasm'],
        filesMap: { 'dlls/cs_emscripten_wasm32.wasm': serverURL, '/rodir/filesystem_stdio.wasm': filesystemURL },
    });
    (window as unknown as { __xash: Xash3DWebRTC; __xashLog: string[] }).__xash = x;
    (window as unknown as { __xashLog: string[] }).__xashLog = engineLog;

    // The engine's filesystem must exist before anything is written into it; extras.pk3 is
    // a hashed, immutable asset the browser caches, so it rides along with init.
    const [, extras] = await Promise.all([x.init(), fetch(extrasURL).then(r => r.arrayBuffer())]);
    clearInterval(partsTimer);
    noteParts();
    if (x.exited) throw new Error('the engine stopped while loading');
    screen.step('Engine ready');
    screen.phase('Looking for the game in this browser…');
    screen.detail('the bundles: the game, and a map at a time; a cached copy means no download');

    // The game's files: from the IndexedDB cache when this build is already unpacked there,
    // otherwise downloaded and inflated in a worker (which keeps this thread free) and
    // cached on the way past.
    await loadGameFiles(x.em!.FS);

    const fs = x.em!.FS;
    fs.writeFile('/rodir/cstrike/extras.pk3', new Uint8Array(extras));
    await wearChosenModels(fs);
    fs.chdir('/rodir');

    screen.phase('Starting the game…');
    screen.detail('the engine reads its files and opens the renderer');
    x.main();
    screen.step('Game started', performance.now() - screen.phaseSince);
    startTicker();
    x.Cmd_ExecuteString('_vgui_menus 0');
    // Without this the engine puts "[Xash3D]" in front of every name on a GoldSrc server.
    x.Cmd_ExecuteString('cl_advertise_engine_in_name 0');
    x.Cmd_ExecuteString(`name "${name.replace(/"/g, '')}"`);
    // One key for the server's own menu, which is otherwise a console command nobody
    // remembers. Nothing in Counter-Strike binds i.
    x.Cmd_ExecuteString('bind i amxmodmenu');
    engine = x;
    if (!demoName) void applyNetwork();
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

async function play(name: string, port: number | string, scale: number, secret: string, change = false) {
    quiet();
    if (change) {
        const problem = await applySettings().catch(() => 'the settings could not be sent');
        if (problem) { say(problem); return; }
    }
    await renameIfAsked(name);
    remembered.name = name;
    remembered.scale = scale;
    remembered.password = secret;

    if (engine && scale !== bootedScale) {
        // The renderer read the pixel ratio when it started; only a reload can change it.
        location.reload();
        return;
    }

    if (!engine) await boot(name, scale);
    else engine.Cmd_ExecuteString(`name "${name.replace(/"/g, '')}"`);

    loading.hidden = false;
    if (!screen.since) screen.begin();
    // The map the server is on, before the engine asks for it.
    if (currentMap && !present.has(currentMap)) await ensureBundle(currentMap, true);
    screen.phase('Connecting…');
    screen.detail('a WebRTC session to the relay, then the game\'s own handshake');
    progress.removeAttribute('value');       // indeterminate: there is nothing to measure
    await engine!.join(port);
    screen.step('Relay connected');
    screen.detail('the game\'s own handshake with the server — the game draws the rest');
    progress.value = 0;

    // Before connecting, not after: the server asks for it during the handshake.
    engine!.Cmd_ExecuteString(secret.length > 0 ? `password "${secret.replace(/"/g, '')}"` : 'password ""');
    engine!.Cmd_ExecuteString(CONNECT_COMMAND);
    showGame();
    watchJoin();
    watchMap();
    void prefetchRotation();
}

function leave() {
    engine?.leave();
    showLobby();
}

// --- wiring --------------------------------------------------------------------------

username.value = remembered.name;
password.value = remembered.password;
// An invited browser is somebody: the relay says who, fills in the name (theirs to change)
// and the server's password (the invitation already opened a bigger door), so there is
// nothing to type.
type Me = { name?: string; role?: string; server_password?: string };
let me: Me | null = null;
fetch('/api/me').then(r => r.ok ? r.json() : null).then((who: Me | null) => {
    if (!who?.name) return;
    me = who;
    username.value = who.name;
    $('whoami').hidden = false;
    if (who.role === 'admin') $('whoami').textContent += ' An admin here: i in the game opens the menu.';
    else lookOnly();
    if (who.server_password !== undefined) {
        password.value = who.server_password;
        $('password-field').hidden = true;
    }
}).catch(() => { /* not invited, or offline: the boxes stay boxes */ });

/** An invited person who typed a different name is renaming themselves, everywhere. */
async function renameIfAsked(name: string) {
    if (!me?.name || name === me.name) return;
    const answer = await fetch('/api/me', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    if (!answer.ok) throw new Error(await answer.text());
    me = await answer.json();
}
for (const radio of picture.querySelectorAll<HTMLInputElement>('input[name=dpr]')) {
    radio.checked = Number(radio.value) === remembered.scale;
}

/** Join, or change the game and then join: the same path, one flag apart. */
function go(change: boolean) {
    const scale = Number((form.elements.namedItem('dpr') as RadioNodeList).value);
    start.disabled = true;
    changeButton.disabled = true;
    play(username.value.trim(), outside || chosenPort, scale, password.value, change)
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
// the button leaves. And the engine never hears Escape at all: to it the key opens its own
// menu, which stops a recording dead and fights the page's pause card in a game. The
// browser frees the pointer on Escape before any script runs, so the page loses nothing
// by swallowing the key here, at the capture stage, ahead of the engine's own listener.
// (The engine's listener is Emscripten's, on window at the capture stage, added when the
// engine boots — later than this one, so this one runs first and can stop it.)
for (const type of ['keydown', 'keyup']) window.addEventListener(type, event => {
    if ((event as KeyboardEvent).key !== 'Escape') return;
    event.stopImmediatePropagation();
    if (event.type === 'keydown' && document.pointerLockElement) return;   // let the browser free the pointer
    event.preventDefault();
}, { capture: true });

// --- network settings, and telemetry ----------------------------------------------------

// The rates are set on both sides. The server bounds them (sv_minupdaterate 20 …
// sv_maxupdaterate 101, sv_maxrate — raised to 100,000 on 9 September, because the stock
// 25,000 choked a client asking for a hundred updates a second); within those the client
// chooses, and this is where. The same four selects sit in the lobby and in the pause
// card; a change takes effect at once and is remembered. Every ten seconds while playing
// the page tells the relay what it is set to and how it is doing, and the relay lines that
// up with the server's ping for the player: /telemetry, for admins.
const NETWORK_CVARS = ['cl_updaterate', 'cl_cmdrate', 'ex_interp', 'rate', '_snd_mixahead'] as const;
type NetworkCvar = typeof NETWORK_CVARS[number];
const networkSelects = () => [...document.querySelectorAll<HTMLSelectElement>('select[data-cvar]')];
function networkSettings(): Record<NetworkCvar, string> {
    const out = {} as Record<NetworkCvar, string>;
    for (const name of NETWORK_CVARS) {
        const box = networkSelects().find(s => s.dataset.cvar === name);
        out[name] = localStorage.getItem('net:' + name) ?? box?.value ?? '';
    }
    return out;
}
const NETWORK_LABELS: Record<NetworkCvar, string> = { cl_updaterate: 'updates', cl_cmdrate: 'commands', ex_interp: 'interp', rate: 'bandwidth', _snd_mixahead: 'sound lead' };
/** Sets the engine's cvars and then reads them back, so what is shown is what the engine
 *  has, not what was asked for. "100 → 30" per changed value; "did not take" if the
 *  engine kept its own. */
async function applyNetwork() {
    if (!engine || engine.exited) return;
    const wanted = networkSettings();
    const read = (name: string) => engine!.getCVar(name, 400).then(v => v === undefined || v === null ? undefined : String(parseFloat(String(v)))).catch(() => undefined);
    const before: Partial<Record<NetworkCvar, string>> = {};
    for (const name of NETWORK_CVARS) before[name] = await read(name);
    for (const [name, value] of Object.entries(wanted)) {
        if (value !== '') engine.Cmd_ExecuteString(`${name} ${value}`);
    }
    await new Promise(r => setTimeout(r, 250));
    const parts: string[] = [];
    for (const name of NETWORK_CVARS) {
        const now = await read(name);
        if (now === undefined) continue;
        // "auto" interpolation (0) reads back as the value the engine chose, one update's worth.
        const same = Number(now) === Number(wanted[name]) || (name === 'ex_interp' && Number(wanted[name]) === 0);
        if (before[name] !== undefined && Number(before[name]) !== Number(now)) parts.push(`<b>${NETWORK_LABELS[name]}</b> ${before[name]} → ${now}`);
        else if (!same) parts.push(`<b>${NETWORK_LABELS[name]}</b> did not take (engine has ${now})`);
    }
    const text = parts.length ? `${parts.join(' · ')} — read back from the engine` : `The engine has these values — read back, not assumed.`;
    for (const line of document.querySelectorAll<HTMLElement>('[data-network-status]')) line.innerHTML = text;
}
for (const box of networkSelects()) {
    const saved = localStorage.getItem('net:' + box.dataset.cvar!);
    if (saved !== null) box.value = saved;
    box.addEventListener('click', event => event.stopPropagation());   // not "click anywhere to play on"
    box.addEventListener('change', event => {
        event.stopPropagation();
        localStorage.setItem('net:' + box.dataset.cvar!, box.value);
        for (const other of networkSelects()) if (other !== box && other.dataset.cvar === box.dataset.cvar) other.value = box.value;
        void applyNetwork();
    });
}
$('network-live').addEventListener('click', event => event.stopPropagation());

// The explanation, as a modal from either copy of the settings; a preset sets all four.
const networkHelp = $<HTMLDialogElement>('network-help');
for (const id of ['network-help-open', 'network-help-open-live']) {
    $(id).addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); networkHelp.showModal(); });
}
$('network-help-close').addEventListener('click', () => networkHelp.close());
networkHelp.addEventListener('click', event => event.stopPropagation());
for (const button of networkHelp.querySelectorAll<HTMLButtonElement>('button[data-preset]')) {
    button.addEventListener('click', () => {
        const [updates, commands, interp, rate, lead] = button.dataset.preset!.split(',');
        const values: Record<NetworkCvar, string> = { cl_updaterate: updates, cl_cmdrate: commands, ex_interp: interp, rate, _snd_mixahead: lead };
        for (const box of networkSelects()) {
            const value = values[box.dataset.cvar as NetworkCvar];
            box.value = value;
            localStorage.setItem('net:' + box.dataset.cvar!, value);
        }
        void applyNetwork();
        networkHelp.close();
    });
}

// The 2011 league config: Shane's own userconfig.cfg from the CAL/ESEA days, minus keys,
// sensitivity, name and volume — the settings that were about performance or seeing
// better. Applied as an experiment from the network help: every value is read back so the
// page can say which the engine took, which it clamped and which it does not have, and the
// frame rate is measured before and after. "Put it back" restores what the engine had.
const LEAGUE_CONFIG: [string, string][] = [
    ['fps_max', '99.5'], ['fps_override', '1'], ['gl_vsync', '0'], ['gl_disable_forced_vsync', '1'],
    ['cl_updaterate', '100'], ['cl_cmdrate', '102'], ['cl_cmdbackup', '2'], ['ex_interp', '0.01'], ['rate', '100000'], ['_snd_mixahead', '0.1'],
    ['max_shells', '0'], ['max_smokepuffs', '0'], ['cl_corpsestay', '0'], ['cl_himodels', '0'], ['cl_dynamiccrosshair', '0'], ['fastsprites', '2'],
    ['gl_dither', '0'], ['gl_fog', '0'], ['gl_overbright', '0'], ['gl_polyoffset', '4'], ['gl_picmip', '0'], ['gl_spriteblend', '0'],
    ['gl_texturemode', 'gl_nearest_mipmap_nearest'], ['gl_texture_nearest', '1'],   // the second is this engine's word for the first
    ['gl_wateramp', '0'], ['gl_ztrick', '1'], ['gl_ansio', '0'],
    ['r_detailtextures', '0'], ['r_decals', '1'], ['hud_fastswitch', '2'], ['hud_centerid', '1'], ['m_filter', '0'], ['m_rawinput', '0'],
    ['gamma', '3'], ['brightness', '2'], ['net_graph', '3'], ['net_graphpos', '2'],
];
let leagueBefore: Map<string, string | undefined> | null = null;
const leagueStatus = (html: string) => { for (const el of document.querySelectorAll<HTMLElement>('[data-league-status]')) el.innerHTML = html; };
// The engine's getCVar waits for the console line; its timeout is only checked when a
// later line arrives, so a cvar the engine does not have would wait for ever on a quiet
// console. A race with a clock of our own says "not there" instead.
const readCvar = (name: string, ms = 350) => Promise.race([
    engine!.getCVar(name, ms).then(v => v === undefined || v === null ? undefined : String(v)).catch(() => undefined),
    new Promise<undefined>(r => setTimeout(() => r(undefined), ms + 150)),
]);
/** Five seconds of frames, counted by requestAnimationFrame, as an average. */
function measureFps(seconds = 5): Promise<number> {
    return new Promise(resolve => {
        let frames = 0; const start = performance.now();
        (function tick() { requestAnimationFrame(() => { frames++; if (performance.now() - start < seconds * 1000) tick(); else resolve(frames / ((performance.now() - start) / 1000)); }); })();
    });
}
$('league-try').addEventListener('click', async event => {
    event.stopPropagation();
    if (!engine || engine.exited) { leagueStatus('Start the game first; the settings go to the running engine.'); return; }
    const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
    leagueStatus('Measuring the frame rate as it is — five seconds…');
    const fpsBefore = await measureFps();
    leagueStatus('Reading the engine\'s current values…');
    const names = LEAGUE_CONFIG.map(([n]) => n);
    const before = new Map(await Promise.all(names.map(async n => [n, await readCvar(n)] as [string, string | undefined])));
    if (!leagueBefore) leagueBefore = before;   // the first application's values are the ones to go back to
    for (const [n, v] of LEAGUE_CONFIG) engine.Cmd_ExecuteString(`${n} ${v}`);
    await new Promise(r => setTimeout(r, 300));
    const after = new Map(await Promise.all(names.map(async n => [n, await readCvar(n)] as [string, string | undefined])));
    const took: string[] = [], clamped: string[] = [], unknown: string[] = [], same: string[] = [];
    for (const [n, v] of LEAGUE_CONFIG) {
        const now = after.get(n);
        if (now === undefined) { unknown.push(n); continue; }
        const equal = isNaN(Number(v)) ? now.toLowerCase() === v.toLowerCase() : Number(now) === Number(v);
        if (equal) (before.get(n) === now ? same : took).push(n);
        else clamped.push(`${n} → ${now}`);
    }
    leagueStatus('Applied. Measuring the frame rate again — five seconds…');
    const fpsAfter = await measureFps();
    for (const box of networkSelects()) { const v = after.get(box.dataset.cvar!); if (v !== undefined) { box.value = v; localStorage.setItem('net:' + box.dataset.cvar!, box.value); } }
    leagueStatus(`<b>Frame rate</b> ${fpsBefore.toFixed(0)} → ${fpsAfter.toFixed(0)} fps (the browser caps it at the display's rate whatever fps_max says).<br>` +
        `<b>Took</b> ${took.length}: ${took.join(', ') || '—'}.<br>` +
        (same.length ? `<b>Already so</b> ${same.length}: ${same.join(', ')}.<br>` : '') +
        (clamped.length ? `<b>The engine kept its own</b> ${clamped.length}: ${clamped.join(', ')}.<br>` : '') +
        (unknown.length ? `<b>Not in this engine</b> ${unknown.length}: ${unknown.join(', ')}.` : ''));
    localStorage.setItem('league', '1');
    $<HTMLButtonElement>('league-undo').disabled = false; button.disabled = false;
});
$('league-undo').addEventListener('click', async event => {
    event.stopPropagation();
    if (!engine || engine.exited || !leagueBefore) return;
    for (const [n, v] of leagueBefore) if (v !== undefined) engine.Cmd_ExecuteString(`${n} ${v}`);
    localStorage.removeItem('league');
    leagueBefore = null; $<HTMLButtonElement>('league-undo').disabled = true;
    for (const box of networkSelects()) { const v = localStorage.getItem('net:' + box.dataset.cvar!); if (v !== null) box.value = v; }
    void applyNetwork();
    leagueStatus('Put back: the values the engine had before the first application.');
});

let framesThisSecond = 0, framesLastSecond = 0;
(function countFrames() { requestAnimationFrame(() => { framesThisSecond++; countFrames(); }); })();
setInterval(() => { framesLastSecond = framesThisSecond; framesThisSecond = 0; }, 1000);
setInterval(() => {
    if (!engine?.joined || !lobby.hidden) return;
    const body = { name: me?.name || username.value.trim(), settings: networkSettings(), fps: framesLastSecond, hidden: driving, takeovers, keepalive: keepaliveOn, sharp: bootedScale === 0, scale: bootedScale, league: localStorage.getItem('league') === '1' };
    fetch('/api/telemetry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => { /* optional */ });
}, 10_000);

// --- a tab that is not in front keeps playing ----------------------------------------

// The engine's loop rides on requestAnimationFrame, and a browser stops or slows that
// for a tab that is not in front — to nothing when hidden, to once a second when merely
// behind another tab — so the game goes silent or crawls, and the server drops the
// player or the reliable channel overflows on the way back. So the page watches the
// frame clock, and when it stalls the page drives the frames itself from a worker's
// timer (workers are not throttled), through two functions the engine exports for it
// (patch 0004: Host_WebLoop pauses and resumes the engine's own scheduling, Host_WebFrame
// runs one frame). When requestAnimationFrame is back at speed, the engine gets its loop
// back. Nothing anyone sees is drawn meanwhile; this is to keep the player in the game.
// Two signals say the clock has stopped: the tab says it is hidden (then a quarter
// second without a frame is enough), or, whatever the tab says, no frame has come for
// most of a second — a tab behind another one gets exactly one a second. Anything
// shorter is a hitch, not a stop: a slow machine loading its first sound can hold a
// frame for half a second, and taking the loop away and handing it back around every
// such hitch is a stutter of its own. The loop goes back only after a run of healthy
// frames, so a single frame does not flap it. ?keepalive=0 turns all of this off, for
// telling it apart from anything else by ear; the takeovers are counted for the telemetry.
const STALL_HIDDEN_MS = 250, STALL_MS = 900;
const HEALTHY_FRAMES = 10;
const TICK_MS = 50;          // the worker's clock: twenty frames a second, enough for the netchan
const keepaliveOn = new URLSearchParams(location.search).get('keepalive') !== '0';
let ticker: Worker | undefined;
let driving = false;
let takeovers = 0;
let lastFrame = performance.now(), previousFrame = lastFrame, healthyRun = 0;
(function watchFrames() {
    requestAnimationFrame(() => {
        previousFrame = lastFrame;
        lastFrame = performance.now();
        healthyRun = lastFrame - previousFrame < 100 ? healthyRun + 1 : 0;
        watchFrames();
    });
})();
function engineCall(name: string, ...args: number[]): boolean {
    const em = engine?.em as { Module?: { ccall: (name: string, ret: null, types: string[], args: unknown[]) => void } } | undefined;
    if (!em?.Module?.ccall || !engine || engine.exited) return false;
    try { em.Module.ccall(name, null, args.map(() => 'number'), args); return true; } catch { return false; }
}
function startTicker() {
    if (ticker || !keepaliveOn) return;
    try {
        ticker = new Worker(new URL('./tick.worker.ts', import.meta.url), { type: 'module' });
    } catch {
        return;   // no worker: the old behaviour, and the server's timeout is long
    }
    ticker.onmessage = () => {
        if (!engine || engine.exited) return;
        const since = performance.now() - lastFrame;
        const stalled = since > (document.hidden ? STALL_HIDDEN_MS : STALL_MS);
        const healthy = since < 100 && healthyRun >= HEALTHY_FRAMES;
        if (!driving && stalled) { driving = engineCall('Host_WebLoop', 0); if (driving) { takeovers++; healthyRun = 0; } }
        else if (driving && healthy) { engineCall('Host_WebLoop', 1); driving = false; }
        if (driving) engineCall('Host_WebFrame');
    };
    ticker.postMessage({ every: TICK_MS });
}

// Only warn about closing the tab while there is a game to lose.
window.addEventListener('beforeunload', event => {
    if (engine?.joined) event.preventDefault();
});

if (demoName) {
    void startDemoMode(demoName);
} else {
    refreshServers();
    setInterval(refreshServers, 5000);
}

// --- a recording -------------------------------------------------------------------------
// /demos/<name>: the same page and the same engine, no server. The recording and its map
// come from the relay into the engine's filesystem, playdemo runs it, and a bar under the
// picture is the transport — pause, speed, a scrubber — plus, for a spectator's (HLTV)
// recording, the perspective. Engine patches 0005 and 0006 are what make this possible;
// Demo_WebState is the engine's word on where the recording is.

type DemoResource = { kind: string; path: string; missing?: boolean; shared?: boolean };
type DemoInfo = {
    name: string; map: string; game: string; protocol: number; hltv: boolean; seconds: number; frames: number;
    recorder?: string; recorderInfo?: string; server?: string; build?: number; maxPlayers?: number; cheats?: boolean;
    gravity?: number; maxSpeed?: number; sky?: string; resources?: DemoResource[]; missing: number; problem?: string;
    mapMissing?: boolean; commands?: string[]; clientSounds?: string[]; userMessages?: string[]; frameTypes?: Record<string, number>;
    players?: { slot: number; name: string; steamId?: string; at: number }[];
    sections?: { description: string; seconds: number; frames: number; bytes: number }[]; netBytes?: number; bytes: number; modified: string;
};
type DemoState = { playing: number; paused?: number; seeking?: number; time?: number; at?: number; length?: number; speed?: number; section?: number; state?: number; spectator?: number };

const demoBar = $('demo-bar'), demoPlay = $<HTMLButtonElement>('demo-play'), demoTime = $('demo-time');
const demoScrub = $<HTMLInputElement>('demo-scrub'), demoSpeed = $<HTMLSelectElement>('demo-speed');
const demoView = $('demo-view'), demoStatus = $('demo-status'), demoDetails = $<HTMLDialogElement>('demo-details');
let demoInfo: DemoInfo | null = null;
let scrubbing = false, demoEnded = false;
let seekIssuedAt = 0;   // when the last demo_seek was sent, for holding the bar on the destination
/** Where a seek is heading, so the bar shows the destination rather than the road there. */
let seekTarget = -1;

function demoState(): DemoState {
    const em = engine?.em as { Module?: { ccall: (name: string, ret: string, types: string[], args: unknown[]) => string } } | undefined;
    try { return JSON.parse(em?.Module?.ccall('Demo_WebState', 'string', [], []) ?? '{"playing":0}'); } catch { return { playing: 0 }; }
}
const clock = (s: number) => {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(x).padStart(2, '0');
};
const demoCmd = (...commands: string[]) => { for (const c of commands) engine?.Cmd_ExecuteString(c); };

async function fetchInto(url: string, path: string): Promise<number> {
    const bytes = await fetchWithProgress(url);
    writeFileTo(gameFS, path, new Uint8Array(bytes));
    return bytes.byteLength;
}

/** A map the bundles do not carry: from the server's files, with the wads and the sky
 *  the catalogue says it needs. */
async function fetchRawMap(map: string) {
    screen.phase('Fetching the map…');
    screen.detail(`${map} from the server's files, with its wads`);
    await fetchInto(`/raw/maps/${encodeURIComponent(map)}.bsp`, `cstrike/maps/${map}.bsp`);
    let extras = 0;
    try {
        const catalogue = await fetch('/content/catalogue.json', { cache: 'no-store' }).then(r => r.json()) as { maps: { name: string; deps: { kind: string; path: string; where: string }[] }[] };
        for (const dep of catalogue.maps.find(m => m.name === map)?.deps ?? []) {
            if (dep.where !== 'content') continue;
            if (dep.kind === 'wad') { await fetchInto(`/raw/${dep.path}`, `cstrike/${dep.path.split('/').pop()}`); extras++; }
            else if (dep.kind === 'sky') {
                for (const side of ['bk', 'dn', 'ft', 'lf', 'rt', 'up']) {
                    const file = dep.path.replace('*', side + '.tga');
                    try { await fetchInto(`/raw/${file}`, `cstrike/${file}`); extras++; } catch { /* not every sky has every side as a tga */ }
                }
            }
        }
    } catch { /* no catalogue: the map may carry its own textures */ }
    present.add(map);
    screen.step(`${map}${extras ? ` and ${extras} of its files` : ''} from the server`);
}

async function startDemoMode(name: string) {
    lobby.hidden = true;
    document.title = `${name} — a recording`;
    // The engine takes the mouse the moment it moves over the picture, as a game should;
    // a recording has a bar to click. So the mouse is the engine's only after a click on
    // the picture (free look in an HLTV recording), and Esc gives it back.
    const canvas = $<HTMLCanvasElement>('canvas');
    let wantsMouse = false;
    const lock = canvas.requestPointerLock.bind(canvas);
    (canvas as unknown as { requestPointerLock: (...args: unknown[]) => unknown }).requestPointerLock = (...args: unknown[]) => wantsMouse ? lock(...(args as [])) : undefined;
    canvas.addEventListener('mousedown', () => { wantsMouse = true; lock(); });
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) wantsMouse = false; });
    loading.hidden = false;
    screen.begin();
    screen.phase('Reading the recording…');
    screen.detail('what the file says about itself');
    try {
        const answer = await fetch(`/api/demos/${encodeURIComponent(name)}`);
        if (!answer.ok) throw new Error(answer.status === 404 ? 'no such demo' : `${answer.status}`);
        demoInfo = await answer.json();
        if (demoInfo!.problem && !demoInfo!.map) throw new Error(demoInfo!.problem);
        if (demoInfo!.mapMissing) throw new Error(`its map, ${demoInfo!.map}, is not on this server (${demoInfo!.game === 'cstrike' ? 'it could be added to cs-server/shared/maps' : `it is a ${demoInfo!.game} map, and this is a Counter-Strike server`})`);
        screen.step(`${demoInfo!.hltv ? 'HLTV' : (demoInfo!.recorder || 'a player')} on ${demoInfo!.map} · ${clock(demoInfo!.seconds)}${demoInfo!.protocol < 48 ? ` · protocol ${demoInfo!.protocol}` : ''}`);
        currentMap = demoInfo!.map;
        await boot(remembered.name || 'watching', remembered.scale);
        if (!present.has(currentMap)) await fetchRawMap(currentMap);

        // what the server had that the bundles do not: its own models, sounds and sprites
        const fromServer = (demoInfo!.resources ?? []).filter(r => r.shared);
        if (fromServer.length) {
            screen.phase('Fetching what the server had…');
            let done = 0;
            for (const r of fromServer) {
                const path = r.kind === 'sound' ? 'sound/' + r.path : r.path;
                try { await fetchInto(`/raw/${path}`, 'cstrike/' + path); } catch { /* listed a moment ago; the game will say */ }
                screen.fraction(++done / fromServer.length);
                screen.detail(`${done} of ${fromServer.length} · ${path}`);
            }
            screen.step(`${done} files from the server`);
        }
        if (demoInfo!.missing) screen.step(`${demoInfo!.missing} of its files we have nowhere — see the details`);

        screen.phase('Fetching the recording…');
        screen.detail(name);
        const size = await fetchInto(`/content/demos/${encodeURIComponent(name)}`, 'cstrike/demo.dem');
        screen.step(`The recording · ${mb(size)}`);
        screen.phase('Starting the recording…');
        screen.detail('the engine reads its loading section and opens the map');
        // A recording's MOTD stays on screen with nobody to dismiss it, and the server it
        // welcomed you to is named in the console anyway.
        demoCmd('cl_hide_motd 1', 'r_demo_xray 1', 'demo_pause 0', 'demo_speed 1', 'playdemo demo');
        xray = true; $('demo-xray').classList.add('on');
        showDemoBar();
        watchDemo();
    } catch (error) {
        loading.hidden = true;
        say(`This recording could not start: ${(error as Error)?.message ?? error}`);
    }
}

function showDemoBar() {
    loading.hidden = true;
    leaveBar.hidden = true;
    demoBar.hidden = false;
    demoView.replaceChildren();
    if (demoInfo?.hltv) {
        const button = (label: string, title: string, ...commands: string[]) => {
            const b = document.createElement('button');
            b.type = 'button'; b.textContent = label; b.title = title;
            b.addEventListener('click', () => demoCmd(...commands));
            return b;
        };
        demoView.append(
            button('Director', "HLTV's director chooses the camera again", 'spec_autodirector 1'),
            button('Chase', 'Follow a player from behind; Next and Prev change who', 'spec_autodirector 0', 'spec_mode 2'),
            button('Eyes', "Through a player's eyes", 'spec_autodirector 0', 'spec_mode 4'),
            button('Free', 'Fly freely: click the picture for the mouse, Esc lets go', 'spec_autodirector 0', 'spec_mode 3'),
            button('Overview', 'The map from above', 'spec_autodirector 0', 'spec_mode 5'),
            button('◀ Prev', 'The previous player', 'spec_autodirector 0', '+attack2', '-attack2'),
            button('Next ▶', 'The next player', 'spec_autodirector 0', '+attack', '-attack'),
        );
    } else {
        const note = document.createElement('span');
        note.className = 'muted small';
        note.textContent = `${demoInfo?.recorder || 'the player'}'s own eyes — a player's recording holds only their view`;
        demoView.append(note);
    }
}

function watchDemo() {
    const tick = () => {
        const s = demoState();
        if (!s.playing) {
            demoEnded = true;
            if (demoPlay.textContent !== '↺') demoPlay.textContent = '↺';
            demoStatus.textContent = engine?.exited ? 'The engine stopped.' : 'The recording ended — ↺ plays it again, the scrubber goes anywhere in it.';
            setTimeout(tick, 500);
            return;
        }
        demoEnded = false;
        const length = s.length || demoInfo?.seconds || 0, time = s.time || 0;
        // a seek behind us restarts the recording: the time reads 0 and climbs; the bar
        // holds the destination until the recording is there
        // A backward seek is the engine starting the recording again: for the first frames
        // after the command it still reports the old time, and a tick that trusted it would
        // show the old place, then zero, then the climb — which reads as a reset. The
        // destination is held for a few seconds after any seek, whatever the engine says.
        const sinceSeek = performance.now() - seekIssuedAt;
        const arrived = !s.seeking && (s.section ?? 0) !== 0 && Math.abs(time - seekTarget) < 1.5;
        const inFlight = seekTarget >= 0 && (s.seeking || (s.section ?? 0) === 0 || time < seekTarget - 1 || (sinceSeek < 3000 && !(sinceSeek > 700 && arrived)));
        if (seekTarget >= 0 && !inFlight) seekTarget = -1;
        if (!scrubbing) {
            const shown = inFlight ? seekTarget : time;
            demoTime.textContent = `${clock(shown)} / ${clock(length)}`;
            const at = String(length ? Math.round(shown / length * 1000) : 0);
            if (demoScrub.value !== at) demoScrub.value = at;
        }
        const glyph = s.paused ? '▶' : '❚❚';
        if (demoPlay.textContent !== glyph) demoPlay.textContent = glyph;
        demoStatus.textContent = inFlight ? `seeking to ${clock(seekTarget)}… at ${clock(s.at ?? time)}` : s.section === 0 ? 'the loading section: the server’s greeting, the files it named…' : (s.speed && s.speed !== 1 ? `${s.speed}×` : '');
        setTimeout(tick, 250);
    };
    tick();
}

function demoRestart() { demoCmd('demo_pause 0', 'playdemo demo'); }
demoPlay.addEventListener('click', () => {
    if (demoEnded) { demoRestart(); return; }
    demoCmd(`demo_pause ${demoState().paused ? 0 : 1}`);
});
demoSpeed.addEventListener('change', () => demoCmd(`demo_speed ${demoSpeed.value}`));
// The wallhack, as an exhibit: r_demo_xray is the renderer's, and the renderer draws
// nothing through walls outside a recording whatever the cvar says (engine patch 0009).
// What a wall hides of a player is drawn as a faint orange ghost with an orange outline,
// and what is in plain sight as usual — the "chams" of 2004, which is the OpenGL
// wrapper's depth-test trick made visible, drawn so hidden and seen cannot be confused.
let xray = true;
$('demo-xray').addEventListener('click', () => {
    xray = !xray;
    demoCmd(`r_demo_xray ${xray ? 1 : 0}`);
    $('demo-xray').classList.toggle('on', xray);
    demoStatus.textContent = xray ? 'The wallhack: what a wall hides of a player is outlined in orange over it, as the OpenGL wrappers and "chams" of 2000–2004 did it — and only the players the server sent, which is the potentially visible set. That limit was the anti-wallhack of its day.' : 'Walls are walls again.';
});
// From the press to the release the slider is the hand's: the tick must not rewrite it in
// the pause between pressing the thumb and moving it, which is what a hand does and a
// synthetic drag never did.
for (const start of ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'focus']) demoScrub.addEventListener(start, () => { scrubbing = true; });
// The seek happens when the hand lets go. Chromium says so with a change event; Firefox,
// with the engine's canvas underneath, sends the inputs and the pointerup and no change at
// all (seen 14 September 2026) — so the release is what commits, and change is one more
// way of saying it.
let scrubDragged = false;
function commitScrub() {
    if (!scrubDragged) return;
    scrubDragged = false;
    const length = demoState().length || demoInfo?.seconds || 0;
    const t = Number(demoScrub.value) / 1000 * length;
    scrubbing = false;
    seekTarget = t;
    demoTime.textContent = `${clock(t)} / ${clock(length)}`;
    if (demoEnded) demoRestart();
    seekIssuedAt = performance.now();
    demoCmd(`demo_seek ${t.toFixed(1)}`);
}
for (const end of ['pointerup', 'mouseup', 'touchend', 'pointercancel', 'keyup', 'blur']) demoScrub.addEventListener(end, () => { commitScrub(); setTimeout(() => { scrubbing = false; }, 300); });
demoScrub.addEventListener('input', () => {
    scrubbing = true; scrubDragged = true;
    const length = demoState().length || demoInfo?.seconds || 0;
    demoTime.textContent = `${clock(Number(demoScrub.value) / 1000 * length)} / ${clock(length)}`;
});
demoScrub.addEventListener('change', () => { scrubDragged = true; commitScrub(); });
document.addEventListener('keydown', event => {
    if (!demoName || document.pointerLockElement || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.code === 'Space') { event.preventDefault(); demoPlay.click(); }
    if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
        event.preventDefault();
        const s = demoState();
        if (demoEnded) demoRestart();
        seekTarget = Math.max(0, (s.time ?? 0) + (event.code === 'ArrowRight' ? 10 : -10));
        seekIssuedAt = performance.now();
        demoCmd(`demo_seek ${seekTarget.toFixed(1)}`);
    }
});

/** The players a recording names, each once, with a Steam profile link where the id is a real one. */
function playersHtml(d: DemoInfo): string {
    const seen = new Map<string, { name: string; steamId?: string; at: number }>();
    for (const p of d.players ?? []) if (!seen.has(p.name)) seen.set(p.name, p);
    if (!seen.size) return '<span class="muted">none named</span>';
    return [...seen.values()].map(p => {
        const steam = p.steamId && /^7656119\d{10}$/.test(p.steamId) ? ` <a href="https://steamcommunity.com/profiles/${p.steamId}" target="_blank" rel="noopener" title="Steam profile">↗</a>` : '';
        return `<span class="pill${p.name === d.recorder ? ' pov' : ''}" title="${p.steamId ? escape(p.steamId) + ' · ' : ''}${p.at ? 'joined at ' + clock(p.at) : 'there from the start'}">${escape(p.name)}${steam}</span>`;
    }).join(' ');
}
function renderDemoDetails() {
    const d = demoInfo;
    if (!d) return;
    const byKind: Record<string, DemoResource[]> = {};
    for (const r of d.resources ?? []) (byKind[r.kind] ??= []).push(r);
    const facts: [string, string][] = [
        ['Map', escape(d.map)],
        ['Game', `${escape(d.game)} · protocol ${d.protocol}${d.protocol < 48 ? ' (before October 2008)' : ''}`],
        ['Server', `${escape(d.server || '—')}${d.build ? ' · build ' + d.build : ''}${d.maxPlayers ? ' · ' + d.maxPlayers + ' slots' : ''}${d.cheats ? ' · cheats on' : ''}`],
        ['Recording', d.hltv ? "HLTV — a spectator's view, every player in it" : `${escape(d.recorder || 'a player')}'s own`],
        ['Recorded', `${new Date(d.modified).toLocaleString()} <span class="muted">— the file's own date</span>`],
        ['Players', playersHtml(d)],
        ['Length', `${clock(d.seconds)} · ${Number(d.frames).toLocaleString()} frames · ${(d.netBytes ?? 0) >= 1048576 ? mb(d.netBytes!) : Math.round((d.netBytes ?? 0) / 1024) + ' KB'} of server messages`],
        ['Sections', (d.sections ?? []).map(x => `${escape(x.description)} ${clock(x.seconds)}, ${x.frames} frames`).join(' · ')],
        ['Movement', `gravity ${d.gravity ?? '?'} · max speed ${d.maxSpeed ?? '?'} · sky ${escape(d.sky || '?')}`],
        ['File', `${mb(d.bytes)} · ${new Date(d.modified).toLocaleString()}`],
        ['Frames', Object.entries(d.frameTypes ?? {}).map(([k, v]) => `${k} ${Number(v).toLocaleString()}`).join(' · ')],
    ];
    const resources = Object.keys(byKind).sort().map(k => {
        const list = byKind[k], missing = list.filter(r => r.missing).length;
        return `<details${missing ? ' open' : ''}><summary>${escape(k)}s: ${list.length}${missing ? ` <span class="missing">${missing} missing</span>` : ''}</summary><ul class="list">${list.map(r => `<li class="${r.missing ? 'missing' : ''}">${escape(r.path)}</li>`).join('')}</ul></details>`;
    }).join('');
    $('demo-details-title').textContent = d.name;
    $('demo-details-body').innerHTML = `<div class="facts">${facts.map(([k, v]) => `<div><b>${k}</b>${v}</div>`).join('')}</div>
        <details><summary>What the server precached: ${(d.resources ?? []).length} files${d.missing ? ` — <span class="missing">${d.missing} missing</span>` : ''}</summary>${resources}</details>
        <details><summary>What the recorder typed: ${(d.commands ?? []).length} distinct commands</summary><p class="cmds">${(d.commands ?? []).map(escape).join(' · ') || '—'}</p></details>
        <details><summary>Sounds the recorder's client played: ${(d.clientSounds ?? []).length}</summary><p class="cmds">${(d.clientSounds ?? []).map(escape).join(' · ') || '—'}</p></details>
        <details><summary>The mod's user messages: ${(d.userMessages ?? []).length}</summary><p class="cmds">${(d.userMessages ?? []).map(escape).join(' · ') || '—'}</p></details>
        ${d.recorderInfo ? `<details><summary>The recorder's settings, as the server saw them</summary><p class="cmds">${escape(d.recorderInfo)}</p></details>` : ''}`;
}
$('demo-details-open').addEventListener('click', () => { renderDemoDetails(); demoDetails.showModal(); });
$('demo-details-close').addEventListener('click', () => demoDetails.close());
