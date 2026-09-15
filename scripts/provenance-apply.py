#!/usr/bin/env python3
"""
Write what GameBanana proved onto the records: for every download archive on the drive
that is byte-for-byte a GameBanana file (content/provenance.json, from provenance.py),
every map inside it (organized/archive-index.json) gets the mod's author, year, page and
licence — said by "gamebanana", so a person's own words still win, and the journal says
where each fact came from.

    scripts/provenance-apply.py            # needs DARKOAK_URL and DARKOAK_KEY from .relay.env
"""
import json, os, re, sys, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def env(name: str) -> str:
    for line in (ROOT / '.relay.env').read_text().splitlines():
        if line.startswith(name + '='):
            return line.split('=', 1)[1].strip().strip('"\'')
    return ''


def darkoak(method: str, path: str, body=None):
    url, key, host = env('DARKOAK_URL').rstrip('/') + '/api/cs16/museum' + path, env('DARKOAK_KEY'), env('RELAY_PUBLIC_HOST') or 'cs16.darkoak.xyz'
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Host': host})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def main() -> int:
    prov = json.loads((ROOT / 'content' / 'provenance.json').read_text())
    drive = Path(env('LAB_DRIVE') or (Path.home() / 'Desktop' / 'cs-museum-2026' / 'Maps 5044')).parent
    index = json.loads((drive / 'organized' / 'archive-index.json').read_text())
    said = skipped = 0
    for archive, rec in prov.get('archives', {}).items():
        if not rec.get('identical') or not rec.get('mod'):
            continue
        mod = rec['mod']
        maps = sorted({Path(f).stem for f in index.get(archive, []) if f.lower().endswith('.bsp')})
        for name in maps:
            found = darkoak('GET', f'/artifacts?kind=map&store=drive&size=20&q={urllib.request.quote(name)}')
            hits = [a for a in found['items'] if a['name'].lower() == name.lower()]
            if not hits:
                skipped += 1
                continue
            a = hits[0]
            if a.get('source') == mod['url']:
                continue   # already said
            body = {'by': 'gamebanana', 'source': mod['url'], 'add': 'provenance:gamebanana'}
            if mod.get('credits'):
                body['author'] = '; '.join(mod['credits'])[:200]
            elif mod.get('submitter'):
                body['author'] = f"{mod['submitter']} (submitter)"
            if mod.get('added'):
                body['year'] = int(mod['added'][:4])
            if mod.get('licence'):
                body['license'] = mod['licence'][:120]
            answer = darkoak('POST', f"/artifacts/{a['id']}/say", body)
            said += 1
            print(f"{name}: {answer.get('said', '')[:140]}")
    print(f'{said} maps told where they came from; {skipped} maps in proven archives are not in the drive store by that name')
    return 0


if __name__ == '__main__':
    sys.exit(main())
