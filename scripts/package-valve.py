#!/usr/bin/env python3
"""
Build content/valve.zip — the game as the browser downloads it — from the server's content.

The browser unpacks the whole zip into memory, so what goes in is a choice, not "everything":
the Half-Life base the engine needs, the Counter-Strike client files, and the maps named
on the command line (by default, every map the servers' cycles mention) with the wads,
models, sounds and skies each of those maps asks for. Half-Life's own campaign — its maps,
its intro media, its monsters' voices — is left out; nothing in Counter-Strike loads it.

    scripts/package-valve.py                      # the cycles' maps
    scripts/package-valve.py --maps de_dust2 cs_office
    scripts/package-valve.py --maps-file mylist.txt --out content/valve.zip

The base (--base) is the previous valve.zip: it carries the files that come from a Steam
install and nowhere else. Maps and their dependencies come from cs-server/shared, which is
what the servers run, so a map the client has is a map the servers have.

A manifest is written beside the zip saying exactly what went in and what was asked for
but not found; darkoak's cs16 room reads it to say which maps a browser can join.
"""
import argparse, hashlib, io, json, os, re, struct, sys, time, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Half-Life content Counter-Strike never loads. Measured by the LAN project at −45 %.
EXCLUDE_PREFIXES = (
    'valve/maps/', 'valve/media/', 'valve/overviews/', 'valve/dlls/', 'valve/cl_dlls/',
    'valve/addons/', 'cstrike/addons/', 'cstrike/dlls/', 'cstrike/cl_dlls/', 'cstrike/bin/',
    'cstrike/cache/', 'cstrike/manual/', 'cstrike/logs/',
    'cstrike/maps/', 'cstrike/overviews/',   # replaced by the chosen maps' own
)
HL_VOICES = ('scientist', 'barney', 'hgrunt', 'holo', 'gman', 'nihilanth', 'garg', 'gonarch', 'agrunt',
             'bullchicken', 'ichy', 'tentacle', 'aslave', 'zombie', 'houndeye', 'headcrab', 'ambience', 'tride')
EXCLUDE_PREFIXES += tuple(f'valve/sound/{v}/' for v in HL_VOICES)
EXCLUDE_SUFFIXES = ('.so', '.dll', '.exe', '.dylib', '.bak', 'liblist.gam.bak')
EXCLUDE_EXACT = ('cstrike/userconfig.cfg', 'cstrike/server.cfg', 'cstrike/listip.cfg', 'cstrike/banned.cfg',
                 'cstrike/mapcycle.txt', 'cstrike/voice_ban.dt', 'valve/server.cfg')

SKY_SIDES = ('up', 'dn', 'lf', 'rt', 'ft', 'bk')


def worldspawn(bsp: Path) -> dict:
    """The map's worldspawn keys: its wad list and sky name live there."""
    with bsp.open('rb') as f:
        version, = struct.unpack('<i', f.read(4))
        offset, length = struct.unpack('<ii', f.read(8))   # lump 0: entities
        f.seek(offset)
        entities = f.read(length).decode('latin1')
    first = entities.split('}', 1)[0]
    return {k: v for k, v in re.findall(r'"([^"]+)"\s*"([^"]*)"', first)}


def wads_of(bsp: Path) -> list[str]:
    raw = worldspawn(bsp).get('wad', '')
    return [os.path.basename(w.replace('\\', '/')) for w in raw.split(';') if w.strip()]


def res_of(res: Path) -> list[str]:
    if not res.exists():
        return []
    lines = []
    for line in res.read_text('latin1', errors='replace').splitlines():
        line = line.strip().replace('\\', '/')
        if not line or line.startswith('//') or line.lower().endswith(('.bsp', '.wad', '.res')):
            continue
        lines.append(line)
    return lines


def cycle_maps() -> list[str]:
    """Every map any server might load: each mode's rotation, the older servers' cycles,
    and the map each container starts on. A map the client's zip lacks is a map nobody in
    a browser can join, so the default is deliberately everything."""
    names = []
    for cycle in sorted((ROOT / 'cs-server').glob('*/modes/*.maps')):
        names += [l.strip() for l in cycle.read_text().splitlines() if l.strip() and not l.startswith('//')]
    for cycle in sorted((ROOT / 'cs-server').glob('*/mapcycle.txt')):
        names += [l.strip() for l in cycle.read_text().splitlines() if l.strip() and not l.startswith('//')]
    compose = (ROOT / 'cs-server' / 'docker-compose.yml').read_text()
    names += re.findall(r'^\s*MAP:\s*(\S+)', compose, re.M)
    for manifest in sorted((ROOT / 'cs-server').glob('*/modes/modes.json')):
        names += [m.get('first', '') for m in json.loads(manifest.read_text()).get('modes', [])]
    return sorted({n for n in names if n})


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--base', default=str(ROOT / 'content' / 'valve.zip'), help='the previous valve.zip, source of the Steam-only files')
    ap.add_argument('--content', default=str(ROOT / 'cs-server' / 'shared'), help="the servers' content directory")
    ap.add_argument('--out', default=str(ROOT / 'content' / 'valve.zip'))
    ap.add_argument('--maps', nargs='*', help='map names; default: every map the server cycles mention')
    ap.add_argument('--maps-file', help='a file with one map name per line')
    ap.add_argument('--userconfig', default=str(ROOT / 'cs-client-config' / 'userconfig.cfg'))
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

    def base_kept(name: str) -> bool:
        low = name.lower()
        return not (low.startswith(EXCLUDE_PREFIXES) or low.endswith(EXCLUDE_SUFFIXES) or low in EXCLUDE_EXACT)

    # name in the zip → (source kind, source)
    entries: dict[str, tuple[str, object]] = {}
    for name, info in base_names.items():
        if base_kept(name):
            entries[name] = ('base', info)

    def add_file(zip_name: str, path: Path) -> bool:
        if path.is_file():
            entries[zip_name] = ('file', path)
            return True
        return False

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

    manifest_maps = []
    missing_maps, missing_wads = [], {}
    for m in maps:
        bsp = content / 'maps' / f'{m}.bsp'
        if not bsp.is_file():
            missing_maps.append(m)
            continue
        entry = {'name': m, 'bytes': bsp.stat().st_size, 'wads': [], 'files': 0}
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
            entries[f'cstrike/{wad}'] = found
            entry['wads'].append(wad)
        sky = worldspawn(bsp).get('skyname', '')
        if sky:
            for side in SKY_SIDES:
                for ext in ('tga', 'bmp'):
                    add_file(f'cstrike/gfx/env/{sky}{side}.{ext}', content / 'gfx' / 'env' / f'{sky}{side}.{ext}')
        for dep in res_of(content / 'maps' / f'{m}.res'):
            if add_file(f'cstrike/{dep}', content / dep):
                entry['files'] += 1
        manifest_maps.append(entry)

    userconfig = Path(args.userconfig).read_text()
    userconfig = '\n'.join(l for l in userconfig.splitlines() if not l.strip().lower().startswith('rcon_password')) + '\n'

    out = Path(args.out)
    tmp = out.with_suffix('.zip.tmp')
    stamp = (2026, 1, 1, 0, 0, 0)   # one date for every entry: the zip's hash says what is in it, not when
    total = 0
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED, compresslevel=1) as z:
        for name in sorted(entries):
            kind, source = entries[name]
            data = base.read(source) if kind == 'base' else Path(source).read_bytes()
            info = zipfile.ZipInfo(name, date_time=stamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
            total += len(data)
        info = zipfile.ZipInfo('cstrike/userconfig.cfg', date_time=stamp)
        z.writestr(info, userconfig)
    digest = hashlib.sha256(tmp.read_bytes()).hexdigest()
    tmp.replace(out)

    manifest = {
        'built': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
        'zip': out.name, 'sha256': digest, 'bytes': out.stat().st_size, 'uncompressedBytes': total,
        'entries': len(entries) + 1,
        'maps': manifest_maps,
        'missingMaps': missing_maps,
        'missingWads': missing_wads,
    }
    out.with_name('valve.manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')

    print(f'{out}: {out.stat().st_size / 1048576:.0f} MB ({total / 1048576:.0f} MB unpacked), {len(entries) + 1} files, {len(manifest_maps)} maps')
    if missing_maps:
        print(f'not on the server, so not in the zip: {", ".join(missing_maps)}', file=sys.stderr)
    for m, wads in missing_wads.items():
        print(f'{m}: wad(s) not found anywhere: {", ".join(wads)}', file=sys.stderr)
    return 1 if missing_maps else 0


if __name__ == '__main__':
    sys.exit(main())
