// A packet's journey, animated: one datagram from the game, through the channel, the
// relay, the loopback address that is yours, into the server — and the reply back.
import { svg, box, el, text } from '../svg';
export function mount(root: HTMLElement) {
    const s = svg(960, 170);
    box(s, 20, 40, 170, 70, 'engine (wasm)', 'a 60-byte usercmd');
    box(s, 260, 40, 170, 70, 'data channel', 'SCTP over DTLS');
    box(s, 500, 40, 170, 70, 'relay socket', '127.1.4.2:51000');
    box(s, 760, 40, 170, 70, 'ReHLDS', '127.0.0.1:27015');
    const path = [[190, 75], [260, 75], [430, 75], [500, 75], [670, 75], [760, 75]];
    s.append(el('line', { x1: 190, y1: 75, x2: 760, y2: 75, stroke: '#333', 'stroke-width': 2 }));
    const dot = el('circle', { cx: 190, cy: 75, r: 7, fill: '#f0b429' });
    const back = el('circle', { cx: 760, cy: 75, r: 7, fill: '#9cc4ff' });
    s.append(dot, back);
    text(s, 480, 150, 'gold: your command, 42 a second · blue: the server\'s snapshot, 20 to 100 a second — each one a datagram, copied as it is; nothing is parsed on the way', { 'text-anchor': 'middle', fill: '#9a9a9a', 'font-size': 12 });
    const fig = document.createElement('div'); fig.className = 'figure'; fig.append(s); root.append(fig);
    let t0 = performance.now();
    const step = (now: number) => {
        requestAnimationFrame(step);
        const f = ((now - t0) % 2400) / 2400;
        const g = f < 0.5 ? f * 2 : 1, b = f >= 0.5 ? (f - 0.5) * 2 : 0;
        dot.setAttribute('cx', String(190 + g * 570)); dot.setAttribute('opacity', f < 0.5 ? '1' : '0.15');
        back.setAttribute('cx', String(760 - b * 570)); back.setAttribute('opacity', f >= 0.5 ? '1' : '0.15');
        void path;
    };
    requestAnimationFrame(step);
}
