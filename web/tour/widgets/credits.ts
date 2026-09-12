// Whose work this is. Every name a link; the museum's rule is that nothing here is ours
// but the arrangement, and that is marked as such.
const credits: { who: string; what: string; url: string }[] = [
    { who: 'Minh "Gooseman" Le and Jess Cliffe', what: 'made Counter-Strike, a Half-Life mod, in 1999', url: 'https://en.wikipedia.org/wiki/Counter-Strike_(video_game)' },
    { who: 'Valve', what: 'Half-Life, the GoldSrc engine, Counter-Strike 1.0 to 1.6, and the SDK that made everything below possible', url: 'https://github.com/ValveSoftware/halflife' },
    { who: 'Xash3D FWGS', what: 'the open engine that runs the game — in the browser here, and natively everywhere else', url: 'https://github.com/FWGS/xash3d-fwgs' },
    { who: 'Velaron and contributors', what: 'cs16-client, the reimplemented Counter-Strike client the engine loads', url: 'https://github.com/Velaron/cs16-client' },
    { who: 'yohimik', what: 'ported the engine to WebAssembly and WebRTC in 2025; this project began on that port', url: 'https://github.com/daShao999/WebXash3D-Fwgs-yohimik' },
    { who: 'ololoken', what: 'the web port\'s living forks, from which the engine and client here are built', url: 'https://github.com/ololoken' },
    { who: 'the ReHLDS team', what: 'ReHLDS, ReGameDLL, Metamod-r, Reunion, ReAPI, ReHLTV: the server and everything around it', url: 'https://github.com/rehlds' },
    { who: 'AlliedModders', what: 'AMX Mod X, the plugin platform the game modes run on', url: 'https://github.com/alliedmodders/amxmodx' },
    { who: 'skyrim', what: 'hlviewer.js, which draws the maps on this page and taught us the demo format', url: 'https://github.com/skyrim/hlviewer.js' },
    { who: 'YaLTeR', what: 'hldemo-rs, whose test files and layouts checked ours', url: 'https://github.com/YaLTeR/hldemo-rs' },
    { who: 'khanghugo', what: 'dem, the Rust parser and writer that read the protocol-47 file end to end', url: 'https://github.com/khanghugo/dem' },
    { who: 'jpcy and compLexity', what: 'compLexity Demo Player, the converter that is the record of what protocols 43 to 47 differ in', url: 'https://github.com/jpcy/coldemoplayer' },
    { who: 'danakt', what: 'web-hlmv, the model viewer the museum\'s model pages will stand on', url: 'https://github.com/danakt/web-hlmv' },
    { who: 'the Internet Archive', what: 'where the test recordings came from: the KZ-Baltic archive, Speed Demos Archive runs, an HLTV match', url: 'https://archive.org/details/kzbaltic' },
    { who: 'Kreedz.com / Xtreme-Jumps', what: 'twenty years of Counter-Strike jump records and their demos', url: 'https://kreedz.com/' },
    { who: '17buddies and GameBanana', what: 'where the maps and their histories live', url: 'https://www.17buddies.rocks/' },
    { who: 'the map makers', what: 'named in each map\'s record where the map names them; the catalogue carries the author from the map itself', url: '/maps' },
];
export function mount(root: HTMLElement) {
    const t = document.createElement('table'); t.className = 't';
    t.innerHTML = credits.map(c => `<tr><td><a href="${c.url}">${c.who}</a></td><td>${c.what}</td></tr>`).join('');
    const fig = document.createElement('div'); fig.className = 'figure'; fig.append(t); root.append(fig);
    root.insertAdjacentHTML('beforeend', `<p class="note">Archives of what was withdrawn: the 2025 web port's sources and npm packages are kept in <code>~/darkoak-backups/</code>, and the engine here is built from a pinned checkout so the build does not depend on any of it staying online. Licences: the engine, its patches and the server are GPL; the client MIT; the maps, models and recordings belong to whoever made them, and are here as fan content. <a href="/review#licence">The long read on licensing.</a></p>`);
}
