// What your keyboard becomes. Forty-two times a second the client packs what you are
// doing into a usercmd — fifty-two bytes of struct — and sends it. The server runs it,
// and so does your own client, immediately, which is why moving feels instant on a
// hundred-millisecond connection. Click the box and use it: the fields are live.
const BUTTONS: [number, string, string][] = [
    [1, 'IN_ATTACK', 'mouse 1'], [2, 'IN_JUMP', 'space'], [4, 'IN_DUCK', 'ctrl'], [8, 'IN_FORWARD', 'W'],
    [16, 'IN_BACK', 'S'], [32, 'IN_USE', 'E'], [512, 'IN_MOVELEFT', 'A'], [1024, 'IN_MOVERIGHT', 'D'],
    [2048, 'IN_ATTACK2', 'mouse 2'], [4096, 'IN_RUN', 'shift'], [8192, 'IN_RELOAD', 'R'], [32768, 'IN_SCORE', 'tab'],
];
const KEYS: Record<string, number> = { KeyW: 8, KeyS: 16, KeyA: 512, KeyD: 1024, Space: 2, ControlLeft: 4, ShiftLeft: 4096, KeyE: 32, KeyR: 8192, Tab: 32768 };
export function mount(root: HTMLElement) {
    const pad = document.createElement('div');
    pad.tabIndex = 0;
    pad.style.cssText = 'border:1px solid #3a352a;border-radius:10px;padding:14px 16px;background:#131313;outline:none;cursor:crosshair;user-select:none';
    pad.innerHTML = '<p class="note" style="margin:0">Click here, then hold <b>W A S D</b>, <b>space</b>, <b>ctrl</b>, <b>shift</b>, <b>R</b>, <b>E</b> or a mouse button, and move the mouse.</p>';
    const body = document.createElement('div'); body.style.marginTop = '10px';
    pad.append(body);
    const fig = document.createElement('div'); fig.className = 'figure'; fig.append(pad); root.append(fig);
    let buttons = 0, yaw = 0, pitch = 0, sent = 0, since = performance.now();
    const draw = () => {
        const fwd = (buttons & 8 ? 1 : 0) - (buttons & 16 ? 1 : 0), side = (buttons & 1024 ? 1 : 0) - (buttons & 512 ? 1 : 0);
        const speed = buttons & 4096 ? 130 : buttons & 4 ? 63 : 250;
        const bits = buttons.toString(2).padStart(16, '0');
        const fields: [string, string, string][] = [
            ['lerp_msec', 'short', '100'],
            ['msec', 'byte', String(Math.min(255, Math.round(1000 / 42)))],
            ['viewangles', '3 × float', `${pitch.toFixed(1)}, ${yaw.toFixed(1)}, 0`],
            ['forwardmove', 'float', (fwd * speed).toFixed(0)],
            ['sidemove', 'float', (side * speed).toFixed(0)],
            ['upmove', 'float', '0'],
            ['lightlevel', 'byte', '128'],
            ['buttons', 'ushort', `${buttons} <span class="note">${bits.slice(0, 8)} ${bits.slice(8)}</span>`],
            ['impulse', 'byte', '0'],
            ['weaponselect', 'byte', '0'],
            ['impact_index', 'int', '0'],
            ['impact_position', '3 × float', '0, 0, 0'],
        ];
        body.innerHTML = `<div class="bytes" style="margin-bottom:10px">${BUTTONS.map(([bit, name, key]) => `<span class="b${buttons & bit ? ' diff' : ''}">${name.replace('IN_', '')}<small>${key}</small></span>`).join('')}</div>
          <table class="t"><tr><th>field</th><th>type</th><th>now</th></tr>${fields.map(([n, t, v]) => `<tr><td><code>${n}</code></td><td class="note">${t}</td><td class="readout">${v}</td></tr>`).join('')}</table>
          <p class="note" style="margin-top:8px">Fifty-two bytes of struct — but not on the wire: the client sends it delta-encoded against the last one, so an unchanged field costs nothing and a typical command is <b>ten to twenty bits</b>. At forty-two a second that is about a kilobyte a second up. ${sent ? `You have made <span class="readout">${sent}</span> of them since clicking in.` : ''}</p>`;
    };
    const set = (code: string, down: boolean) => { const bit = KEYS[code]; if (!bit) return false; buttons = down ? buttons | bit : buttons & ~bit; return true; };
    pad.addEventListener('keydown', e => { if (set(e.code, true)) { e.preventDefault(); draw(); } });
    pad.addEventListener('keyup', e => { if (set(e.code, false)) { e.preventDefault(); draw(); } });
    pad.addEventListener('mousedown', e => { buttons |= e.button === 0 ? 1 : 2048; draw(); });
    pad.addEventListener('mouseup', e => { buttons &= ~(e.button === 0 ? 1 : 2048); draw(); });
    pad.addEventListener('contextmenu', e => e.preventDefault());
    pad.addEventListener('mousemove', e => { yaw = (yaw - e.movementX * 0.2 + 360) % 360; pitch = Math.max(-89, Math.min(89, pitch + e.movementY * 0.2)); });
    pad.addEventListener('blur', () => { buttons = 0; draw(); });
    setInterval(() => { if (document.activeElement === pad) { sent = Math.round((performance.now() - since) / 1000 * 42); draw(); } }, 120);
    pad.addEventListener('focus', () => { since = performance.now(); });
    draw();
}
