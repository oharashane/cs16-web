#!/usr/bin/env python3
"""
What a map needs, and whether we have it.

A GoldSrc map names its dependencies in three places: the worldspawn's wad list and sky
name, the entity lump (every model, sprite and sound an entity plays or shows), and an
optional .res file beside the .bsp. This reads all three and says, for each file, where
it is: in the server's content (cs-server/shared), in the Steam base files (the last
one-zip build, content/valve.zip), or missing. A missing model is fatal — ReGameDLL shuts
the server down for one (de_dust2_xmas, 10 September 2026); a missing sound or sprite is
a console error and a failed in-band download every round; a missing wad is often fine,
because most maps embed the textures they use.

    scripts/mapdeps.py de_dust2_xmas             # one map, to the terminal
    scripts/mapdeps.py --catalogue               # every map in cs-server/shared/maps → content/catalogue.json

The catalogue is what /maps shows and what the museum's records start from.
"""
import argparse, json, os, re, struct, sys, time, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / 'cs-server' / 'shared'
BASE_ZIP = ROOT / 'content' / 'valve.zip'
SKY_SIDES = ('up', 'dn', 'lf', 'rt', 'ft', 'bk')
# Wads the engine itself carries or that live in the Steam base; a map naming one of these
# is never missing it.
STOCK_WADS_ALWAYS = {'halflife.wad', 'liquids.wad', 'xeno.wad', 'decals.wad', 'cstrike.wad', 'cached.wad', 'gfx.wad', 'fonts.wad', 'spraypaint.wad', 'tempdecal.wad'}


def lump0(bsp: Path) -> str:
    with bsp.open('rb') as f:
        f.read(4)
        offset, length = struct.unpack('<ii', f.read(8))
        f.seek(offset)
        return f.read(length).decode('latin1', errors='replace')


def textures(bsp: Path) -> tuple[int, int]:
    """(textures, of which embedded). Lump 2 is the miptex directory; a texture whose mip
    offsets are zero is only a name, to be found in one of the wads worldspawn lists.
    When every texture is embedded the wads are dead weight — and most maps embed."""
    with bsp.open('rb') as f:
        f.seek(4 + 2 * 8)
        offset, length = struct.unpack('<ii', f.read(8))
        f.seek(offset)
        lump = f.read(length)
    if len(lump) < 4:
        return 0, 0
    count = struct.unpack_from('<i', lump, 0)[0]
    if count <= 0 or count > 4096:
        return 0, 0
    offsets = struct.unpack_from(f'<{count}i', lump, 4)
    embedded = 0
    for o in offsets:
        if o < 0 or o + 40 > len(lump):
            continue
        if struct.unpack_from('<I', lump, o + 24)[0] != 0:   # the first mip level's offset
            embedded += 1
    return count, embedded


def worldspawn(entities: str) -> dict:
    first = entities.split('}', 1)[0]
    return {k: v for k, v in re.findall(r'"([^"]+)"\s*"([^"]*)"', first)}


class Where:
    """Resolves a game path (cstrike/... relative, e.g. models/x.mdl) to where it is."""

    def __init__(self, content: Path, base_zip: Path):
        self.content = content
        self.lower = {}
        for root, _, files in os.walk(content):
            for name in files:
                rel = Path(root, name).relative_to(content).as_posix()
                self.lower.setdefault(rel.lower(), rel)
        self.base = set()
        if base_zip.exists():
            for name in zipfile.ZipFile(base_zip).namelist():
                self.base.add(name.lower())

    def find(self, rel: str) -> tuple[str, str]:
        """(where, path as it exists): where is 'content', 'base' or 'missing'."""
        key = rel.lower().replace('\\', '/').lstrip('/')
        if key in self.lower:
            return 'content', self.lower[key]
        for game in ('cstrike', 'valve'):
            if f'{game}/{key}' in self.base:
                return 'base', f'{game}/{key}'
        return 'missing', rel


# What a map hands a player. Two mechanisms, and the difference decides how a map plays:
# armoury_entity puts guns on the floor to be picked up (fy_ maps, aim_ maps), while
# game_player_equip gives them at the moment of spawning (scoutzknivez, awp_india). A map
# with neither expects the buy menu. The item numbers are ReGameDLL's ArmouryItemPack.
ARMOURY = ['mp5navy', 'tmp', 'p90', 'mac10', 'ak47', 'sg552', 'm4a1', 'aug', 'scout', 'g3sg1', 'awp',
           'm3', 'xm1014', 'm249', 'flashbang', 'hegrenade', 'kevlar', 'assaultsuit', 'smokegrenade',
           'shield', 'famas', 'sg550', 'galil', 'ump45', 'glock18', 'usp', 'elite', 'fiveseven', 'p228', 'deagle']
GUNS = {'mp5navy', 'tmp', 'p90', 'mac10', 'ak47', 'sg552', 'm4a1', 'aug', 'scout', 'g3sg1', 'awp', 'm3',
        'xm1014', 'm249', 'famas', 'sg550', 'galil', 'ump45', 'glock18', 'usp', 'elite', 'fiveseven', 'p228', 'deagle'}


def arms(entities: str) -> dict:
    """The weapons a map provides: on the floor, and on spawn."""
    floor, spawn = {}, []
    for block in re.findall(r'\{([^}]*)\}', entities):
        kv = dict(re.findall(r'"([^"]*)"\s+"([^"]*)"', block))
        cls = kv.get('classname', '')
        if cls == 'armoury_entity':
            item = (kv.get('item') or '0').strip()
            name = ARMOURY[int(item)] if item.isdigit() and int(item) < len(ARMOURY) else item.replace('weapon_', '')
            try:
                count = max(1, int(kv.get('count', '1') or 1))
            except ValueError:
                count = 1
            floor[name] = floor.get(name, 0) + count
        elif cls == 'game_player_equip':
            spawn += [k.replace('weapon_', '').replace('item_', '') for k in kv if k.startswith(('weapon_', 'item_'))]
        elif cls.startswith('weapon_'):
            name = cls.replace('weapon_', '')
            floor[name] = floor.get(name, 0) + 1
    kinds = sorted(k for k in floor if k in GUNS)
    return {'floor': dict(sorted(floor.items(), key=lambda kv: -kv[1])), 'spawn': sorted(set(spawn)),
            'gunKinds': len(kinds), 'guns': sum(v for k, v in floor.items() if k in GUNS)}


def dependencies(bsp: Path, where: Where) -> dict:
    entities = lump0(bsp)
    ws = worldspawn(entities)
    deps = []

    def add(kind, rel, fatal=False, note=''):
        w, path = where.find(rel)
        deps.append({'kind': kind, 'path': path if w != 'missing' else rel, 'where': w, 'fatal': fatal and w == 'missing', 'note': note})

    total, embedded = textures(bsp)
    all_embedded = total > 0 and embedded == total
    for w in [os.path.basename(x.replace('\\', '/')) for x in ws.get('wad', '').split(';') if x.strip()]:
        if all_embedded:
            # Named, but every texture is in the map: the wad is not needed by anyone.
            deps.append({'kind': 'wad', 'path': w, 'where': 'base', 'fatal': False, 'note': 'not needed: every texture is embedded in the map'})
            continue
        if w.lower() in STOCK_WADS_ALWAYS:
            deps.append({'kind': 'wad', 'path': w, 'where': 'base', 'fatal': False, 'note': 'stock'})
            continue
        found, path = where.find(f'wads/{w}')
        if found == 'missing':
            found, path = where.find(w)
        deps.append({'kind': 'wad', 'path': path if found != 'missing' else w, 'where': found, 'fatal': False,
                     'note': '' if found != 'missing' else 'textures are usually embedded in the map; a wad named but absent is often harmless'})
    sky = ws.get('skyname', '')
    if sky:
        sides = [where.find(f'gfx/env/{sky}{side}.{ext}') for side in SKY_SIDES for ext in ('tga', 'bmp')]
        have = [p for w, p in sides if w != 'missing']
        deps.append({'kind': 'sky', 'path': f'gfx/env/{sky}*', 'where': 'content' if any(w == 'content' for w, _ in sides) else ('base' if have else 'missing'),
                     'fatal': False, 'note': f'{len({os.path.splitext(p)[0][-2:] for p in have})} of 6 faces' if have else 'the sky draws black without it'})
    refs = sorted({m.replace('\\', '/').lstrip('/*') for m in re.findall(r'"([A-Za-z0-9_\-./\\ ]+\.(?:mdl|spr|wav|mp3|tga|bmp))"', entities, re.I)})
    for rel in refs:
        low = rel.lower()
        if low.endswith('.mdl') or low.endswith('.spr'):
            # A missing sprite shuts the server down exactly as a missing model does: both
            # are precache_model, and Mod_LoadModel is fatal. Learned from Surf_0-day.
            add('model' if low.endswith('.mdl') else 'sprite', rel, fatal=True, note='the server shuts down for a missing model or sprite')
        elif low.endswith(('.wav', '.mp3')):
            add('sound', rel if low.startswith('media/') else f'sound/{rel}')
        else:
            add('image', rel)
    res = bsp.with_suffix('.res')
    if res.exists():
        for line in res.read_text('latin1', errors='replace').splitlines():
            line = line.strip().replace('\\', '/')
            if not line or line.startswith('//') or line.lower().endswith(('.bsp', '.res')):
                continue
            if not any(d['path'].lower() == line.lower() for d in deps):
                add('res', line, fatal=line.lower().endswith(('.mdl', '.spr')), note='named in the .res file')
    over = [where.find(f'overviews/{bsp.stem}.{e}') for e in ('bmp', 'txt', 'tga')]
    missing = [d for d in deps if d['where'] == 'missing']
    record = {
        'name': bsp.stem, 'bytes': bsp.stat().st_size, 'author': ws.get('message', ''), 'sky': sky,
        'textures': total, 'embedded': embedded,
        'arms': arms(entities),
        'overview': any(w != 'missing' for w, _ in over),
        'deps': deps, 'missing': len(missing), 'fatal': any(d['fatal'] for d in missing),
    }
    # The same first sort the drive scan gives its maps — family and the scanner's tags —
    # so the two stores read alike on the curator's desk. Imported here, not at the top,
    # because museum-scan imports this file.
    import importlib
    drive, scan = importlib.import_module('museum-drive'), importlib.import_module('museum-scan')
    record['family'] = drive.family(bsp.stem)
    record['tags'] = sorted(set(scan.name_tags(bsp.stem, record['family']) + scan.entity_tags(entities, record) + scan.file_tags(bsp, record)))
    return record


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('maps', nargs='*', help='map names; none with --catalogue means every map on the server')
    ap.add_argument('--catalogue', action='store_true', help='write content/catalogue.json for every map')
    ap.add_argument('--content', default=str(CONTENT))
    ap.add_argument('--base', default=str(BASE_ZIP))
    args = ap.parse_args()
    content = Path(args.content)
    where = Where(content, Path(args.base))
    names = args.maps or sorted(p.stem for p in (content / 'maps').glob('*.bsp'))
    rotation = set()
    try:
        rotation = {m['name'] for m in json.loads((ROOT / 'content' / 'manifest.json').read_text())['maps']}
    except Exception:
        pass
    records = []
    for name in names:
        bsp = content / 'maps' / f'{name}.bsp'
        if not bsp.exists():
            print(f'{name}: no such map on the server', file=sys.stderr)
            continue
        record = dependencies(bsp, where)
        record['inRotation'] = name in rotation
        records.append(record)
    if args.catalogue:
        out = ROOT / 'content' / 'catalogue.json'
        out.write_text(json.dumps({'built': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'maps': records}, indent=1) + '\n')
        fatal = [r['name'] for r in records if r['fatal']]
        print(f'{out}: {len(records)} maps, {sum(1 for r in records if r["missing"])} with something missing, {len(fatal)} would shut the server down')
        return 0
    for r in records:
        print(f"{r['name']}  ({r['bytes'] / 1048576:.1f} MB{', by ' + r['author'] if r['author'] else ''}; sky {r['sky'] or 'none'})")
        for d in r['deps']:
            mark = 'MISSING' if d['where'] == 'missing' else d['where']
            print(f"   {mark:8} {d['kind']:7} {d['path']}{'  — ' + d['note'] if d['note'] and d['where'] == 'missing' else ''}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
