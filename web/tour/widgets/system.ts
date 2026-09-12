// What you are looking at: the system, box by box, and a live round trip to the relay.
import { svg, box, arrow, text } from '../svg';

const parts: Record<string, string> = {
    browser: 'Your browser runs the real GoldSrc-compatible engine, Xash3D FWGS, compiled to WebAssembly, with a reimplementation of the Counter-Strike 1.6 client as a second module. It draws with WebGL and mixes sound with the Web Audio API. Nothing is emulated; the same engine runs the game natively on phones and Linux.',
    channel: 'A browser cannot send UDP, and the game speaks nothing else. WebRTC data channels are the one browser transport that carries small unreliable packets with the timing games need; each datagram goes into the channel as it is, and comes out of the relay as UDP.',
    relay: 'A small Go program. It signals the WebRTC session, then copies datagrams between the data channel and a UDP socket, one socket per browser, each from its own loopback address so the server sees a different player behind each. It also serves these pages, the game bundles, the lobby, the demos, and the invitations.',
    server: 'ReHLDS in Docker: the reverse-engineered Half-Life Dedicated Server with the Counter-Strike game code, Metamod, AMX Mod X, six switchable game modes, bots. It knows nothing of browsers; every player is a UDP address to it.',
    room: 'The darkoak room: a set of tools that start, stop, retune and interrogate all of it — over rcon and the server\'s log — from a chat, and keep the museum\'s records in cs16.db.',
};

export function mount(root: HTMLElement) {
    const s = svg(960, 250);
    const b = {
        browser: box(s, 20, 60, 190, 90, 'Your browser', 'Xash3D FWGS + CS client, wasm', { 'data-part': 'browser' }),
        relay: box(s, 385, 60, 190, 90, 'The relay', 'Go · 27100 http · 27101 udp', { 'data-part': 'relay' }),
        server: box(s, 750, 60, 190, 90, 'ReHLDS', 'Docker · 27015', { 'data-part': 'server' }),
        room: box(s, 567, 175, 190, 60, 'The darkoak room', 'rcon · logs · cs16.db', { 'data-part': 'room' }),
    };
    arrow(s, 210, 105, 385, 105, 'WebRTC data channel', true);
    arrow(s, 575, 105, 750, 105, 'UDP, one loopback address each', true);
    arrow(s, 662, 175, 800, 152, 'rcon');
    text(s, 297, 135, 'datagrams, as they are', { 'text-anchor': 'middle', fill: '#9a9a9a', 'font-size': 11 });
    text(s, 662, 135, '127.1.x.y → 127.0.0.1:27015', { 'text-anchor': 'middle', fill: '#9a9a9a', 'font-size': 11 });
    s.querySelector('line')!.setAttribute('data-part', 'channel');
    const fig = document.createElement('div'); fig.className = 'figure'; fig.append(s);
    const say = document.createElement('p'); say.className = 'caption'; say.textContent = 'Hover or tap a box.';
    fig.append(say);
    for (const g of Object.values(b)) {
        const show = () => { say.textContent = parts[g.getAttribute('data-part')!]; };
        g.addEventListener('mouseenter', show); g.addEventListener('focus', show); g.addEventListener('click', show);
    }
    const line = s.querySelector('line[data-part=channel]')!;
    line.addEventListener('mouseenter', () => { say.textContent = parts.channel; });
    root.append(fig);

    // a live measurement: this browser to the relay and back, five times
    const row = document.createElement('div'); row.className = 'controls';
    const btn = document.createElement('button'); btn.textContent = 'Measure my round trip to the relay';
    const out = document.createElement('span'); out.className = 'readout';
    const note = document.createElement('span'); note.className = 'note'; note.textContent = 'an HTTP request, timed here; the game\'s own packets take the WebRTC path beside it';
    btn.addEventListener('click', async () => {
        btn.disabled = true; out.textContent = '…';
        const times: number[] = [];
        for (let i = 0; i < 5; i++) {
            const t = performance.now();
            try { await fetch('/api/heartbeat', { cache: 'no-store' }); times.push(performance.now() - t); } catch { /* one miss is fine */ }
        }
        times.sort((a, b) => a - b);
        out.textContent = times.length ? `${times[Math.floor(times.length / 2)].toFixed(1)} ms median · ${times[0].toFixed(1)} best` : 'the relay did not answer';
        btn.disabled = false;
    });
    row.append(btn, out, note);
    root.append(row);
}
