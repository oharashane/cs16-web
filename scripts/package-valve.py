#!/usr/bin/env python3
"""
Build the game as the browser downloads it — content/base.zip and content/maps/<map>.zip —
from the server's content.

Since 9 September 2026 the game comes in bundles rather than one zip: the base (the
Half-Life files the engine needs, the Counter-Strike client files, and everything two or
more of the chosen maps share) and one bundle per map (its .bsp, overview, sky, and the
wads, models and sounds only it asks for). The browser loads the base and the map the
server is on, plays, and fetches the rest of the rotation behind the game; each bundle is
cached on its own, so a new map is a few megabytes and a new base is rare. Half-Life's own
campaign — its maps, its monsters' voices — is left out; nothing in Counter-Strike loads
it. Its ambience and its music are kept: custom maps ask for both, and a map that asks for
a file nobody has spends the first seconds of every round failing to download it.

    scripts/package-valve.py                      # the cycles' maps
    scripts/package-valve.py --maps de_dust2 cs_office
    scripts/package-valve.py --maps-file mylist.txt

The Steam-only files come from --base, the last one-zip build (content/valve.zip), which
is kept for that reason alone. Maps and their dependencies
come from cs-server/shared, which is what the server runs, so a map the client has is a
map the server has.

content/manifest.json says what went in — each bundle's file, size, sha256 (the browser's
cache key) and file count — and what was asked for but not found; it is also written as
valve.manifest.json, the name darkoak's cs16 room reads to say which maps a browser can join.
"""
import argparse, hashlib, io, json, os, re, struct, sys, time, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from mapdeps import res_path  # noqa: E402

# Half-Life content Counter-Strike never loads. Measured by the LAN project at −45 %.
EXCLUDE_PREFIXES = (
    'valve/maps/', 'valve/overviews/', 'valve/dlls/', 'valve/cl_dlls/',
    'valve/addons/', 'cstrike/addons/', 'cstrike/dlls/', 'cstrike/cl_dlls/', 'cstrike/bin/',
    'cstrike/cache/', 'cstrike/manual/', 'cstrike/logs/',
    'cstrike/maps/', 'cstrike/overviews/',   # replaced by the chosen maps' own
)
# Half-Life's monsters, whose voices Counter-Strike never plays. "ambience" was on this
# list until 8 September 2026 and did not belong: it is ordinary environmental sound that
# maps of both games reference, so leaving it out cost every map that asks for one a
# console error and a failed download from the server (sound/ambience/sprayer.wav and
# friends). Music — valve/media — came off the excluded list for the same reason: custom
# maps play the Half-Life soundtrack, and thirteen megabytes is a cheap way to have it.
HL_VOICES = ('scientist', 'barney', 'hgrunt', 'holo', 'gman', 'nihilanth', 'garg', 'gonarch', 'agrunt',
             'bullchicken', 'ichy', 'tentacle', 'aslave', 'zombie', 'houndeye', 'headcrab', 'tride')
EXCLUDE_PREFIXES += tuple(f'valve/sound/{v}/' for v in HL_VOICES)
EXCLUDE_SUFFIXES = ('.so', '.dll', '.exe', '.dylib', '.bak', 'liblist.gam.bak')
EXCLUDE_EXACT = ('cstrike/userconfig.cfg', 'cstrike/server.cfg', 'cstrike/listip.cfg', 'cstrike/banned.cfg',
                 'cstrike/mapcycle.txt', 'cstrike/voice_ban.dt', 'valve/server.cfg')

SKY_SIDES = ('up', 'dn', 'lf', 'rt', 'ft', 'bk')

# Content the engine opens only when a map names it, measured on 16 September 2026 by
# bench/opened.mjs (a session of two maps and a recording opened 146 of the base's 227 MB):
# the soundtrack, Half-Life's models and its announcer, the ambient sounds and the map
# props. None of it is in the base unless two chosen maps want it; a map that wants it
# alone carries it in its own zip, and a map outside the bundles gets it from the server
# the game's way, since the server precaches what it needs and the client downloads what
# it lacks. Weapons, players, the radio and the HUD stay: the game opens those as it goes,
# not at map load, and a download at the moment of a shot would be too late.
ON_DEMAND_PREFIXES = ('valve/media/', 'valve/models/', 'valve/sound/ambience/', 'valve/sound/vox/', 'valve/sound/fvox/',
                      'cstrike/sound/ambience/', 'cstrike/sound/ambient/', 'cstrike/sound/storm/', 'cstrike/models/props/')
MODEL_DIRS_KEPT = ('player', 'shield')   # under cstrike/models/, the rest are one map's props

def on_demand(name: str) -> bool:
    low = name.lower()
    if low.startswith(ON_DEMAND_PREFIXES):
        return True
    parts = low.split('/')
    return len(parts) >= 4 and parts[0] == 'cstrike' and parts[1] == 'models' and parts[2] not in MODEL_DIRS_KEPT


def worldspawn(bsp: Path) -> dict:
    """The map's worldspawn keys: its wad list and sky name live there."""
    with bsp.open('rb') as f:
        version, = struct.unpack('<i', f.read(4))
        offset, length = struct.unpack('<ii', f.read(8))   # lump 0: entities
        f.seek(offset)
        entities = f.read(length).decode('latin1')
    first = entities.split('}', 1)[0]
    return {k: v for k, v in re.findall(r'"([^"]+)"\s*"([^"]*)"', first)}


def entity_lump(bsp: Path) -> str:
    """The map's whole entity lump, where everything it plays or shows is named."""
    with bsp.open('rb') as f:
        f.read(4)
        offset, length = struct.unpack('<ii', f.read(8))   # lump 0: entities
        f.seek(offset)
        return f.read(length).decode('latin1')


def media_of(bsp: Path) -> list[str]:
    """Sounds and music the map's entities name, relative to sound/ (or to the game dir
    for media/). An ambient_generic's "message" is a path like ambience/sprayer.wav, and
    nothing else in the packaging finds it: it is in no .res file and no wad list. Maps
    that ask for a file nobody ships spend the first seconds of a round failing to
    download it, which is what this exists to stop."""
    found = re.findall(r'"([A-Za-z0-9_\-./\\]+\.(?:wav|mp3))"', entity_lump(bsp))
    return sorted({m.replace('\\', '/').lstrip('/*') for m in found})


def case_insensitive(root: Path, relative: str) -> Path | None:
    """The file a map names, found however it spelled it. Maps were made on Windows and
    say "Ambience/steamjet1.wav" for a file that is on disk as "ambience/steamjet1.wav";
    the engine copes, and so must this."""
    here = root
    for part in relative.split('/'):
        if not part or part == '.':
            continue
        candidate = here / part
        if candidate.exists():
            here = candidate
            continue
        try:
            matches = [c for c in here.iterdir() if c.name.lower() == part.lower()]
        except (NotADirectoryError, FileNotFoundError):
            return None
        if not matches:
            return None
        here = matches[0]
    return here if here.is_file() else None


def wads_of(bsp: Path) -> list[str]:
    raw = worldspawn(bsp).get('wad', '')
    return [os.path.basename(w.replace('\\', '/')) for w in raw.split(';') if w.strip()]


def res_of(res: Path) -> list[str]:
    if not res.exists():
        return []
    lines = []
    for line in res.read_text('latin1', errors='replace').splitlines():
        line = res_path(line)
        if not line or line.startswith('//') or line.lower().endswith(('.bsp', '.wad', '.res')):
            continue
        lines.append(line)
    return lines


def cycle_maps() -> list[str]:
    """Every map main's modes can load: each rotation, and the map each mode starts on. A
    map the client's zip lacks is a map nobody in a browser can join, so the default is
    every map the server people play on might choose. The 2025 servers' own cycles are not
    counted — they are on their way out, and their maps were the whole reason the zip
    carried thirty-seven of them."""
    modes = ROOT / 'cs-server' / 'main' / 'modes'
    names = []
    for cycle in sorted(modes.glob('*.maps.txt')):
        names += [l.strip() for l in cycle.read_text().splitlines() if l.strip() and not l.startswith('//')]
    manifest = modes / 'modes.json'
    if manifest.exists():
        names += [m.get('first', '') for m in json.loads(manifest.read_text()).get('modes', [])]
    return sorted({n for n in names if n})


def write_zip(out: Path, entries: dict, read) -> dict:
    """One bundle: deterministic dates, so the hash says what is in it and not when."""
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix('.zip.tmp')
    stamp = (2026, 1, 1, 0, 0, 0)
    total = 0
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED, compresslevel=1) as z:
        for name in sorted(entries):
            data = read(entries[name])
            info = zipfile.ZipInfo(name, date_time=stamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
            total += len(data)
    digest = hashlib.sha256(tmp.read_bytes()).hexdigest()
    tmp.replace(out)
    return {'file': out.name if out.parent.name == 'content' else f'{out.parent.name}/{out.name}',
            'bytes': out.stat().st_size, 'uncompressedBytes': total, 'sha256': digest, 'files': len(entries)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--base', default=str(ROOT / 'content' / 'valve.zip'), help='the last one-zip build, source of the Steam-only files')
    ap.add_argument('--content', default=str(ROOT / 'cs-server' / 'shared'), help="the server's content directory")
    ap.add_argument('--out', default=str(ROOT / 'content'), help='the directory for base.zip, maps/ and manifest.json')
    ap.add_argument('--maps', nargs='*', help='map names; default: every map the server cycles mention')
    ap.add_argument('--maps-file', help='a file with one map name per line')
    ap.add_argument('--userconfig', default=str(ROOT / 'content' / 'userconfig.cfg'))
    ap.add_argument('--catalogue', default=str(ROOT / 'content' / 'catalogue.json'),
                    help="the scanner's catalogue (mapdeps.py --catalogue): what each map needs beyond its wads and sounds")
    ap.add_argument('--wad-share', type=int, default=3,
                    help='a stock wad stays in the base when at least this many chosen maps name it; fewer, and it goes with each of them')
    ap.add_argument('--extras', default=str(ROOT / 'cs-server' / 'plugins' / 'extras.txt'),
                    help="what the plugins ask the client for (paths under the content directory, or directories), bundled as extras.zip")
    args = ap.parse_args()

    content = Path(args.content)
    maps = list(args.maps or [])
    if args.maps_file:
        maps += [l.strip() for l in Path(args.maps_file).read_text().splitlines() if l.strip()]
    if not maps:
        maps = cycle_maps()
    maps = sorted(set(maps))

    base = zipfile.ZipFile(args.base)
    base_names = {i.filename: i for i in base.infolist() if not i.is_dir()}
    base_lower = {n.lower() for n in base_names}

    def base_kept(name: str) -> bool:
        low = name.lower()
        return not (low.startswith(EXCLUDE_PREFIXES) or low.endswith(EXCLUDE_SUFFIXES) or low in EXCLUDE_EXACT or on_demand(name))

    def in_base(rel: str):
        # a game-relative path (models/x.mdl, sound/y.wav) as a Steam file, either game, any case
        for game in ('cstrike', 'valve'):
            for name in base_names:
                if name.lower() == f'{game}/{rel}'.lower():
                    return name, base_names[name]
        return None

    catalogue: dict[str, list] = {}
    try:
        cat = json.loads(Path(args.catalogue).read_text())
        for entry in (cat['maps'] if isinstance(cat, dict) else cat):
            catalogue[entry['name']] = entry.get('deps', [])
    except (OSError, ValueError, KeyError):
        pass

    def find_wad(wad: str):
        for candidate in (content / 'wads' / wad, content / wad):
            if candidate.is_file():
                return ('file', candidate)
        for name in (f'cstrike/{wad}', f'valve/{wad}'):
            if name in base_names:
                return ('base', base_names[name])
        # Case-insensitive, because map authors and Windows never agreed.
        for candidate in list((content / 'wads').glob('*')) + list(content.glob('*.wad')):
            if candidate.name.lower() == wad.lower():
                return ('file', candidate)
        return None

    # What each map needs: zip name → (source kind, source). A file two maps need goes to
    # the base; a file one map needs goes with that map.
    wants: dict[str, dict[str, tuple[str, object]]] = {}
    skies: set[str] = set()
    manifest_maps = []
    missing_maps, missing_wads = [], {}
    for m in maps:
        bsp = content / 'maps' / f'{m}.bsp'
        if not bsp.is_file():
            missing_maps.append(m)
            continue
        entry = {'name': m, 'wads': []}
        own: dict[str, tuple[str, object]] = {}

        def add_file(zip_name: str, path: Path) -> bool:
            if path.is_file():
                own[zip_name] = ('file', path)
                return True
            return False

        add_file(f'cstrike/maps/{m}.bsp', bsp)
        for extra in ('.txt', '.res', '.cfg'):
            add_file(f'cstrike/maps/{m}{extra}', content / 'maps' / f'{m}{extra}')
        for over in ('.bmp', '.txt', '.tga'):
            add_file(f'cstrike/overviews/{m}{over}', content / 'overviews' / f'{m}{over}')
        for wad in wads_of(bsp):
            found = find_wad(wad)
            if found is None:
                missing_wads.setdefault(m, []).append(wad)
                continue
            own[f'cstrike/{wad}'] = found
            entry['wads'].append(wad)
        sky = worldspawn(bsp).get('skyname', '')
        if sky:
            skies.add(sky.lower())
            for side in SKY_SIDES:
                for ext in ('tga', 'bmp'):
                    name = f'cstrike/gfx/env/{sky}{side}.{ext}'
                    if not add_file(name, content / 'gfx' / 'env' / f'{sky}{side}.{ext}'):
                        for game in ('cstrike', 'valve'):   # a stock sky, from the Steam files
                            stock = f'{game}/gfx/env/{sky}{side}.{ext}'
                            if stock in base_names:
                                own[stock] = ('base', base_names[stock])
        for dep in res_of(content / 'maps' / f'{m}.res'):
            add_file(f'cstrike/{dep}', content / dep)
        # what the scanner found the map's entities naming — models, sounds, sprites — when
        # it is a Steam file the base no longer carries for everyone
        for dep in catalogue.get(m, []):
            rel = str(dep.get('path', '')).replace('\\', '/')
            if not rel or dep.get('kind') == 'wad':
                continue
            source = case_insensitive(content, rel)
            if source is not None:
                add_file(f'cstrike/{source.relative_to(content).as_posix()}', source)
            else:
                stock = in_base(rel)
                if stock is not None and on_demand(stock[0]):
                    own[stock[0]] = ('base', stock[1])
        for sound in media_of(bsp):
            # media/ is a directory of its own; everything else lives under sound/.
            rel = sound if sound.lower().startswith('media/') else f'sound/{sound}'
            source = case_insensitive(content, rel)
            if source is not None:
                # Named as it is on disk, not as the map spelled it.
                add_file(f'cstrike/{source.relative_to(content).as_posix()}', source)
            elif (stock := in_base(rel)) is not None:
                if on_demand(stock[0]):
                    own[stock[0]] = ('base', stock[1])
            else:
                entry.setdefault('missingMedia', []).append(sound)
        wants[m] = own
        manifest_maps.append(entry)

    users: dict[str, int] = {}
    for own in wants.values():
        for name in own:
            users[name] = users.get(name, 0) + 1
    # A file two maps need goes to the base — a big wad, only when args.wad_share do:
    # halflife.wad is 26 MB and 47 of 60 rotation maps name it; cs_havana.wad is 6.5 MB
    # and two do, so it rides with those two. The small wads (fonts, gfx, cached, the
    # decals) are the engine's own furniture and stay whatever names them.
    def wad_size(name: str) -> int:
        if name in base_names:
            return base_names[name].file_size
        for own in wants.values():
            if name in own and own[name][0] == 'file':
                return Path(own[name][1]).stat().st_size
        return 0
    def big_wad(name: str) -> bool:
        return name.lower().endswith('.wad') and wad_size(name) > 262144
    def enough(name: str, n: int) -> bool:
        return n >= (args.wad_share if big_wad(name) else 2)
    shared = {name for name, n in users.items() if enough(name, n)}

    def is_unused_sky(name: str) -> bool:
        low = name.lower()
        if '/gfx/env/' not in low:
            return False
        stem = low.rsplit('/', 1)[1]
        return not any(stem.startswith(sky) for sky in skies)

    # The base: the Steam files worth keeping — minus skies no chosen map names and files a
    # single map owns — plus what two or more maps share.
    base_entries: dict[str, tuple[str, object]] = {}
    for name, info in base_names.items():
        if not base_kept(name) or is_unused_sky(name):
            continue
        n = users.get(name, 0)
        if big_wad(name):
            if not enough(name, n):
                continue   # named by too few of the chosen maps: it rides with them, or with nobody
        elif n == 1:
            continue   # one map's own
        base_entries[name] = ('base', info)
    for own in wants.values():
        for name, source in own.items():
            if name in shared:
                base_entries[name] = source
    userconfig = Path(args.userconfig).read_text()
    userconfig = '\n'.join(l for l in userconfig.splitlines() if not l.strip().lower().startswith('rcon_password')) + '\n'
    base_entries['cstrike/userconfig.cfg'] = ('text', userconfig)

    def read(source) -> bytes:
        kind, what = source
        if kind == 'base':
            return base.read(what)
        if kind == 'text':
            return what.encode()
        return Path(what).read_bytes()

    out = Path(args.out)
    manifest_base = write_zip(out / 'base.zip', base_entries, read)
    for entry in manifest_maps:
        own = {name: source for name, source in wants[entry['name']].items() if name not in shared}
        entry.update(write_zip(out / 'maps' / f"{entry['name']}.zip", own, read))

    # The extras: what the plugins want on the client (the announcer's sounds), in a small
    # bundle of their own so that adding one never re-downloads the base.
    extras_entries: dict[str, tuple[str, object]] = {}
    extras_file = Path(args.extras)
    if extras_file.is_file():
        for line in extras_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            source = content / line
            files = sorted(p for p in source.rglob('*') if p.is_file()) if source.is_dir() else [source]
            for p in files:
                if p.is_file():
                    extras_entries[f'cstrike/{p.relative_to(content).as_posix()}'] = ('file', p)
                else:
                    print(f'extras: {line} is not in {content}', file=sys.stderr)
    manifest_extras = write_zip(out / 'extras.zip', extras_entries, read) if extras_entries else None

    manifest = {
        'built': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
        'base': manifest_base,
        'extras': manifest_extras,
        'maps': manifest_maps,
        'missingMaps': missing_maps,
        'missingWads': missing_wads,
    }
    text = json.dumps(manifest, indent=2) + '\n'
    (out / 'manifest.json').write_text(text)
    (out / 'valve.manifest.json').write_text(text)   # the name darkoak's room reads

    print(f"base.zip: {manifest_base['bytes'] / 1048576:.0f} MB ({manifest_base['uncompressedBytes'] / 1048576:.0f} MB unpacked), {manifest_base['files']} files")
    if manifest_extras:
        print(f"extras.zip: {manifest_extras['bytes'] / 1048576:.1f} MB, {manifest_extras['files']} files")
    for entry in manifest_maps:
        print(f"  maps/{entry['name']}.zip: {entry['bytes'] / 1048576:.1f} MB, {entry['files']} files")
    print(f"{len(manifest_maps)} maps, {(manifest_base['bytes'] + sum(e['bytes'] for e in manifest_maps)) / 1048576:.0f} MB in all")
    if missing_maps:
        print(f'not on the server, so not bundled: {", ".join(missing_maps)}', file=sys.stderr)
    for m, wads in missing_wads.items():
        print(f'{m}: wad(s) not found anywhere: {", ".join(wads)}', file=sys.stderr)
    return 1 if missing_maps else 0


if __name__ == '__main__':
    sys.exit(main())
