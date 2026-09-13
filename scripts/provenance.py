#!/usr/bin/env python3
"""
Provenance from GameBanana, politely: what the site says about a map, and whether the
archive on the drive is byte-for-byte the one it serves.

    scripts/provenance.py --rotation                 # every map in a rotation, by name
    scripts/provenance.py --archives 50              # the first N download archives on the drive, by name then md5
    scripts/provenance.py de_dust2_xmas fy_iceworld  # named maps

Manners, the coins room's: one request a second, a User-Agent that says who we are and
how to reach us, and a capture of every response kept for ever under
content/provenance/captures/ so nothing is fetched twice and a better parser can re-read
what was fetched. Output: content/provenance.json — per name, the GameBanana record
(author credits, submitter, date, downloads, licence, files with md5) and, where the drive
holds the same archive, "identical: true".

The API is GameBanana's public apiv11; Counter-Strike 1.6 is game row 4254.
"""
import argparse, hashlib, json, os, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CAPTURES = ROOT / 'content' / 'provenance' / 'captures'
OUT = ROOT / 'content' / 'provenance.json'
UA = 'cs16-museum-provenance/0.1 (a family museum of Counter-Strike 1.6; contact shane@oharaspace.com)'
GAME = 4254
PAUSE = 1.0
_last = [0.0]


def fetch(url: str) -> dict:
    """A capture: the response as it came, keyed by the URL, fetched once."""
    CAPTURES.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(url.encode()).hexdigest()
    path = CAPTURES / f'{key}.json'
    if path.exists():
        return json.loads(path.read_text())['body']
    wait = PAUSE - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = json.loads(r.read().decode('utf-8'))
    _last[0] = time.time()
    path.write_text(json.dumps({'url': url, 'at': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'body': body}))
    return body


def search(name: str) -> list[dict]:
    q = urllib.parse.quote(name)
    body = fetch(f'https://gamebanana.com/apiv11/Util/Search/Results?_sModelName=Mod&_sOrder=best_match&_idGameRow={GAME}&_sSearchString={q}&_nPage=1')
    return body.get('_aRecords', [])


def profile(mod_id: int) -> dict:
    return fetch(f'https://gamebanana.com/apiv11/Mod/{mod_id}/ProfilePage')


def record(p: dict) -> dict:
    credits = [f"{a.get('_sName')} ({a.get('_sRole')})" for g in p.get('_aCredits') or [] for a in g.get('_aAuthors', [])]
    licence = re.sub(r'<[^>]+>', '', p.get('_sLicense') or '').strip()
    return {
        'id': p.get('_idRow'), 'name': p.get('_sName'), 'url': p.get('_sProfileUrl'),
        'added': time.strftime('%Y-%m-%d', time.gmtime(p['_tsDateAdded'])) if p.get('_tsDateAdded') else None,
        'submitter': (p.get('_aSubmitter') or {}).get('_sName'), 'credits': credits,
        'category': (p.get('_aCategory') or {}).get('_sName'), 'downloads': p.get('_nDownloadCount'), 'likes': p.get('_nLikeCount'),
        'licence': licence[:200], 'text': (p.get('_sText') or '')[:500],
        'files': [{'file': f.get('_sFile'), 'bytes': f.get('_nFilesize'), 'md5': f.get('_sMd5Checksum')} for f in p.get('_aFiles') or []],
    }


def rotation_maps() -> list[str]:
    names = set()
    for f in (ROOT / 'cs-server' / 'main' / 'modes').glob('*.maps.txt'):
        for line in f.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith(('#', '//')):
                names.add(line.split()[0])
    return sorted(names)


def drive_archives(limit: int) -> list[Path]:
    env = (ROOT / 'cs-server' / '.env').read_text() if (ROOT / 'cs-server' / '.env').exists() else ''
    m = re.search(r'^LAB_DRIVE=["\']?(.*?)["\']?$', env, re.M)
    drive = Path(m.group(1)).parent if m else Path.home() / 'Desktop' / 'cs-museum-2026'
    files = sorted(p for p in (drive / 'cs1.6maps').iterdir() if p.is_file() and not p.name.startswith('._') and p.suffix.lower() in ('.zip', '.rar', '.7z'))
    return files[:limit]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('names', nargs='*')
    ap.add_argument('--rotation', action='store_true')
    ap.add_argument('--archives', type=int, default=0)
    a = ap.parse_args()
    out = json.loads(OUT.read_text()) if OUT.exists() else {'maps': {}, 'archives': {}}

    names = list(a.names) + (rotation_maps() if a.rotation else [])
    hits = 0
    for name in names:
        exact = [r for r in search(name) if r.get('_sName', '').lower() == name.lower()]
        if not exact:
            out['maps'][name] = {'found': False}
            print(f'{name}: no exact match')
            continue
        rec = record(profile(exact[0]['_idRow']))
        out['maps'][name] = {'found': True, **rec}
        hits += 1
        print(f"{name}: {rec['url']} — {', '.join(rec['credits']) or rec['submitter']}, {rec['added']}, {rec['downloads']} downloads")
    if names:
        print(f'{hits} of {len(names)} found by exact name')

    identical = 0
    archives = drive_archives(a.archives) if a.archives else []
    for path in archives:
        md5 = hashlib.md5(path.read_bytes()).hexdigest()
        stem = re.sub(r'__[a-z0-9]+$', '', path.stem)   # GameBanana's download names carry a suffix
        candidates = search(stem.replace('_', ' '))[:5]
        match = None
        for c in candidates:
            rec = record(profile(c['_idRow']))
            if any(f['md5'] == md5 for f in rec['files']):
                match = rec
                break
        out['archives'][path.name] = {'md5': md5, 'identical': match is not None, **({'mod': match} if match else {'candidates': [c.get('_sName') for c in candidates]})}
        identical += match is not None
        print(f"{path.name}: {'identical to ' + match['url'] if match else 'no md5 match among ' + str(len(candidates)) + ' candidates'}")
    if archives:
        print(f'{identical} of {len(archives)} archives are byte-for-byte a GameBanana file')

    OUT.write_text(json.dumps(out, indent=1) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
