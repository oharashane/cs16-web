# Playing GoldSrc demos in the browser

*Research, 11 September 2026. Shane has a drive of `.dem` files from the 2000s, wants
them playable in the browser, and wants the first-person view, not a top-down replay.*

## What a demo is

A GoldSrc `.dem` (magic `HLDEMO`) is the recording of a client's session as the client saw
it: a header, a directory of segments, and frames. Most frames are **network messages** —
the very packets the server sent, protocol 46/47/48, delta-compressed entity updates and
all — each with the client's own view at that moment (origin, angles, `refparams`,
`usercmd`, `movevars`). The rest are client-side frames: console commands, `clientdata`,
events, weapon animations, sounds. Playing one back means feeding the recorded packets
to a client that understands the protocol and drawing the recorded view.

## Two ways in

### 1. The engine itself (fidelity: the game)

Xash3D FWGS reads its own demo format only — `IDEM` magic, in both our pin and upstream
master (checked in `cl_demo.c`; the master has a Quake `.dem` reader as a second format,
so a third has precedent). It **does** understand GoldSrc protocol 48 on the wire, since
that is how it plays on ReHLDS. So the work is a `HLDEMO` reader in `cl_demo.c` that:

- parses the header and directory (well documented; four open parsers to crib from),
- walks the frames, handing each network-message frame's bytes to the client's message
  parser as `CL_DemoReadMessage` does for Xash frames, with the recorded `refparams`
  applied as the view,
- replays the client-side frames the engine would otherwise miss: sounds, weapon
  animations, events — this is where fidelity is won or lost,
- copes with protocol 46/47 demos (older) or refuses them with a clear message.

Upstream FWGS has not done it, so it is engine work of ours: a week to first frames,
longer to faithful. The prize is the real thing — models, sounds, HUD, the map as the
engine draws it — in the same page that plays the game, with the map's bundle already
there. Risks: demos recorded with client versions whose messages our parser does not
know; the older protocols; the client-side frames.

### 2. hlviewer.js (fidelity: the map and the camera)

[hlviewer.js](https://github.com/skyrim/hlviewer.js) (MIT, 180 stars, pushed 11
September 2026 — alive) renders BSP maps in WebGL and **plays `.dem` demos in the browser
today**: it parses the frames, decodes the delta-compressed entities, and moves the camera
as the recorded player did. What it does not draw: it has no MDL parser, so players and
weapons are not models; it has sprites, wads, skies, lightmaps and sounds. First-person
view, yes; a first-person *game*, no.

It needs the files served plainly: `.bsp`, `.wad`, sky faces, sounds, and the `.dem`. Our
content is on disk under `cs-server/shared/`; a read-only route can serve it.

## The plan

Start with 2, this weekend, with real demos: a `/demos` page on the relay hosting
hlviewer.js over our content, a demo upload folder, and Shane's drive. That answers,
in an evening, which of his demos parse at all (protocol, client version), what they
look like with the map drawn and the camera moving, and how much the missing models
matter. It is also a museum exhibit on its own.

Then decide on 1 with evidence: if the demos parse and the map and camera are right, the
engine reader is the fidelity step, and its first milestone is exactly what hlviewer
already shows — frames from packets — plus models and sounds for free. Take it on with
the engine rebase, since upstream's demo code has moved since the pin.
