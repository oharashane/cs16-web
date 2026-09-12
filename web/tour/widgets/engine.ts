// The engine, in parts: what the browser downloads, measured live from the build's own
// files; the game in bundles; and what this browser has already cached.
import xashURL from 'xash3d-fwgs/xash.wasm?url';
import filesystemURL from 'xash3d-fwgs/filesystem_stdio.wasm?url';
import refURL from 'xash3d-fwgs/libref_webgl2.wasm?url';
import menuURL from 'cs16-client/cl_dll/menu_emscripten_wasm32.wasm?url';
import clientURL from 'cs16-client/cl_dll/client_emscripten_wasm32.wasm?url';
import serverURL from 'cs16-client/dlls/cs_emscripten_wasm32.wasm?url';
import extrasURL from 'cs16-client/extras.pk3?url';
import { ContentCache } from '../../src/cache';

const parts = [
    { name: 'xash.wasm — the engine', url: xashURL, what: 'Xash3D FWGS: rendering, sound, networking, the file system, the demo reader' },
    { name: 'client — the game, client side', url: clientURL, what: 'the Counter-Strike client: HUD, weapons, prediction, the spectator' },
    { name: 'server dll — the game, server side', url: serverURL, what: 'the game code the engine loads for a local game; on our servers ReGameDLL plays this part' },
    { name: 'menu', url: menuURL, what: 'the main menu' },
    { name: 'renderer (WebGL 2)', url: refURL, what: 'the reference renderer, GL ES over WebGL 2' },
    { name: 'filesystem', url: filesystemURL, what: 'the file system module' },
    { name: 'extras.pk3', url: extrasURL, what: 'the engine\'s own extras: fonts, the touch controls, default configs' },
];
const mb = (b: number) => (b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0) + ' MB';

export async function mount(root: HTMLElement) {
    const fig = document.createElement('div'); fig.className = 'figure bars';
    fig.innerHTML = '<div class="note">Measured now, from this build\'s own files (a HEAD request each):</div>';
    root.append(fig);
    const sizes = await Promise.all(parts.map(async p => { try { const r = await fetch(p.url, { method: 'HEAD' }); return Number(r.headers.get('content-length')) || 0; } catch { return 0; } }));
    const max = Math.max(...sizes, 1);
    parts.forEach((p, i) => {
        const row = document.createElement('div'); row.className = 'bar'; row.title = p.what;
        row.innerHTML = `<span>${p.name}</span><div><div class="fill" style="width:${(sizes[i] / max * 100).toFixed(1)}%"></div></div><span class="n">${mb(sizes[i])}</span>`;
        fig.append(row);
    });
    const total = sizes.reduce((a, b) => a + b, 0);
    fig.insertAdjacentHTML('beforeend', `<div class="note" style="margin-top:8px">${mb(total)} for the engine and the game code — then the game's files: the base bundle and one bundle per map.</div>`);

    // the bundles, and this browser's cache
    const fig2 = document.createElement('div'); fig2.className = 'figure';
    root.append(fig2);
    try {
        const manifest = await fetch('/content/manifest.json', { cache: 'no-store' }).then(r => r.json()) as { base: { bytes: number; uncompressedBytes: number; files: number; sha256: string }; maps: { name: string; bytes: number; files: number; sha256: string }[] };
        const cache = await ContentCache.open();
        const baseSha = cache ? await cache.bundleSha('base') : null;
        const files = cache ? await cache.count().catch(() => 0) : 0;
        const cachedMaps = cache ? (await Promise.all(manifest.maps.map(async m => (await cache.bundleSha(m.name)) === m.sha256 ? m.name : null))).filter(Boolean) : [];
        fig2.innerHTML = `<table class="t"><tr><th>bundle</th><th class="n">download</th><th class="n">unpacked</th><th class="n">files</th><th>in this browser</th></tr>
            <tr><td>base — models, sounds, sprites, wads, the HUD</td><td class="n">${mb(manifest.base.bytes)}</td><td class="n">${mb(manifest.base.uncompressedBytes)}</td><td class="n">${manifest.base.files.toLocaleString()}</td><td>${baseSha === manifest.base.sha256 ? 'yes — cached' : baseSha ? 'an older build' : 'not yet'}</td></tr>
            <tr><td>maps — one bundle each, ${manifest.maps.length} in the rotation</td><td class="n">${mb(manifest.maps.reduce((a, m) => a + m.bytes, 0))} in all</td><td class="n"></td><td class="n"></td><td>${cachedMaps.length ? cachedMaps.length + ' cached: ' + cachedMaps.join(', ') : 'none yet'}</td></tr></table>
            <p class="note">${cache ? `This browser's cache holds ${files.toLocaleString()} files. ` : 'This browser has no cache open. '}A map bundle is fetched when its server is joined, the rest of the rotation behind the game; a next visit reads it all back from IndexedDB and downloads nothing.</p>`;
    } catch { fig2.innerHTML = '<p class="note">the manifest did not load</p>'; }
}
