package main

// What a GoldSrc demo says about itself, read without the engine: the header and the
// directory (map, game, protocol, sections, length), the loading section's messages up
// to the resource list (the server's name and settings, the recorder, the mod's user
// messages, every model, sound, sprite, event and decal the server precached — and
// which of those we do not have), and a scan of the playback section for the client-side
// frames: what the recorder typed and the sounds their client played. Layouts as in
// hlviewer.js and hldemo-rs; the engine's reader (patch 0005) agrees with them.

import (
	"archive/zip"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type demoSection struct {
	Type        int32   `json:"type"` // 0 loading, 1 playback
	Description string  `json:"description"`
	Seconds     float32 `json:"seconds"`
	Frames      int32   `json:"frames"`
	Bytes       int32   `json:"bytes"`
}

type demoResource struct {
	Kind    string `json:"kind"` // sound, skin, model, decal, generic, event, world
	Path    string `json:"path"`
	Index   int    `json:"index"`
	Bytes   int    `json:"bytes,omitempty"`
	Missing bool   `json:"missing,omitempty"` // in neither the server's content nor the Steam base
	Shared  bool   `json:"shared,omitempty"`  // in the server's content (cs-server/shared), not the Steam base: a page fetches it from /raw
}

type demoInfo struct {
	Name         string    `json:"name"`
	Bytes        int64     `json:"bytes"`
	Modified     time.Time `json:"modified"`
	Map          string    `json:"map,omitempty"`
	Game         string    `json:"game,omitempty"`
	Protocol     int32     `json:"protocol,omitempty"`
	DemoProtocol int32     `json:"demoProtocol,omitempty"`
	Problem      string    `json:"problem,omitempty"`

	Sections []demoSection `json:"sections,omitempty"`
	Seconds  float64       `json:"seconds"` // the playback sections' own length
	Frames   int64         `json:"frames"`

	// The loading section
	HLTV           bool           `json:"hltv"` // a spectator's recording (HLTV), not a player's
	Server         string         `json:"server,omitempty"`
	MapFile        string         `json:"mapFile,omitempty"`
	MapCycle       string         `json:"mapCycle,omitempty"`
	MaxPlayers     int            `json:"maxPlayers,omitempty"`
	Slot           int            `json:"slot"`
	Build          int            `json:"build,omitempty"` // the server's build number, from its greeting
	Fallback       string         `json:"fallback,omitempty"`
	Cheats         bool           `json:"cheats,omitempty"`
	Recorder       string         `json:"recorder,omitempty"`
	RecorderInfo   string         `json:"recorderInfo,omitempty"`
	Gravity        float32        `json:"gravity,omitempty"`
	MaxSpeed       float32        `json:"maxSpeed,omitempty"`
	Sky            string         `json:"sky,omitempty"`
	UserMessages   []string       `json:"userMessages,omitempty"`
	Resources      []demoResource `json:"resources,omitempty"`
	ResourceCount  int            `json:"resourceCount,omitempty"` // the list carries the count, the detail the list
	ResourceCounts map[string]int `json:"resourceCounts,omitempty"`
	Missing        int            `json:"missing"`
	MapMissing     bool           `json:"mapMissing"`           // the map itself is nowhere we can serve it from; set at listing time, not cached
	ParsedUpTo     string         `json:"parsedUpTo,omitempty"` // where the message parse stopped, if before the resource list

	// The playback section's client-side frames
	FrameTypes   map[string]int64 `json:"frameTypes,omitempty"`
	Commands     []string         `json:"commands,omitempty"`     // what the recorder typed, unique, in order
	ClientSounds []string         `json:"clientSounds,omitempty"` // sounds the recorder's own client played
	NetBytes     int64            `json:"netBytes"`
}

var frameTypeNames = [...]string{"netmsg-loading", "netmsg", "demostart", "command", "clientdata", "nextsection", "event", "weaponanim", "sound", "demobuffer"}

var resourceKinds = [...]string{"sound", "skin", "model", "decal", "generic", "event", "world"}

const hldemoHeaderSize = 8 + 4 + 4 + 260 + 260 + 4 + 4
const hldemoEntrySize = 4 + 64 + 4 + 4 + 4 + 4 + 4 + 4
const hldemoInfoSize = 436

// ---- the file -------------------------------------------------------------------------

// readDemoInfo reads everything above from one file. A file that is not a demo comes back
// with Problem set and the rest empty; a demo that stops parsing early says where.
func readDemoInfo(path string, have haveFunc) demoInfo {
	info := demoInfo{Name: filepath.Base(path)}
	st, err := os.Stat(path)
	if err != nil {
		info.Problem = err.Error()
		return info
	}
	info.Bytes, info.Modified = st.Size(), st.ModTime()

	f, err := os.Open(path)
	if err != nil {
		info.Problem = err.Error()
		return info
	}
	defer f.Close()

	var header [hldemoHeaderSize]byte
	got, _ := io.ReadFull(f, header[:])
	if got < 6 || string(header[:6]) != "HLDEMO" {
		info.Problem = "not a GoldSrc demo (no HLDEMO magic)"
		return info
	}
	if got < hldemoHeaderSize {
		info.Problem = "too short to be a demo"
		return info
	}
	le32 := func(b []byte) int32 { return int32(binary.LittleEndian.Uint32(b)) }
	info.DemoProtocol = le32(header[8:12])
	info.Protocol = le32(header[12:16])
	info.Map = cstring(header[16 : 16+260])
	info.Game = cstring(header[276 : 276+260])
	dirOffset := le32(header[540:544])
	if info.DemoProtocol != 5 {
		info.Problem = fmt.Sprintf("demo protocol %d; 5 is the one we know", info.DemoProtocol)
		return info
	}
	if info.Protocol < 46 || info.Protocol > 48 {
		info.Problem = fmt.Sprintf("net protocol %d; 46 to 48 are the ones we know", info.Protocol)
	}

	// the directory
	if dirOffset <= 0 || int64(dirOffset)+4 > st.Size() {
		info.Problem = "directory offset outside the file"
		return info
	}
	var count [4]byte
	if _, err := f.ReadAt(count[:], int64(dirOffset)); err != nil {
		info.Problem = "cannot read the directory"
		return info
	}
	n := le32(count[:])
	if n < 1 || n > 1024 {
		info.Problem = fmt.Sprintf("%d directory entries", n)
		return info
	}
	entries := make([]byte, int(n)*hldemoEntrySize)
	if _, err := f.ReadAt(entries, int64(dirOffset)+4); err != nil {
		info.Problem = "directory truncated"
		return info
	}
	for i := 0; i < int(n); i++ {
		e := entries[i*hldemoEntrySize : (i+1)*hldemoEntrySize]
		s := demoSection{Type: le32(e[0:4]), Description: cstring(e[4:68]),
			Seconds: math.Float32frombits(binary.LittleEndian.Uint32(e[76:80])), Frames: le32(e[80:84])}
		offset, length := le32(e[84:88]), le32(e[88:92])
		s.Bytes = length
		info.Sections = append(info.Sections, s)
		if s.Type != 0 {
			info.Seconds += float64(s.Seconds)
			info.Frames += int64(s.Frames)
		}
		if int64(offset) < hldemoHeaderSize || int64(offset)+int64(length) > st.Size() {
			info.Problem = fmt.Sprintf("section %d lies outside the file", i)
			return info
		}
		if s.Type == 0 {
			info.parseLoading(f, int64(offset), int64(offset)+int64(length), have)
		} else {
			info.scanPlayback(f, int64(offset), int64(offset)+int64(length))
		}
	}
	return info
}

func cstring(b []byte) string {
	if i := strings.IndexByte(string(b), 0); i >= 0 {
		return string(b[:i])
	}
	return string(b)
}

// ---- the frames -----------------------------------------------------------------------

// walkFrames calls fn for every frame between start and end with its type, time and
// payload (the whole message for a netmsg frame, after the client state and sequences),
// and returns when fn says stop or the section ends.
func walkFrames(f io.ReadSeeker, start, end int64, fn func(kind byte, when float32, payload []byte) bool) {
	pos := start
	var hdr [9]byte
	for pos+9 <= end {
		if _, err := f.Seek(pos, io.SeekStart); err != nil {
			return
		}
		if _, err := io.ReadFull(f, hdr[:]); err != nil {
			return
		}
		kind := hdr[0]
		when := math.Float32frombits(binary.LittleEndian.Uint32(hdr[1:5]))
		pos += 9
		var payload []byte
		switch kind {
		case 0, 1:
			var lenb [4]byte
			if _, err := f.Seek(pos+hldemoInfoSize+28, io.SeekStart); err != nil {
				return
			}
			if _, err := io.ReadFull(f, lenb[:]); err != nil {
				return
			}
			n := int64(int32(binary.LittleEndian.Uint32(lenb[:])))
			if n < 0 || n > 1<<20 {
				return
			}
			payload = make([]byte, n)
			if _, err := io.ReadFull(f, payload); err != nil {
				return
			}
			pos += hldemoInfoSize + 28 + 4 + n
		case 2, 5:
		case 3:
			payload = make([]byte, 64)
			if _, err := io.ReadFull(f, payload); err != nil {
				return
			}
			pos += 64
		case 4:
			pos += 32
		case 6:
			pos += 84
		case 7:
			pos += 8
		case 8:
			var head [8]byte
			if _, err := io.ReadFull(f, head[:]); err != nil {
				return
			}
			n := int64(int32(binary.LittleEndian.Uint32(head[4:8])))
			if n < 0 || n > 4096 {
				return
			}
			payload = make([]byte, n)
			if _, err := io.ReadFull(f, payload); err != nil {
				return
			}
			pos += 8 + n + 16
		case 9:
			var lenb [4]byte
			if _, err := io.ReadFull(f, lenb[:]); err != nil {
				return
			}
			n := int64(int32(binary.LittleEndian.Uint32(lenb[:])))
			if n < 0 || n > 1<<24 {
				return
			}
			pos += 4 + n
		default:
			return
		}
		if !fn(kind, when, payload) {
			return
		}
		if kind == 5 {
			return
		}
	}
}

// scanPlayback counts frame types and collects the client-side frames' text.
func (info *demoInfo) scanPlayback(f io.ReadSeeker, start, end int64) {
	if info.FrameTypes == nil {
		info.FrameTypes = map[string]int64{}
	}
	seenCmd, seenSnd := map[string]bool{}, map[string]bool{}
	pos := start
	// a lighter walk than walkFrames: nothing is read but the lengths
	var hdr [9]byte
	for pos+9 <= end {
		if _, err := f.Seek(pos, io.SeekStart); err != nil {
			return
		}
		if _, err := io.ReadFull(f, hdr[:]); err != nil {
			return
		}
		kind := hdr[0]
		pos += 9
		if int(kind) < len(frameTypeNames) {
			info.FrameTypes[frameTypeNames[kind]]++
		}
		switch kind {
		case 0, 1:
			var lenb [4]byte
			if _, err := f.Seek(pos+hldemoInfoSize+28, io.SeekStart); err != nil {
				return
			}
			if _, err := io.ReadFull(f, lenb[:]); err != nil {
				return
			}
			n := int64(int32(binary.LittleEndian.Uint32(lenb[:])))
			if n < 0 || n > 1<<20 {
				return
			}
			info.NetBytes += n
			pos += hldemoInfoSize + 28 + 4 + n
		case 2, 5:
		case 3:
			var cmd [64]byte
			if _, err := io.ReadFull(f, cmd[:]); err != nil {
				return
			}
			pos += 64
			if s := strings.TrimSpace(cstring(cmd[:])); s != "" && !seenCmd[s] && len(info.Commands) < 200 {
				seenCmd[s] = true
				info.Commands = append(info.Commands, s)
			}
		case 4:
			pos += 32
		case 6:
			pos += 84
		case 7:
			pos += 8
		case 8:
			var head [8]byte
			if _, err := io.ReadFull(f, head[:]); err != nil {
				return
			}
			n := int64(int32(binary.LittleEndian.Uint32(head[4:8])))
			if n < 0 || n > 4096 {
				return
			}
			name := make([]byte, n)
			if _, err := io.ReadFull(f, name); err != nil {
				return
			}
			if s := cstring(name); s != "" && !seenSnd[s] && len(info.ClientSounds) < 200 {
				seenSnd[s] = true
				info.ClientSounds = append(info.ClientSounds, s)
			}
			pos += 8 + n + 16
		case 9:
			var lenb [4]byte
			if _, err := io.ReadFull(f, lenb[:]); err != nil {
				return
			}
			n := int64(int32(binary.LittleEndian.Uint32(lenb[:])))
			if n < 0 || n > 1<<24 {
				return
			}
			pos += 4 + n
		default:
			return
		}
		if kind == 5 {
			return
		}
	}
}

// ---- the loading section's messages ---------------------------------------------------

// parseLoading reads the server's messages of the loading section until the resource list
// has been seen, or a message we do not know how to skip.
func (info *demoInfo) parseLoading(f io.ReadSeeker, start, end int64, have haveFunc) {
	var stream []byte
	walkFrames(f, start, end, func(kind byte, _ float32, payload []byte) bool {
		if kind == 0 || kind == 1 {
			stream = append(stream, payload...)
		}
		return true
	})
	r := &byteReader{b: stream}
	deltas := map[string][]deltaField{"delta_description_t": deltaDescriptionMeta}
	seenResources := false
	for !r.eof() && !seenResources {
		at := r.pos
		id := r.u8()
		switch id {
		case 0: // svc_bad
			info.ParsedUpTo = fmt.Sprintf("svc_bad at byte %d", at)
			return
		case 1: // nop
		case 4: // version
			r.i32()
		case 5: // setview
			r.i16()
		case 7: // time
			r.f32()
		case 8: // print
			s := r.str()
			if strings.Contains(s, "(HLTV)") {
				info.HLTV = true
			}
			if i := strings.Index(s, "BUILD "); i >= 0 {
				fmt.Sscanf(s[i+6:], "%d", &info.Build)
			}
		case 9: // stufftext
			r.str()
		case 11: // serverinfo
			r.i32() // protocol
			r.i32() // spawn count
			r.i32() // map checksum
			r.skip(16)
			info.MaxPlayers = int(r.u8())
			info.Slot = int(r.u8())
			r.u8()  // deathmatch
			r.str() // game folder
			info.Server = r.str()
			info.MapFile = r.str()
			info.MapCycle = r.str()
			if flag := r.u8(); flag != 0 {
				r.skip(21) // a secured server of the demo era followed the flag with 21 bytes
			}
		case 12: // lightstyle
			r.u8()
			r.str()
		case 24: // setpause
			r.u8()
		case 25: // signonnum
			r.u8()
		case 29: // spawnstaticsound: coord3, index, volume, attenuation, entity, pitch, flags
			r.skip(3*2 + 2 + 1 + 1 + 2 + 1 + 1)
		case 13: // updateuserinfo
			slot := int(r.u8())
			r.i32()
			userinfo := r.str()
			r.skip(16)
			if slot == info.Slot && info.Recorder == "" {
				info.RecorderInfo = userinfo
				info.Recorder = infoValue(userinfo, "name")
			}
		case 14: // deltadescription
			name := r.str()
			count := int(r.u16())
			bits := &bitReader{b: r.b, pos: r.pos * 8}
			fields := make([]deltaField, 0, count)
			for i := 0; i < count && !bits.eof(); i++ {
				values := readDelta(bits, deltaDescriptionMeta)
				fields = append(fields, deltaField{
					Flags:   uint32(values["flags"].(float64)),
					Name:    values["name"].(string),
					Bits:    int(values["bits"].(float64)),
					Divisor: values["divisor"].(float64),
				})
			}
			deltas[name] = fields
			r.pos = (bits.pos + 7) / 8
		case 32: // cdtrack
			r.skip(2)
		case 39: // newusermsg
			r.u8()
			r.u8()
			nameBytes := r.take(16)
			info.UserMessages = append(info.UserMessages, cstring(nameBytes))
		case 43: // resourcelist
			bits := &bitReader{b: r.b, pos: r.pos * 8}
			count := int(bits.read(12))
			info.ResourceCounts = map[string]int{}
			for i := 0; i < count && !bits.eof(); i++ {
				res := demoResource{}
				kind := int(bits.read(4))
				if kind < len(resourceKinds) {
					res.Kind = resourceKinds[kind]
				} else {
					res.Kind = fmt.Sprintf("type%d", kind)
				}
				res.Path = bits.str()
				res.Index = int(bits.read(12))
				res.Bytes = int(bits.read(24))
				flags := bits.read(3)
				if flags&4 != 0 {
					bits.pos += 128
				}
				if bits.read(1) != 0 {
					bits.pos += 256
				}
				// a file we would need: not the map itself (its own business), not a brush
				// model (*N lives inside the map), not a decal (a name in decals.wad)
				if have != nil && res.Kind != "world" && res.Kind != "decal" && !strings.HasPrefix(res.Path, "*") {
					lookup := res.Path
					if res.Kind == "sound" {
						lookup = "sound/" + res.Path
					}
					switch have(lookup) {
					case "":
						res.Missing = true
						info.Missing++
					case "shared":
						res.Shared = true
					}
				}
				info.ResourceCounts[res.Kind]++
				info.Resources = append(info.Resources, res)
			}
			seenResources = true
		case 44: // newmovevars
			info.Gravity = r.f32()
			r.f32() // stopspeed
			info.MaxSpeed = r.f32()
			r.skip(4 * 13) // spectatormaxspeed … waveheight
			r.u8()         // footsteps
			r.skip(4 * 2)  // rollangle, rollspeed
			r.skip(4 * 3)  // skycolor
			r.skip(4 * 3)  // skyvec
			info.Sky = r.str()
		case 45: // resourcerequest
			r.i32()
			r.i32()
		case 46: // customization: slot, type, name, index, size, flags[, md5]
			r.u8()
			r.u8()
			r.str()
			r.i16()
			r.i32()
			if flags := r.u8(); flags&4 != 0 {
				r.skip(16)
			}
		case 50: // hltv
			mode := r.u8()
			if mode == 0 {
				info.HLTV = true
			} else {
				info.ParsedUpTo = fmt.Sprintf("svc_hltv mode %d at byte %d", mode, at)
				return
			}
		case 51: // director
			r.skip(int(r.u8()))
		case 52: // voiceinit: codec, and from protocol 47 a quality byte
			r.str()
			if info.Protocol >= 47 {
				r.u8()
			}
		case 54: // sendextrainfo
			info.Fallback = r.str()
			info.Cheats = r.u8() != 0
		case 55: // timescale
			r.f32()
		case 56: // resourcelocation
			r.str()
		case 57: // sendcvarvalue
			r.str()
		case 58: // sendcvarvalue2
			r.i32()
			r.str()
		default:
			info.ParsedUpTo = fmt.Sprintf("svc %d at byte %d", id, at)
			return
		}
		if r.failed {
			info.ParsedUpTo = fmt.Sprintf("truncated in svc %d", id)
			return
		}
	}
}

func infoValue(userinfo, key string) string {
	parts := strings.Split(userinfo, "\\")
	for i := 1; i+1 < len(parts); i += 2 {
		if parts[i] == key {
			return parts[i+1]
		}
	}
	return ""
}

// ---- readers ----------------------------------------------------------------------------

type byteReader struct {
	b      []byte
	pos    int
	failed bool
}

func (r *byteReader) eof() bool { return r.pos >= len(r.b) }
func (r *byteReader) need(n int) bool {
	if r.pos+n > len(r.b) {
		r.failed = true
		r.pos = len(r.b)
		return false
	}
	return true
}
func (r *byteReader) u8() byte {
	if !r.need(1) {
		return 0
	}
	v := r.b[r.pos]
	r.pos++
	return v
}
func (r *byteReader) u16() uint16 {
	if !r.need(2) {
		return 0
	}
	v := binary.LittleEndian.Uint16(r.b[r.pos:])
	r.pos += 2
	return v
}
func (r *byteReader) i16() int16 { return int16(r.u16()) }
func (r *byteReader) i32() int32 {
	if !r.need(4) {
		return 0
	}
	v := int32(binary.LittleEndian.Uint32(r.b[r.pos:]))
	r.pos += 4
	return v
}
func (r *byteReader) f32() float32 { return math.Float32frombits(uint32(r.i32())) }
func (r *byteReader) skip(n int) {
	if r.need(n) {
		r.pos += n
	}
}
func (r *byteReader) take(n int) []byte {
	if !r.need(n) {
		return nil
	}
	v := r.b[r.pos : r.pos+n]
	r.pos += n
	return v
}
func (r *byteReader) str() string {
	start := r.pos
	for r.pos < len(r.b) && r.b[r.pos] != 0 {
		r.pos++
	}
	s := string(r.b[start:r.pos])
	if r.pos < len(r.b) {
		r.pos++
	} else {
		r.failed = true
	}
	return s
}

// A GoldSrc bit stream: least significant bit of each byte first.
type bitReader struct {
	b   []byte
	pos int // in bits
}

func (r *bitReader) eof() bool { return r.pos >= len(r.b)*8 }
func (r *bitReader) read(n int) uint32 {
	var v uint32
	for i := 0; i < n; i++ {
		byteAt := r.pos >> 3
		if byteAt >= len(r.b) {
			r.pos = len(r.b) * 8
			return v
		}
		if r.b[byteAt]&(1<<(r.pos&7)) != 0 {
			v |= 1 << i
		}
		r.pos++
	}
	return v
}
func (r *bitReader) str() string {
	var out []byte
	for !r.eof() {
		c := byte(r.read(8))
		if c == 0 {
			break
		}
		out = append(out, c)
	}
	return string(out)
}

// ---- deltas -----------------------------------------------------------------------------

const (
	dtByte       = 1 << 0
	dtShort      = 1 << 1
	dtFloat      = 1 << 2
	dtInteger    = 1 << 3
	dtAngle      = 1 << 4
	dtTimewin8   = 1 << 5
	dtTimewinBig = 1 << 6
	dtString     = 1 << 7
	dtSigned     = 1 << 31
)

type deltaField struct {
	Flags   uint32
	Name    string
	Bits    int
	Divisor float64
}

// how a delta description describes its own fields
var deltaDescriptionMeta = []deltaField{
	{Flags: dtInteger, Name: "flags", Bits: 32, Divisor: 1},
	{Flags: dtString, Name: "name", Bits: 8, Divisor: 1},
	{Flags: dtInteger, Name: "offset", Bits: 16, Divisor: 1},
	{Flags: dtInteger, Name: "size", Bits: 8, Divisor: 1},
	{Flags: dtInteger, Name: "bits", Bits: 8, Divisor: 1},
	{Flags: dtFloat, Name: "divisor", Bits: 32, Divisor: 4000},
	{Flags: dtFloat, Name: "preMultiplier", Bits: 32, Divisor: 4000},
}

// readDelta decodes one delta-encoded struct: a mask of which fields follow, then the
// fields, each as its description says. Numbers come back as float64, strings as string.
func readDelta(r *bitReader, fields []deltaField) map[string]any {
	out := map[string]any{}
	maskBytes := int(r.read(3))
	masks := make([]uint32, maskBytes)
	for i := range masks {
		masks[i] = r.read(8)
	}
	for i := 0; i < maskBytes; i++ {
		for j := 0; j < 8; j++ {
			index := i*8 + j
			if index >= len(fields) {
				return out
			}
			if masks[i]&(1<<j) == 0 {
				continue
			}
			d := fields[index]
			divisor := d.Divisor
			if divisor == 0 {
				divisor = 1
			}
			switch {
			case d.Flags&(dtByte|dtShort|dtInteger|dtFloat|dtTimewin8|dtTimewinBig) != 0:
				if d.Flags&dtSigned != 0 {
					sign := 1.0
					if r.read(1) != 0 {
						sign = -1
					}
					out[d.Name] = sign * float64(r.read(d.Bits-1)) / divisor
				} else {
					out[d.Name] = float64(r.read(d.Bits)) / divisor
				}
			case d.Flags&dtAngle != 0:
				out[d.Name] = float64(r.read(d.Bits)) * 360 / float64(uint64(1)<<uint(d.Bits))
			case d.Flags&dtString != 0:
				out[d.Name] = r.str()
			default:
				out[d.Name] = float64(r.read(d.Bits))
			}
		}
	}
	return out
}

// ---- what we have -----------------------------------------------------------------------

// A haveFunc says whether a game file exists on our side: in the server's shared content
// or in the Steam base (the last one-zip build, whose listing is enough).
// It answers "base", "shared" or "" (nowhere).
type haveFunc func(path string) string

var baseListing struct {
	once  sync.Once
	names map[string]bool
}

func haveResources(cfg Config) haveFunc {
	baseListing.once.Do(func() {
		baseListing.names = map[string]bool{}
		z, err := zip.OpenReader(filepath.Join(cfg.ContentDir, "valve.zip"))
		if err != nil {
			return
		}
		defer z.Close()
		for _, f := range z.File {
			baseListing.names[strings.ToLower(f.Name)] = true
		}
	})
	return func(path string) string {
		clean := strings.ToLower(strings.ReplaceAll(path, "\\", "/"))
		if baseListing.names["cstrike/"+clean] || baseListing.names["valve/"+clean] {
			return "base"
		}
		p := under(cfg.SharedDir, strings.ReplaceAll(path, "\\", "/"))
		if p == "" {
			return ""
		}
		if _, err := os.Stat(p); err == nil {
			return "shared"
		}
		return ""
	}
}

// ---- the cache --------------------------------------------------------------------------

// demoInfoFor reads a demo's details, from a sidecar JSON beside the file when one is
// there for this size and date, else from the file (and writes the sidecar).
func demoInfoFor(path string, have haveFunc) (demoInfo, error) {
	st, err := os.Stat(path)
	if err != nil {
		return demoInfo{}, err
	}
	side := path + ".json"
	if data, err := os.ReadFile(side); err == nil {
		var cached demoInfo
		if json.Unmarshal(data, &cached) == nil && cached.Bytes == st.Size() && cached.Modified.Equal(st.ModTime()) && cached.Name == filepath.Base(path) {
			return cached, nil
		}
	}
	info := readDemoInfo(path, have)
	if info.Problem == "" || strings.HasPrefix(info.Problem, "net protocol") {
		if data, err := json.Marshal(info); err == nil {
			_ = os.WriteFile(side, data, 0o644)
		}
	}
	return info, nil
}

var errNotADemo = errors.New("not a GoldSrc demo")

// sniffDemo checks an upload's first bytes: the magic and the demo protocol.
func sniffDemo(head []byte) error {
	if len(head) < 12 || string(head[:6]) != "HLDEMO" {
		return errNotADemo
	}
	if binary.LittleEndian.Uint32(head[8:12]) != 5 {
		return fmt.Errorf("demo protocol %d; 5 is the one we know", binary.LittleEndian.Uint32(head[8:12]))
	}
	return nil
}
