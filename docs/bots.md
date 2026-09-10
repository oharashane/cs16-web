# Bots: what it would take

*Investigated 8 September 2026; superseded on 9 September, when the server image was
rebuilt from parts (`cs-server/README.md`) and ReGameDLL 5.30's own Condition Zero bots
came with it. What follows is the original note, kept for the YaPB comparison; the state
today is at the end.*

## Where we stand

The server has no bots and cannot get them from what is already installed. `bot_quota`,
`bot_add`, `bot_difficulty` and `nav_generate` are all unknown to it, so the ReGameDLL in
`timoxo/cs1.6:1.9.0817` was built without the Condition Zero bot code that newer ReGameDLL
releases carry. Metamod is loading two plugins today, both 32-bit:

    linux addons/amxmodx/dlls/amxmodx_mm_i386.so
    linux addons/reunion/reunion_mm_i386.so

## The candidate: YaPB

[YaPB](https://github.com/yapb/yapb) — the maintained descendant of POD-Bot — release
**4.4.957**, 10 February 2024. Checked, not assumed:

| Question | Answer |
|---|---|
| Does the binary fit? | Yes. `addons/yapb/bin/yapb.so` is *ELF 32-bit LSB, Intel 80386* — the same shape as the two plugins Metamod already loads. |
| Does it know about our modes? | Yes, explicitly. `yb_csdm_mode`: "Enables or disables CSDM / FFA mode for bots", auto-detected at `0`. Deathmatch and free-for-all are handled rather than fought. |
| How many bots? | `yb_quota` (ships at 9), `yb_autovacate` to give slots back as people arrive, `yb_difficulty`. |
| What about our maps? | This is the work — see below. |

## Navigation is the whole job

A bot needs a graph of the map. The release ships graphs for **six of our twenty-three**:
de_dust2, cs_assault, cs_estate, cs_office, de_aztec, cs_italy. For the rest there are two
fallbacks, both built in:

1. **Download.** `yb_graph_url "yapb.jeefo.net"` — it fetches a graph for a map it does not
   have, if the database has one. Some of ours are well-known enough to be there
   (scoutzknivez, fy_snow, aim_map); the 1337 and rats variants probably are not.
2. **Analyse.** `yb_graph_analyze_auto_start 1` with `yb_graph_analyze_auto_save 1`: it
   walks the map itself and writes a graph, throttled to `yb_graph_analyze_fps 30` so the
   server keeps running while it does. Quality varies with the map. The fy_ and aim_ maps
   are simple boxes and should come out fine; **de_rats_1337 is the one to expect trouble
   from**, since its geometry is furniture at giant scale.

## What installing it looks like

1. Add the release to the server image with a pinned URL and sha256 — not a binary in git;
   `.gitignore` refuses `*.so` for good reasons.
2. One line in `cs-server/shared/addons/metamod/plugins.ini`, which already overrides the
   image's copy:
   `linux addons/yapb/bin/yapb.so`
3. `cs-server/main/addons/yapb/conf/yapb.cfg` for quota, difficulty, autovacate.
4. Let it analyse each custom map once, keep the graphs in the repository, and walk each
   map to see whether the bots move like players or like furniture.
5. Expose it on the play page: "Bots: none / a few / a full server", which is `yb_quota`
   and nothing more.

**Half a day**, most of it step 4. The risks are that the analyser produces poor
navigation on the odd maps, and that bots occupy slots on a sixteen-slot server — which
`yb_autovacate` is for.

## The other road

Newer ReGameDLL builds include the Condition Zero bots (`bot_quota`, `bot_add`, and
`.nav` files generated in-game with `nav_generate`). That arrives free with the "our own
server image" work in the review's plan — build ReGameDLL 5.30 ourselves and the bots are
in the box, with no third-party plugin and no graph database. Worth knowing before
committing to YaPB: if the image is being rebuilt anyway, try that first and see whether
CZ bots on generated navigation meshes are good enough.


## 9 September 2026: the built-in bots, on the new image

ReGameDLL 5.30 registers the Condition Zero bots for a Counter-Strike server when
`bot_enable 1` is in `cstrike/game_init.cfg` (set at image build; the cvar is read once at
start). Checked on the trial server:

- `bot_add` brings a bot in; `bot_quota N` keeps N of them; `bot_quota_mode fill` fills to N
  counting humans; they wait for a human (`bot_join_after_player 1`) and leave when none is
  there.
- A map without a `.nav` mesh gets one built on the spot — six seconds for de_dust2_3x3 —
  saved to `maps/<map>.nav`. `maps/` is now a writable directory (`cs-server/navs/` on the
  host) so a mesh is built once. The odd maps (rats, 1337) still want a look at how the
  bots move; a mesh can be rebuilt with `nav_generate` after `nav_edit`-style fixes.
- Their radio chatter (`sound/radio/bot/*.wav`, 7 MB, in the image) is not in the browser
  client's bundle; `bot_chatter off` in the mode files until it is, so a client never
  starts an in-band download for a line of bot speech.

What remains for the play page: a "Bots" control (none / a few / a full server → `bot_quota`
0 / 4 / 10, `bot_difficulty` 0–3), and a soak with bots as the opposition — which is the
testing use Shane wanted them for. YaPB is not needed.

## 10 September 2026: on the play page

Done: the game settings offer the bot count (fill mode: the server is filled to N players,
bots leaving as people arrive) and the skill; both persist in the mode file with the other
settings, and `bench/navs.mjs` builds the meshes for every map in the rotation once so the
first bot on a map does not stall the server. A Playwright test asks for bots and sees one
arrive. YaPB is not needed.
