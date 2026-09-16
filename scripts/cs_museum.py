#!/usr/bin/env python3
"""
cs_museum: the museum as a map. The floor plan in docs/proposals/de_museum.md, built as
brushes — nine rooms, doorways, a corridor — with the exhibits on its walls: every map on
display becomes a picture (its preview, as a texture) and every room a sign. Written as a
.map, compiled with SDHLT into cs-server/shared/maps/cs_museum.bsp, textures embedded, so
it flies in hlviewer and plays on the lab like any other map.

    scripts/cs_museum.py --tools <dir with sdHLCSG, sdHLBSP, sdHLVIS, sdHLRAD>

Walls, floors and ceilings are cs_office.wad's (an office block is the closest thing to
a gallery the game has); the pictures and signs are ours, in cs_museum.wad, which the
script also writes. Units: 1 svg unit of the floor plan = 4 map units.
"""
import argparse, json, os, shutil, struct, subprocess, sys, urllib.request
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SCALE = 4
H = 176            # room height
WALL = 16          # wall thickness
DOOR_W, DOOR_H = 112, 128
WALLTEX, FLOORTEX, CEILTEX, TRIM = 'Core_Urban_036', 'Core_Urban_120', 'Core_Urban_023', 'Core_Urban_061'

# The floor plan (x, y, w, h) in svg units; doors as (axis, position, length) on a wall.
ROOMS = {
    'entrance':   dict(rect=(420, 420, 140, 80),  name='Entrance',           sign='THE COUNTER-STRIKE 1.6 MUSEUM'),
    'game':       dict(rect=(560, 420, 300, 80),  name='The game',           sign='THE GAME'),
    'maps':       dict(rect=(40, 40, 360, 250),   name='The maps hall',      sign='THE MAPS HALL'),
    'models':     dict(rect=(40, 290, 220, 210),  name='The models hall',    sign='THE MODELS HALL'),
    'workshop':   dict(rect=(260, 290, 160, 210), name='The workshop',       sign='THE WORKSHOP'),
    'recordings': dict(rect=(400, 40, 200, 150),  name='Recordings theatre', sign='RECORDINGS THEATRE'),
    'machine':    dict(rect=(600, 40, 260, 150),  name='The machine room',   sign='THE MACHINE ROOM'),
    'timeline':   dict(rect=(400, 190, 460, 80),  name='The timeline gallery', sign=None),   # the years are its sign
    'world':      dict(rect=(600, 270, 260, 150), name='The wider world',    sign='THE WIDER WORLD'),
    'corridor':   dict(rect=(470, 270, 60, 150),  name='the corridor',       sign=None),
}
# Doorways: which two rooms, and where (the shared wall is found from the rects).
DOORS = [('entrance', 'corridor'), ('entrance', 'game'), ('entrance', 'workshop'), ('corridor', 'timeline'),
         ('timeline', 'recordings'), ('timeline', 'machine'), ('timeline', 'world'), ('maps', 'recordings'),
         ('maps', 'models'), ('models', 'workshop'), ('maps', 'timeline')]


def m(v):  # svg → map units; y flips so the plan reads the same from above
    return v * SCALE


def brush(x0, y0, z0, x1, y1, z1, tex, textop=None, texbottom=None, scale=1.0, faces=None):
    """An axis-aligned box as a .map brush (Valve 220 texture axes). The U axis of each
    side runs left-to-right for someone standing outside facing it, and a face named in
    `faces` ({'+y': (texture, scale)}) gets its own texture aligned to the face's
    top-left corner, which is how a picture hangs straight."""
    lines = ['{']
    faces = faces or {}
    def face(key, p1, p2, p3, t, u, v, uoff=0, voff=0, sc=scale):
        if key in faces:
            t, sc = faces[key]
            # align the texture's origin to the face's top-left: u runs along the wall, v down
            ax = u.index(next(c for c in u if c)); uoff = -(u[ax] * (x0, y0, z0)[ax] if u[ax] > 0 else u[ax] * (x1, y1, z1)[ax]) / sc
            voff = z1 / sc
        lines.append(f'( {p1[0]} {p1[1]} {p1[2]} ) ( {p2[0]} {p2[1]} {p2[2]} ) ( {p3[0]} {p3[1]} {p3[2]} ) {t} [ {u[0]} {u[1]} {u[2]} {uoff:g} ] [ {v[0]} {v[1]} {v[2]} {voff:g} ] 0 {sc} {sc}')
    top, bottom = textop or tex, texbottom or tex
    face('+z', (x0, y1, z1), (x1, y1, z1), (x1, y0, z1), top, (1, 0, 0), (0, -1, 0))
    face('-z', (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), bottom, (1, 0, 0), (0, -1, 0))
    face('-x', (x0, y0, z0), (x0, y1, z0), (x0, y1, z1), tex, (0, -1, 0), (0, 0, -1))   # seen from -x: right is -y
    face('+x', (x1, y1, z0), (x1, y0, z0), (x1, y0, z1), tex, (0, 1, 0), (0, 0, -1))    # seen from +x: right is +y
    face('-y', (x0, y0, z1), (x1, y0, z1), (x1, y0, z0), tex, (1, 0, 0), (0, 0, -1))    # seen from -y: right is +x
    face('+y', (x1, y1, z1), (x0, y1, z1), (x0, y1, z0), tex, (-1, 0, 0), (0, 0, -1))   # seen from +y: right is -x
    lines.append('}')
    return '\n'.join(lines)


def shared_wall(a, b):
    """Where two rooms touch: ('x', x, lo, hi) for a vertical wall at x, ('y', y, lo, hi) for a horizontal one."""
    ax, ay, aw, ah = a; bx, by, bw, bh = b
    if abs(ax + aw - bx) < 1 or abs(bx + bw - ax) < 1:
        x = ax + aw if abs(ax + aw - bx) < 1 else ax
        lo, hi = max(ay, by), min(ay + ah, by + bh)
        if hi - lo > 20: return ('x', x, lo, hi)
    if abs(ay + ah - by) < 1 or abs(by + bh - ay) < 1:
        y = ay + ah if abs(ay + ah - by) < 1 else ay
        lo, hi = max(ax, bx), min(ax + aw, bx + bw)
        if hi - lo > 20: return ('y', y, lo, hi)
    raise SystemExit(f'rooms do not touch: {a} {b}')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--tools', default=str(Path.home() / 'darkoak-backups' / 'sdhlt-tools'), help='SDHLT (seedee/SDHLT), built once and kept beside the engine backups')
    ap.add_argument('--out', default=str(ROOT / 'cs-server' / 'shared'))
    ap.add_argument('--relay', default='http://127.0.0.1:27100')
    ap.add_argument('--no-rad', action='store_true', help='skip lighting (fast, fullbright)')
    args = ap.parse_args()
    out = Path(args.out); work = ROOT / 'content' / 'cs_museum'; work.mkdir(parents=True, exist_ok=True)

    # --- the exhibits: every map on display, from the museum's records --------------------
    env = {}
    for line in (ROOT / '.relay.env').read_text().splitlines():
        if '=' in line and not line.startswith('#'): k, v = line.split('=', 1); env[k] = v.strip()
    import base64
    auth = base64.b64encode(f"{env['RELAY_USER']}:{env['RELAY_PASSWORD']}".encode()).decode()
    def api(path):
        req = urllib.request.Request(args.relay + path, headers={'Authorization': 'Basic ' + auth})
        return json.load(urllib.request.urlopen(req, timeout=30))
    shown = []
    for page in range(1, 6):
        d = api(f'/api/museum/artifacts?kind=map&shown=1&size=200&page={page}&sort=stars'); shown += d['items']
        if len(shown) >= d['total']: break
    previews = ROOT / 'content' / 'previews'
    exhibits = [a for a in shown if (previews / f"{a['id']}.jpg").exists()]

    # --- cs_museum.wad: the pictures and the signs, as 8-bit textures ----------------------
    textures = {}   # name → PIL image (RGB), sizes multiples of 16
    for a in exhibits:
        im = Image.open(previews / f"{a['id']}.jpg").convert('RGB').resize((256, 160))
        # a caption strip along the bottom: the map's name and its family
        d = ImageDraw.Draw(im); d.rectangle((0, 140, 256, 160), fill=(20, 18, 14))
        d.text((6, 144), f"{a['name']}  ·  {a.get('family') or ''}", fill=(217, 195, 122))
        textures[f"EX{a['id']}"] = im
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 30)
    except OSError:
        font = ImageFont.load_default()
    for key, r in ROOMS.items():
        if not r['sign']: continue
        im = Image.new('RGB', (512, 64), (20, 18, 14)); d = ImageDraw.Draw(im)
        w = d.textlength(r['sign'], font=font); d.text(((512 - w) / 2, 12), r['sign'], fill=(232, 226, 207), font=font)
        textures[f"SIGN_{key.upper()}"[:15]] = im
    # the theatre's screen: a frame of the 2022 HLTV recording, and the same frame with the wallhack on
    for key, src in (('SCREEN_HLTV', ROOT / '.bench-xray-150-off.png'), ('SCREEN_XRAY', ROOT / '.bench-xray-150-on.png')):
        if src.exists(): textures[key] = Image.open(src).convert('RGB').resize((512, 320))
    poster = ROOT / 'web' / 'dist' / 'tour' / 'clip.jpg'
    if poster.exists(): textures['POSTER_CLIP'] = Image.open(poster).convert('RGB').resize((256, 160))
    # the machine room's plinths and the timeline's strip: signs of our own making
    small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 18) if font else font
    for key, text in (('PL_ENGINE', 'THE ENGINE'), ('PL_RELAY', 'THE RELAY'), ('PL_SERVER', 'THE SERVER'), ('PL_PATCHES', 'THE PATCHES'), ('PL_NUMBERS', 'THE NUMBERS')):
        im = Image.new('RGB', (128, 32), (20, 18, 14)); d = ImageDraw.Draw(im); w = d.textlength(text, font=small); d.text(((128 - w) / 2, 6), text, fill=(217, 195, 122), font=small); textures[key] = im
    years = [(1998, 'Half-Life'), (1999, 'the mod'), (2000, 'CS 1.0'), (2003, '1.6'), (2004, 'Steam'), (2012, 'CS:GO'), (2025, 'six plans'), (2026, 'this museum')]
    strip = Image.new('RGB', (1024, 64), (20, 18, 14)); d = ImageDraw.Draw(strip)
    d.line((16, 40, 1008, 40), fill=(217, 195, 122), width=2)
    for y, what in years:
        x = 16 + (y - 1996) * (992 / 31); d.line((x, 34, x, 46), fill=(232, 226, 207), width=2)
        d.text((x - 14, 8), str(y), fill=(232, 226, 207), font=small); d.text((x - 14, 46), what, fill=(154, 147, 132))
    textures['STRIP_YEARS'] = strip
    wad = write_wad(textures, work / 'cs_museum.wad')
    shutil.copy(wad, out / 'wads' / 'cs_museum.wad')

    # --- the map ----------------------------------------------------------------------------
    brushes, ents = [], []
    floor_z, ceil_z = 0, H
    for key, r in ROOMS.items():
        x, y, w, h = r['rect']
        x0, y0, x1, y1 = m(x), -m(y + h), m(x + w), -m(y)   # svg y down → map y up
        brushes.append(brush(x0, y0, floor_z - WALL, x1, y1, floor_z, FLOORTEX))
        brushes.append(brush(x0, y0, ceil_z, x1, y1, ceil_z + WALL, CEILTEX))
    # walls: every room edge, cut where a door is
    door_cuts = {}   # (axis, coord) → list of (lo, hi) in map units to leave open
    doorways = []    # rectangles a visitor may stand in, for the page's walls
    for a, b in DOORS:
        axis, c, lo, hi = shared_wall(ROOMS[a]['rect'], ROOMS[b]['rect'])
        mid = (lo + hi) / 2
        if axis == 'x':
            door_cuts.setdefault(('x', m(c)), []).append((-m(mid) - DOOR_W / 2, -m(mid) + DOOR_W / 2))
            doorways.append(dict(between=[a, b], rect=[m(c) - WALL, -m(mid) - DOOR_W / 2, m(c) + WALL, -m(mid) + DOOR_W / 2]))
        else:
            door_cuts.setdefault(('y', -m(c)), []).append((m(mid) - DOOR_W / 2, m(mid) + DOOR_W / 2))
            doorways.append(dict(between=[a, b], rect=[m(mid) - DOOR_W / 2, -m(c) - WALL, m(mid) + DOOR_W / 2, -m(c) + WALL]))
    seen = set()
    for key, r in ROOMS.items():
        x, y, w, h = r['rect']
        x0, y0, x1, y1 = m(x), -m(y + h), m(x + w), -m(y)
        for axis, c, lo, hi in (('x', x0, y0, y1), ('x', x1, y0, y1), ('y', y0, x0, x1), ('y', y1, x0, x1)):
            if (axis, c, lo, hi) in seen: continue
            seen.add((axis, c, lo, hi))
            cuts = sorted(door_cuts.get((axis, c), []))
            segs, at = [], lo
            for clo, chi in cuts:
                if chi <= lo or clo >= hi: continue
                if clo > at: segs.append((at, clo))
                # the lintel above the door
                if axis == 'x': brushes.append(brush(c - WALL / 2, clo, DOOR_H, c + WALL / 2, chi, ceil_z, WALLTEX))
                else: brushes.append(brush(clo, c - WALL / 2, DOOR_H, chi, c + WALL / 2, ceil_z, WALLTEX))
                at = max(at, chi)
            if at < hi: segs.append((at, hi))
            for slo, shi in segs:
                if axis == 'x': brushes.append(brush(c - WALL / 2, slo - WALL / 2, floor_z, c + WALL / 2, shi + WALL / 2, ceil_z, WALLTEX))
                else: brushes.append(brush(slo - WALL / 2, c - WALL / 2, floor_z, shi + WALL / 2, c + WALL / 2, ceil_z, WALLTEX))
    # the pictures: along the maps hall's walls first, then the other halls', 4 units proud
    PIC_W, PIC_H, GAP = 192, 120, 48
    hang = []   # (room, axis, c, lo, hi, normal) walls that take pictures
    for key in ('maps', 'models', 'recordings', 'machine', 'timeline', 'world'):
        x, y, w, h = ROOMS[key]['rect']
        x0, y0, x1, y1 = m(x), -m(y + h), m(x + w), -m(y)
        walls_ = [(key, 'y', y1, x0, x1, -1), (key, 'y', y0, x0, x1, 1), (key, 'x', x0, y0, y1, 1), (key, 'x', x1, y0, y1, -1)]
        if key == 'timeline': walls_ = walls_[1:]   # the north wall carries the years
        hang += walls_
    placed, ei = [], 0
    for room, axis, c, lo, hi, n in hang:
        cuts = door_cuts.get((axis, c), [])
        pos = lo + GAP
        while pos + PIC_W + GAP <= hi and ei < len(exhibits):
            if any(not (pos + PIC_W < clo - 32 or pos > chi + 32) for clo, chi in cuts): pos += 32; continue
            a = exhibits[ei]; ei += 1; tex = f"EX{a['id']}"
            z0, z1 = 40, 40 + PIC_H
            if axis == 'y':
                yy = c + n * (WALL / 2)
                brushes.append(brush(pos, min(yy, yy + n * 4), z0, pos + PIC_W, max(yy, yy + n * 4), z1, WALLTEX, faces={('+y' if n > 0 else '-y'): (tex, 0.75)}))
                placed.append(dict(id=a['id'], name=a['name'], room=room, at=[pos + PIC_W / 2, yy, 100], facing=[0, n, 0]))
            else:
                xx = c + n * (WALL / 2)
                brushes.append(brush(min(xx, xx + n * 4), pos, z0, max(xx, xx + n * 4), pos + PIC_W, z1, WALLTEX, faces={('+x' if n > 0 else '-x'): (tex, 0.75)}))
                placed.append(dict(id=a['id'], name=a['name'], room=room, at=[xx, pos + PIC_W / 2, 100], facing=[n, 0, 0]))
            pos += PIC_W + GAP
    things = []   # what a visitor may activate, beyond the pictures: for the page and for the game's own labels
    # the theatre: a screen on the north wall, rows of seats facing it, the wallhack frame beside the door
    tx, ty, tw, th = ROOMS['recordings']['rect']; x0, y0, x1, y1 = m(tx), -m(ty + th), m(tx + tw), -m(ty)
    cx = (x0 + x1) / 2
    brushes.append(brush(cx - 256, y1 - WALL / 2 - 6, 36, cx + 256, y1 - WALL / 2, 36 + 320, '{BLACK' if False else WALLTEX, faces={'-y': ('SCREEN_HLTV', 1.0)}))
    things.append(dict(kind='recording', name='hltv_2022_dust2.dem', label='An HLTV recording, de_dust2, 2022', at=[cx, y1 - WALL / 2, 100], facing=[0, -1, 0], reach=520))
    for row in range(3):
        yy = y1 - 260 - row * 90
        for seat in range(5):
            sx = cx - 200 + seat * 96
            brushes.append(brush(sx, yy - 28, 0, sx + 48, yy + 4, 26, TRIM))
    brushes.append(brush(x0 + WALL / 2, y0 + 40, 40, x0 + WALL / 2 + 4, y0 + 40 + 256, 40 + 160, WALLTEX, faces={'+x': ('SCREEN_XRAY', 1.0)}))
    things.append(dict(kind='exhibit', name='the wallhack', label='The wallhack of 2003, as an exhibit — the same frame, players outlined through the wall', href='/recordings', at=[x0 + WALL / 2, y0 + 168, 100], facing=[1, 0, 0]))
    # the entrance: the clip's poster
    ex_, ey_, ew_, eh_ = ROOMS['entrance']['rect']; x0, y0, x1, y1 = m(ex_), -m(ey_ + eh_), m(ex_ + ew_), -m(ey_)
    brushes.append(brush(x0 + WALL / 2, y0 + 60, 40, x0 + WALL / 2 + 4, y0 + 60 + 192, 40 + 120, WALLTEX, faces={'+x': ('POSTER_CLIP', 0.75)}))
    things.append(dict(kind='clip', name='thirty seconds of it', label='Thirty seconds of a real recording, played by the real game', at=[x0 + WALL / 2, y0 + 156, 100], facing=[1, 0, 0]))
    # the machine room: plinths, one per piece, each opening its station
    mx_, my_, mw_, mh_ = ROOMS['machine']['rect']; x0, y0, x1, y1 = m(mx_), -m(my_ + mh_), m(mx_ + mw_), -m(my_)
    for i, (key, label, href) in enumerate((('PL_ENGINE', 'The engine — Xash3D FWGS in WebAssembly', '/engine#engine'), ('PL_RELAY', 'The relay — a browser’s packets become the game’s', '/engine#network'), ('PL_SERVER', 'The server — ReHLDS, as in 2003', '/engine#read-now'), ('PL_PATCHES', 'The nine patches on the engine', '/engine#patches'), ('PL_NUMBERS', 'The numbers — every measurement, with the bench that made it', '/engine#read-perf'))):
        px_ = x0 + 120 + i * ((x1 - x0 - 240) / 4); py_ = (y0 + y1) / 2
        brushes.append(brush(px_ - 28, py_ - 28, 0, px_ + 28, py_ + 28, 44, TRIM, textop=key))
        things.append(dict(kind='station', name=label.split(' — ')[0], label=label, href=href, at=[px_, py_, 44], facing=[0, 0, 1], reach=140))
    # the timeline: the years along the north wall, above the pictures
    tx, ty, tw, th = ROOMS['timeline']['rect']; x0, y0, x1, y1 = m(tx), -m(ty + th), m(tx + tw), -m(ty)
    cx = (x0 + x1) / 2
    brushes.append(brush(cx - 512, y1 - WALL / 2 - 4, 88, cx + 512, y1 - WALL / 2, 152, WALLTEX, faces={'-y': ('STRIP_YEARS', 1.0)}))
    # the signs: over each room's centre, on the ceiling side of the north wall
    for key, r in ROOMS.items():
        if not r['sign']: continue
        x, y, w, h = r['rect']; cx = m(x + w / 2); yy = -m(y) - WALL / 2
        tex = f"SIGN_{key.upper()}"[:15]
        brushes.append(brush(cx - 192, yy - 4, H - 40, cx + 192, yy, H - 8, WALLTEX, faces={'-y': (tex, 0.75)}))
    # lights and spawns
    for key, r in ROOMS.items():
        x, y, w, h = r['rect']
        for fx in (0.25, 0.75) if w > 100 else (0.5,):
            for fy in (0.25, 0.75) if h > 100 else (0.5,):
                bright = {'corridor': 120, 'recordings': 70, 'machine': 200}.get(key, 220)
                ents.append(f'{{\n"classname" "light"\n"origin" "{m(x + w * fx):.0f} {-m(y + h * fy):.0f} {H - 24}"\n"_light" "255 240 205 {bright}"\n}}')
    ex, ey, ew, eh = ROOMS['entrance']['rect']
    for i in range(6):
        ents.append(f'{{\n"classname" "info_player_start"\n"origin" "{m(ex + 20 + i * 18):.0f} {-m(ey + 40):.0f} 36"\n"angles" "0 90 0"\n}}')
    gx, gy, gw, gh = ROOMS['game']['rect']
    for i in range(6):
        ents.append(f'{{\n"classname" "info_player_deathmatch"\n"origin" "{m(gx + 40 + i * 30):.0f} {-m(gy + 40):.0f} 36"\n"angles" "0 180 0"\n}}')
    # the game's own labels: a trigger in front of every picture and thing, and one in every
    # doorway, each showing a line on the screen (game_text) — the museum's captions, in
    # the engine, with no plugin. hlviewer draws nothing for AAATRIGGER, so the same map serves both.
    def trig(x0, y0, z0, x1, y1, z1, target, wait=3):
        return f'{{\n"classname" "trigger_multiple"\n"target" "{target}"\n"wait" "{wait}"\n' + brush(x0, y0, z0, x1, y1, z1, 'AAATRIGGER') + '\n}'
    def text(name, message, y=0.78, hold=3):
        message = message.replace('"', "'")[:120]
        return f'{{\n"classname" "game_text"\n"targetname" "{name}"\n"message" "{message}"\n"x" "-1"\n"y" "{y}"\n"effect" "0"\n"color" "217 195 122"\n"color2" "232 226 207"\n"fadein" "0.2"\n"fadeout" "0.6"\n"holdtime" "{hold}"\n"channel" "2"\n}}'
    for i, pc in enumerate(placed):
        a = next(x for x in exhibits if x['id'] == pc['id'])
        ax, ay, _ = pc['at']; fx, fy = pc['facing'][0], pc['facing'][1]
        depth = 110
        if fy: ents.append(trig(ax - 96, min(ay, ay + fy * depth), 0, ax + 96, max(ay, ay + fy * depth), 96, f'lbl_{pc["id"]}'))
        else: ents.append(trig(min(ax, ax + fx * depth), ay - 96, 0, max(ax, ax + fx * depth), ay + 96, 96, f'lbl_{pc["id"]}'))
        line = ' · '.join(str(v) for v in (a['name'], a.get('family'), a.get('author'), a.get('year')) if v)
        ents.append(text(f'lbl_{pc["id"]}', line))
    for i, t in enumerate(things):
        ax, ay, _ = t['at']; fx, fy, fz = t['facing']; r = t.get('reach', 160)
        if fz: ents.append(trig(ax - r / 2, ay - r / 2, 0, ax + r / 2, ay + r / 2, 96, f'thing_{i}'))
        elif fy: ents.append(trig(ax - 140, min(ay, ay + fy * r), 0, ax + 140, max(ay, ay + fy * r), 96, f'thing_{i}'))
        else: ents.append(trig(min(ax, ax + fx * r), ay - 140, 0, max(ax, ax + fx * r), ay + 140, 96, f'thing_{i}'))
        ents.append(text(f'thing_{i}', t['label']))
    WALLS = {'entrance': 'A 2003 game, still playable, kept with everything people made for it.', 'game': 'Pick a name; the seats fill with bots.', 'maps': "Valve's own, the server's, and what the curators have hung.", 'models': 'Skins and weapons people made; wear one in your own game.', 'workshop': 'Where the museum is made.', 'recordings': 'Matches as they were played, replayed by the game itself.', 'machine': 'How a 2003 game runs in a browser tab.', 'timeline': '1996 to now, and where this museum sits on it.', 'world': 'The public servers still running today, asked directly.'}
    for d_ in doorways:
        a, b = d_['between']; x0, y0, x1, y1 = d_['rect']
        for room, side in ((a, -1), (b, 1)):
            if room not in WALLS: continue
            # a thin trigger just inside each room's side of the door, announcing that room
            rx, ry, rw, rh = ROOMS[room]['rect']; rcx, rcy = m(rx + rw / 2), -m(ry + rh / 2)
            if x1 - x0 < y1 - y0:   # a door in an x wall
                inside = x1 + 24 if rcx > x1 else x0 - 24
                ents.append(trig(min(inside, inside + (8 if rcx > x1 else -8)), y0, 0, max(inside, inside + (8 if rcx > x1 else -8)), y1, 96, f'room_{room}', wait=6))
            else:
                inside = y1 + 24 if rcy > y1 else y0 - 24
                ents.append(trig(x0, min(inside, inside + (8 if rcy > y1 else -8)), 0, x1, max(inside, inside + (8 if rcy > y1 else -8)), 96, f'room_{room}', wait=6))
    for room, sentence in WALLS.items():
        ents.append(text(f'room_{room}', f"{ROOMS[room]['name']}: {sentence}", y=0.12, hold=4))
    world = '{\n"classname" "worldspawn"\n"mapversion" "220"\n"wad" "cs_office.wad;cs_museum.wad"\n"message" "The Counter-Strike 1.6 museum"\n' + '\n'.join(brushes) + '\n}'
    mapfile = work / 'cs_museum.map'
    mapfile.write_text(world + '\n' + '\n'.join(ents) + '\n')
    (work / 'exhibits.json').write_text(json.dumps({'rooms': {k: dict(name=v['name'], rect=[m(v['rect'][0]), -m(v['rect'][1] + v['rect'][3]), m(v['rect'][0] + v['rect'][2]), -m(v['rect'][1])]) for k, v in ROOMS.items()}, 'doorways': doorways, 'pictures': placed, 'things': things, 'wall': WALL, 'eye': 60}, indent=1))
    print(f'{len(brushes)} brushes, {len(placed)} pictures hung, {len(ents)} entities → {mapfile}')

    # --- compile ----------------------------------------------------------------------------
    tools = Path(args.tools)
    wadcfg = work / 'wad.cfg'
    shutil.copy(out / 'wads' / 'cs_office.wad', work / 'cs_office.wad')
    env2 = dict(os.environ)
    base = str(work / 'cs_museum')
    # the screens glow: a texlight entry each, on top of the compiler's own list
    rad = work / 'lights.rad'
    rad.write_text((tools / 'lights.rad').read_text() + '\nSCREEN_HLTV\t235 235 255\t260\nSCREEN_XRAY\t235 235 255\t120\nPOSTER_CLIP\t255 240 205\t60\n')
    for tool, extra in (('sdHLCSG', ['-nowadtextures', '-wadautodetect']), ('sdHLBSP', []), ('sdHLVIS', ['-fast']), ('sdHLRAD', ['-lights', str(rad)])):
        if tool == 'sdHLRAD' and args.no_rad: continue
        r = subprocess.run([str(tools / tool), *extra, base], cwd=work, capture_output=True, text=True, env=env2)
        tail = r.stdout.strip().splitlines()[-3:]
        print(f'{tool}: exit {r.returncode}  ' + ' | '.join(tail))
        if r.returncode != 0:
            print(r.stdout[-3000:], r.stderr[-1500:]); return 1
    shutil.copy(work / 'cs_museum.bsp', out / 'maps' / 'cs_museum.bsp')
    print(f'{out}/maps/cs_museum.bsp: {(out / "maps" / "cs_museum.bsp").stat().st_size // 1024} KB')
    return 0


def write_wad(textures: dict, path: Path) -> Path:
    """A WAD3 of 8-bit miptex: each image quantised to 256 colours, four mips."""
    lumps, blob = [], bytearray(b'WAD3' + b'\0' * 8)
    for name, im in textures.items():
        w, h = im.size
        q = im.quantize(256, method=Image.Quantize.MEDIANCUT)
        pal = q.getpalette()[:768]; pal += [0] * (768 - len(pal))
        mips = [q.tobytes()]
        for level in (2, 4, 8):
            mips.append(im.resize((w // level, h // level)).quantize(palette=q).tobytes())
        header = struct.pack('<16sii', name.encode('latin1')[:15].ljust(16, b'\0'), w, h)
        off = 40; offs = []
        for mp in mips: offs.append(off); off += len(mp)
        data = header + struct.pack('<4i', *offs) + b''.join(mips) + struct.pack('<H', 256) + bytes(pal) + b'\0\0'
        lumps.append((len(blob), len(data), name)); blob += data
    infotable = len(blob)
    for pos, size, name in lumps:
        blob += struct.pack('<iiiBBH16s', pos, size, size, 0x43, 0, 0, name.encode('latin1')[:15].ljust(16, b'\0'))
    struct.pack_into('<ii', blob, 4, len(lumps), infotable)
    path.write_bytes(blob)
    return path


if __name__ == '__main__':
    sys.exit(main())
