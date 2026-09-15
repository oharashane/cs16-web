// What is next. Kept here rather than in a document nobody opens; each item says where
// it is written down in full.
type Item = { what: string; why: string; where?: string; href?: string };
const now: Item[] = [
    { what: 'Going through the drive', why: 'Twenty years of maps, models, skins and recordings are catalogued — 4,936 maps, 4,803 models, every dependency traced — and a person is going through them one by one: what is good, what is broken, what is worth putting on the server.', where: 'the collection' },
    { what: 'Counter-Strike 1.5 recordings', why: 'Protocol 46 reads, but a 1.5 recording played by the 1.6 client also needs the game-level fix-ups: animation numbers shift by sixteen from 83 up, right-handed weapon models lose their suffix, a sound message gains a pitch. Written down, waiting for a file to test.', where: 'docs/proposals/demo-playback.md' },
    { what: 'Artifact pages', why: 'One page per map, model or recording, built from the widgets on this tour: the fly-through, the model inspector, the record, its history and its links.', where: 'the museum plan' },
];
const next: Item[] = [
    { what: 'Models, turning', why: 'The inspector reads a model; a turntable would animate it. web-hlmv already does this and is MIT.', where: 'review §9' },
    { what: 'HLTV', why: 'The proxy is already inside our server image. It would let people watch without taking a slot, delay the broadcast by thirty seconds so nobody can ghost, and record every family game in the format this tour already plays.', where: 'the discussion of 11 September' },
    { what: 'A public front page', why: 'Everything here is behind a family login. A page anyone can open would show a clip and the collection, with the game itself behind a click that states its cost.', where: 'the tour plan' },
    { what: 'Servers on demand', why: 'A server as a record: a name, a mode, a map list, a lifetime. Created from the operations tools, destroyed when nobody is in it.', where: 'review §8' },
    { what: 'Deep dives', why: 'What a wallhack actually was; how the bots find their way; the buy menu as user messages; what a server sends in its first half-second.', where: 'this chapter, eventually' },
];
const later: Item[] = [
    { what: 'Provenance', why: 'Where each map came from, who made it, what its page said in 2004 — from 17buddies, GameBanana and the map\'s own readme.', where: 'review §9' },
    { what: 'Outside play', why: 'Friends beyond the house, without the tunnel doubling every packet\'s journey.', where: 'review §15' },
    { what: 'The lab', why: 'The cheats of 2003 as research, on a server nobody else plays on, with the containment built first.', where: 'review §10' },
];
const shipped = ['the engine built from source, six patches', 'per-map bundles', 'invitations and named admins', 'bots in every mode', 'the map dependency catalogue', 'recordings: protocol 46 to 48, played in the browser', 'the demos page', 'this tour', 'fifteen game modes', 'the drive catalogued', 'the announcer, death beams for the dead, the admin ESP for spectators'];

const list = (items: Item[]) => items.map(i => `<div class="tile"><h4>${i.what}</h4><p>${i.why}</p>${i.where ? `<p class="note" style="margin-top:6px">${i.href ? `<a href="${i.href}">${i.where}</a>` : i.where}</p>` : ''}</div>`).join('');
export function mount(root: HTMLElement) {
    const d = document.createElement('div');
    d.innerHTML = `
      <h4 style="margin:14px 0 6px">Being done now</h4><div class="tiles">${list(now)}</div>
      <h4 style="margin:18px 0 6px">Next</h4><div class="tiles">${list(next)}</div>
      <h4 style="margin:18px 0 6px">Later</h4><div class="tiles">${list(later)}</div>
      <p class="note" style="margin-top:14px"><b>Shipped so far:</b> ${shipped.join(' · ')}. The plans in full are in <code>docs/proposals/</code>, and what happened each day is in <code>docs/engine/journal.md</code>.</p>`;
    root.append(d);
}
