#!/usr/bin/env python3
r"""
A bundle for one map on the lab: the map and everything it needs that the browser does
not already have, found on the server's content first, then the drive, then the base.

    scripts/package-lab.py surf_ski_2                   # content/lab/surf_ski_2.zip
    scripts/package-lab.py --drive ~/Desktop/cs-museum-2026/Maps\ 5044 zm_dust2 deathrun_aztec

Each bundle is written once and listed in content/lab-manifest.json, which the browser
reads beside the main manifest: a map the lab is on is fetched from here when the main
bundles do not carry it. The base never changes for a lab map, so nobody re-downloads
it. Resolution is the catalogue scanner's own (museum-scan.Where + mapdeps.dependencies),
so what the bundle holds is exactly what the curator's desk says the map needs.
"""
import argparse, importlib, json, os, sys, time, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from mapdeps import dependencies, SKY_SIDES  # noqa: E402
scan = importlib.import_module('museum-scan')
pv = importlib.import_module('package-valve')


def drive_dir() -> Path:
    """LAB_DRIVE from cs-server/.env — the same mount the lab container reads."""
    env = ROOT / 'cs-server' / '.env'
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith('LAB_DRIVE='):
                return Path(line.split('=', 1)[1].strip().strip('"\''))
    return Path('/nonexistent')


def bundle(name: str, where, content: Path, drive: Path, base: zipfile.ZipFile, out_dir: Path) -> dict | None:
    bsp = None
    for root in (content, drive):
        candidate = root / 'maps' / f'{name}.bsp'
        if candidate.is_file():
            bsp = candidate
            break
    if bsp is None:
        print(f'{name}: not on the server and not on the drive', file=sys.stderr)
        return None
    record = dependencies(bsp, where)
    entries: dict[str, tuple[str, object]] = {f'cstrike/maps/{name}.bsp': ('file', bsp)}
    for extra in ('.txt', '.res', '.cfg'):
        side = bsp.with_suffix(extra)
        if side.is_file():
            entries[f'cstrike/maps/{name}{extra}'] = ('file', side)
    for over in ('.bmp', '.txt', '.tga'):
        for root in (content, drive):
            p = root / 'overviews' / f'{name}{over}'
            if p.is_file():
                entries[f'cstrike/overviews/{name}{over}'] = ('file', p)
                break
    roots = {'content': content, 'drive': drive}
    for dep in record['deps']:
        w, path = dep['where'], dep['path']
        if w == 'missing':
            continue
        if dep['kind'] == 'sky':
            sky = path[len('gfx/env/'):-1]
            for side in SKY_SIDES:
                for ext in ('tga', 'bmp'):
                    found, p = where.find(f'gfx/env/{sky}{side}.{ext}')
                    if found in roots:
                        entries[f'cstrike/{p}'] = ('file', roots[found] / p)
                    elif found == 'base':
                        # A stock sky the base bundle may have dropped as unused by the rotation.
                        entries[p] = ('base', base.getinfo(p))
            continue
        if w == 'base':
            continue   # the browser has it
        if dep['kind'] == 'wad':
            entries[f'cstrike/{os.path.basename(path)}'] = ('file', roots[w] / path)
        else:
            entries[f'cstrike/{path}'] = ('file', roots[w] / path)

    def read(source) -> bytes:
        kind, what = source
        return base.read(what) if kind == 'base' else Path(what).read_bytes()

    info = pv.write_zip(out_dir / f'{name}.zip', entries, read)
    info['name'] = name
    info['file'] = f'lab/{name}.zip'
    missing = [d for d in record['deps'] if d['where'] == 'missing']
    info['missing'] = [f"{d['kind']} {d['path']}" for d in missing]
    info['fatal'] = record['fatal']
    return info


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('maps', nargs='+')
    ap.add_argument('--drive', default=str(drive_dir()), help='the merged install the lab mounts (default: LAB_DRIVE in cs-server/.env)')
    ap.add_argument('--content', default=str(ROOT / 'cs-server' / 'shared'))
    ap.add_argument('--base', default=str(ROOT / 'content' / 'valve.zip'))
    ap.add_argument('--out', default=str(ROOT / 'content'))
    args = ap.parse_args()
    content, drive, out = Path(args.content), Path(args.drive), Path(args.out)
    where = scan.Where(drive, content, Path(args.base))
    base = zipfile.ZipFile(args.base)
    manifest_path = out / 'lab-manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {'maps': []}
    by_name = {m['name']: m for m in manifest['maps']}
    rc = 0
    for name in args.maps:
        info = bundle(name, where, content, drive, base, out / 'lab')
        if info is None:
            rc = 1
            continue
        by_name[name] = info
        note = f"; missing {len(info['missing'])}" if info['missing'] else ''
        print(f"lab/{name}.zip: {info['bytes'] / 1048576:.1f} MB, {info['files']} files{note}{' — FATAL on the server' if info['fatal'] else ''}")
    manifest = {'built': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'maps': sorted(by_name.values(), key=lambda m: m['name'])}
    manifest_path.write_text(json.dumps(manifest, indent=1) + '\n')
    return rc


if __name__ == '__main__':
    sys.exit(main())
