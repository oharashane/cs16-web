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

## The plan

**B.** The reader in the engine, as patch 0005, first milestone the network frames and
usercmds, second the client-side frames. hlviewer as the parse-and-preview exhibit on
the `/demos` page meanwhile, which also tells us the protocols on Shane's drive. Real
demos this weekend decide the order of the risks.
