package main

// The colours a map is painted in, for the museum's plan from above: every texture the
// map names, as one average colour — read from the map itself where the mapper embedded
// them, and from the wads the map's worldspawn lists otherwise (the server's wads, then
// the drive's). halflife.wad alone is 37 MB, which is why this is done here once and kept,
// not in every visitor's browser: /api/plan?map=<name> for the server's maps,
// /api/plan?path=<drive path> for the drive's.

import (
	"encoding/binary"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

var planCache sync.Map // key → map[string][3]int

func planHandler(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var bsp string
		if name := r.URL.Query().Get("map"); name != "" && mapNameOK(name) {
			bsp = rawFile(cfg, "maps/"+name+".bsp")
		} else if p := r.URL.Query().Get("path"); p != "" && cfg.DriveDir != "" {
			rel := strings.TrimPrefix(p, cfg.DriveDir+"/")
			bsp = under(cfg.DriveDir, rel)
		}
		if bsp == "" {
			http.Error(w, "map=<name> or path=<a drive map>", http.StatusBadRequest)
			return
		}
		if cached, ok := planCache.Load(bsp); ok {
			writeJSON(w, cached)
			return
		}
		data, err := os.ReadFile(bsp)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		colours := embeddedColours(data)
		wanted := map[string]bool{}
		for _, name := range textureNames(data) {
			if _, have := colours[name]; !have {
				wanted[name] = true
			}
		}
		if len(wanted) > 0 {
			for _, wad := range wadsNamed(data) {
				path := rawFile(cfg, wad)
				if path == "" {
					continue
				}
				if raw, err := os.ReadFile(path); err == nil {
					wadColours(raw, wanted, colours)
				}
				if len(wanted) == 0 {
					break
				}
			}
		}
		planCache.Store(bsp, colours)
		w.Header().Set("Cache-Control", "public, max-age=86400")
		writeJSON(w, colours)
	}
}

func lump(data []byte, i int) (int, int) {
	if len(data) < 4+15*8 {
		return 0, 0
	}
	off := int(int32(binary.LittleEndian.Uint32(data[4+i*8:])))
	n := int(int32(binary.LittleEndian.Uint32(data[8+i*8:])))
	if off < 0 || n < 0 || off+n > len(data) {
		return 0, 0
	}
	return off, n
}

func cstr(b []byte) string {
	if i := strings.IndexByte(string(b), 0); i >= 0 {
		return string(b[:i])
	}
	return string(b)
}

// textureNames is the miptex directory's names, lower-cased, in order.
func textureNames(data []byte) []string {
	off, n := lump(data, 2)
	if n < 4 {
		return nil
	}
	count := int(int32(binary.LittleEndian.Uint32(data[off:])))
	var names []string
	for i := 0; i < count && i < 4096 && off+4+i*4+4 <= len(data); i++ {
		mo := off + int(int32(binary.LittleEndian.Uint32(data[off+4+i*4:])))
		if mo < off || mo+40 > len(data) {
			names = append(names, "")
			continue
		}
		names = append(names, strings.ToLower(cstr(data[mo:mo+16])))
	}
	return names
}

// miptexAverage reads one miptex (name, width, height, four mip offsets, then the
// 256-colour palette after the last mip) and returns its average colour, or false.
func miptexAverage(b []byte, mo int, relative bool) ([3]int, bool) {
	if mo < 0 || mo+40 > len(b) {
		return [3]int{}, false
	}
	w := int(int32(binary.LittleEndian.Uint32(b[mo+16:])))
	h := int(int32(binary.LittleEndian.Uint32(b[mo+20:])))
	off0 := int(int32(binary.LittleEndian.Uint32(b[mo+24:])))
	off3 := int(int32(binary.LittleEndian.Uint32(b[mo+36:])))
	if w <= 0 || h <= 0 || w > 4096 || h > 4096 || off0 == 0 {
		return [3]int{}, false
	}
	base := 0
	if relative {
		base = mo
	}
	pix := base + off0
	pal := base + off3 + (w/8)*(h/8) + 2
	if pix+w*h > len(b) || pal+768 > len(b) {
		return [3]int{}, false
	}
	var r, g, bl, n int
	for k := 0; k < w*h; k += 11 {
		p := int(b[pix+k])
		r += int(b[pal+p*3])
		g += int(b[pal+p*3+1])
		bl += int(b[pal+p*3+2])
		n++
	}
	if n == 0 {
		return [3]int{}, false
	}
	return [3]int{r / n, g / n, bl / n}, true
}

func embeddedColours(data []byte) map[string][3]int {
	out := map[string][3]int{}
	off, n := lump(data, 2)
	if n < 4 {
		return out
	}
	count := int(int32(binary.LittleEndian.Uint32(data[off:])))
	for i := 0; i < count && i < 4096 && off+4+i*4+4 <= len(data); i++ {
		mo := off + int(int32(binary.LittleEndian.Uint32(data[off+4+i*4:])))
		if mo < off || mo+40 > len(data) {
			continue
		}
		name := strings.ToLower(cstr(data[mo : mo+16]))
		if c, ok := miptexAverage(data, mo, true); ok {
			out[name] = c
		}
	}
	return out
}

var wadKey = regexp.MustCompile(`"wad"\s*"([^"]*)"`)

// wadsNamed is the worldspawn's wad list, bare names.
func wadsNamed(data []byte) []string {
	off, n := lump(data, 0)
	if n == 0 {
		return nil
	}
	ents := string(data[off : off+n])
	if i := strings.Index(ents, "}"); i > 0 {
		ents = ents[:i]
	}
	m := wadKey.FindStringSubmatch(ents)
	if m == nil {
		return nil
	}
	var out []string
	for _, w := range strings.Split(m[1], ";") {
		w = strings.TrimSpace(strings.ReplaceAll(w, "\\", "/"))
		if w == "" {
			continue
		}
		out = append(out, filepath.Base(w))
	}
	return out
}

// wadColours fills in the wanted names from a WAD3 file's miptex lumps.
func wadColours(raw []byte, wanted map[string]bool, out map[string][3]int) {
	if len(raw) < 12 || string(raw[:4]) != "WAD3" {
		return
	}
	count := int(int32(binary.LittleEndian.Uint32(raw[4:])))
	dir := int(int32(binary.LittleEndian.Uint32(raw[8:])))
	for i := 0; i < count && i < 8192; i++ {
		e := dir + i*32
		if e < 0 || e+32 > len(raw) {
			return
		}
		name := strings.ToLower(cstr(raw[e+16 : e+32]))
		if !wanted[name] {
			continue
		}
		pos := int(int32(binary.LittleEndian.Uint32(raw[e:])))
		if raw[e+12] != 0x43 { // a miptex
			continue
		}
		if c, ok := miptexAverage(raw, pos, true); ok {
			out[name] = c
			delete(wanted, name)
		}
	}
}
