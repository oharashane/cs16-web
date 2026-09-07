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

The new page count must encode as the same number of LEB128 bytes as the old one, so that
no section length changes: 4096 encodes in two bytes, and so does anything up to 16383.
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

def encode(value, width):
    out = bytearray()
    while True:
        byte = value & 0x7F; value >>= 7
        if value: out.append(byte | 0x80)
        else:
            out.append(byte); break
    if len(out) != width:
        raise SystemExit(f"{value} needs {len(out)} LEB bytes, not {width}; pick another size")
    return bytes(out)

def memory_section(data):
    """(offset, initial, maximum, width) of the module's own memory limits."""
    i = 8
    while i < len(data):
        section = data[i]; i += 1
        size, i = leb(data, i)
        end = i + size
        if section == 5:
            _, j = leb(data, i)              # one memory
            flags, j = leb(data, j)
            start = j
            initial, j = leb(data, j)
            width = j - start
            maximum = None
            if flags & 1:
                maximum, j = leb(data, j)
            return start, initial, maximum, width
        i = end
    return None

def main(path, megabytes):
    data = bytearray(pathlib.Path(path).read_bytes())
    if data[:4] != b"\0asm":
        raise SystemExit(f"{path} is not a wasm module")
    found = memory_section(data)
    if not found:
        raise SystemExit(f"{path} declares no memory of its own")
    offset, initial, maximum, width = found
    pages = megabytes * 1024 * 1024 // PAGE
    print(f"{path}: {initial} pages ({initial * PAGE // 2**20} MB), max {maximum} → {pages} pages ({megabytes} MB)")
    if initial == pages:
        print("  already there"); return
    new = encode(pages, width)
    data[offset:offset + width] = new
    if maximum is not None:
        data[offset + width:offset + 2 * width] = new
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
