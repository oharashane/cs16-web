#!/usr/bin/env python3
"""Raise the engine's fixed wasm heap.

The published engine was built without ALLOW_MEMORY_GROWTH: xash.wasm declares its memory
as 4096 pages minimum and 4096 maximum — 256 MB, fixed for the life of the tab, and
_emscripten_resize_heap does nothing but abort("OOM"). The engine also leaks about 50 KB
of its "Network Pool" for every datagram it receives (measured 7 September 2026: 64 MB a
minute of ordinary play), so that ceiling is reached after three or four minutes and the
game dies with Aborted(OOM).

Raising the ceiling does not fix the leak; it buys time between reconnects, which is what
main.ts's watchdog uses. The side modules import env.memory with no maximum of their own,
so only this one number matters.

This runs over node_modules before the build, not over dist after it: Vite names the file
by the hash of its contents and the relay serves hashed names as immutable, so patching
afterwards would leave every browser that had already visited holding the old engine for
ever. Patch first, and the new engine arrives under a new name.

The memory section is rebuilt rather than edited in place, so any size up to the wasm32
limit works — 1024 MB and above need a longer LEB128 field than 256 MB did, and the
section's own length field grows with it.
"""
import sys, pathlib

PAGE = 64 * 1024

def leb(b, i):
    value = shift = 0
    while True:
        byte = b[i]; i += 1
        value |= (byte & 0x7F) << shift; shift += 7
        if not byte & 0x80:
            return value, i

def encode(value):
    """LEB128, as short as it goes."""
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | 0x80 if value else byte)
        if not value:
            return bytes(out)


def memory_section(data):
    """(section start, payload start, payload end, initial, maximum) of the module's own
    memory limits — enough to rewrite the section and its length."""
    i = 8
    while i < len(data):
        section_start = i
        section = data[i]; i += 1
        size, i = leb(data, i)
        payload, end = i, i + size
        if section == 5:
            _, j = leb(data, payload)        # one memory
            flags, j = leb(data, j)
            initial, j = leb(data, j)
            maximum = None
            if flags & 1:
                maximum, j = leb(data, j)
            return section_start, payload, end, initial, maximum
        i = end
    return None

def main(path, megabytes):
    data = bytearray(pathlib.Path(path).read_bytes())
    if data[:4] != b"\0asm":
        raise SystemExit(f"{path} is not a wasm module")
    found = memory_section(data)
    if not found:
        raise SystemExit(f"{path} declares no memory of its own")
    section_start, payload, end, initial, maximum = found
    pages = megabytes * 1024 * 1024 // PAGE
    if pages > 32768:
        # Above two gigabytes a wasm32 pointer no longer fits in a signed 32-bit integer,
        # and C written before anyone tried is full of signed pointer arithmetic.
        raise SystemExit("2048 MB is the most a wasm32 module can be given safely")
    print(f"{path}: {initial} pages ({initial * PAGE // 2**20} MB) → {pages} pages ({megabytes} MB)")
    if initial == pages:
        print("  already there"); return
    # The whole section, rebuilt: one memory, its flags, and its limits.
    flags = 1 if maximum is not None else 0
    body = bytes([1]) + bytes([flags]) + encode(pages) + (encode(pages) if maximum is not None else b"")
    section = bytes([5]) + encode(len(body)) + body
    data[section_start:end] = section
    pathlib.Path(path).write_bytes(bytes(data))
    print("  patched")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: patch-wasm-heap.py <xash.wasm|directory> <megabytes>")
    target, megabytes = pathlib.Path(sys.argv[1]), int(sys.argv[2])
    if target.is_dir():
        # Vite writes the engine under a hashed name, and rewrites it on every build, so
        # the build runs this over the whole directory rather than naming a file.
        patched = 0
        for wasm in sorted(target.glob("*.wasm")):
            data = wasm.read_bytes()
            if data[:4] == b"\0asm" and memory_section(bytearray(data)):
                main(str(wasm), megabytes); patched += 1
        if not patched:
            raise SystemExit(f"no module in {target} declares a memory of its own")
    else:
        main(str(target), megabytes)
