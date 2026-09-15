// The tour: chapters top down — what Counter-Strike is, its history, this project, the
// maps, the models, the engine, the network, the patches, the extras, the credits — each
// with a few sentences, a visual, and where the subject allows it a widget that runs
// here. Every chapter links to the prose review's matching section, the long read.
import './tour.css';

type Stop = { title: string; text: string; widget?: (root: HTMLElement) => void | Promise<void>; caption?: string };
type Chapter = { id: string; title: string; kicker?: string; lead: string; long?: string; stops: Stop[] };
const base = import.meta.env.BASE_URL;

const allChapters: Chapter[] = [
    { id: 'what', title: 'What Counter-Strike is', kicker: '1999', long: '#summary',
      lead: 'Two teams of five. One plants a bomb or holds hostages; the other stops them. A round lasts under two minutes and you do not come back when you die, so every decision in it counts, and the money you earn buys next round\'s rifle. It began as a hobby mod for Half-Life, became the most played online shooter for a decade, and its 2003 version — 1.6 — is still played every day.',
      stops: [
        { title: 'Thirty seconds of it', text: 'A real recording, playing in the real game, captured from this page\'s own player.',
          widget: root => import('./widgets/clip').then(m => m.mount(root, { src: base + 'tour/clip.webm', poster: base + 'tour/clip.jpg', caption: 'An HLTV match on de_dust2, 2022, through the eyes of one player.', link: '/recordings' })) },
        { title: 'The round', text: 'Buy time, then the round: the terrorists plant at A or B and the counter-terrorists defuse, or one side is eliminated. Win money, lose less money; a team that keeps losing can still afford pistols and a plan. Fifteen rounds a side is a match.' },
      ] },
    { id: 'history', title: 'A short history', kicker: '1996 to now', long: '#history',
      lead: 'From Quake\'s engine to a hobby mod to Steam\'s launch title, then fifteen years of the same game, kept alive by people who reverse-engineered its server from its own debug symbols and rewrote its engine from scratch. This project stands on the last two.',
      stops: [ { title: 'The timeline', text: 'Gold is this project. The rest is why it exists.', widget: root => import('./widgets/history').then(m => m.mount(root)) } ] },
    { id: 'project', title: 'This project, and why', kicker: 'a family server, and a museum', long: '#now',
      lead: 'A Counter-Strike 1.6 server that a browser can join — no install, an invitation and a name — for a family and their friends. And, growing out of it, a museum: the maps, the models, the recordings of a game the way it was played, kept with their histories and playable. Everything here is other people\'s work, arranged.',
      stops: [ { title: 'What you are looking at', text: 'Four parts. The browser runs the real engine; a small relay turns its packets into the UDP a game server expects; the server is the real one; a room of tools runs it all from a chat.', widget: root => import('./widgets/system').then(m => m.mount(root)) } ] },
    { id: 'modes', title: 'The ways people played', kicker: 'a server list, 2005', long: '#museum',
      lead: 'By 2005 "Counter-Strike" meant twenty different games. The same engine, the same maps, and a plugin — or just a page of settings — turned it into a duel, a climb, a prison, a chase, or a role-playing game with levels. Most of what people remember is not the bomb: it is the server they played on every night. This is that server list, and what each kind was actually for.',
      stops: [ { title: '', text: '', widget: root => import('./widgets/modes').then(m => m.mount(root)) } ] },
    { id: 'maps', title: 'The maps', kicker: '255 on the server', long: '#museum',
      lead: 'A map is a BSP file and everything it names: texture wads, a sky, models, sprites and sounds for its entities. Most of that came with the game; the rest came with the map, and twenty years on some of it is gone. A map also decides how you are armed: 119 of ours scatter guns on the floor to be picked up, 29 hand them over the moment you spawn, and the rest expect you to buy. The catalogue knows all of it, and what is missing — a missing model stops the server cold, a missing sound is a complaint every round.',
      stops: [ { title: 'Every map, what it gives you, and what it needs', text: 'Two entities arm a player: armoury_entity leaves guns on the floor, game_player_equip puts them in your hands at the spawn. Which one a map uses is most of what makes it an aim map, an fy map, or a map you buy on. Click fly through for the map itself, drawn from its BSP without the engine.', widget: root => import('./widgets/maps').then(m => m.mount(root)) } ] },
    { id: 'models', title: 'The models and skins', kicker: 'studio models, 1998', long: '#museum',
      lead: 'A player, a weapon in hand, a weapon on the ground, a hostage: each is a studio model — a skeleton of bones, sequences of animation on them, meshes skinned to the bones, textures painted from 256-colour palettes. A "skin" is the same file with the textures repainted, which is why a decade of community skins fit the same animations.',
      stops: [ { title: 'Inside a model', text: 'The page reads the file\'s header — the format is Valve\'s from 1998 and has not changed — and draws the textures from their palettes.', widget: root => import('./widgets/mdl').then(m => m.mount(root)) } ] },
    { id: 'engine', title: 'The engine', kicker: 'Xash3D FWGS, in WebAssembly', long: '#upstream',
      lead: 'The game needs GoldSrc, and GoldSrc is Valve\'s and closed. Xash3D FWGS is the open engine that speaks its formats and its protocol; compiled to WebAssembly it runs in a tab, drawing through WebGL. The Counter-Strike client is a second module loaded beside it. It is built here from pinned sources with six patches of ours, in a container, because the published port was withdrawn.',
      stops: [ { title: 'What the browser downloads', text: 'The engine and game code first, then the game\'s files in bundles: one base, one per map, each cached in the browser so a second visit downloads nothing.', widget: root => import('./widgets/engine').then(m => m.mount(root)) } ] },
    { id: 'network', title: 'The network', kicker: 'UDP, from a browser', long: '#perf',
      lead: 'GoldSrc speaks UDP and a browser cannot, so a WebRTC data channel carries each datagram to a relay that hands it on. Inside the packets is the 1998 design: the server sends the world a few dozen times a second, the client sends what you pressed, and the picture you see is drawn a little in the past, between two snapshots, so it never stutters. That last part is where the lag lives, and it is not the network.',
      stops: [
        { title: 'A packet\'s journey', text: 'One datagram out and one back. Nothing on the way parses them.', widget: root => import('./widgets/packet').then(m => m.mount(root)) },
        { title: 'The lag is not the network', text: 'Drag the sliders. The update rate is the lever: at a hundred snapshots a second the client\'s window is short but the queue is deep; at twenty it is the other way round. Measured on our server, twenty updates halved the game\'s ping.', widget: root => import('./widgets/netsim').then(m => m.mount(root)) },
        { title: 'Protocol 46, 47, 48', text: 'Three versions in twenty-five years, and between them a handful of bytes. The recordings on this server are read in all three.', widget: root => import('./widgets/protocols').then(m => m.mount(root)) },
      ] },
    { id: 'patches', title: 'The patches', kicker: 'six, on the engine', long: '#code',
      lead: 'The engine as published nearly worked. Six patches, each a unified diff against the pinned sources, are the difference: memory that grows, buffers that fit, a tab that keeps playing when it is hidden, and the recordings.',
      stops: [ { title: 'What each one moved', text: '', widget: root => import('./widgets/patches').then(m => m.mount(root)) } ] },
    { id: 'extras', title: 'Extras', kicker: 'deep dives', long: '#demos',
      lead: 'The parts that do not fit the story above: what is actually inside the files, what your keyboard becomes on the wire, and how a 1998 game fitted a world down a modem. Everything here runs in your browser, on real files — drop your own in and it never leaves the page.',
      stops: [
        { title: 'Inside a recording', text: 'A recording is what the client wrote as it played: the packets the server sent, the commands typed, the sounds played. Header, directory, frames by kind, the server\'s own greeting, and the path the recorder walked, drawn from the view origin every frame carries.', widget: root => import('./widgets/deminfo').then(m => m.mount(root)) },
        { title: 'Delta compression: a world down a modem', text: 'Before the game starts, the server tells the client the shape of everything it will send — every field, its type, its width in bits. After that an update carries a bitmask and only what changed. These are the real tables from the recording above.', widget: root => import('./widgets/delta').then(m => m.mount(root)) },
        { title: 'Inside a map file', text: 'Fifteen lumps. One of them is plain text listing every spawn, bomb site and door with its position; another is every vertex of the geometry, which drawn from above is the map\'s floor plan.', widget: root => import('./widgets/bsp').then(m => m.mount(root)) },
        { title: 'What your keyboard becomes', text: 'Forty-two times a second the client packs what you are doing into a usercmd and sends it — and runs it locally at once, which is why moving feels instant on a slow connection.', widget: root => import('./widgets/usercmd').then(m => m.mount(root)) },
        { title: 'The sounds', text: '', widget: root => import('./widgets/sounds').then(m => m.mount(root)) },
        { title: 'What is next', text: 'The roadmap, kept where it can be read rather than in a document nobody opens.', widget: root => import('./widgets/roadmap').then(m => m.mount(root)) },
        { title: 'Appendix: what runs it', text: 'The server, the relay and the museum\'s records are looked after by a small self-hosted platform of the family\'s own, which exists for other things too. To it, this whole site is one room: a handful of named tools — start or restart the server, switch the mode, read the log, measure the lag, bring a catalogue in, say what a map is worth — that an assistant can call through a chat, and a few pages a person uses directly, the curator\'s desk among them. The rule that made it fit: every tool is a row of data with a description, not a program, so a new one is a file and a review. The integration is two directions and nothing more: the platform reaches the game over rcon and the server\'s log, and the game\'s pages send it nothing. What it is called, where it lives and how it is locked are its own business and not this tour\'s.' },
      ] },
    { id: 'credits', title: 'Credits and archives', kicker: 'whose work this is', long: '#licence',
      lead: 'The museum\'s rule: nothing here is ours but the arrangement, and every name gets its link.',
      stops: [ { title: '', text: '', widget: root => import('./widgets/credits').then(m => m.mount(root)) } ] },
];

// Two doors into the same chapters: the story (/story) — what the game is, its history,
// this project, the ways people played — and the engine room (/engine) — the files, the
// engine, the network, the patches, the deep dives. The credits close both.
const STORY = new Set(['what', 'history', 'project', 'modes']);
const part = location.pathname.startsWith('/engine') ? 'engine' : 'story';
const chapters = allChapters.filter(c => c.id === 'credits' || STORY.has(c.id) === (part === 'story'));
document.title = part === 'engine' ? 'The engine room' : 'The story';
document.getElementById('brand')!.textContent = part === 'engine' ? 'The engine room' : 'The story';
const navSlot = document.querySelector('[data-nav]') as HTMLElement | null; if (navSlot) navSlot.dataset.nav = '/' + part;
const other = document.getElementById('other-part') as HTMLAnchorElement; other.href = part === 'engine' ? '/story' : '/engine'; other.textContent = part === 'engine' ? 'The story' : 'The engine room';
const main = document.getElementById('chapters')!, toc = document.getElementById('toc-list')!;
chapters.forEach((c, i) => {
    const li = document.createElement('li'); li.innerHTML = `<a href="#${c.id}">${c.title}</a>`; toc.append(li);
    const sec = document.createElement('section'); sec.className = 'chapter'; sec.id = c.id;
    sec.innerHTML = `<h2>${i + 1}. ${c.title}${c.kicker ? `<small>${c.kicker}</small>` : ''}</h2><p class="lead">${c.lead}</p>`;
    for (const s of c.stops) {
        const div = document.createElement('div'); div.className = 'stop';
        if (s.title) div.innerHTML = `<h3>${s.title}</h3>`;
        if (s.text) div.insertAdjacentHTML('beforeend', `<p>${s.text}</p>`);
        sec.append(div);
        if (s.widget) {
            const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { io.disconnect(); void s.widget!(div); } }, { rootMargin: '300px' });
            io.observe(div);
        }
    }
    if (c.long) sec.insertAdjacentHTML('beforeend', `<p class="long"><a href="/review${c.long}">The long read: the review's section</a></p>`);
    main.append(sec);
});
// the table of contents follows the reader
const links = [...toc.querySelectorAll('a')];
new IntersectionObserver(entries => { for (const e of entries) if (e.isIntersecting) links.forEach(a => a.classList.toggle('here', a.getAttribute('href') === '#' + e.target.id)); }, { rootMargin: '-40% 0px -55% 0px' }).observe && chapters.forEach(c => { const el = document.getElementById(c.id); if (el) new IntersectionObserver(entries => { for (const e of entries) if (e.isIntersecting) links.forEach(a => a.classList.toggle('here', a.getAttribute('href') === '#' + c.id)); }, { rootMargin: '-40% 0px -55% 0px' }).observe(el); });
