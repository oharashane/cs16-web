# The drive: what is on it, and how to bring it in

*A first pass, 12 September 2026. Shane copied the drive he has been filling since the
early 2000s to `~/Desktop/cs-museum-2026`: 25 GB, 28,770 files. He asked for a look before
anything is imported — there is junk, there are twenty years of server ideas and museum
structures in it, and it wants organising first. This is the look. Nothing has been
imported; `organized/` is a view made of hardlinks, and `rm -r organized` undoes it.*

## What is on it

| what | where | size | count |
|---|---|---|---|
| **The maps, merged into one install** | `Maps 5044/` — `maps/`, `models/`, `sound/`, `sprites/`, `wad/`, `gfx/`, `overviews/` | 19 GB | 5,044 `.bsp`, 4,934 distinct by content; 24,910 files in all |
| **The same maps as downloaded** | `cs1.6maps/` | 5.3 GB | 2,347 archives (1,261 rar, 979 zip, 107 7z) and 179 loose files, with their original names |
| **Recordings from the uG servers, 2014** | `worthsaving.7z` | 494 MB, 2.9 GB unpacked | 37 GoldSrc demos, May–September 2014 |
| **Recordings, a 2023 batch** | fourteen loose `.dem` at the top | 520 MB | all protocol 48, thirteen on de_dust2, one on cs_assault |
| **The uG server itself** | `192.223.26.202.7z` | 188 MB, 606 MB unpacked | 165 player-model files (the donor and admin skins), the map `.txt`s, three per-server player lists |
| **Shane's own notes** | eight text files at the top | — | the 2017 museum schema, the uG server layout, the reorganisation idea, configs |
| **Sounds** | five `.wav` at the top | — | `monsterkill.wav` is the Quake announcer pack; the rest server sounds |
| **Plugins and tools** | `all-in-one-3.2a/`, `amx_adminspec/`, AMX Mod X 1.8.2, Metamod, Sledge, the Pawn manuals, four fonts | 40 MB | `amx_adminspec` has Shane's own edits to a plugin |
| **Research** | `hack.7z` | 364 KB | a cracked aimbot — review §10 material, never to be installed |
| **Screenshots** | `cstrike_screenshots.zip` | 67 MB | 2002–2005 |
| **Not GoldSrc** | `cstrike_demos.zip`, `cssource-x-men_wolverine_claws.rar`, a CS:GO image | 55 MB | six Counter-Strike: Source demos from 2005 — `HL2DEMO`, not ours — and a Source skin |

Two forms of the map collection, and both matter: `Maps 5044` is what a server would
load, `cs1.6maps` is where each map came from. A download named
`10333_winchester_mode__scout.7z` carries its GameBanana id; most carry the name the site
gave them. That is provenance, and it is the reason not to throw the archives away once
the install exists.

## What the maps are

By family, from their names (`scripts/museum-drive.py` does this; 595 it could not place
by name are left for a person):

| family | maps | what the server has today | the gap |
|---|---|---|---|
| **climb** (kz, bhop, slide, and forty clan tags) | 1,734 | 1 | the biggest family on the drive, and the one the `climb` mode has one map for |
| **arena** (aim, awp, fy, he, ka, 35hp, gg, 1v1) | 820 | ~175 | mostly covered; the drive adds knife arenas and 35hp maps |
| **classic** (de, cs, as, remakes) | 688 | ~120 | including `de_aztec15` — the 1.5-era Aztec, under three names |
| **surf** | 365 | 0 | the whole family |
| **zombie** (zm, ze, bb) | 242 | 0 | the whole family, including the `ze_` escapes `infect` was waiting for |
| **deathrun** | 228 | 0 | the whole family |
| **hide-and-seek** (hns, by country) | 144 | 0 | the whole family |
| **escape** (es) | 55 | 0 | the original fourth game type, dropped from 1.6 |
| **minigame** (soccer jam, and the rest) | 45 | 0 | |
| **jailbreak** | 18 | 0 | |
| **duplicates** (byte-identical under another name) | 110 | — | `de_dust2_2x2` = `de_dust2_2x2_hama` = `de_dust2x2` = `gg_dust2_2x2` |

Of the 112 names the drive and the server share, 105 are byte-identical and 7 are
different versions of the same map. So the two agree, and the drive extends the server
rather than contradicting it. Every gap the variations plan named — surf, zombie escape,
deathrun, hide-and-seek maps, 35hp — is filled from here.

## What Shane wrote, and why it matters more than the maps

`2017-csmuseum-notes.txt` and `sample.md` are a museum schema from 2017: twelve kinds
(map, skin, texture, sound, mappack, skinpack, soundpack, plugin, script, tutorial, tool,
sprite), a rating scale, fifty attributes (single-player fun, nostalgic, bot friendly,
includes nav, pickup weapons, custom models…), credits fields (original author, porter,
curator, creation year, licence as written and as interpreted), and a tag vocabulary of
themes, game types, inspirations, textures, styles and visual themes. `sample.md` is that
schema as YAML front matter over a page of content — a record with a story.

The collection in the cs16 room has `Kind`, `Name`, `Path`, `Sha256`, `Author`, `Year`,
`SourceUrl`, `License`, `Status`, `Note`. The 2017 schema is the same idea, thought
through for longer. The right move is to adopt it rather than grow ours towards it: add
a `Tags` set to the artifact record with Shane's vocabulary as the allowed values, keep
his rating scale as the museum's rating, and let `sample.md` be the shape of an
artifact's page. His note is the museum's founding document and should be on the tour
as such.

`cstrike_server_layout.txt` and `reorg_idea.txt` are the uG community's server plan —
Assault, Dust2 ("try hard"), Fun RTV, Deathmatch, Aim/Scoutz, a members' Gun Game — with
each server's maps, plugins and rules, and the idea that one person owns each server.
Three of those servers are modes we have already built; the rest are a page of config
each, and the rules ("CTs still alive get slayed next round", "one bot joins when a
player is alone, leaves when a second arrives") are plugin work worth doing because they
are Shane's own design. The `192.223.26.202.7z` backup is the same servers' skins and
player lists: the skin set is Batman, Iron Man, Darth Vader, the Matrix, the Turtles,
50 Cent, Obama — the 2010s pop-reference skin pack his 2017 notes call a theme.

## The recordings

The 2014 archive is the uG servers as played: 37 demos named the way admins name them
(`assaultfodder1`, `d2hyuhyh`, `myselfepisode6`), 2.9 GB, protocol 48 by their date. The
2023 batch is the same kind. All of it plays on the demos page today. None of it is
protocol 46 or 47 — the 2005 demos turned out to be Counter-Strike: Source, a different
engine entirely — so the old-protocol reader still has no Counter-Strike test file, and
the 1.5-era maps on the drive (`de_aztec15`, `de_dust_old` if it is there) are content for
the 1.5 costume rather than recordings from it.

## How `organized/` is laid out

    organized/
      maps/{classic,arena,climb,surf,zombie,escape,deathrun,hide-and-seek,jailbreak,minigame,other}/
          — each .bsp with its .txt/.res/.nav beside it
      maps/duplicates/       byte-identical copies under other names, set aside
      maps/packs/            the gg, surf and fy packs, unopened
      maps/loose/            the three maps that were at the top
      content/{models,sound,sprites,wad,gfx,overviews}/   the dependency pool, as one pool
      downloads-as-downloaded → cs1.6maps/                provenance
      recordings/            worthsaving.7z and the loose 2023 demos
      servers/               the uG backup
      notes/ sounds/ models/ plugins/ tools/ research/ screenshots/ images/ not-goldsrc/
      manifest.json          every item: kind, family, bytes, sha256 and twins for maps

Hardlinks, so it costs nothing and the drive is unchanged. The classification is in the
script and improves by editing it.

## What to import first, as the test

Five things, chosen to exercise five different paths, small enough to check by hand:

1. **`de_aztec15`** — a classic map that is a *different version* of one we have. Tests
   that the collection can hold two artifacts with one name, and it is the first piece of
   the 1.5 costume.
2. **Six surf maps** from the smallest up — a whole family we lack, and the `surf` mode
   that goes with them (cvars only, written in the variations plan).
3. **`ze_` maps, three of them** — the escape maps `infect` was waiting for, with their
   dependencies from the pool; the first real test of the scanner attributing models and
   sounds from a 16,000-file pool.
4. **`monsterkill.wav` and the announcer sounds** — the first non-map artifact kind, and
   the file the 2007 recording on the demos page has been asking for.
5. **The uG skin set** — 165 model files out of the server backup, as player-model
   artifacts with the pop-reference tags from Shane's own vocabulary; the model inspector
   on the tour reads them the moment they are served.

Each import: hash, record (kind, name, path, sha256, source = the drive path, plus the
download archive it came from where `cs1.6maps` has one), scan dependencies, place under
`cs-server/shared`, and — for maps — a bundle. The recordings can wait: they play from
`content/demos` already, and 3.4 GB of them wants a decision about which to keep.

## What not to import

The CS:S demos and skin; the aimbot (kept, catalogued as research, never installed);
the 110 duplicates (recorded as `sameAs` on the canonical one, not imported twice); the
merged `content/` pool as a whole — it comes in map by map, as dependencies, so the
server never carries a file nothing asks for.
