# Deep dives: what the extras could hold, with a taste of each

*13 September 2026. Shane asked for more deep-dive ideas, each with a "shallow dive"
appetizer; for provenance from GameBanana and the like; for what the tunnel doubling
is; for where a public server could live; for the cheats as a technical history; and
for the licensing question — how much of the client could be swapped, and whether a
visitor could unlock the originals by proving they own the game. This is the thinking,
not the work. Nothing here is built.*

The rule for every item: the appetizer is one widget or one measured fact, buildable in
an afternoon from what the tour already has (the demo parser, the BSP reader, the usercmd
view, the engine in the browser). The deep dive is the exhibit it grows into.

## 1. Cheats, and catching them

The technical history Shane most wants kept. Cheating shaped the game as much as any
map: the 2000–2004 wallhacks made Valve write VAC, the sXe/Cheating-Death era decided
which servers people trusted, and the folklore — `ex_interp 0.01 or you're cheating` —
outlived the facts. All of it is demonstrable here **safely**, because we own the engine
in the browser: a cheat in a museum is a build flag, not a download.

**What the cheats were, by mechanism** (each becomes a small exhibit):
- *The OpenGL wallhack* (OGC, XQZ, 2000–2003): an `opengl32.dll` placed beside the
  game, wrapping the real one, that turned depth testing off when player models drew.
  The ASUS driver's "see-through" feature did the same by accident in 1999 and is why
  the first anti-cheat conversations happened at all. Demonstration: the engine's
  renderer, one flag, players drawn through walls. *Catching it:* VAC 1 (2002) scanned
  for the known DLL; the server-side answer was `mp_consistency` and, later, a
  spectating admin with an ESP of their own — Shane's plugin, now on the server.
- *The aimbot*: reads the client's entity list (positions are already in your memory:
  the server sent them), computes the angle to a head, writes it into the view angles
  before the usercmd goes out. Demonstration: the same, gated to the lab build. *Catching
  it:* the usercmd stream. A human turns along a curve; an aimbot snaps. The tour's
  "What your keyboard becomes" widget already draws that stream from a recording —
  the appetizer is a recording of each, side by side, with the per-tick yaw deltas as a
  histogram. That is what the statistical anti-cheats (HLGuard's aim detection, the
  AMXX "aimbot detector" plugins) actually measured.
- *Speedhack*: lies to the client's clock so it sends more usercmds per second than
  time has passed. *Catching it:* the server counts commands against wall time
  (`sv_check_cmdrate`-style checks, later ReHLDS's own). Demonstration: a graph of
  commands-per-second per player from the server log.
- *No-recoil / no-spread / no-flash*: hooks on the client's punch angle, the spread
  cone, the screen fade. *Catching it:* consistency of `cl_*` cvars queried by the
  server (`sv_` queries of client cvars — the mechanism VAC2 and sXe both used).
- *The interp exploit and the lag switch*: not code at all — settings and a cable.
  Already half-written in §7 of the review; the appetizer is the thomz0 forum guide
  beside our measurements.
- *`hack.7z` itself*: never run. A static reading — what it imports, what it hooks, the
  strings in it — is an exhibit on its own: "this is what was passed around in 2012".

**The anti-cheat side, as a timeline**: PunkBuster's brief CS support (2001), VAC 1
(2002), Cheating-Death (UnitedAdmins, 2002–2006, `cdrequired 1` on the server), HLGuard
(server-side, AMXX-era), VAC2 (2005, signature scans in memory), sXe Injected (2006–,
a kernel driver, the Latin American standard), the AMXX plugin ecosystem (aim and speed
detectors, and Shane's ESP for humans to look). Where each looked, what each could and
could not see, and why the browser build has none of it and needs none.

Containment, so it stays a museum: the demonstrations live in a `dist-lab` build the
relay serves only to the lab (`/lab/play`), never to `/play`; the lab is a server nobody
else is on; the flag is a compile-time patch in `engine/patches/`, listed in the tour
like the other six. What was on the drive stays catalogued as research.

**Appetizer, cooked 13 September.** The lab's aimbot is a server plugin (`mm_forceaim
<name>` in museum.amxx: the server turns the named player's view to the nearest enemy's
eyes twenty times a second — the same result a client-side aimbot produces from the
other end), and the server-side detector's raw material is `mm_aimlog <name>`: the view
angles of every command the player sends, to a file — what HLGuard and the AMXX aim
detectors looked at. `bench/aimbot.mjs` records a control run and an aimbot run on the
lab among bots; `scripts/aim-signature.py` reads those and the 2014 uG recordings:

| recording | still | turns >10°/frame | lonely jumps |
|---|---|---|---|
| the lab's aimbot | 87% | 0.34% | **100%** |
| six humans, uG 2014 | 51–79% | 0.14–0.67% | 11–55% |

"Lonely" is a turn of more than ten degrees with less than one degree of movement in
the frame before and after: a person's hand accelerates into a turn and out of it, an
aimbot's does not. Every one of the aimbot's turns was lonely; a fifth of a person's
were. That single shape is most of what the statistical detectors ever had, and it
separates these two on thirty seconds of data. Caveats for the exhibit: the aimbot here
is sampled at twenty updates a second and the humans at their frame rate, and a flat
map gave the aimbot no pitch to move. The logs are kept in `content/research/`.

## 2. Provenance: what the sites said about each map

Shane does not remember where the 5,044 came from (a torrent, probably) and would
rather know what GameBanana and the others said about them. The right tool is the one
the coins room already has: a **capture** — fetch a page politely, keep the raw
response with its URL and time, parse it later and again when the parser improves,
never fetch twice.

Sources, in order of use:
- **GameBanana** has a public API (`apiv11`): search by name within Counter-Strike 1.6,
  and each mod record carries author, date, description, screenshots, the file list
  with sizes and md5s of the archives, and the download count. Manners: their rate
  limit is documented; one request a second with a named User-Agent and a contact is
  what the coins scraper does and what this would do.
- **17buddies** (the classic CS map archive; the site outlived its era) — HTML, one
  page per map with author, date, a screenshot, often the readme. Slower, one fetch
  per map, cached for ever.
- **The map's own readme**, which is inside the download archives on the drive
  (`cs1.6maps/*.zip|rar`), already indexed in `organized/manifest.json`.

Matching is the hard part and it is by name first, then by size, then by the archive
md5 where GameBanana gives one and our archive index has the same file. A match writes
`Author`, `Year`, `SourceUrl` onto the artifact by the annotate routine with `By =
"gamebanana"`, so a person's own words still win.

**Appetizer, cooked 13 September** (`scripts/provenance.py`, captures under
`content/provenance/`): by exact name, 35 of the 60 rotation maps are on GameBanana —
the misses are Valve's own maps and a few uG renames. And better than names: GameBanana
lists each download's md5, so an archive on the drive can be proven to be *the file
they serve*: 29 of the first 60 archives in `cs1.6maps/` are byte-for-byte GameBanana's,
`de_dust2_xmas_2.zip` among them — mapper xPaw, submitted 22 December 2010, CC BY-NC-ND,
24,444 downloads. So the torrent, or whatever it was, was largely GameBanana's files with
their names intact. Name matches need care (de_dust's hit is a 2013 remake, de_westwood's
a waypoint pack); md5 matches need none. The next step writes the md5-proven ones onto
the artifacts as `By = "gamebanana"`, and shows them on the desk and the tour.

## 3. The tunnel, and where a public server could live

**What "doubling" means.** The house is behind a home connection with no inbound UDP,
so a browser from outside reaches the game through playit: its packets go to playit's
nearest edge, then over playit's own link to the house, and back the same way. For a
friend in the same city that is city → edge → house → edge → city, twice the distance
of the direct path, plus the edge's own queueing. Measured 7 September: a stranger's
game ping is the sum of two internet hops instead of one. It is fine for the family; it
is not what a public server should offer.

**What it would cost** (September 2026, OVH's US prices after their March rise): a VPS-1
is $6.46 a month, a VPS-2 $9.99; the game-tuned anti-DDoS is only on the bare-metal
Game range, which starts around $60. Hetzner's equivalent VPS is about €4. One VPS-2
holds the public server *and* the mini tour servers: an idle HLDS is ~100 MB of RAM and
nearly no CPU, so five or six of them on one $10 machine is ordinary, with the relay in
front of all of them. The Game bare-metal tier is the answer only if a public server
draws attacks, which a family museum with a login on the front is unlikely to.

**Or no public server at all.** Shane's other thought: publish only the tour and the
mini museum servers, and for playing, offer an all-seeing-eye — a server browser (the
2003 program by that name was exactly this) that lists other people's CS 1.6 servers
from the Steam master list and lets a browser join them through our relay. Technically
the relay already does the hard part (a UDP socket per browser); the difference is that
the socket's other end is somebody else's server, and the museum is a doorway rather
than a host. It pairs well with bring-your-own-game: a visitor with their own files and
our engine could join any server in the world from a browser, which is a thing that has
never existed. The catch is that other servers' content (their maps) has to reach the
browser — the relay would fetch the map from the server's fast-download URL the way a
native client does, on demand.

**The eye, tried (14 September).** `/eye` lists United States servers with people on
them — the GoldSrc master server no longer resolves, so the candidates come from
GameTracker's public list (one polite page, cached ten minutes) and every one is asked
directly with A2S_INFO from the relay. On a Sunday morning: 24 answered, ~150 people
playing — a Zombie Plague server with 23, a zombie escape with 20, a deathmatch with 17,
ClassicCS.com's "Old School #1" with 16 on de_dust, an America Gaming CTF with 15.
Joining works through the same bridge as the house's servers (`?server=host:port`, the
socket on a real interface rather than a loopback one): ClassicCS accepted the museum's
client and streamed 800 datagrams in fifteen seconds; three others answered "STEAM
validation rejected" — they take Steam clients only, and the eye should say so before
anyone presses Join. The other missing piece is maps: a public server is usually on a map
the browser has no bundle for, and the client cannot fetch from the server's fast-download
site; the relay can — fetch the bsp and its wads from `sv_downloadurl`, bundle them the
way the lab does — and that is the next step if the eye is worth opening.

**Where a public server could live.** The constraints are exact: HLDS is a 32-bit x86
Linux binary (so no ARM free tiers, no Graviton), WebRTC needs a public IP with a UDP
port open (so no HTTP-only platforms — Fly.io and Cloud Run are out), the relay and the
server want to be on the same machine (one loopback address per player is how ReHLDS
tells them apart), and game servers attract DDoS.
- **A small VPS with a real IP** — Hetzner (CX22-class: 2 vCPU, 4 GB, 40 GB, ~€4/month),
  OVH (its game-server tier has the anti-DDoS built for exactly this), Vultr or Linode
  (~$6). The same compose file, the same relay, WebRTC direct to the public IP, no
  tunnel at all, Cloudflare in front of the HTTP part only. A CS server is light — one
  core, half a gigabyte — and the relay is a Go binary. Recommendation: OVH if DDoS is
  a worry, Hetzner otherwise.
- **The flexibility question**: the lab and the family stay at home; the public one
  runs the rotation content (`shared/` + the bundles, ~1 GB) synced by rsync from the
  house, and "try any map or model" on it means syncing the drive's pool too (the
  merged install is ~10 GB; a 40 GB VPS disk holds it). The rooms's tools already take a
  server by name; a public server is one more row in the table with a different host —
  the one change is that `Cs16Console` and the container tools would speak to a remote
  Docker socket over SSH instead of the local one.
- **Not** a game-hosting company (no relay, no browser), and not a home server exposed
  by port-forward (the house's address handed to everyone).

Appetizer: none needed — the measurement exists. The first step, when it comes, is a
weekend VPS with the compose file, to time a join from the phone.

## 4. Licensing, and bringing your own game

Where things stand: the engine (Xash3D FWGS) and the client reimplementation are GPL;
ReHLDS and ReGameDLL are reverse-engineered from Valve's binaries and tolerated; the
maps, models and recordings on the drive belong to their makers and are here as fan
content. The one thing that is plainly Valve's and plainly redistributed is
`valve.zip` — `halflife.wad`, the stock models, the stock sounds — the 200 MB base
every browser downloads. That is the exposure.

**How much of the client could be swapped for alternatives?** All of the code already
is. The assets are the question, and the honest answer is: swapping them defeats the
museum. A `de_dust2` with replacement textures is not de_dust2. Free replacement sets
exist for some of it (community weapon models, free sound packs) but not for the game
as it was, and the tribute is the point.

**Bring your own game** is the way through, and it is not a scan-and-unlock — it is
better than that. The browser can read the visitor's own Half-Life folder (the File
System Access API in Chrome and Edge; a folder picker in the rest), hash `halflife.wad`
and the rest against the known builds, and write the files it needs straight into the
same IndexedDB cache the base bundle uses today. After that the museum serves **only
the free part** — the engine, the community maps, the plugins' sounds — and the Valve
part never leaves the visitor's own disk. No upload, no copy on our server, no
verification theatre: the game they own is the game they play, exactly as Xash3D on
a phone has always worked. The "unlock" Shane imagined falls out of it: with a verified
folder the originals are in the cache; without one, the page can offer the free
subset or nothing.

What it costs: the base bundle splits in two (free / Valve's), the cache learns a
second source, a page to pick the folder and say what it found. What it changes: the
public server question in §3 gets much easier, because a public page would then
distribute nothing of Valve's at all.

**Appetizer, cooked 13 September:** `/verify` (relay/verify.go) takes the visitor's own
Half-Life folder — a directory picker in Chrome and Edge, a folder file-chooser elsewhere
— hashes every file the game needs against the build the base was made from
(`content/known-files.json`, 4,186 files, from `scripts/known-files.py`), and says what
it found. Nothing is uploaded. A full Steam folder, 393 MB, checks in 2.4 seconds. The
step after this keeps the verified files in the browser's own cache.

**Verify once, play anywhere.** Shane's wrinkle: part of the fun is playing on a device
that has no Counter-Strike on it. Two answers, and the second is the clean one.
(1) A Steam sign-in: Steam's OpenID login plus the Web API's owned-games call proves the
visitor owns Half-Life or Counter-Strike without any file at all, on any device; the
museum then serves them the base bundle as it does today, gated. That is "restore your
own purchase", the same thing Steam's own CDN does, and defensible in a way that public
distribution is not. (2) The folder check above, once, on the machine that has the game —
which unlocks the same gate for that account. Either way the account, not the device,
carries the proof, and the browser cache does the rest. The wrinkle's own limit: on the
device without the game the bytes still come from us, so this is gating, not
elimination; only bring-your-own is elimination.

## 5. More dives, with their appetizers

| dive | the appetizer | the exhibit |
|---|---|---|
| **How the bots find their way** | the `.nav` mesh (we have 33 in `cs-server/navs`) drawn over the BSP floor plan the tour already draws | how ZBot builds it, the "danger" learning, why bots get stuck on custom maps |
| **A server's first half-second** | the demo parser's byte count per message kind for the first second of a recording | serverinfo, the resource list, delta descriptions, the baseline — what a join actually is |
| **The buy menu as user messages** | the `BuyMenu`/`VGUIMenu` messages from a recording, decoded | how the client and server negotiate a purchase, and why `vgui_menus` mattered |
| **Hitboxes and lag compensation** | one recording, one kill, the shooter's view rewound by their ping | `sv_unlag`, `cl_lc`, what "hit registration" meant on 200 ms |
| **Sprays** | a `tempdecal.wad` read in the browser, the 16 KB limit shown | how a spray travelled player to player, `pldecal.wad`, the clan logos in the drive's wads |
| **The map compile pipeline** | the BSP lump table with lighting and VIS sizes | .map → ZHLT → .bsp, why lighting took an hour and VIS all night, r_speeds |
| **The sounds** | a waveform and spectrogram of `ak47-1.wav` (8-bit, 11 kHz) | footsteps as information, `hisound`, why the announcer is Unreal's |
| **Models** | the inspector, already; a turntable | MDL: bones, sequences, hitboxes, the `T.mdl` texture split, why skins were 2 MB |
| **WON → Steam** | protocol 46 → 47 → 48 from the demo chapters | the 2003 leak, the 2004 migration, what changed on the wire |
| **How servers were found** | an A2S_INFO query and its answer, byte by byte | WON master, Steam master, `sv_region`, the server browser, our lobby |
| **The league era** | the 2011 config experiment, already | mr12, knife rounds, CAL/ESEA/CPL rules, the demos, the thomz0 guide |
| **HLTV** | none yet — roadmap | watching without a slot, the delay, the proxy's own protocol |

The order that makes sense: cheats first (Shane's priority, and the usercmd appetizer
is nearly free), provenance second (it feeds every artifact page), bring-your-own-game
third (it changes the hosting question), then the table as time allows.
