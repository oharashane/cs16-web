// Reading a GoldSrc recording in the browser: the header, the directory, the frames, and
// the server's opening messages — its greeting, the delta descriptions it sends (which
// are how the whole protocol compresses itself), the files it precached, the mod's user
// messages. The same walk as relay/demoinfo.go, ported so a dropped file needs no server.

export type Section = { type: number; description: string; seconds: number; frames: number; offset: number; length: number; counts: number[]; commands: string[]; sounds: string[]; path: [number, number][]; netBytes: number };
export type DeltaField = { name: string; bits: number; divisor: number; flags: number };
export type Resource = { kind: string; path: string; index: number; bytes: number };
export type Demo = {
    demoProtocol: number; protocol: number; map: string; game: string; bytes: number;
    sections: Section[]; seconds: number; frames: number;
    server?: string; mapFile?: string; maxPlayers?: number; slot?: number; build?: number; hltv?: boolean;
    recorder?: string; recorderInfo?: string; gravity?: number; maxSpeed?: number; sky?: string;
    deltas: Record<string, DeltaField[]>; resources: Resource[]; userMessages: string[]; parsedUpTo?: string;
};

export const FRAME_KINDS = ['netmsg (loading)', 'netmsg', 'demo start', 'command', 'client data', 'next section', 'event', 'weapon anim', 'sound', 'demo buffer'];
const RESOURCE_KINDS = ['sound', 'skin', 'model', 'decal', 'generic', 'event', 'world'];
export const DT = { BYTE: 1, SHORT: 2, FLOAT: 4, INTEGER: 8, ANGLE: 16, TIMEWINDOW_8: 32, TIMEWINDOW_BIG: 64, STRING: 128, SIGNED: 1 << 31 };
export const typeName = (flags: number) => flags & DT.STRING ? 'string' : flags & DT.ANGLE ? 'angle' : flags & DT.FLOAT ? 'float' : flags & DT.INTEGER ? 'int' : flags & DT.SHORT ? 'short' : flags & DT.BYTE ? 'byte' : flags & (DT.TIMEWINDOW_8 | DT.TIMEWINDOW_BIG) ? 'time' : '?';

/** A GoldSrc bit stream: least significant bit of each byte first. */
export class BitReader {
    constructor(public b: Uint8Array, public pos = 0) {}
    get eof() { return this.pos >= this.b.length * 8; }
    read(n: number): number {
        let v = 0;
        for (let i = 0; i < n; i++) {
            const at = this.pos >> 3;
            if (at >= this.b.length) { this.pos = this.b.length * 8; return v >>> 0; }
            if (this.b[at] & (1 << (this.pos & 7))) v |= 1 << i;
            this.pos++;
        }
        return v >>> 0;
    }
    str(): string { let s = ''; while (!this.eof) { const c = this.read(8); if (!c) break; s += String.fromCharCode(c); } return s; }
}

/** One delta-encoded struct: a mask of which fields follow, then those fields. */
export function readDelta(r: BitReader, fields: DeltaField[]): Record<string, number | string> {
    const out: Record<string, number | string> = {};
    const maskBytes = r.read(3);
    const masks: number[] = [];
    for (let i = 0; i < maskBytes; i++) masks.push(r.read(8));
    for (let i = 0; i < maskBytes; i++) for (let j = 0; j < 8; j++) {
        const index = i * 8 + j;
        if (index >= fields.length) return out;
        if (!(masks[i] & (1 << j))) continue;
        const d = fields[index], divisor = d.divisor || 1;
        if (d.flags & DT.STRING) out[d.name] = r.str();
        else if (d.flags & DT.ANGLE) out[d.name] = r.read(d.bits) * 360 / (2 ** d.bits);
        else if (d.flags & DT.SIGNED) { const sign = r.read(1) ? -1 : 1; out[d.name] = sign * r.read(d.bits - 1) / divisor; }
        else out[d.name] = r.read(d.bits) / divisor;
    }
    return out;
}
const DELTA_META: DeltaField[] = [
    { name: 'flags', bits: 32, divisor: 1, flags: DT.INTEGER },
    { name: 'name', bits: 8, divisor: 1, flags: DT.STRING },
    { name: 'offset', bits: 16, divisor: 1, flags: DT.INTEGER },
    { name: 'size', bits: 8, divisor: 1, flags: DT.INTEGER },
    { name: 'bits', bits: 8, divisor: 1, flags: DT.INTEGER },
    { name: 'divisor', bits: 32, divisor: 4000, flags: DT.FLOAT },
    { name: 'preMultiplier', bits: 32, divisor: 4000, flags: DT.FLOAT },
];

class Bytes {
    pos = 0; failed = false;
    dv: DataView;
    constructor(public b: Uint8Array) { this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength); }
    get eof() { return this.pos >= this.b.length; }
    need(n: number) { if (this.pos + n > this.b.length) { this.failed = true; this.pos = this.b.length; return false; } return true; }
    u8() { return this.need(1) ? this.b[this.pos++] : 0; }
    u16() { if (!this.need(2)) return 0; const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v; }
    i32() { if (!this.need(4)) return 0; const v = this.dv.getInt32(this.pos, true); this.pos += 4; return v; }
    f32() { if (!this.need(4)) return 0; const v = this.dv.getFloat32(this.pos, true); this.pos += 4; return v; }
    skip(n: number) { if (this.need(n)) this.pos += n; }
    take(n: number) { if (!this.need(n)) return new Uint8Array(0); const v = this.b.subarray(this.pos, this.pos + n); this.pos += n; return v; }
    str() { const start = this.pos; while (this.pos < this.b.length && this.b[this.pos]) this.pos++; const s = cstr(this.b.subarray(start, this.pos)); if (this.pos < this.b.length) this.pos++; else this.failed = true; return s; }
}
const cstr = (b: Uint8Array) => { let s = ''; for (const c of b) { if (!c) break; s += String.fromCharCode(c); } return s; };
const infoValue = (info: string, key: string) => { const p = info.split('\\'); for (let i = 1; i + 1 < p.length; i += 2) if (p[i] === key) return p[i + 1]; return ''; };

export function parseDemo(buf: ArrayBuffer): Demo {
    const b = new Uint8Array(buf), dv = new DataView(buf);
    if (cstr(b.subarray(0, 6)) !== 'HLDEMO') throw new Error('not a GoldSrc demo (no HLDEMO magic)');
    const d: Demo = {
        demoProtocol: dv.getInt32(8, true), protocol: dv.getInt32(12, true),
        map: cstr(b.subarray(16, 276)), game: cstr(b.subarray(276, 536)), bytes: buf.byteLength,
        sections: [], seconds: 0, frames: 0, deltas: {}, resources: [], userMessages: [],
    };
    if (d.demoProtocol !== 5) throw new Error(`demo protocol ${d.demoProtocol}; 5 is the one we know`);
    const dirOffset = dv.getInt32(540, true);
    const n = dv.getInt32(dirOffset, true);
    if (n < 1 || n > 1024) throw new Error(`${n} directory entries`);
    for (let i = 0; i < n; i++) {
        const o = dirOffset + 4 + i * 92;
        const s: Section = { type: dv.getInt32(o, true), description: cstr(b.subarray(o + 4, o + 68)), seconds: dv.getFloat32(o + 76, true), frames: dv.getInt32(o + 80, true), offset: dv.getInt32(o + 84, true), length: dv.getInt32(o + 88, true), counts: new Array(10).fill(0), commands: [], sounds: [], path: [], netBytes: 0 };
        const payloads: Uint8Array[] = [];
        walk(b, dv, s, s.type === 0 ? payloads : null);
        d.sections.push(s);
        if (s.type !== 0) { d.seconds += s.seconds; d.frames += s.frames; }
        else if (payloads.length) { try { loading(d, concat(payloads)); } catch (e) { d.parsedUpTo = String((e as Error).message ?? e); } }
    }
    return d;
}
const concat = (parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };

function walk(b: Uint8Array, dv: DataView, s: Section, payloads: Uint8Array[] | null) {
    let pos = s.offset; const end = Math.min(s.offset + s.length, b.length);
    const seenCmd = new Set<string>(), seenSnd = new Set<string>();
    let sample = 0;
    while (pos + 9 <= end) {
        const kind = b[pos]; pos += 9;
        if (kind < 10) s.counts[kind]++;
        switch (kind) {
            case 0: case 1: {
                if (sample++ % 4 === 0 && pos + 24 <= end) s.path.push([dv.getFloat32(pos + 4, true), dv.getFloat32(pos + 8, true)]);
                const len = dv.getInt32(pos + 436 + 28, true);
                if (len < 0 || pos + 436 + 32 + len > end + 64) return;
                s.netBytes += len;
                if (payloads && len > 0) payloads.push(b.subarray(pos + 436 + 32, pos + 436 + 32 + len));
                pos += 436 + 28 + 4 + len; break;
            }
            case 3: { const c = cstr(b.subarray(pos, pos + 64)).trim(); if (c && !seenCmd.has(c) && s.commands.length < 300) { seenCmd.add(c); s.commands.push(c); } pos += 64; break; }
            case 4: pos += 32; break;
            case 6: pos += 84; break;
            case 7: pos += 8; break;
            case 8: { const len = dv.getInt32(pos + 4, true); if (len < 0 || len > 4096) return; const name = cstr(b.subarray(pos + 8, pos + 8 + len)); if (name && !seenSnd.has(name) && s.sounds.length < 300) { seenSnd.add(name); s.sounds.push(name); } pos += 8 + len + 16; break; }
            case 9: { const len = dv.getInt32(pos, true); if (len < 0) return; pos += 4 + len; break; }
            case 2: case 5: break;
            default: return;
        }
        if (kind === 5) return;
    }
}

/** The server's opening messages, to the resource list. */
function loading(d: Demo, stream: Uint8Array) {
    const r = new Bytes(stream);
    d.deltas['delta_description_t'] = DELTA_META;
    while (!r.eof) {
        const at = r.pos, id = r.u8();
        switch (id) {
            case 1: break;                                            // nop
            case 4: r.i32(); break;                                   // version
            case 5: r.skip(2); break;                                 // setview
            case 7: r.f32(); break;                                   // time
            case 8: { const s = r.str(); if (s.includes('(HLTV)')) d.hltv = true; const i = s.indexOf('BUILD '); if (i >= 0) d.build = parseInt(s.slice(i + 6), 10) || undefined; break; }
            case 9: r.str(); break;                                   // stufftext
            case 11:                                                  // serverinfo
                r.i32(); r.i32(); r.i32(); r.skip(16);
                d.maxPlayers = r.u8(); d.slot = r.u8(); r.u8();
                r.str(); d.server = r.str(); d.mapFile = r.str(); r.str();
                if (r.u8()) r.skip(21);
                break;
            case 12: r.u8(); r.str(); break;                          // lightstyle
            case 13: { const slot = r.u8(); r.i32(); const info = r.str(); r.skip(16); if (slot === d.slot && !d.recorder) { d.recorderInfo = info; d.recorder = infoValue(info, 'name'); } break; }
            case 14: {                                                // deltadescription
                const name = r.str(), count = r.u16();
                const bits = new BitReader(stream, r.pos * 8);
                const fields: DeltaField[] = [];
                for (let i = 0; i < count && !bits.eof; i++) {
                    const v = readDelta(bits, DELTA_META);
                    fields.push({ name: String(v.name ?? '?'), bits: Number(v.bits ?? 0), divisor: Number(v.divisor ?? 1), flags: Number(v.flags ?? 0) });
                }
                d.deltas[name] = fields;
                r.pos = Math.ceil(bits.pos / 8);
                break;
            }
            case 24: case 25: r.u8(); break;                          // setpause, signonnum
            case 29: r.skip(11); break;                               // spawnstaticsound
            case 32: r.skip(2); break;                                // cdtrack
            case 39: { r.u8(); r.u8(); d.userMessages.push(cstr(r.take(16))); break; }
            case 43: {                                                // resourcelist
                const bits = new BitReader(stream, r.pos * 8);
                const count = bits.read(12);
                for (let i = 0; i < count && !bits.eof; i++) {
                    const kind = bits.read(4);
                    const res: Resource = { kind: RESOURCE_KINDS[kind] ?? `type${kind}`, path: bits.str(), index: bits.read(12), bytes: bits.read(24) };
                    const flags = bits.read(3);
                    if (flags & 4) bits.pos += 128;
                    if (bits.read(1)) bits.pos += 256;
                    d.resources.push(res);
                }
                return;                                               // everything worth having is read
            }
            case 44:                                                  // newmovevars
                d.gravity = r.f32(); r.f32(); d.maxSpeed = r.f32();
                r.skip(4 * 13); r.u8(); r.skip(4 * 2); r.skip(4 * 3); r.skip(4 * 3);
                d.sky = r.str(); break;
            case 45: r.i32(); r.i32(); break;                         // resourcerequest
            case 46: { r.u8(); r.u8(); r.str(); r.skip(2); r.i32(); if (r.u8() & 4) r.skip(16); break; }
            case 50: { if (r.u8() === 0) d.hltv = true; else { d.parsedUpTo = `svc_hltv at byte ${at}`; return; } break; }
            case 51: r.skip(r.u8()); break;                           // director
            case 52: { r.str(); if (d.protocol >= 47) r.u8(); break; } // voiceinit
            case 54: { r.str(); r.u8(); break; }                      // sendextrainfo
            case 55: r.f32(); break;
            case 56: case 57: r.str(); break;
            case 58: { r.i32(); r.str(); break; }
            default: d.parsedUpTo = `svc ${id} at byte ${at}`; return;
        }
        if (r.failed) { d.parsedUpTo = `truncated in svc ${id}`; return; }
    }
}
