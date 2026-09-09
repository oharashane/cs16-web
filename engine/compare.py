#!/usr/bin/env python3
"""Compare two engine builds: is ours a drop-in for the published one?

    engine/compare.py <published xash.wasm> <ours xash.wasm> [published raw.js] [ours raw.js]

Prints size, the memory section's limits, and the difference in import and export names —
the surface the TypeScript wrapper and the side modules depend on. Byte-identical output
is not expected (paths and timestamps differ); identical imports/exports/memory are.
"""
import sys, pathlib

def leb(b, i):
    v = s = 0
    while True:
        x = b[i]; i += 1; v |= (x & 0x7F) << s; s += 7
        if not x & 0x80: return v, i

def name(b, i):
    n, i = leb(b, i); return b[i:i+n].decode('utf8', 'replace'), i + n

def sections(b):
    assert b[:4] == b'\0asm', 'not wasm'
    i = 8
    while i < len(b):
        sid = b[i]; i += 1; size, i = leb(b, i); yield sid, b[i:i+size]; i += size

def describe(path):
    b = pathlib.Path(path).read_bytes()
    out = {'size': len(b), 'imports': set(), 'exports': set(), 'memory': None}
    for sid, body in sections(b):
        if sid == 2:
            n, i = leb(body, 0)
            for _ in range(n):
                mod, i = name(body, i); nm, i = name(body, i); kind = body[i]; i += 1
                if kind == 0: _, i = leb(body, i)
                elif kind == 1: i += 1; f, i = leb(body, i); _, i = leb(body, i); i = leb(body, i)[1] if f & 1 else i
                elif kind == 2:
                    f, i = leb(body, i); mn, i = leb(body, i); mx = None
                    if f & 1: mx, i = leb(body, i)
                    out['memory'] = ('imported', mn, mx)
                elif kind == 3: i += 2
                out['imports'].add(f'{mod}.{nm}')
        elif sid == 5:
            n, i = leb(body, 0); f, i = leb(body, i); mn, i = leb(body, i); mx = None
            if f & 1: mx, i = leb(body, i)
            out['memory'] = ('defined', mn, mx)
        elif sid == 7:
            n, i = leb(body, 0)
            for _ in range(n):
                nm, i = name(body, i); i += 1; _, i = leb(body, i); out['exports'].add(nm)
    return out

def main(a, b, ja=None, jb=None):
    A, B = describe(a), describe(b)
    mb = lambda pages: f'{pages * 64 // 1024} MB' if pages is not None else 'none'
    print(f"{'':12} {'published':>14} {'ours':>14}")
    print(f"{'size':12} {A['size']:>14,} {B['size']:>14,}")
    print(f"{'memory':12} {A['memory'][0]} {mb(A['memory'][1])}/{mb(A['memory'][2])}   {B['memory'][0]} {mb(B['memory'][1])}/{mb(B['memory'][2])}")
    print(f"{'imports':12} {len(A['imports']):>14} {len(B['imports']):>14}")
    print(f"{'exports':12} {len(A['exports']):>14} {len(B['exports']):>14}")
    for label, x, y in (('imports', A['imports'], B['imports']), ('exports', A['exports'], B['exports'])):
        only_a, only_b = sorted(x - y), sorted(y - x)
        if not only_a and not only_b: print(f"  {label}: identical")
        else:
            if only_a: print(f"  {label} only in published ({len(only_a)}): {' '.join(only_a[:20])}{' …' if len(only_a) > 20 else ''}")
            if only_b: print(f"  {label} only in ours ({len(only_b)}): {' '.join(only_b[:20])}{' …' if len(only_b) > 20 else ''}")
    if ja and jb:
        sa, sb = pathlib.Path(ja).stat().st_size, pathlib.Path(jb).stat().st_size
        print(f"{'raw.js':12} {sa:>14,} {sb:>14,}")

if __name__ == '__main__':
    main(*sys.argv[1:5])
