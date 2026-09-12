// The sounds, which are half of what anyone remembers. Eight-bit and eleven kilohertz in
// 1999, still the same files; these come from the server's own copy.
import { esc } from '../fmt';
const CANDIDATES: [string, string][] = [
    ['weapons/ak47-1.wav', 'AK-47'], ['weapons/awp1.wav', 'AWP'], ['weapons/knife_slash1.wav', 'knife'],
    ['weapons/c4_plant.wav', 'planting the bomb'], ['weapons/c4_beep1.wav', 'the bomb, beeping'], ['weapons/hegrenade-1.wav', 'grenade'],
    ['weapons/zoom.wav', 'the scope'], ['weapons/clipin1.wav', 'reloading'],
    ['radio/moveout.wav', 'radio: move out'], ['radio/go.wav', 'radio: go go go'],
    ['player/pl_step1.wav', 'a footstep'], ['items/9mmclip1.wav', 'picking up ammo'], ['items/kevlar.wav', 'kevlar'],
];
export async function mount(root: HTMLElement) {
    const fig = document.createElement('div'); fig.className = 'figure';
    fig.innerHTML = '<p class="note">Checking which the server has…</p>';
    root.append(fig);
    const found: [string, string][] = [];
    await Promise.all(CANDIDATES.map(async ([path, label]) => { try { const r = await fetch('/raw/sound/' + path, { method: 'HEAD' }); if (r.ok) found.push([path, label]); } catch { /* not there */ } }));
    if (!found.length) { fig.innerHTML = '<p class="note">None of the stock sounds are among the server\'s own files — they live inside the game\'s base bundle, which the browser unpacks for the game rather than for a page.</p>'; return; }
    found.sort((a, b) => CANDIDATES.findIndex(c => c[0] === a[0]) - CANDIDATES.findIndex(c => c[0] === b[0]));
    fig.innerHTML = '';
    const row = document.createElement('div'); row.className = 'controls';
    for (const [path, label] of found) {
        const b = document.createElement('button'); b.className = 'quiet'; b.textContent = `▶ ${label}`; b.title = path;
        b.addEventListener('click', () => { const a = new Audio('/raw/sound/' + path); a.volume = 0.6; void a.play(); });
        row.append(b);
    }
    fig.append(row);
    fig.insertAdjacentHTML('beforeend', `<p class="caption">${found.length} of the stock sounds, served as files. A map or a mod brings its own, and a recording names every one its server precached — the red lines on <a href="/demos">the demos page</a> are the ones nobody has any more.</p>`);
}
