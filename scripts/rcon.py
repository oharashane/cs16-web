#!/usr/bin/env python3
"""One rcon command to a server on this machine, answer on stdout.

    scripts/rcon.py 27015 status
    scripts/rcon.py 27015 'sv_gravity 200'

The password is read from cs-server/.env (RCON_PASSWORD) and never printed or taken as an
argument, so it stays off command lines and out of transcripts. Only servers on
127.0.0.1 are reachable; that is the point of it.
"""
import pathlib
import re
import socket
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def password() -> str:
    for line in (ROOT / 'cs-server' / '.env').read_text().splitlines():
        if line.startswith('RCON_PASSWORD='):
            return line.split('=', 1)[1].strip()
    raise SystemExit('cs-server/.env has no RCON_PASSWORD')


def rcon(port: int, command: str, timeout: float = 3.0) -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    s.sendto(b'\xff\xff\xff\xffchallenge rcon\n', ('127.0.0.1', port))
    data, _ = s.recvfrom(4096)
    m = re.search(rb'challenge rcon (\d+)', data)
    if not m:
        raise SystemExit(f'port {port} did not offer an rcon challenge')
    s.sendto(b'\xff\xff\xff\xffrcon %s "%s" %s\n' % (m.group(1), password().encode(), command.encode()), ('127.0.0.1', port))
    parts = []
    try:
        while True:
            data, _ = s.recvfrom(65535)
            parts.append(data)
            s.settimeout(0.4)   # the answer can span packets; wait a little for the rest
    except socket.timeout:
        pass
    # ReHLDS 3.15 ends an answer with NUL bytes, which make grep treat the text as binary.
    return b''.join(p[5:] if p.startswith(b'\xff\xff\xff\xffl') else p for p in parts).decode('latin1').replace('\0', '')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    sys.stdout.write(rcon(int(sys.argv[1]), sys.argv[2]))
