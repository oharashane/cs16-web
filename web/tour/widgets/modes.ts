// The ways people played. Every recognisable kind of Counter-Strike server, what it
// actually did, and — the part nobody writes down — why it was fun. Live modes are read
// from the server's own mode list, so "you can play this" is the truth rather than a
// claim.
import { esc } from '../fmt';

type Kind = {
    name: string; era: string; what: string; fun: string; rules: string;
    mode?: string;                 // our mode's name, if we run it
    needs?: string;                // what it would take, if we do not
    family: 'the game' | 'skill' | 'social' | 'a whole mod';
};
const KINDS: Kind[] = [
    { family: 'the game', name: 'Bomb and hostages', era: '1999', mode: 'classic',
      what: 'Two teams of five. Plant the bomb at A or B and defend it for forty seconds, or rescue the hostages, or simply kill everyone.',
      fun: 'You die and you stay dead, so the round is a story with a beginning and an end. And money carries between rounds, so losing badly is a plan for next time rather than just losing. Nothing else in 1999 made five people talk to each other so much.',
      rules: 'Round-based, no respawn, an economy.' },
    { family: 'the game', name: 'Competitive 5v5', era: '2001', mode: 'match',
      what: 'The same game with league rules: fifteen rounds a side, a knife round for who starts where, $800 to open.',
      fun: 'Everything above, plus consequence. The pistol round decides the next three, so the first ninety seconds of a match are the tensest part of it.',
      rules: '1:45 rounds, 35-second bomb, friendly fire on, no balancing.' },
    { family: 'the game', name: 'Deathmatch', era: '2003', mode: 'team-dm',
      what: 'Respawn where you fell, keep your gun, no rounds.',
      fun: 'The opposite trade: you lose the story but you never wait. Made by CSDM, a plugin, because the game had no such mode and people wanted to practise aiming rather than play a match.',
      rules: 'Respawn, a weapon menu, no economy.' },
    { family: 'skill', name: 'Gun Game', era: '2004', mode: 'gungame',
      what: 'A ladder of weapons. Every kill moves you up it; the last rung is a knife, and you win with it.',
      fun: 'It hands you weapons you would never buy and makes you good at them. And the leader is punished — the better you do, the worse your gun gets — so it stays close to the end.',
      rules: 'Respawn, a fixed ladder, the knife to finish.' },
    { family: 'skill', name: 'Aim maps', era: '2002', mode: 'aim',
      what: 'One room, two rifles, no economy. aim_ak-colt and its thousand variations.',
      fun: 'It removes everything except the thing you wanted to practise. No buying, no walking, no waiting — you are in a fight two seconds after you spawn, and you will be in another one ten seconds later.',
      rules: 'Round-based or respawn, the server hands out the guns.' },
    { family: 'skill', name: 'AWP maps', era: '2002', mode: 'awp',
      what: 'One rifle, one shot, a long sightline.',
      fun: 'The AWP kills with any hit, so an AWP duel is pure timing and nerve. Peek, and you have already decided.',
      rules: 'Everyone has the rifle and a pistol.' },
    { family: 'skill', name: '35hp duels', era: '2004', mode: '35hp',
      what: 'Thirty-five health and a Deagle each on a small map.',
      fun: 'The Deagle does about fifty to the chest, so two shots is the whole conversation. It turns a duel into a coin toss you can practise into a skill, which is exactly the itch a duel server scratches.',
      rules: 'Health lowered on spawn; one pistol; tiny maps.' },
    { family: 'skill', name: 'Scoutzknivez', era: '2003', mode: 'scoutz',
      what: 'Low gravity, high air control, scouts and knives.',
      fun: 'You float, and the scout is accurate only when you are still — so the game becomes about stopping in the air at the right moment. Nothing else in Counter-Strike feels like it.',
      rules: 'sv_gravity down, air control up, two weapons.' },
    { family: 'skill', name: 'Surf', era: '2005', needs: 'surf_ maps — we have none',
      what: 'Ride the sloped faces of a map like a rail. No shooting on many of them; the map is the opponent.',
      fun: 'A bug in Quake\'s movement code, found and then cultivated for twenty years. Holding a slope at speed feels like nothing else in a shooter, and a surf map is a piece of level design whose only purpose is that feeling.',
      rules: 'sv_airaccelerate raised from 10 to somewhere between 100 and 1000.' },
    { family: 'skill', name: 'Bhop and Kreedz', era: '2004', mode: 'climb',
      what: 'Chain jumps to keep and build speed; climb a map built entirely of the jumps you have practised. Kreedz, KZ, climb — the same thing under several names.',
      fun: 'Another movement bug, kept deliberately. There is no opponent and no round; there is a map, a clock, and the knowledge that somebody did it four seconds faster. The recordings on this site come from exactly that world.',
      rules: 'No speed cap on landing, high air control, a knife and a timer.' },
    { family: 'skill', name: 'HE and knife arenas', era: '2003', needs: 'a restriction plugin; we have one he_ map',
      what: 'Grenades only, or knives only.',
      fun: 'Take away the aiming and what is left is positioning and nerve. A knife round in a real match is the same joke told once; a knife server tells it all evening.',
      rules: 'The other weapons forbidden.' },
    { family: 'social', name: 'Hide and Seek', era: '2005', mode: 'hns',
      what: 'One team hides, the other counts and then looks. Knives only, long rounds.',
      fun: 'It is the playground game, in a first-person shooter, with adults. The pleasure is in the absurd hiding place and the slow footsteps getting closer — and in the fact that the game engine was never designed for any of this.',
      rules: 'Hiders stripped, a long freeze time, a long round.' },
    { family: 'social', name: 'Jailbreak', era: '2005', mode: 'jail',
      what: 'Counter-terrorists are guards with guns; terrorists are prisoners with knives. One guard is the warden and gives orders over the microphone. Prisoners obey, or rebel.',
      fun: 'The only Counter-Strike mode that is really a game of improvisation and authority. The warden invents the day\'s activity — a race, Simon Says, a duel — and the tension is entirely about whether the prisoners are about to riot. Nothing enforces any of it, which is the point.',
      rules: 'Prisoners stripped; the rest is a person talking.' },
    { family: 'social', name: 'Deathrun', era: '2007', needs: 'deathrun_ maps and a small plugin',
      what: 'One player operates the traps, everyone else runs the course.',
      fun: 'A gauntlet designed to be unfair, run by somebody watching you. The map maker\'s cruelty and the trap operator\'s timing are the whole game, and dying is funny rather than annoying.',
      rules: 'One trapper, the rest runners, a map full of buttons.' },
    { family: 'social', name: 'Soccer / football', era: '2006', needs: 'a ball plugin and its maps',
      what: 'A ball entity, two goals, and knives.',
      fun: 'Physics that were never meant to model a ball, doing their best. Half the fun is how wrong it looks.',
      rules: 'A pushable entity and two trigger zones.' },
    { family: 'social', name: 'Mario Kart, paintball, and the rest', era: '2006', needs: 'their plugins and maps',
      what: 'Karts on rails. Paint splats instead of bullets. Bank robberies, prop hunts, Simpsons maps, and a thousand other one-server ideas.',
      fun: 'The 2000s answer to the workshop: if you could write Pawn, you could ship your idea to a hundred strangers by the weekend. Most were bad. Some were played for a decade.',
      rules: 'Whatever the author thought of.' },
    { family: 'a whole mod', name: 'Zombie mods', era: '2007', mode: 'infect',
      what: 'One player starts infected. Everyone they kill joins them. Humans have guns; zombies have claws and a lot of health.',
      fun: 'The tide turns. Ten minutes of humans holding a corridor, then one mistake and it is four against sixteen. Zombie Plague added classes, an ammo-pack economy and a shop, and became the single most played modification Counter-Strike ever had.',
      rules: 'Infection on damage, asymmetric health and speed. Ours is the mechanic without the models, classes or shop.' },
    { family: 'a whole mod', name: 'Zombie Escape', era: '2008', needs: 'ze_ maps — the long corridor with a door at the end',
      what: 'A zombie mod played on maps built as escapes: run a long route, hold at chokepoints, reach the door before the horde does.',
      fun: 'It turns the tide into a shared story with an ending. Forty strangers running the same corridor and shouting about which door to hold is cooperative play that Counter-Strike was never designed for and was very good at.',
      rules: 'Infection, plus maps with triggers, timers and a finish.' },
    { family: 'a whole mod', name: 'Warcraft 3', era: '2004', needs: 'the mod itself — thousands of lines',
      what: 'Pick a race. Earn experience for kills. Level up into skills: teleport, invisibility, a chance to bounce bullets, life steal.',
      fun: 'Progression, in a game that had none. You came back to the same server because your orc was level nine, and the servers kept your levels between visits. It is the reason a lot of people played one server for years rather than fifty servers for a night.',
      rules: 'Experience, levels, per-race abilities on top of the normal game.' },
    { family: 'a whole mod', name: 'Superhero', era: '2003', needs: 'the mod itself',
      what: 'The same shape as Warcraft 3, but with comic-book powers you assemble yourself.',
      fun: 'Choosing your own combination and finding the broken one before the admin does.',
      rules: 'Levels and powers.' },
    { family: 'a whole mod', name: 'Furien', era: '2006', needs: 'the mod itself',
      what: 'Asymmetric: one side is fast, invisible and armed with knives; the other is slow and heavily armed.',
      fun: 'Being hunted by something you can only half see, or being the thing that is half seen. Popular across eastern Europe for years and almost unknown elsewhere, which is itself worth recording.',
      rules: 'Per-team speed, gravity, transparency and weapons.' },
    { family: 'a whole mod', name: 'Base Builder', era: '2008', needs: 'the mod itself',
      what: 'Build a fort out of blocks in the first minute, then defend it from the zombies.',
      fun: 'Minecraft, four years early, inside a shooter, under a countdown.',
      rules: 'A block-spawning phase, then a zombie mod.' },
];

const FAMILIES = ['the game', 'skill', 'social', 'a whole mod'] as const;

export async function mount(root: HTMLElement) {
    let live = new Set<string>();
    try {
        const s = await fetch('/api/settings', { cache: 'no-store' }).then(r => r.json()) as { modes: { Name: string }[] };
        live = new Set(s.modes.map(m => m.Name));
    } catch { /* not logged in, or the relay is away: the cards still read */ }

    const ctl = document.createElement('div'); ctl.className = 'controls';
    const here = KINDS.filter(k => k.mode && live.has(k.mode)).length;
    ctl.innerHTML = `<span><span class="readout">${here}</span> of these ${KINDS.length} run on this server today. Show</span>`;
    const pick = document.createElement('select');
    pick.innerHTML = '<option value="all">all of them</option><option value="live">the ones you can play here</option>' + FAMILIES.map(f => `<option value="${f}">${f}</option>`).join('');
    ctl.append(pick); root.append(ctl);
    const grid = document.createElement('div'); grid.className = 'cards'; root.append(grid);
    const draw = () => {
        const want = pick.value;
        const rows = KINDS.filter(k => want === 'all' || (want === 'live' ? k.mode && live.has(k.mode) : k.family === want));
        grid.replaceChildren(...rows.map(k => {
            const c = document.createElement('div'); c.className = 'card';
            const playable = k.mode && live.has(k.mode);
            c.innerHTML = `<h4>${esc(k.name)} <span class="note" style="font-weight:400">${esc(k.era)}</span></h4>
                <div style="margin:4px 0 8px">${playable ? `<span class="pill pov">on this server</span>` : `<span class="pill">${esc(k.needs ?? 'not here yet')}</span>`}</div>
                <p>${esc(k.what)}</p>
                <p style="margin-top:8px"><b style="color:var(--accent)">Why it was fun.</b> ${esc(k.fun)}</p>
                <p class="note" style="margin-top:8px">${esc(k.rules)}</p>`;
            return c;
        }));
    };
    pick.addEventListener('change', draw); draw();
    root.insertAdjacentHTML('beforeend', `<p class="note" style="margin-top:12px">Every mod named here is somebody else's work; the ones we run are our own configuration of the stock game, not their code. What it would take to run the real ones is written up in <code>docs/proposals/variations.md</code>.</p>`);
}
