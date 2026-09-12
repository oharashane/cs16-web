# Playing GoldSrc demos in the browser

*Research, 11 September 2026. Shane has a drive of `.dem` files from the 2000s, wants
them playable in the browser, and wants the first-person view, not a top-down replay.
Second pass the same day: hlviewer with player models, or a GoldSrc → Xash demo
converter? Answered below, with the two formats side by side and a proof that our engine
already plays GoldSrc-protocol demos of its own.*

## What a demo is

A GoldSrc `.dem` (magic `HLDEMO`) is the recording of a client's session as the client saw
it: a header, a directory of segments, and frames. Most frames are **network messages** —
the very packets the server sent, protocol 46/47/48, delta-compressed entity updates and
all — each with the client's own view at that moment (`ref_params`, `usercmd`,
`movevars`). The rest are client-side frames: console commands, `clientdata`, events,
weapon animations, sounds. Playing one back means feeding the recorded packets to a
client that understands the protocol and drawing the recorded view.

## The engine already plays GoldSrc-protocol demos — its own

Our pinned engine (`cl_demo.c`, and FWGS master, same code) records and plays `IDEM`
demos whose header says `net_protocol = 176`, which is `PROTOCOL_GOLDSRC_VERSION | BIT(7)`:
a demo of a session against a GoldSrc server, with the GoldSrc packets inside, parsed on
playback by the same `cl_parse_gs.c` that parses them live. Proof, in the browser, against
our ReHLDS (`web/bench/demo.mjs`: join, `record bench`, walk and shoot for eight seconds,
`stop`, read the file out of the engine's filesystem, `playdemo bench`, screenshot):

```
record     recording to bench.dem. | Completed demo | Recording time: 00:08, frames 539
file       /rodir/cstrike/bench.dem  104579 bytes  magic IDEM  demo protocol 3  net protocol 176  map de_dust2
```

and the screenshots at two and five seconds into playback show de_dust2 drawn from the
recorded viewpoint, the knife viewmodel, the HUD, the round clock counting, the net graph
at 0.00 kb/s in and out (nothing on the wire — the frames come from the file). So the
client we serve at `/play` is a working first-person demo player for GoldSrc-protocol
sessions today. What it cannot open is the *file format* Shane's demos are in.

## The two formats, side by side

Read from `cl_demo.c` (ours and master's) and from hlviewer's field-by-field reader
(`src/Replay/Replay.ts`, proven on real files).

**Header.** GoldSrc: `HLDEMO\0\0`, demo protocol 5, net protocol, map name (260), game
directory (260), a CRC, directory offset. Xash: `IDEM`, demo protocol 3, net protocol,
`host_fps` (double), map name (64), comment (64), game directory (64), directory offset.

**Directory entry.** GoldSrc: type (0 loading, 1 playback), description (64), flags, CD
track, track time, frame count, offset, length. Xash `demoentry_t`: type, playback time,
frame count, offset, length, flags, description (64). The same facts, reordered.

**A network-message frame.** The only kind that matters for the picture.

| GoldSrc frame type 0/1 | Xash `dem_norewind`/`dem_read` |
|---|---|
| byte type, float time, int frame | byte cmd, float seconds since the section began |
| 4 bytes, `ref_params_t` (view origin and angles, forward/right/up, frametime, health, punch angle, …), `usercmd_t` (52 bytes), `movevars_t`, view vector, viewmodel index — about 460 bytes of the client's own state | *(nothing; Xash reconstructs the view from `svc_clientdata` and from re-running the recorded usercmds)* |
| 7 ints: incoming_sequence, incoming_acknowledged, incoming_reliable_acknowledged, incoming_reliable_sequence, outgoing_sequence, reliable_sequence, last_reliable_sequence | the same 7 ints, same order (`CL_WriteDemoSequence`) |
| int length, then the server's message with the netchan header stripped | int length, then the same |

The second half of every frame is byte-for-byte the same idea. Shane's instinct is
right: the packets convert by copying.

**The client-side frames**, where the recorder's own weapon, sounds and effects live —
GoldSrc's client predicts those locally and the server never sends them back, so the
demo carries them itself:

| GoldSrc frame | Xash frame | what a reader inside the engine would call |
|---|---|---|
| 2 demo start | — | nothing |
| 3 console command (64 chars) | — | `Cbuf_AddText` |
| 4 clientdata (origin, angles, weapon bits, fov) | — | nothing: `svc_clientdata` in the stream has it |
| 5 next section | `dem_stop` | `CL_DemoMoveToNextSection` |
| 6 event (flags, index, delay, `event_args_t`) | — | `CL_QueueEvent(flags, index, delay, &args)` |
| 7 weapon animation (sequence, body) | — | the client dll's `pfnWeaponAnim` |
| 8 sound (channel, name, attenuation, volume, flags, pitch) | — | `S_StartSound` after `S_RegisterSound` |
| 9 demo buffer (client dll's own bytes) | `dem_userdata` | `pfnDemo_ReadBuffer` |
| *(the `usercmd_t` inside each frame 0/1)* | `dem_usercmd`: outgoing sequence, command number, and the usercmd in **Xash's own delta encoding** | copy the struct into `cl.commands[]`, as `CL_ReadDemoUserCmd` does after decoding |

Xash has no frame for events, weapon animations, sounds or console commands, because
Xash re-runs the recorded usercmds through the client dll's prediction on playback and
lets it fire its own events again. A GoldSrc demo's usercmds can drive that too — if
they reach the engine as usercmds.

## The three ways in, assessed

### A. A standalone converter, `HLDEMO` → `IDEM` (the relay, or a script)

The header, directory and network frames convert mechanically; the relay could write a
`.xash.dem` beside every upload. Two things do not:

1. **The usercmds.** Xash's `dem_usercmd` carries the usercmd in the engine's delta
   encoding (`CL_WriteUsercmd(PROTO_CURRENT, …)`, bit-packed against the engine's field
   table). Skip them and the recorder's *look direction* is gone — GoldSrc's
   `svc_clientdata` has origin, velocity and punch angle but not view angles; those are
   client-side, and Xash takes them from the usercmds during playback. So the converter
   must reproduce Xash's usercmd encoding bit for bit, and re-do it when the engine's
   table changes.
2. **The client-side frames.** Nowhere to put them. Drop them and the recorder's own
   gunfire, weapon animations and muzzle flashes vanish (everyone else's come through
   the server stream). Or forge server messages for them — `svc_weaponanim` is easy,
   `svc_sound` needs the sound's index from the demo's resource list and fails for
   sounds the client never precached, `svc_event` means delta-encoding `event_args_t`
   against the demo's own delta descriptions. That is a second network encoder, outside
   the engine, for messages the engine can already act on directly.

A converter is the right shape only if the target format could hold everything. It
cannot; it would be a lossy converter plus an encoder that mirrors engine internals.

### B. A `HLDEMO` reader inside the engine (`cl_demo.c`, our patch 0005)

The same conversion, done at read time, where every piece has a function to hand it to:

- header and directory: parse, keep the entries as `demoentry_t` (a reorder);
- frame 0/1: skip the 460 bytes of client state but keep its `usercmd_t` — copy it into
  `cl.commands[]` the way `CL_ReadDemoUserCmd` does after decoding, and its view angles
  into the angle-interpolation ring; then the 7 ints and the message go down the very
  path `CL_ReadRawNetworkData` already takes;
- frames 3, 5, 6, 7, 8, 9: the calls in the table above — no encoding anywhere;
- frame time: the file's absolute `time` minus the section's first, as Xash's `dt`.

Precedent: the file already holds a second reader, `CL_DemoReadMessageQuake` for Quake
`.dem`, chosen by the magic at byte 0; a third is the same switch. Size: about 250 lines
of parsing, 100 of struct layouts (crib hlviewer's field-by-field reader, which is what
is proven), 100 of dispatch. The same patch applies to master — its `cl_demo.c` has the
same functions — so it survives the rebase. First milestone, network frames and
usercmds only: the map, the entities, the other players, the recorder's view and
everything the server sent — a couple of days. Then the client-side frames, a day.

Risks, in order: **protocol 46/47** (demos from before about 2004 — `cl_parse_gs.c`
parses 48 only; the `/demos` page shows each file's protocol, so we will know this
weekend which of Shane's files are which); server messages from mods or client versions
our parser does not know (the engine already tolerates unknown user messages);
`MAX_INIT_MSG` per message (196 KB in Xash, well above anything GoldSrc sends).

### C. hlviewer.js, extended with player models

What it is (`skyrim/hlviewer.js`, MIT, v0.8.5 June 2026, pushed this month; solid-js,
gl-matrix, raw WebGL, no three.js): BSP with lightmaps, wads, sky, sprites, sounds, and a
demo reader that parses every frame and decodes the delta-compressed entities
(`FrameDataReader.ts`, 1,285 lines). What it does with them: `ReplayState.ts` keeps the
camera and nothing else — its own comment is "TODO: handle spawnbaseline, clientdata,
and similar messages" — and `WorldScene.draw` takes the *map's* entity lump, so even a
door in the demo does not move. Adding player models means:

1. an entity table: baselines, delta application per frame, removals — the decoders
   exist, the bookkeeping does not (a few hundred lines);
2. an MDL parser and renderer — hlviewer has none. `danakt/web-hlmv` (pushed August
   2026, ~2,000 lines TypeScript) has a parser worth taking (~600 lines) and a three.js
   renderer that would be a rewrite for hlviewer's raw WebGL: bone matrices per frame,
   skinning, 8-bit palette textures, chrome and additive flags (~500 lines);
3. the part that makes a *player* look right: the CS client's studio renderer blends a
   gait sequence for the legs with the upper-body sequence, derives gait yaw from
   velocity, applies the entity's blending and controllers, and steps frames by animtime
   and framerate — `StudioEstimateGait`, `StudioProcessGait`, two-sequence
   `StudioSetupBones`, about 800 lines in the HL SDK, ported by hand;
4. then the rest of a first-person game: `p_` weapon models on the hand bone, `v_`
   viewmodels for the recorder, muzzle flashes and shells from events, player names,
   the HUD, sounds by index, water, the skybox — each its own project.

The end of that road is a second Counter-Strike client, in TypeScript, forever behind
the real one — which we already run in the same browser. hlviewer stays what it is good
for: a light exhibit that answers "does this file parse, and what map is it" and shows
the camera path; not the way to the first-person view.

## Protocol 46 and 47: what a demo from the 2000s carries

Shane's demos are from before October 2008, when the Steam update moved GoldSrc from
protocol 47 to 48 (thread of 23 October 2008 on half-life.pro; the previous change was
WON → Steam, 46 → 47, September 2003). So the drive holds **47** (Counter-Strike 1.6 on
Steam, 2003–2008) and, for anything from CS 1.5 or earlier, **46** (WON).

The reference is compLexity Demo Player (`jpcy/coldemoplayer`, GPL-3, 2008–2014): it
played "any 1.0 to 1.6 demo with the current version of 1.6" by rewriting the file for a
protocol-48 client, and its `HalfLifeDemoConverter.cs` is the complete list of what
differs. Read against our engine's parser:

| protocol | differs from 48 in | where the engine handles it |
|---|---|---|
| 47 | the version number in the header and in `svc_serverinfo`; nothing else on the wire | `CL_ParseServerData` accepts the demo's number |
| 46 and 47 | a secured server followed `svc_serverinfo`'s VAC flag with 21 bytes | skipped when the flag is set during playback |
| 46 | `svc_clientdata` numbers the weapons in 5 bits, not 6 | `CL_ParseClientData` reads 5 |
| 46 | `svc_voiceinit` has no quality byte | `CL_ParseVoiceInit` assumes 5 |
| 43–45 | Counter-Strike betas: big-endian bit streams, other layouts | not ours |

Everything else — the delta descriptions, entity updates, events, sounds, resource
lists — is self-describing or unchanged since 46. The rest of coldemoplayer's work is
**game-level**, for CS 1.0–1.5 demos played by the 1.6 client dll, which ours is: player
sequence numbers from 83 up shift by 16 (the 1.6 models gained shield animations);
`_r.mdl` weapon models lose the suffix (1.5 had left- and right-handed files); a
blacklist of 24 sprites (the old HUD); the `SendAudio` user message gains a pitch short;
`ClCorpse` carries a sequence that shifts like the players'. The CS version comes from
the client dll MD5 in `svc_serverinfo` (six known checksums, 1.0 to 1.5). None of that
is done yet; it needs a 46 file to test against, which the drive will have.

## Where it stands, 11 September 2026

Patch `0005-goldsrc-demos` is built and in `/play`'s engine: `playdemo` opens a HLDEMO
file, and `bench/hldemo.mjs <demo> [map]` fetches a demo (and its map) from the relay
into the engine's filesystem and plays it. Tried:

| file | protocol | what happened |
|---|---|---|
| a Kreedz record on kz_longjumps2, CS 1.6 (KZ-Baltic archive) | 48 | plays: first person, HUD, knife and USP viewmodels, the plugin's chat, the clock running |
| an HLTV match demo on de_dust2, 162 MB (2022, from the Internet Archive) | 48 | plays: chase camera behind the players, models, scoreboard, "Knife round" |
| a Half-Life speedrun segment, 2004 (Speed Demos Archive) | 47 | runs through its whole loading section — serverinfo, delta descriptions, user messages, resource list — with protocol 47, and stops at the map, `c1a4k`, which we do not have: the same point a 48 demo reaches without its map |

The 47 path is therefore proven through the loading section; the playback section of a
Counter-Strike 47 demo is what remains, and coldemoplayer's record says nothing differs
there. Getting the Half-Life file that far took an afternoon, for two things the engine
did to any demo of a *single-player* game: `CL_ClearState` shuts the console when
serverinfo arrives and only a multiplayer game reopens it, so the recording played out
in silence, errors included; and the map checksum of a single-player game is a
constant, so the demo's real checksum never matched and the client disconnected behind
that closed console. Both are in the patch: a recording keeps its console, gets the
file's real checksum, and a mismatch is a warning — the map we have may be a later
edit of the one it was recorded on, and the museum will meet that often. No 46
file has been found online yet (Speed Demos Archive's 2004 Half-Life runs are all 47);
CS 1.5 demos from the drive are the first.

What a demo needs on our side: its map, as a file the engine can load (the play page
fetches maps per bundle, so a demo player fetches the demo's map first), and the
resources its server precached — the resource list inside the demo is exactly the
dependency list the collection tracks for maps, and the same red-for-missing treatment
applies. Missing sounds are logged and skipped (five KZ-plugin sounds on the first file);
a missing model or map is fatal.

Open questions, to be answered with real files: whether the recorded client-side
events double up with the ones prediction fires again from the recorded usercmds;
whether the recorded console commands (frame type 3) are worth replaying — for now
they are logged at developer level and not run.

## The demos page, 11 September 2026, evening

`/demos` lists the recordings with what each says about itself, takes uploads (a file
picker or a drop anywhere on the page; the relay checks the magic before writing), and
plays one at `/demos/<name>`: the play page in a second mode, no server — the engine
boots as for a game, the recording's map comes from the bundles or, if the bundles do not
carry it, from the server's files with the wads and sky the catalogue names, every model
and sound the server had that the Steam base does not comes from `/raw`, then the file
itself, then `playdemo`. Under the picture, the transport: pause (space), a draggable
scrubber, ← → for ten seconds, speed from ¼× to 4×, the details, and for an HLTV
recording the perspective — the director, chase, eyes, free look, overview, next and
previous player. A player's own recording holds only their view, and the bar says so.

Engine patch 0006 is what the bar drives: `demo_pause`, `demo_speed` (the whole host
frame scales, so animations and the recording agree), `demo_seek` (forward by running the
frames in between without waiting, a few hundred a host frame so the page keeps
breathing; backward by starting again and running forward; client-side sounds and
events on the way are not replayed) and `Demo_WebState()`, the engine's word on where the
recording is. The relay reads a recording without the engine (`relay/demoinfo.go`): the
header and directory, the loading section's messages up to the resource list (a Go port
of the delta description decoding hlviewer.js does), and a scan of the playback section
for the frames the client wrote — what the recorder typed, the sounds their client
played. Measured on the 162 MB HLTV match: the page shows the bar 5 s after opening
(the game cached), a seek to the 14th minute arrives in about a second, a seek backward in
half a second, and the mouse stays with the page until the picture is clicked.

Two things Shane found on the first evening: the 2004 Half-Life recording failed with a
bare 404 for its map, and the scrubber would not drag for him where it dragged for the
test (which fed the slider synthetic events, as no hand does). Now a recording whose map
we cannot serve says so on the list (no Play) and on the page, before anything boots; the
slider is the hand's from the press to the release, so the bar's quarter-second tick
cannot rewrite it in the pause between pressing the thumb and moving it; and while a
seek is in flight the bar holds the destination and the status shows the frame reached
(`at` in `Demo_WebState`), instead of the time reading 0:00 through a backward seek's
restart.

What is not there, and why: third person for a player's own recording — the client's
camera code refuses it in multiplayer, and a recording is multiplayer; following other
players in a POV recording — the file holds one player's view and nothing of the others
beyond what they saw; the recorded console commands (frame type 3) are still not
replayed.

## The plan

**B.** The reader in the engine, as patch 0005 — done for 48, 47 up to serverinfo, 46 by
the book and untested; game-level fix-ups for CS ≤ 1.5 when a 46 file arrives. hlviewer as the parse-and-preview exhibit on
the `/demos` page meanwhile, which also tells us the protocols on Shane's drive. Real
demos this weekend decide the order of the risks.
