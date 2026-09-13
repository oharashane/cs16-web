#!/usr/bin/env python3
"""
A pass over a drive of Counter-Strike files, before any of it is imported.

    scripts/museum-drive.py ~/Desktop/cs-museum-2026

Reads the drive without changing it, classifies every file, hashes the maps, and builds
`<drive>/organized/`: a view of the same files made of hardlinks — zero bytes, the
originals untouched, `rm -r organized` undoes it — sorted the way the museum thinks:
maps by family (classic, arena, climb, surf, zombie, escape, deathrun, hide-and-seek,
jailbreak, minigame), the maps' dependencies as one pool for the scanner, recordings,
notes, plugins, tools, research, and what is not GoldSrc at all. `organized/manifest.json`
is the classification, one entry per item, with sha256 and same-content twins for maps.

Written for Shane's 2026 drive; the layout it expects (a merged `Maps 5044/` install, a
`cs1.6maps/` of downloads, loose files at the top) is that drive's, and the top-level
file lists near the end are too. A different drive wants those lists edited.
"""
import collections, hashlib, json, os, re, shutil, sys, time

# Map families by name. The Kreedz world names its maps by clan and country tag, which
# is why the climb list is long; a tag met on the next drive goes in the same place.
KZ_TAGS = ('kz', 'notkz', 'bkz', 'cobkz', 'bruderkz', 'kzcn', 'kzarg', 'kzro', 'kzra', 'kzsca', 'kzbr', 'kzlt', 'kzsk', 'kzlu', 'kzex',
           'kzua', 'kztw', 'kzr', 'kzba', 'kzkg', 'kzls', 'kzru', 'kzse', 'kzfr', 'kzee', 'kzpl', 'kzhu', 'kzdk', 'kzno', 'kzfi', 'kzde',
           'cg', 'bhop', 'slide', 'ins', 'climb', 'jump', 'lj', 'uq', 'sn', 'daza', 'klbk', 'cypress', 'risk', 'b2j', 'j2s', 'hb', 'ih',
           'qsk', 'etl', 'tx', 'nz', 'km', 'md', 'hm', 'trc', 'cosy', 'xjbg', 'sxj', 'cgturnier', 'st', 'dza', 'fu', 'ins', 'chip',
           'nfs', 'sf', 'zh', 'prochallenge', 'pc', 'bg', 'k2', 'dr0p', 'nl', 'ivns', 'clintmo', 'ksz', 'gbc', 'ykz', 'cl', 'dy')
FAMILY = [
    ('surf',          r'^surf_'),
    ('zombie',        r'^(zm|ze|zp|bb|zombie)_'),
    ('escape',        r'^es_'),
    ('deathrun',      r'^(deathrun|dr|dr0)_'),
    ('hide-and-seek', r'^(hns\w*|smk|hs)_'),
    ('jailbreak',     r'^(jb|jail|ba)_'),
    ('minigame',      r'^(mg|mini|fun|sj|soccer|foot|race|car|mario|paintball|pb|knife|bunny|ctf)_'),
    ('arena',         r'^(aim|awp|fy|he|ka|35hp|1hp|100hp|gg|1on1|1v1|dm|scout|scoutz|scoutzknivez|aaa|awp4one|kill|arena)[_\d]|^(aim|awp|fy|35hp|1on1|1vs1|scoutzknivez|awp4one|100hp|1hp)$'),
    ('classic',       r'^(de|cs|as|csde|csp|c4|hostage)_'),
    ('climb',         r'^(' + '|'.join(re.escape(t) for t in KZ_TAGS) + r')[_\d]|^kz\w*_|bhop|climb|longjump|_lj_|_bh_'),
]
def family(stem: str) -> str:
    n = stem.lower()
    for fam, rx in FAMILY:
        if re.search(rx, n):
            return fam
    return 'other'

def sha256(p: str) -> str:
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()

def demo_protocol(p: str):
    b = open(p, 'rb').read(16)
    return int.from_bytes(b[12:16], 'little', signed=True) if b[:6] == b'HLDEMO' else None

def main() -> int:
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
    out = os.path.join(root, 'organized')
    if os.path.isdir(out):
        shutil.rmtree(out)
    items = []
    def add(kind, rel, fam=None, note='', **extra):
        p = os.path.join(root, rel)
        items.append({'kind': kind, 'path': rel, 'bytes': os.path.getsize(p) if os.path.isfile(p) else None, 'family': fam, 'note': note, **extra})
    def link(src, dst):
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if not os.path.exists(dst):
            os.link(src, dst)

    # 1. The maps, hashed, twins found, sorted by family; sidecars beside them.
    maps_dir = os.path.join(root, 'Maps 5044', 'maps')
    hashes = {}
    names = sorted(f for f in os.listdir(maps_dir) if f.lower().endswith('.bsp'))
    for i, f in enumerate(names):
        hashes[f] = sha256(os.path.join(maps_dir, f))
        if i % 500 == 0:
            print(f'  hashing maps… {i}/{len(names)}', file=sys.stderr)
    by_hash = collections.defaultdict(list)
    for f, h in hashes.items():
        by_hash[h].append(f)
    fams = collections.Counter()
    for f in names:
        stem, fam = f[:-4], family(f[:-4])
        twins = [n for n in by_hash[hashes[f]] if n != f]
        canonical = not twins or min(by_hash[hashes[f]], key=lambda n: (len(n), n)) == f
        fams[fam if canonical else 'duplicates'] += 1
        add('map', f'Maps 5044/maps/{f}', fam, sha256=hashes[f], sameAs=twins or None, canonical=canonical)
        dst = os.path.join(out, 'maps', fam if canonical else 'duplicates', f)
        link(os.path.join(maps_dir, f), dst)
        for ext in ('.txt', '.res', '.nav', '.cfg'):
            side = os.path.join(maps_dir, stem + ext)
            if os.path.exists(side):
                link(side, os.path.join(os.path.dirname(dst), stem + ext))
    # 2. The dependency pool: one pool, the scanner attributes it.
    for sub in ('models', 'sound', 'sprites', 'wad', 'gfx', 'overviews'):
        n = 0
        for dp, _, fs in os.walk(os.path.join(root, 'Maps 5044', sub)):
            for f in fs:
                src = os.path.join(dp, f)
                link(src, os.path.join(out, 'content', os.path.relpath(src, os.path.join(root, 'Maps 5044'))))
                n += 1
        add('content-pool', f'Maps 5044/{sub}', note=f"{n} files — the maps' dependencies, kept as one pool")
    # 3. The downloads as downloaded: provenance, linked as a whole.
    if os.path.isdir(os.path.join(root, 'cs1.6maps')):
        add('downloads', 'cs1.6maps', note='the archives with their original download names — the source of the install above, and its provenance')
        os.symlink(os.path.join(root, 'cs1.6maps'), os.path.join(out, 'downloads-as-downloaded'))
    # 4. Everything loose at the top, by what it is.
    TOP = {
        'notes': ['2017-csmuseum-notes.txt', 'reorg_idea.txt', 'sample.md', 'cstrike_server_layout.txt', 'cs_rates_thomz0.txt', 'cs-hl-map-entity-hacking.txt', 'userconfig.cfg', 'cs1.6_commands'],
        'sounds': ['aaah.wav', 'monsterkill.wav', 'move.wav', 'muhahaha.wav', 'setbomb.wav'],
        'models': ['modelsbluered.rar', 'uGParachute.mdl'],
        'plugins': ['dib3-deathinfobeams3-onlydeadsee.sma', 'amxmodx-1.8.2-base-linux.tar.gz', 'amxmodx-1.8.2-cstrike-linux.tar.gz', 'metamod-1.21.1-am.zip', 'cs16_ReGameDll_zBot__bot_profiles.zip', 'xspec.zip'],
        'tools': ['Sledge_Editor.zip', 'FGD_sprites_cs1.6.rar', 'Pawn_File_IO_Support.pdf', 'Pawn_Implementer_Guide.pdf', 'Pawn_Language_Guide.pdf', 'Pawn_String_Manipulation.pdf', 'counter-strike-extruded-font.zip', 'counter_strike_font.zip', 'counter-strike-regular.family.zip', 'facelift-font.zip'],
        'research': ['hack.7z'],
        'screenshots': ['cstrike_screenshots.zip'],
        'images': ['predator.bmp', 'yxvRC.jpg', 'The-Science-of-Counterstrike-Global-Offensive-600x491.png'],
        'not-goldsrc': ['cssource-x-men_wolverine_claws.rar', 'cstrike_demos.zip'],
        'servers': ['192.223.26.202.7z'],
        'maps/packs': ['gg1.6maps.7z', 'SurfMapPack_v1.zip', 'fy_dust_aim.zip'],
        'maps/loose': ['cs_assault_santa.bsp', 'de_dust2_xmas.bsp', 'mcdonalds-mds.bsp'],
        'recordings': ['worthsaving.7z'],
    }
    NOTES = {'hack.7z': 'a cracked aimbot — review §10 material, never installed', '192.223.26.202.7z': 'the uG server: 165 player-model files (donor and admin skins), map .txt files, player lists',
             'worthsaving.7z': '37 recordings from the uG servers, May–September 2014', 'cstrike_demos.zip': 'six Counter-Strike: Source demos from 2005, not GoldSrc',
             'monsterkill.wav': 'the Quake announcer pack', 'amx_adminspec': "admin_spec_esp with Shane's own edits"}
    for kind, files in TOP.items():
        for f in files:
            if os.path.exists(os.path.join(root, f)):
                add(kind.split('/')[0], f, note=NOTES.get(f, ''))
                link(os.path.join(root, f), os.path.join(out, kind, f))
    for f in sorted(os.listdir(root)):
        if f.lower().endswith('.dem') and not f.startswith('._'):
            proto = demo_protocol(os.path.join(root, f))
            add('recording', f, note=f'GoldSrc, protocol {proto}' if proto else 'not GoldSrc', protocol=proto)
            link(os.path.join(root, f), os.path.join(out, 'recordings', 'loose', f))
    for d in ('amx_adminspec', 'all-in-one-3.2a'):
        if os.path.isdir(os.path.join(root, d)):
            add('plugins', d, note=NOTES.get(d, ''))
            for dp, _, fs in os.walk(os.path.join(root, d)):
                for f in fs:
                    src = os.path.join(dp, f)
                    link(src, os.path.join(out, 'plugins', os.path.relpath(src, root)))
    json.dump({'built': time.strftime('%Y-%m-%d'), 'root': root, 'items': items}, open(os.path.join(out, 'manifest.json'), 'w'), indent=1)
    print(f'{out}: {sum(len(f) for _, _, f in os.walk(out))} links')
    print('maps: ' + ', '.join(f'{k} {v}' for k, v in fams.most_common()))
    return 0

if __name__ == '__main__':
    sys.exit(main())
