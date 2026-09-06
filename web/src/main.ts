import { loadAsync } from 'jszip';
import xashURL from 'xash3d-fwgs/xash.wasm?url';
import gl4esURL from 'xash3d-fwgs/libref_webgl2.wasm?url';
import filesystemURL from 'xash3d-fwgs/filesystem_stdio.wasm?url';
import menuURL from 'cs16-client/cl_dll/menu_emscripten_wasm32.wasm?url';
import clientURL from 'cs16-client/cl_dll/client_emscripten_wasm32.wasm?url';
import serverURL from 'cs16-client/dlls/cs_emscripten_wasm32.wasm?url';
import extrasURL from 'cs16-client/extras.pk3?url';
import { CONNECT_COMMAND, Xash3DWebRTC } from './webrtc';

// The page: pick a name and a server, then the engine takes the screen. The server list
// is the relay's; the engine and the game's files are vendored; valve.zip is the one
// thing downloaded at play time, so it is the one thing with a progress bar.

type ServerEntry = { port: number; name: string; map: string; players: number; max_players: number; status: string; game_mode: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const lobby = $('#lobby'.slice(1)), form = $<HTMLFormElement>('form'), username = $<HTMLInputElement>('username');
const servers = $('servers'), serversEmpty = $('servers-empty'), start = $<HTMLButtonElement>('start');
const loading = $('loading'), loadingText = $('loading-text'), progress = $<HTMLProgressElement>('progress'), notice = $('notice');

const requestedPort = Number(new URLSearchParams(location.search).get('server')) || 0;
let chosenPort = requestedPort;

function say(text: string) { notice.textContent = text; notice.hidden = false; }

async function refreshServers() {
    try {
        const response = await fetch('/api/servers');
        const body = await response.json() as { servers: Record<string, ServerEntry> };
        const list = Object.values(body.servers).sort((a, b) => a.port - b.port);
        renderServers(list);
    } catch {
        serversEmpty.textContent = 'The relay is not answering.';
        serversEmpty.hidden = false;
    }
}

function renderServers(list: ServerEntry[]) {
    for (const el of servers.querySelectorAll('.choice')) el.remove();
    serversEmpty.hidden = list.length > 0;
    if (list.length === 0) serversEmpty.textContent = 'No server is running. Ask for one to be started.';
    if (!list.some(s => s.port === chosenPort && s.status === 'online')) chosenPort = list.find(s => s.status === 'online')?.port ?? 0;
    for (const server of list) {
        const label = document.createElement('label');
        label.className = 'choice' + (server.status === 'online' ? '' : ' offline');
        const radio = Object.assign(document.createElement('input'), { type: 'radio', name: 'server', value: String(server.port) });
        radio.checked = server.port === chosenPort;
        radio.disabled = server.status !== 'online';
        radio.onchange = () => { chosenPort = server.port; };
        const text = document.createElement('span');
        text.innerHTML = `<span class="name">${escape(server.name)}</span><br><span class="detail">${escape(server.map)} · ${server.players}/${server.max_players} playing</span>`;
        label.append(radio, text);
        servers.append(label);
    }
    start.disabled = chosenPort === 0;
}

const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

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

async function play(name: string, port: number, sharp: boolean) {
    lobby.hidden = true;
    loading.hidden = false;
    localStorage.setItem('username', name);

    // Retina: the engine draws one pixel per CSS pixel unless told the screen is denser.
    // "Fast" tells it the screen is ordinary, which is a quarter of the work on a 2x
    // display and the setting every iMac in this house has been using.
    if (!sharp) {
        try { Object.defineProperty(window, 'devicePixelRatio', { get: () => 1, configurable: true }); } catch { /* fine */ }
    }

    const signalUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${port}`;
    const x = new Xash3DWebRTC(signalUrl, (event, detail) => {
        if (event === 'failed') say(`Could not reach the game: ${detail ?? event}. Reload to try again.`);
        if (event === 'closed') say('The connection to the game closed. Reload to rejoin.');
    }, {
        canvas: $<HTMLCanvasElement>('canvas'),
        arguments: ['-windowed', '-game', 'cstrike'],
        libraries: { filesystem: filesystemURL, xash: xashURL, menu: menuURL, server: serverURL, client: clientURL, render: { gl4es: gl4esURL } },
        dynamicLibraries: ['dlls/cs_emscripten_wasm32.wasm', '/rodir/filesystem_stdio.wasm'],
        filesMap: { 'dlls/cs_emscripten_wasm32.wasm': serverURL, '/rodir/filesystem_stdio.wasm': filesystemURL },
    });
    (window as unknown as { __xash: Xash3DWebRTC }).__xash = x;

    const [zip, extras] = await Promise.all([
        fetchWithProgress('/valve.zip').then(loadAsync),
        fetch(extrasURL).then(r => r.arrayBuffer()),
        x.init(),
    ]);
    if (x.exited) return;

    // Unpacking is the slow, invisible half of loading; it gets a phase and a bar of its own.
    loadingText.textContent = 'Unpacking the game…';
    progress.value = 0;
    const files = Object.entries(zip.files).filter(([, file]) => !file.dir);
    const fs = x.em!.FS;
    for (let i = 0; i < files.length; i++) {
        const [filename, file] = files[i];
        const path = '/rodir/' + filename;
        fs.mkdirTree(path.slice(0, path.lastIndexOf('/')));
        fs.writeFile(path, await file.async('uint8array'));
        if (i % 50 === 0) { progress.value = i / files.length; await new Promise(r => setTimeout(r, 0)); }
    }
    fs.writeFile('/rodir/cstrike/extras.pk3', new Uint8Array(extras));
    fs.chdir('/rodir');

    loading.hidden = true;
    x.main();
    x.Cmd_ExecuteString('_vgui_menus 0');
    x.Cmd_ExecuteString(`name "${name.replace(/"/g, '')}"`);
    x.Cmd_ExecuteString(CONNECT_COMMAND);

    window.addEventListener('beforeunload', e => { e.preventDefault(); });
}

username.value = localStorage.getItem('username') ?? '';
form.addEventListener('submit', e => {
    e.preventDefault();
    const sharp = (form.elements.namedItem('dpr') as RadioNodeList).value === '0';
    play(username.value.trim(), chosenPort, sharp).catch(err => { loading.hidden = true; say(`The game could not start: ${err?.message ?? err}`); });
});
refreshServers();
setInterval(refreshServers, 5000);
