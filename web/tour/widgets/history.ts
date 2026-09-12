// A timeline from 1996 to now. Dates are the ones we are sure of; "c." marks the rest.
import { svg, el, text } from '../svg';

const events: { when: string; year: number; what: string; ours?: boolean }[] = [
    { when: '1996', year: 1996, what: 'Quake. Its engine, licensed to Valve, becomes GoldSrc.' },
    { when: 'Nov 1998', year: 1998.9, what: 'Half-Life.' },
    { when: 'Jun 1999', year: 1999.5, what: 'Counter-Strike beta 1, a mod by Minh Le and Jess Cliffe.' },
    { when: 'Nov 2000', year: 2000.9, what: 'Counter-Strike 1.0, retail, Valve.' },
    { when: 'Jun 2002', year: 2002.5, what: '1.5 — the last version before Steam; network protocol 46.' },
    { when: 'Sep 2003', year: 2003.7, what: 'Steam, and Counter-Strike 1.6; protocol 47.' },
    { when: 'Oct 2008', year: 2008.8, what: 'The update that moved the protocol to 48, where it stays.' },
    { when: 'c. 2015', year: 2015, what: 'ReHLDS: the server reverse-engineered from its own debug symbols; Xash3D FWGS: the engine reimplemented, open, portable.' },
    { when: 'Jul 2025', year: 2025.5, what: 'yohimik ports Xash3D FWGS to WebAssembly and WebRTC. This project\'s first sprint follows in August.', ours: true },
    { when: 'Aug 2026', year: 2026.6, what: 'yohimik deletes the port. Its parts survive in backups, and in the engine itself.', ours: true },
    { when: 'Sep 2026', year: 2026.7, what: 'Revived: the engine built from source, per-map bundles, invitations, bots, recordings from 1998 to now playing in the browser.', ours: true },
];

export function mount(root: HTMLElement) {
    const W = 960, x0 = 40, x1 = 920, y = 66;
    const s = svg(W, 140);
    s.append(el('line', { x1: x0, y1: y, x2: x1, y2: y, stroke: '#555', 'stroke-width': 2 }));
    const scale = (yr: number) => x0 + (yr - 1996) / (2027 - 1996) * (x1 - x0);
    for (const yr of [1996, 2000, 2004, 2008, 2012, 2016, 2020, 2024]) { const x = scale(yr); s.append(el('line', { x1: x, y1: y - 5, x2: x, y2: y + 5, stroke: '#555' })); text(s, x, y + 22, String(yr), { 'text-anchor': 'middle', fill: '#9a9a9a', 'font-size': 11 }); }
    const say = document.createElement('p'); say.className = 'caption';
    events.forEach((e, i) => {
        const x = scale(e.year);
        const dot = el('circle', { cx: x, cy: y, r: 7, fill: e.ours ? '#f0b429' : '#e8e2cf', stroke: '#0e0e0e', 'stroke-width': 2, tabindex: 0, style: 'cursor:pointer' });
        const show = () => { say.innerHTML = `<b>${e.when}</b> — ${e.what}`; };
        dot.addEventListener('mouseenter', show); dot.addEventListener('focus', show); dot.addEventListener('click', show);
        s.append(dot);
        const rowY = [y - 16, y + 44, y - 32, y + 60][i % 4];
        text(s, x, rowY, e.when, { 'text-anchor': 'middle', fill: e.ours ? '#f0b429' : '#c8c2b0', 'font-size': 11 });
    });
    const fig = document.createElement('div'); fig.className = 'figure'; fig.append(s, say);
    say.innerHTML = 'Hover a dot. <span style="color:#f0b429">Gold</span> is this project.';
    root.append(fig);
    const list = document.createElement('table'); list.className = 't';
    list.innerHTML = '<tbody>' + events.map(e => `<tr><td class="n" style="color:${e.ours ? '#f0b429' : 'inherit'}">${e.when}</td><td>${e.what}</td></tr>`).join('') + '</tbody>';
    const f2 = document.createElement('details'); f2.innerHTML = '<summary class="note">the same, as a list</summary>'; f2.append(list);
    root.append(f2);
}
