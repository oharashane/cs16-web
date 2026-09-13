#!/usr/bin/env python3
"""
What an aimbot looks like in a recording: the view angles frame by frame.

    scripts/aim-signature.py web/bench/out/control.dem web/bench/out/aimbot.dem content/demos/*.dem

Every netmsg frame of a GoldSrc demo carries the client's view angles for that frame
(ref_params.viewangles) and the usercmd it sent. A person turns along a curve: many small
yaw changes, few large ones, and the large ones ramp up and down. An aimbot jumps: the yaw
changes by a large amount in one frame and then hardly at all while it tracks. The
numbers here are that shape: how often the yaw did not move at all, the share of frames
with a turn over 10 degrees, the biggest single-frame turn, and how "smooth" the turning
was — the ratio of the biggest jump to the median non-zero one.
"""
import struct, sys, math
from pathlib import Path


def frames(path: Path):
    b = path.read_bytes()
    if b[:6] != b'HLDEMO':
        return
    dir_offset = struct.unpack_from('<i', b, 540)[0]
    count = struct.unpack_from('<i', b, dir_offset)[0]
    for i in range(count):
        e = dir_offset + 4 + i * 92
        kind, offset, length = struct.unpack_from('<i', b, e)[0], struct.unpack_from('<i', b, e + 84)[0], struct.unpack_from('<i', b, e + 88)[0]
        if kind == 0:
            continue
        pos, end = offset, min(offset + length, len(b))
        while pos + 9 <= end:
            k = b[pos]; pos += 9
            if k in (0, 1):
                if pos + 436 + 32 > end:
                    return
                view = struct.unpack_from('<3f', b, pos + 16)      # ref_params.viewangles: pitch, yaw, roll
                cmd = struct.unpack_from('<3f', b, pos + 4 + 236 + 4)   # usercmd.viewangles
                yield view, cmd
                n = struct.unpack_from('<i', b, pos + 436 + 28)[0]
                if n < 0:
                    return
                pos += 436 + 32 + n
            elif k == 3: pos += 64
            elif k == 4: pos += 32
            elif k == 6: pos += 84
            elif k == 7: pos += 8
            elif k == 8:
                n = struct.unpack_from('<i', b, pos + 4)[0]; pos += 8 + n + 16
            elif k == 9:
                n = struct.unpack_from('<i', b, pos)[0]; pos += 4 + n
            elif k == 5:
                break
            elif k == 2:
                pass
            else:
                return


def wrap(d: float) -> float:
    return (d + 180.0) % 360.0 - 180.0


def yaws_of(path: Path) -> list[float]:
    """A GoldSrc recording's view yaw per frame, or the lab's aim log (mm_aimlog: time,pitch,yaw,buttons) per command."""
    if path.suffix.lower() == '.csv':
        out = []
        for line in path.read_text().splitlines():
            parts = line.split(',')
            if len(parts) >= 3:
                try: out.append(float(parts[2]))
                except ValueError: pass
        return out
    return [v[1] for v, _ in frames(path)]


def signature(path: Path) -> dict | None:
    yaws = yaws_of(path)
    if len(yaws) < 50:
        return None
    deltas = [abs(wrap(b - a)) for a, b in zip(yaws, yaws[1:])]
    deltas = [d for d in deltas if d < 150.0]   # a spawn or a spectator's camera jump, not a turn
    nonzero = sorted(d for d in deltas if d > 0.01)
    big = sum(1 for d in deltas if d > 10.0)
    med = nonzero[len(nonzero) // 2] if nonzero else 0.0
    # The shape of a turn: a person's big turns are preceded and followed by smaller ones
    # (the hand accelerates and slows); an aimbot's are preceded and followed by nothing.
    lonely = 0
    for i, d in enumerate(deltas):
        if d > 10.0:
            before = deltas[i - 1] if i > 0 else 0.0
            after = deltas[i + 1] if i + 1 < len(deltas) else 0.0
            if before < 1.0 and after < 1.0:
                lonely += 1
    return {
        'frames': len(yaws), 'still': sum(1 for d in deltas if d <= 0.01) / len(deltas),
        'over10': big / len(deltas), 'max': max(deltas), 'median_move': med,
        'jump_ratio': (max(deltas) / med) if med else float('inf'),
        'lonely': (lonely / big) if big else 0.0,
    }


def main() -> int:
    print(f"{'recording':34} {'frames':>7} {'still':>6} {'>10°/frame':>10} {'max °':>7} {'median °':>9} {'jump ratio':>10} {'lonely jumps':>12}")
    for arg in sys.argv[1:]:
        p = Path(arg)
        s = signature(p)
        if not s:
            print(f'{p.name:34} not a readable GoldSrc recording'); continue
        print(f"{p.name:34} {s['frames']:7d} {s['still']:6.0%} {s['over10']:10.2%} {s['max']:7.1f} {s['median_move']:9.2f} {s['jump_ratio']:10.0f} {s['lonely']:12.0%}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
