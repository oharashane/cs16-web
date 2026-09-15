// The six patches on the engine, as cards: what each does and the number it moved.
const patches = [
    { id: '0001', title: 'Memory growth', num: '256 MB → up to 2 GB', what: 'The published engine had a fixed heap; a busy map ran it out and the tab died. The heap now grows as the game asks.' },
    { id: '0002', title: 'Fragment buffers', num: '64 KB → the fragment\'s size', what: 'Every incoming file fragment was given a 64 KB buffer whatever its size — the "network pool leak" of 2025. Now each buffer is the fragment.' },
    { id: '0003', title: 'Dropping a transfer', num: 'freed at once', what: 'A failed in-band download left its fragments allocated; the client frees them the moment the transfer fails.' },
    { id: '0004', title: 'Frames when the tab is hidden', num: '1 fps → full rate', what: 'Browsers stop drawing a hidden tab and the server dropped the player. The page drives the engine\'s frames from a Web Worker\'s clock, which is not throttled, whenever its own clock stalls.' },
    { id: '0005', title: 'GoldSrc demos', num: 'protocol 46, 47, 48', what: 'The engine reads the .dem files Half-Life and Counter-Strike have written since 1998, the three differences between the old protocols and 48 included.' },
    { id: '0006', title: 'Demo controls', num: 'pause · ¼× to 4× · seek', what: 'A transport for a recording: hold it, run it at another speed, jump to a second of it, and tell the page where it is.' },
];
export function mount(root: HTMLElement) {
    const grid = document.createElement('div'); grid.className = 'tiles';
    for (const p of patches) {
        const c = document.createElement('div'); c.className = 'tile';
        c.innerHTML = `<h4>${p.id} · ${p.title}</h4><div class="num">${p.num}</div><p>${p.what}</p>`;
        grid.append(c);
    }
    root.append(grid);
    const note = document.createElement('p'); note.className = 'note';
    note.innerHTML = 'Each is a unified diff in <code>engine/patches/</code>, applied to the pinned sources inside the build container; the account of each is in <code>docs/engine/journal.md</code>.';
    root.append(note);
}
