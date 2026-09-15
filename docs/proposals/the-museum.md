# The museum: one site, visitors first

*14 September 2026. Shane: "I don't want to be the only one sifting through maps and
models. Anyone — locked down for now, not forever — should be able to browse, test things
out, add feedback. A unified museum experience, where admins are just an extension of
visitors." And: "we should always download (and cache) maps from the server to the client,
models too; valve.zip and bundles are kinda hacky." This is the shape of both. Nothing here
is built yet; the order at the end is the proposal.*

## The idea

One site. A visitor arrives at the front door, browses the collection the way they'd walk
a museum — by room (the families: classic, arena, climb, zombie…), by era, by what
somebody rated highly, by a search — opens a thing, looks at it (a fly-through, a turntable,
a recording playing), tries it (plays it on the lab, wears the skin), and says what they
think (a rating, a few tags, a note). Their name is on what they said. An admin is that
same visitor with a few more buttons on the same pages: put it on the real server, promote
it into a rotation, retire it, delete a recording. There is no separate admin site; the
curator's desk was the prototype of a page every visitor gets.

## Who

| who | can | how they are known |
|---|---|---|
| visitor | browse, look, try on the lab, watch recordings | the family login for now; a public door later, with the game itself behind a click that says what it costs |
| member | everything a visitor can, plus rate, tag, note — by name | an invitation (the relay already mints these; the name on the invite is the name on the feedback) |
| curator | everything a member can, plus load on main, promote, retire, settings, the people page | the admin flag on the invitation, as now |

Nothing a member says is anonymous, and nothing a curator does is unjournalled — the
collection's `Changes` table already keeps who said what, when.

## The objects

- **An artifact page** — one per map, model, recording: what the file says of itself, its
  family and tags, what it needs and whether we have it, where it came from (GameBanana's
  record, md5-proven where it is), what people said, and the ways to look at it and try
  it. This is the tour's widgets (fly-through, inspector, recording player) and the desk's
  record on one page.
- **Rooms** — the families, plus curated sets: the server's rotations, "the drive", the uG
  years, "what Shane rated five stars", the recordings of a particular night.
- **The tour** stays the museum's narrative layer; **the eye** its window on the world
  outside; **the lab** its workshop; **recordings** its archive.

Every look and every try opens in place — a dialog over the list, as the desk does now
— so going through fifty things is fifty clicks, not fifty page loads.

## Where it lives

The relay already serves the family site and knows every person by their invitation, so
the museum's pages live there. darkoak keeps what it keeps — the collection's ledger, the
tools that run the servers, the journal — and the two speak through a small, keyed API:
the relay reads artifacts and their tags from darkoak, and posts a member's feedback to it
with the member's name; darkoak records it as an annotation by that person, the same
routine the desk uses today. The desk itself becomes the curator's view of the same
pages and is retired as a separate thing once the pages can do what it does.

## Files the game's way

The bundles were a scaffold: `valve.zip` because the Valve files must come from
somewhere, `base.zip` and a zip per map because the browser could not do what every game
client since 1998 does — ask the server what it needs and fetch the rest. That is the fix
for the eye's map problem, for the lab's bundle-per-map, and for models: **the game's own
resource mechanism**. The server sends its resource list and `sv_downloadurl`; the client
finds what it lacks and fetches it from that URL; the browser keeps what it fetched.

What it takes: the engine's HTTP download layer is seven functions (`HTTP_AddDownload`,
`HTTP_Run` and five smaller), and the web build's version uses raw sockets, which a
browser has not got — so it fails silently today. A web version of those seven functions
does the fetching with the browser's `fetch`, hands the bytes to the same completion path
the native engine uses, and drops each file into the browser's cache (the IndexedDB
store the bundles already use) so the next visit has it. Cross-origin is the one wrinkle:
a browser may not fetch from `fastdl.classiccs.com`, so the relay proxies — `GET
/fetch?url=…`, restricted to the download URL of the server the session is on, cached on
the relay's disk too. Our own servers set `sv_downloadurl` to the relay's `/raw/`, which
is same-origin and needs no proxy.

After that: `base.zip` shrinks to the free part (the engine's own files), the Valve part
comes from bring-your-own-game or the gated download, and the per-map zips, the lab
manifest and the packager's map logic go away. A map on the drive is playable the moment
the lab is on it; a public server is joinable if it takes non-Steam clients; a model is
a file the server names. In-band UDP download (the game's other way, slow but
infrastructure-free) is the fallback when a server has no download URL.

## The order

1. **Files the game's way** — the engine's web HTTP layer, the relay proxy, the cache.
   It unblocks the eye, simplifies the lab, and is what "models too" needs.
2. **The read API and artifact pages** on the relay, with the dialogs, for every family
   visitor. The desk's list and record become these pages.
3. **Feedback by name** — rate, tag, note — posted to darkoak as annotations by the
   member; the curator's fields (status, promote, retire) as the extra buttons.
4. **Rooms** and the front door rebuilt around them; the tour linked from every artifact
   it mentions.
5. **The public door**, when the licensing piece (bring-your-own-game or the gated
   download) is in place.

## 16 September: the building

Shane's direction, restated: one cohesive museum, entered from a high level ("what is
this?") with paths of exploration — exhibits — by interest, like a real museum; every
exhibit interactive and real unless load time or server cost says otherwise, in which
case a made-in-advance picture stands in. And the collection reconsidered: the backlog is
the curators' (visitors may peek and see progress and the roadmap), the wings show only
what curators have put up, and everybody with a name gives stars.

What was built:

- **The lobby** (`/`, `relay/lobby.html`): three sentences, the clip, eight doors.
- **The wings**: `/maps`, `/models` (cards of what is on display; the record opens in
  place with its plan or its turntable, its pictures, the stars), `/recordings` (the
  demos page, retitled), `/story` and `/engine` (the tour's chapters, split by path),
  `/world` (the eye), `/curators` (counters, the roadmap from `docs/roadmap.md`, the
  backlog by family, the journal, the back office). The old doors redirect.
- **One look**: `relay/museum.css`, `relay/museum.js` — the nav, the dialog, the plan,
  the turntable, wearing, the record, the stars.
- **The collection**: `Shown` on the artifact (the seed puts the rotation and Valve's own
  maps up: 72), `Votes` (one per person per thing, the latest counts; the record keeps
  the mean, the count, the rounded rating), the note as the curator's note. Curators set
  fields through `say`; anyone named votes through `vote`. Visitor comments and tags are
  deferred; curators' remain.
- **Pictures**: `scripts/previews.mjs` — three views by hlviewer (the whole map from
  above at an angle, then the CT and T spawns facing as the mapper pointed them) and the
  plan, into `content/previews/<id>*.jpg|png`; `/api/previews` says which exist.
- **A bot to play against**: the lab, `bot_quota` set eight seconds after the map change
  (the lab's config zeroes it on every map, since a bot on an unseen map builds a mesh
  first; the lab's `navs-lab` already holds 9,061 meshes).
- **Loading**: `bench/opened.mjs` hooks the engine's filesystem and plays a session —
  two maps and a recording opened 146 of the base's 227 MB. The packager
  (`scripts/package-valve.py`) now keeps the soundtrack, Half-Life's models and
  announcer, ambient sounds and map props out of the base unless two chosen maps want
  them, sends a big wad with its maps unless three name it, and reads the scanner's
  catalogue for what else a map's entities name. Weapons, players, the radio and the HUD
  stay: the game opens those as it goes.

Not yet: models on display (curators choose; the wing says so), the public door, votes
that change anything by themselves.
