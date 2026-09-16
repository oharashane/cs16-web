# de_museum: the museum is a map

*A proposal, 16 September 2026. Shane: "one unified integrated museum … ai-gen prose to a
minimum, interactive and visual instead … the elements are excellent, they don't fit
together as one thing yet." The mock with the floor plan is the artifact published the
same day; this is the text of it.*

## The thesis

One building, drawn the way the museum already draws its maps: from above, rooms painted
in their floor colours, spawns marked. The floor plan **is the navigation** — on every
page, with a dot for where you are. Every room holds **objects** (a two-line label, the
stars, a verb) and **stations** (a thing you operate, with a two-line caption). The story
is told by what is in the rooms and where they sit. Prose lives in one place, the
archive, backstage in the workshop.

## The rooms

| Room | The wall sentence | Objects | Stations |
|---|---|---|---|
| Entrance | A 2003 game, still playable, kept with everything people made for it. | the clip; who is on now (live); the plan | — |
| The game | Pick a name; the seats fill with bots. | the server; the lab | settings (curators) |
| The maps hall | Valve's own, the server's, and what the curators have hung. | every map on display | the catalogue; the wings' signage = the 2005 server list (each mode a room of maps, and a switch of the server for a curator) |
| The models hall | Skins and weapons people made; wear one in your own game. | every model on display | inside a model |
| Recordings theatre | Matches as they were played, replayed by the game itself. | the recordings; the wallhack | inside a recording; delta compression |
| The machine room | How a 2003 game runs in a browser tab. | the nine patches (diff stat, bench, before/after); the measurements (a number, its bench, its date); the pieces (the diagram is the room's plan) | downloads measured now; a packet's journey; the lag sliders; protocols; keyboard → usercmd; inside a map file; the sounds |
| The timeline gallery | 1996 to now, and where this museum sits on it. | one timeline: the game's years and the project's (2025's plans, 2026's revival), each entry a date, a line, an artifact | the timeline |
| The wider world | The public servers still running today, asked directly. | every server that answered | bring your own game |
| The workshop | Where the museum is made. | counters, backlog, journal, roadmap; **the archive**: the review, proposals, the engineering journal, deep dives, credits — documents kept as documents | imports, seed, servers, people, telemetry |

## The rules

A room: one sentence. An object: two lines (what, who, when) and a curator's note if
there is one. A station: two lines of caption. Anything longer is a document in the
archive, linked from a station by "the archive has the full account".

Measured today: ~125 KB of prose on the visitor path (117 KB of it the review, 7 KB the
tour's chapter text, the lobby's paragraphs). Proposed: ≤ 6 KB on the path; all of it in
the archive.

## What dissolves

The story and the engine room as chapter pages (their widgets become stations in the
rooms above; their text becomes captions); the review as chapters (→ the archive, the
timeline's entries, the stations' captions); the lobby's paragraphs (→ one sentence).
Nothing built is thrown away; every element has a room in the table above.

## The shape

One `room.html` template fed by a room manifest: the sentence, the objects' query (the
collection, or a static list for patches and measurements), the stations. The tour's
widgets become stations: ES modules mounted by `<div data-station="lag">`, built once by
Vite. The floor plan is one SVG in `museum.js`. The archive is `docs/` served as documents.

## The order

1. The floor plan as the nav; the entrance.
2. The machine room: widgets as stations, patches and measurements as objects.
3. The recordings theatre takes its two stations; the models hall its one.
4. The maps hall gets its wings from the modes list.
5. The timeline gallery.
6. The archive; then the story, the engine room and `/review` retire (redirects stay).

## Questions

- One timeline for the game and the project, or two lanes? (One, I think.)
- Is the archive reachable from the entrance, or only through the workshop? (Workshop:
  prose is backstage.)

## The horizon

A floor plan drawn like a map wants to be a map: `de_museum.bsp`, the rooms built in
Hammer, the objects as pictures on its walls, walked in the engine that runs everything
else here. Not this pass; nothing above forecloses it.
