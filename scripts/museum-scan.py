#!/usr/bin/env python3
"""
Scan a drive's organized view into a catalogue the collection can import — maps, models
and recordings — with each map's dependencies resolved against the drive's own pool, then
the server's content, then the Steam base, and a first set of tags read off the files.

    scripts/museum-scan.py ~/Desktop/cs-museum-2026            # → content/drive-catalogue.json
    scripts/museum-scan.py ~/Desktop/cs-museum-2026 --out x.json

Nothing is copied and nothing on the server changes: this is the survey the museum's
records are built from. `scripts/museum-drive.py` must have run first (it builds
organized/ and hashes the maps). Reuses mapdeps.py's readers.

The tags are the automatic layer — what a file says about itself and what its name says —
and every one is marked auto, so a person's tags are never confused with them. The
vocabulary borrows from Shane's 2017 notes where it fits: game types, themes, textures,
the reskin/shrunk/remake distinction.
"""
import argparse, collections, json, os, re, struct, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from mapdeps import lump0, worldspawn, arms, textures, STOCK_WADS_ALWAYS, SKY_SIDES  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

class Where:
    """A game path → ('drive'|'content'|'base'|'missing', path). The drive's pool first."""
    def __init__(self, drive_pool: Path, content: Path, base_zip: Path):
        import zipfile
        self.lower = {}
        for label, root in (('drive', drive_pool), ('content', content)):
            for r, _, files in os.walk(root):
                for name in files:
                    rel = Path(r, name).relative_to(root).as_posix()
                    self.lower.setdefault(rel.lower(), (label, rel))
        self.base = set()
        if base_zip.exists():
            self.base = {n.lower() for n in zipfile.ZipFile(base_zip).namelist()}
    def find(self, rel: str):
        key = rel.lower().replace('\\', '/').lstrip('/')
        if key in self.lower:
            return self.lower[key]
        for game in ('cstrike', 'valve'):
            if f'{game}/{key}' in self.base:
                return 'base', f'{game}/{key}'
        return 'missing', rel

THEMES = [
    ('xmas', r'xmas|christmas|santa|newyear|winter'), ('snow', r'snow|ice|frost|arctic|winter'), ('dark', r'night|dark|_n$|_nite'),
    ('dust', r'dust'), ('aztec', r'aztec'), ('assault', r'assault'), ('italy', r'italy'), ('office', r'office'), ('inferno', r'inferno'),
    ('nuke', r'nuke'), ('rats', r'rats|kitchen|giant'), ('pool', r'pool'), ('iceworld', r'iceworld'), ('mcdonalds', r'mcdonald'),
    ('pop-reference', r'simpsons|mario|matrix|starwars|star_wars|tmnt|turtles|batman|spongebob|zelda|halo|pokemon|lego|minecraft|goldeneye|doom|wolfenstein|jamesbond|007|potter|pacman|sonic'),
    ('sports', r'soccer|football|basket|tennis|stadium|golf|hockey'), ('vehicle', r'car|kart|vehicle|race|plane|747'),
    ('underwater', r'aqua|underwater|sub_'), ('western', r'western|west_|cowboy|saloon'), ('space', r'space|moon|mars|alien'),
    ('halloween', r'halloween|scary|horror|haunted'), ('military', r'militia|military|base_|bunker|army'),
]
def name_tags(stem: str, family: str) -> list[str]:
    n = stem.lower()
    tags = {f'family:{family}'}
    for tag, rx in THEMES:
        if re.search(rx, n): tags.add(f'theme:{tag}')
    if re.search(r'2x2|3x3|_mini|mini_|_small|_tiny|only', n): tags.add('style:shrunk')
    if re.search(r'remake|reboot|_v2|_v3|_2k\d|_20\d\d|_new|_final', n): tags.add('style:remake')
    if re.search(r'_pro\b|pro_|_esl|_cpl|_ec|cpl_|esl_', n): tags.add('style:competitive')
    if re.search(r'_beta|_b\d|_alpha|_wip|_test|_rc\d', n): tags.add('style:unfinished')
    if re.search(r'_h$|_hard|_ez$|_easy|_x$|_xtreme|_extreme', n): tags.add('style:difficulty-variant')
    return sorted(tags)

def entity_tags(entities: str, m: dict) -> list[str]:
    tags = set()
    classes = collections.Counter(re.findall(r'"classname"\s*"([^"]+)"', entities))
    if any(k in classes for k in ('func_bomb_target', 'info_bomb_target')): tags.add('gametype:defuse')
    if 'hostage_entity' in classes: tags.add('gametype:hostage')
    if any(k in classes for k in ('func_escapezone', 'info_escapezone')): tags.add('gametype:escape')
    if 'info_vip_start' in classes or 'func_vip_safetyzone' in classes: tags.add('gametype:assassination')
    ct, t = classes.get('info_player_start', 0), classes.get('info_player_deathmatch', 0)
    if ct + t: tags.add(f'players:{min(ct, t) * 2 if min(ct, t) else ct + t}')
    if ct + t >= 32: tags.add('size:big-server')
    a = m['arms']
    if a['floor']: tags.add('weapons:pickup')
    if a['spawn']: tags.add('weapons:on-spawn')
    if not a['floor'] and not a['spawn']: tags.add('weapons:buy')
    if 'func_buyzone' in classes: tags.add('has:buyzone')
    if any(k.startswith('func_vehicle') for k in classes): tags.add('has:vehicle')
    if any(k in classes for k in ('func_water', 'func_ladder')): pass
    if 'trigger_teleport' in classes: tags.add('has:teleport')
    if classes.get('light', 0) + classes.get('light_spot', 0) == 0 and 'light_environment' not in classes: tags.add('lighting:fullbright')
    if 'light_environment' in classes: tags.add('lighting:outdoor')
    sky = (m.get('sky') or '').lower()
    if re.search(r'night|dark|2night|moon|nite', sky): tags.add('theme:dark')
    if re.search(r'snow|ice|winter', sky): tags.add('theme:snow')
    return sorted(tags)

def file_tags(bsp: Path, m: dict) -> list[str]:
    tags = set()
    if bsp.with_suffix('.nav').exists(): tags.add('has:nav')
    if bsp.with_suffix('.res').exists(): tags.add('has:res')
    if bsp.with_suffix('.txt').exists(): tags.add('has:info')
    if m['overview']: tags.add('has:overview')
    kb = m['bytes'] / 1024
    tags.add('size:' + ('tiny' if kb < 500 else 'small' if kb < 2048 else 'medium' if kb < 8192 else 'large'))
    if m['author']: tags.add('credited-in-file')
    if m['missing'] == 0: tags.add('complete')
    if m['fatal']: tags.add('fatal')
    return sorted(tags)

def scan_map(bsp: Path, where: Where, family: str, sha: str, same_as) -> dict:
    entities = lump0(bsp)
    ws = worldspawn(entities)
    deps = []
    def add(kind, rel, fatal=False, note=''):
        w, path = where.find(rel)
        deps.append({'kind': kind, 'path': path if w != 'missing' else rel, 'where': w, 'fatal': fatal and w == 'missing', 'note': note})
    total, embedded = textures(bsp)
    all_embedded = total > 0 and embedded == total
    for w in [os.path.basename(x.replace('\\', '/')) for x in ws.get('wad', '').split(';') if x.strip()]:
        if all_embedded:   # named, but every texture is in the map: nobody needs the wad
            deps.append({'kind': 'wad', 'path': w, 'where': 'base', 'fatal': False, 'note': 'not needed: every texture is embedded in the map'}); continue
        if w.lower() in STOCK_WADS_ALWAYS:
            deps.append({'kind': 'wad', 'path': w, 'where': 'base', 'fatal': False, 'note': 'stock'}); continue
        found, path = where.find(f'wad/{w}')
        if found == 'missing': found, path = where.find(f'wads/{w}')
        if found == 'missing': found, path = where.find(w)
        deps.append({'kind': 'wad', 'path': path if found != 'missing' else w, 'where': found, 'fatal': False, 'note': '' if found != 'missing' else 'textures are usually embedded'})
    sky = ws.get('skyname', '')
    if sky:
        sides = [where.find(f'gfx/env/{sky}{side}.{ext}') for side in SKY_SIDES for ext in ('tga', 'bmp')]
        have = [p for w, p in sides if w != 'missing']
        loc = 'drive' if any(w == 'drive' for w, _ in sides) else 'content' if any(w == 'content' for w, _ in sides) else 'base' if have else 'missing'
        deps.append({'kind': 'sky', 'path': f'gfx/env/{sky}*', 'where': loc, 'fatal': False, 'note': f'{len({os.path.splitext(p)[0][-2:] for p in have})} of 6 faces' if have else ''})
    refs = sorted({x.replace('\\', '/').lstrip('/*') for x in re.findall(r'"([A-Za-z0-9_\-./\\ ]+\.(?:mdl|spr|wav|mp3|tga|bmp))"', entities, re.I)})
    for rel in refs:
        low = rel.lower()
        if low.endswith(('.mdl', '.spr')): add('model' if low.endswith('.mdl') else 'sprite', rel, fatal=True)   # both precache_model: fatal when missing
        elif low.endswith(('.wav', '.mp3')): add('sound', rel if low.startswith('media/') else f'sound/{rel}')
        else: add('image', rel)
    res = bsp.with_suffix('.res')
    if res.exists():
        for line in res.read_text('latin1', errors='replace').splitlines():
            line = line.strip().replace('\\', '/')
            if not line or line.startswith('//') or line.lower().endswith(('.bsp', '.res')): continue
            if not any(d['path'].lower() == line.lower() for d in deps): add('res', line, fatal=line.lower().endswith(('.mdl', '.spr')), note='named in the .res file')
    over = [where.find(f'overviews/{bsp.stem}.{e}') for e in ('bmp', 'txt', 'tga')]
    missing = [d for d in deps if d['where'] == 'missing']
    m = {
        'kind': 'map', 'name': bsp.stem, 'path': bsp.as_posix(), 'bytes': bsp.stat().st_size, 'sha256': sha, 'family': family, 'sameAs': same_as,
        'textures': total, 'embedded': embedded,
        'author': ws.get('message', ''), 'sky': sky, 'overview': any(w != 'missing' for w, _ in over),
        'arms': arms(entities), 'deps': deps, 'missing': len(missing), 'fatal': any(d['fatal'] for d in missing),
    }
    m['tags'] = sorted(set(name_tags(bsp.stem, family) + entity_tags(entities, m) + file_tags(bsp, m)))
    return m

def scan_models(pool: Path) -> list[dict]:
    out = []
    for r, _, files in os.walk(pool / 'models'):
        for f in files:
            if not f.lower().endswith('.mdl'): continue
            p = Path(r, f); rel = p.relative_to(pool).as_posix(); low = rel.lower(); stem = f[:-4]
            parts = low.split('/')
            if len(parts) >= 3 and parts[1] == 'player': family, tags = 'player', ['family:player', 'kind:skin']
            elif stem.lower().startswith(('v_', 'p_', 'w_')): family, tags = 'weapon', ['family:weapon', f'view:{stem[0].lower()}']
            elif stem.lower().endswith('t') and (p.parent / (stem[:-1] + '.mdl')).exists(): family, tags = 'textures', ['family:textures', 'part-of:' + stem[:-1]]
            else: family, tags = 'prop', ['family:prop']
            n = stem.lower()
            for tag, rx in THEMES:
                if re.search(rx, n): tags.append(f'theme:{tag}')
            if family == 'player' and re.search(r'batman|ironman|spiderman|deadpool|wolverine|vader|joker|neo|morpheus|trinity|obama|50cent|lara|snake|subzero|scorpion|leo|raphael|hitman|bond|flash|scream', n): tags.append('theme:pop-reference')
            # The name is the game path under models/ without .mdl: 660 bare stems collide
            # across skin folders (five v_m249.mdl), and a dependency joins it as
            # 'models/' + name + '.mdl'.
            out.append({'kind': 'model', 'name': rel[len('models/'):-4], 'path': rel, 'bytes': p.stat().st_size, 'family': family, 'tags': sorted(set(tags))})
    return out

def scan_demos(paths: list[Path]) -> list[dict]:
    out = []
    for p in paths:
        b = p.read_bytes()
        if b[:6] != b'HLDEMO' or len(b) < 548: out.append({'kind': 'demo', 'name': p.stem, 'path': p.as_posix(), 'bytes': len(b), 'family': 'not-goldsrc', 'tags': ['not-goldsrc'], 'problem': 'not a GoldSrc demo'}); continue
        proto = struct.unpack('<i', b[12:16])[0]; mp = b[16:276].split(b'\0')[0].decode(errors='replace'); game = b[276:536].split(b'\0')[0].decode(errors='replace')
        d = struct.unpack('<i', b[540:544])[0]; n = struct.unpack('<i', b[d:d+4])[0] if 0 < d < len(b) - 4 else 0
        seconds = frames = 0
        for i in range(min(n, 64)):
            e = b[d+4+i*92:d+4+(i+1)*92]
            if len(e) < 92: break
            if struct.unpack('<i', e[:4])[0] != 0: seconds += struct.unpack('<f', e[76:80])[0]; frames += struct.unpack('<i', e[80:84])[0]
        year = time.strftime('%Y', time.localtime(p.stat().st_mtime))
        out.append({'kind': 'demo', 'name': p.stem, 'path': p.as_posix(), 'bytes': len(b), 'family': f'protocol-{proto}', 'map': mp, 'game': game, 'protocol': proto, 'seconds': round(seconds, 1), 'frames': frames,
                    'tags': sorted({f'protocol:{proto}', f'map:{mp}', f'game:{game}', f'year:{year}', 'length:' + ('short' if seconds < 120 else 'medium' if seconds < 900 else 'long')})})
    return out

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('drive'); ap.add_argument('--out', default=str(ROOT / 'content' / 'drive-catalogue.json'))
    ap.add_argument('--demos', nargs='*', default=[], help='extra directories of recordings beyond organized/recordings/*/')
    a = ap.parse_args()
    drive = Path(a.drive).resolve(); org = drive / 'organized'
    if not (org / 'manifest.json').exists(): sys.exit('run scripts/museum-drive.py first')
    manifest = json.load(open(org / 'manifest.json'))
    hashes = {Path(i['path']).name: i for i in manifest['items'] if i['kind'] == 'map' and i.get('sha256')}
    where = Where(org / 'content', ROOT / 'cs-server' / 'shared', ROOT / 'content' / 'valve.zip')
    maps = []
    for fam_dir in sorted((org / 'maps').iterdir()):
        fam = fam_dir.name
        if fam in ('duplicates', 'packs') or not fam_dir.is_dir(): continue
        for bsp in sorted(fam_dir.glob('*.bsp')):
            h = hashes.get(bsp.name, {})
            if any(m['name'] == bsp.stem for m in maps):   # the same name twice: a copy the organiser left in loose/
                continue
            try: maps.append(scan_map(bsp, where, fam if fam != 'loose' else 'classic', h.get('sha256', ''), h.get('sameAs')))
            except Exception as e: maps.append({'kind': 'map', 'name': bsp.stem, 'path': bsp.as_posix(), 'bytes': bsp.stat().st_size, 'family': fam, 'tags': ['unreadable'], 'problem': str(e)[:200], 'deps': [], 'missing': 0, 'fatal': False})
            if len(maps) % 500 == 0: print(f'  {len(maps)} maps…', file=sys.stderr)
    models = scan_models(org / 'content')
    demo_paths = sorted((org / 'recordings').glob('*/*.dem')) + [p for d in a.demos for p in sorted(Path(d).glob('*.dem'))]
    demos, seen = [], {}
    for d in scan_demos(demo_paths):   # the same recording in two folders is one record
        import hashlib
        h = hashlib.sha256(open(d['path'], 'rb').read()).hexdigest()
        d['sha256'] = h
        if h in seen: continue
        if d['name'] in {x['name'] for x in demos}: d['name'] = f"{Path(d['path']).parent.name}/{d['name']}"
        seen[h] = d['name']; demos.append(d)
    out = {'built': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'drive': str(drive), 'store': 'drive', 'maps': maps, 'models': models, 'demos': demos}
    json.dump(out, open(a.out, 'w'), indent=None)
    wl = collections.Counter(d['where'] for m in maps for d in m.get('deps', []))
    print(f"{a.out}: {len(maps)} maps, {len(models)} models, {len(demos)} demos")
    print(f"  maps missing something: {sum(1 for m in maps if m.get('missing'))}, fatal: {sum(1 for m in maps if m.get('fatal'))}")
    print(f"  dependencies by where: {dict(wl)}")
    tagc = collections.Counter(t for m in maps for t in m.get('tags', []))
    print('  commonest tags: ' + ', '.join(f'{t} {n}' for t, n in tagc.most_common(16)))
    return 0

if __name__ == '__main__':
    sys.exit(main())
