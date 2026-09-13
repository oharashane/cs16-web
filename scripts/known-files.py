#!/usr/bin/env python3
"""
The Valve files the game needs, by path, size and sha256 — from the base build's source
(content/valve.zip), so that a visitor's own Half-Life folder can be checked file by file in
the browser, and one day supply them itself. Written to content/known-files.json.
"""
import hashlib, json, sys, time, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
pv = __import__('package-valve')


def main() -> int:
    z = zipfile.ZipFile(ROOT / 'content' / 'valve.zip')
    files = {}
    for info in z.infolist():
        if info.is_dir():
            continue
        low = info.filename.lower()
        if low.startswith(pv.EXCLUDE_PREFIXES) or low.endswith(pv.EXCLUDE_SUFFIXES) or low in pv.EXCLUDE_EXACT:
            continue
        files[info.filename] = {'bytes': info.file_size, 'sha256': hashlib.sha256(z.read(info)).hexdigest()}
    out = {'built': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'source': 'the Steam build of Half-Life and Counter-Strike the base bundle was made from', 'files': files}
    (ROOT / 'content' / 'known-files.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
    print(f"{len(files)} files, {sum(f['bytes'] for f in files.values()) / 1048576:.0f} MB")
    return 0


if __name__ == '__main__':
    sys.exit(main())
