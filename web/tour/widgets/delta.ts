// Delta compression, from a real recording. Before a game starts, the server sends the
// client a description of every structure it will send: each field's name, its type, how
// many bits it takes and what it is divided by. After that, an update carries a bitmask
// and only the fields that changed — which is how a 1998 game fitted a world into a
// modem. The tables below are the ones the server in the recording actually sent.
import { onDemo, lastDemo } from './deminfo';
import { typeName, DT, type DeltaField, type Demo } from '../dem';
import { esc } from '../fmt';

// What a player running across a map actually changes, update to update.
const RUNNING = ['origin[0]', 'origin[1]', 'origin[2]', 'angles[1]', 'frame', 'animtime', 'sequence', 'gaitsequence', 'velocity[0]', 'velocity[1]'];
const bitsOf = (f: DeltaField) => (f.flags & DT.STRING ? 8 * 12 : f.bits) + (f.flags & DT.SIGNED ? 1 : 0);

export function mount(root: HTMLElement) {
    const box = document.createElement('div');
    root.append(box);
    const draw = (d: Demo) => {
        const names = Object.keys(d.deltas).filter(n => d.deltas[n].length > 1).sort();
        if (!names.length) { box.innerHTML = '<p class="note">This recording carried no delta descriptions (its loading section stopped early).</p>'; return; }
        box.replaceChildren();
        const ctl = document.createElement('div'); ctl.className = 'controls';
        ctl.innerHTML = '<span>The structures this server described:</span>';
        const pick = document.createElement('select');
        const prefer = ['entity_state_player_t', 'entity_state_t', 'clientdata_t', 'weapon_data_t', 'usercmd_t', 'event_t'];
        pick.innerHTML = names.sort((a, b) => (prefer.indexOf(a) + 1 || 99) - (prefer.indexOf(b) + 1 || 99) || a.localeCompare(b)).map(n => `<option value="${esc(n)}">${esc(n)} · ${d.deltas[n].length} fields</option>`).join('');
        ctl.append(pick); box.append(ctl);
        const body = document.createElement('div'); box.append(body);
        const render = () => {
            const name = pick.value, fields = d.deltas[name];
            const total = fields.reduce((a, f) => a + bitsOf(f), 0);
            const changing = fields.filter(f => RUNNING.includes(f.name));
            const changed = changing.length ? changing : fields.slice(0, Math.min(6, fields.length));
            const mask = 3 + 8 * Math.ceil(fields.length / 8);
            const sent = mask + changed.reduce((a, f) => a + bitsOf(f), 0);
            body.innerHTML = `
              <div class="figure">
                <div class="cards" style="margin-bottom:10px">
                  <div class="card"><h4>Everything, every time</h4><div class="num">${total} bits · ${(total / 8).toFixed(0)} bytes</div><p>all ${fields.length} fields of <code>${esc(name)}</code>, as this server described them</p></div>
                  <div class="card"><h4>One update of a running player</h4><div class="num">${sent} bits · ${(sent / 8).toFixed(0)} bytes</div><p>a ${mask}-bit mask, then the ${changed.length} fields that changed</p></div>
                  <div class="card"><h4>What that saves</h4><div class="num">${(100 - sent / total * 100).toFixed(0)}%</div><p>and at 20 updates a second, per player, ${((total - sent) / 8 * 20 / 1024).toFixed(1)} KB/s not sent</p></div>
                </div>
                <details><summary class="note">all ${fields.length} fields of <code>${esc(name)}</code>, as this server described them</summary>
                <table class="t"><tr><th>#</th><th>field</th><th>type</th><th class="n">bits</th><th class="n">divisor</th><th>changes while running</th></tr>
                ${fields.map((f, i) => `<tr${changed.includes(f) ? ' style="background:rgba(240,180,41,.10)"' : ''}><td class="n">${i}</td><td><code>${esc(f.name)}</code></td><td class="note">${typeName(f.flags)}${f.flags & DT.SIGNED ? ' signed' : ''}</td><td class="n">${bitsOf(f)}</td><td class="n">${f.divisor !== 1 ? f.divisor : ''}</td><td>${changed.includes(f) ? '<span class="readout">yes</span>' : ''}</td></tr>`).join('')}</table></details>
                <p class="note" style="margin-top:8px">Read from <b>${esc(lastDemo()?.server || 'the recording')}</b>'s own <code>svc_deltadescription</code> messages. A field's divisor is how the float was made an integer: an origin divided by 8 keeps eighth-of-a-unit precision in 26 bits instead of 32. The mask is three bits saying how many mask bytes follow, then one bit per field.</p>
              </div>`;
        };
        pick.addEventListener('change', render); render();
    };
    const have = lastDemo();
    if (have) draw(have); else { box.innerHTML = '<p class="note">Pick a recording above and its delta tables appear here.</p>'; onDemo(draw); }
}
