// Protocol 46, 47, 48: the bytes that differ, laid out. From compLexity Demo Player's
// converter, the one program that translated the old recordings for a decade.
type Field = { name: string; size: string; note?: string; in?: number[]; diff?: number[] };
const messages: { title: string; fields: Field[] }[] = [
    { title: 'The demo header', fields: [
        { name: 'magic', size: '8', note: '"HLDEMO"' }, { name: 'demo protocol', size: '4', note: '5' }, { name: 'net protocol', size: '4', note: '46, 47 or 48', diff: [46, 47] },
        { name: 'map', size: '260' }, { name: 'game', size: '260' }, { name: 'map checksum', size: '4' }, { name: 'directory offset', size: '4' } ] },
    { title: 'svc_serverinfo, the server\'s greeting', fields: [
        { name: 'protocol', size: '4', note: 'the version again', diff: [46, 47] }, { name: 'spawn count', size: '4' }, { name: 'map checksum', size: '4' }, { name: 'client dll md5', size: '16' },
        { name: 'max players', size: '1' }, { name: 'your slot', size: '1' }, { name: 'deathmatch', size: '1' }, { name: 'game folder', size: 'string' }, { name: 'host name', size: 'string' },
        { name: 'map file', size: 'string' }, { name: 'map cycle', size: 'string' }, { name: 'VAC flag', size: '1' },
        { name: '21 bytes after a set flag', size: '21', note: 'a secured server of the demo era; the modern client does not expect them', in: [46, 47], diff: [46, 47] } ] },
    { title: 'svc_clientdata, your own state — the weapon list after it', fields: [
        { name: 'delta flag', size: '1 bit' }, { name: 'clientdata_t', size: 'delta' }, { name: 'a weapon follows', size: '1 bit' },
        { name: 'weapon index', size: '5 bits', in: [46], diff: [46], note: 'protocol 46' }, { name: 'weapon index', size: '6 bits', in: [47, 48], note: 'protocol 47 and 48' }, { name: 'weapon_data_t', size: 'delta' } ] },
    { title: 'svc_voiceinit', fields: [
        { name: 'codec', size: 'string' }, { name: 'quality', size: '1', in: [47, 48], diff: [47, 48], note: 'not in 46' } ] },
];
export function mount(root: HTMLElement) {
    const ctl = document.createElement('div'); ctl.className = 'controls';
    ctl.innerHTML = '<span>As read by a client expecting 48, a recording in protocol</span>';
    const pick = document.createElement('select'); pick.innerHTML = '<option value="48">48 (since October 2008)</option><option value="47">47 (Steam, 2003–2008)</option><option value="46">46 (before Steam)</option>';
    ctl.append(pick); root.append(ctl);
    const body = document.createElement('div');
    root.append(body);
    const draw = () => {
        const p = Number(pick.value);
        body.replaceChildren(...messages.map(m => {
            const fig = document.createElement('div'); fig.className = 'figure';
            const h = document.createElement('div'); h.style.marginBottom = '8px'; h.innerHTML = `<b>${m.title}</b>`;
            const row = document.createElement('div'); row.className = 'bytes';
            for (const f of m.fields) {
                if (f.in && !f.in.includes(p)) continue;
                const b = document.createElement('span');
                b.className = 'b' + (f.diff && f.diff.includes(p) ? ' diff' : '');
                b.innerHTML = `${f.name}<small>${f.size}${f.note ? ' · ' + f.note : ''}</small>`;
                row.append(b);
            }
            fig.append(h, row);
            return fig;
        }));
        const cap = document.createElement('p'); cap.className = 'note';
        cap.textContent = p === 48 ? 'Nothing to translate: this is what the client expects.' : p === 47 ? 'Only the version numbers differ. A protocol-47 recording is a 48 recording that says 47 — and the client now takes its word for it.' : 'Three differences on the wire, and the game-level ones for Counter-Strike 1.5 (player animation numbers, right-handed model names, a pitch field) still to do when a 46 file arrives.';
        body.append(cap);
    };
    pick.addEventListener('change', draw); draw();
}
