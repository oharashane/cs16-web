// Every map and what it needs, from the catalogue the dependency scanner writes; click
// one to fly through it in hlviewer.js, from the server's own files, beside its record.
type Dep = { kind: string; path: string; where: string; fatal: boolean; note: string };
type Arms = { floor: Record<string, number>; spawn: string[]; gunKinds: number; guns: number };
type MapRecord = { name: string; bytes: number; author: string; sky: string; overview: boolean; deps: Dep[]; missing: number; fatal: boolean; inRotation: boolean; arms?: Arms };
let viewer: { load: (name: string) => void } | null = null;

export async function mount(root: HTMLElement) {
    const catalogue = await fetch('/content/catalogue.json', { cache: 'no-store' }).then(r => r.json()).catch(() => null) as { built: string; maps: MapRecord[] } | null;
    if (!catalogue) { root.insertAdjacentHTML('beforeend', '<p class="note">the catalogue did not load</p>'); return; }
    const maps = catalogue.maps;
    const ctl = document.createElement('div'); ctl.className = 'controls';
    const arms = (m: MapRecord) => !!m.arms && (Object.keys(m.arms.floor).length > 0 || m.arms.spawn.length > 0);
    ctl.innerHTML = `<span class="readout">${maps.length}</span> maps on the server · ${maps.filter(m => m.inRotation).length} in the rotation · <span class="readout">${maps.filter(arms).length}</span> hand out weapons · ${maps.filter(m => m.missing).length} wanting something · <span class="missing">${maps.filter(m => m.fatal).length}</span> would stop the server`;
    const which = document.createElement('select'); which.innerHTML = '<option value="rotation">the rotation</option><option value="arms">maps that arm you</option><option value="scavenge">maps built for scavenging</option><option value="missing">wanting something</option><option value="fatal">would stop the server</option><option value="all">every map</option>';
    const find = document.createElement('input'); find.placeholder = 'name…'; find.style.font = 'inherit'; find.style.padding = '4px 8px';
    ctl.append(which, find); root.append(ctl);
    const fig = document.createElement('div'); fig.className = 'figure'; fig.style.maxHeight = '360px'; fig.style.overflow = 'auto';
    const table = document.createElement('table'); table.className = 't';
    table.innerHTML = '<thead><tr><th>map</th><th class="n">MB</th><th>author (worldspawn)</th><th>hands out</th><th class="n">needs</th><th class="n">missing</th><th></th></tr></thead><tbody></tbody>';
    fig.append(table); root.append(fig);
    const view = document.createElement('div'); view.className = 'figure'; view.hidden = true;
    const target = document.createElement('div'); target.className = 'viewer'; target.id = 'hlv-target';
    const cap = document.createElement('p'); cap.className = 'caption';
    view.append(target, cap); root.append(view);
    const tbody = table.querySelector('tbody')!;
    const draw = () => {
        const w = which.value, q = find.value.toLowerCase();
        const rows = maps.filter(m => (w === 'all' || (w === 'rotation' && m.inRotation) || (w === 'missing' && m.missing) || (w === 'fatal' && m.fatal)
            || (w === 'arms' && arms(m)) || (w === 'scavenge' && (m.arms?.gunKinds ?? 0) >= 5)) && (!q || m.name.toLowerCase().includes(q))).slice(0, 300);
        tbody.replaceChildren(...rows.map(m => {
            const tr = document.createElement('tr'); if (m.fatal) tr.style.background = 'rgba(214,102,102,.12)';
            // What the map hands a player: armoury_entity leaves guns on the floor,
            // game_player_equip puts them in your hands the moment you spawn.
            const missing = m.deps.filter(d => d.where === 'missing').map(d => d.path);
            tr.innerHTML = `<td><b>${m.name}</b>${m.inRotation ? ' <span class="note">rotation</span>' : ''}</td><td class="n">${(m.bytes / 1048576).toFixed(1)}</td><td>${escape(m.author || '')}</td><td style="font-size:13px">${gives(m)}</td><td class="n">${m.deps.length}</td><td class="n">${m.missing ? `<span class="missing" title="${escape(missing.join('\n'))}">${m.missing}</span>` : '0'}</td><td><button class="quiet" data-fly="${escape(m.name)}">fly through</button></td>`;
            return tr;
        }));
    };
    which.addEventListener('change', draw); find.addEventListener('input', draw); draw();
    tbody.addEventListener('click', async e => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-fly]'); if (!b) return;
        const name = b.dataset.fly!;
        view.hidden = false; view.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        cap.textContent = `Loading ${name} and its wads from the server's files…`;
        try {
            if (!viewer) {
                const mod = await import('hlviewer.js') as unknown as { default?: { init: (t: string, o: unknown) => typeof viewer }; HLViewer?: { init: (t: string, o: unknown) => typeof viewer } };
                await import('../../node_modules/hlviewer.js/dist/hlviewer.js.css');
                const HLViewer = mod.default ?? mod.HLViewer ?? (mod as unknown as { init: (t: string, o: unknown) => typeof viewer });
                viewer = HLViewer.init('#hlv-target', { paths: { base: '/', replays: 'content/demos', maps: 'raw/maps', wads: 'raw/wads', skies: 'raw/gfx/env', sounds: 'raw/sound' } });
            }
            viewer!.load(name + '.bsp');
            const m = maps.find(x => x.name === name)!;
            cap.innerHTML = `<b>${escape(name)}</b>${m.author ? ' by ' + escape(m.author) : ''} · ${(m.bytes / 1048576).toFixed(1)} MB · ${m.deps.filter(d => d.kind === 'wad').length} wads · sky ${escape(m.sky || '?')}. Drag to look, WASD to move. Drawn by <a href="https://github.com/skyrim/hlviewer.js">hlviewer.js</a> from the BSP and its wads, no engine — which is why it is quick, and why there are no models in it.`;
        } catch (err) { cap.textContent = `The viewer could not load it: ${(err as Error).message ?? err}`; }
    });
}
/** What a map gives a player, for the table. */
function gives(m: MapRecord): string {
    const floor = Object.entries(m.arms?.floor ?? {});
    if (m.arms?.spawn.length) return `<span class="pill pov">on spawn</span> ${m.arms.spawn.map(escape).join(', ')}`;
    if (!floor.length) return '<span class="note">nothing — you buy</span>';
    const shown = floor.slice(0, 4).map(([k, v]) => `${escape(k)}${v > 1 ? '×' + v : ''}`).join(', ');
    return `<span class="pill">on the floor</span> ${shown}${floor.length > 4 ? ` <span class="note">+${floor.length - 4} more</span>` : ''}`;
}
const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
