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

    // The announcer — the "Quake sounds" every public server had, which are mostly Unreal
    // Tournament's voice. Served from the server's copy, played on the page.
    const shouts: [string, string][] = [['firstblood', 'first blood'], ['headshot', 'headshot'], ['doublekill', 'double kill'], ['multikill', 'multi kill'], ['monsterkill', 'monster kill'], ['ultrakill', 'ultra kill'], ['ludicrouskill', 'ludicrous kill'], ['holyshit', 'holy shit'], ['killingspree', 'killing spree'], ['rampage', 'rampage'], ['dominating', 'dominating'], ['unstoppable', 'unstoppable'], ['godlike', 'godlike'], ['whickedsick', 'wicked sick'], ['hattrick', 'hat trick'], ['payback', 'payback'], ['suicide', 'humiliation'], ['prepare', 'prepare to fight']];
    const have: [string, string][] = [];
    await Promise.all(shouts.map(async ([n, label]) => { try { const r = await fetch(`/raw/sound/QuakeSounds/${n}.wav`, { method: 'HEAD' }); if (r.ok) have.push([n, label]); } catch { /* not there */ } }));
    if (have.length) {
        have.sort((a, b) => shouts.findIndex(c => c[0] === a[0]) - shouts.findIndex(c => c[0] === b[0]));
        const row2 = document.createElement('div'); row2.className = 'controls';
        for (const [n, label] of have) {
            const b = document.createElement('button'); b.className = 'quiet'; b.textContent = `▶ ${label}`; b.title = `sound/QuakeSounds/${n}.wav`;
            b.addEventListener('click', () => { const a = new Audio(`/raw/sound/QuakeSounds/${n}.wav`); a.volume = 0.6; void a.play(); });
            row2.append(b);
        }
        fig.append(row2);
        fig.insertAdjacentHTML('beforeend', `<p class="caption">The announcer. Every public server of 2004 had the "Quake sounds", and nearly all of them were Unreal Tournament's announcer (Epic, 1999), not Quake's; the name stuck. The server shouts them now — first blood, the multi-kill ladder within a round, the spree ladder across rounds, hat trick, payback — through a plugin of the museum's own, and the match mode turns it off.</p>`);
    }
}
