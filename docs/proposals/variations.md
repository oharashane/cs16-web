# The variations: mods, map families, sounds, and the older versions

*Research and a plan, 12 September 2026. Shane: collect the other ways Counter-Strike was
played — zombie, Warcraft 3, surf, bhop, "what else am I forgetting" — plus 5v5 PUG
configs, the event sounds everyone had in the early 2000s, and the question underneath all
of it: could we retrofit 1.5, or 1.0, or a beta, onto our 1.6 engine? Some will not work;
the museum's job is to try.*

## 1. What people actually ran

Servers of 2002–2010 divided into a few dozen recognisable kinds. Sorted by what it would
take us to stand one up, because that is the useful axis.

### Configuration only — no new code, sometimes no new files

| kind | what it is | what it needs from us |
|---|---|---|
| **Classic / competitive** | the game, league rules | cvars. **Built: `match`** |
| **Aim** | one room, two rifles, no economy | cvars (ReGameDLL hands out the guns). **Built: `aim`** |
| **AWP** | one rifle, one shot | cvars. **Built: `awp`** |
| **Scoutzknivez** | low gravity, scouts, knives | cvars. Built already |
| **Fun / fy** | everything on the floor | the map does it; we have 43 `fy_` maps |
| **Surf** | ride the ramps: `sv_airaccelerate` 100–1000 | cvars, plus `surf_` maps — **we have none** |
| **Bhop / Kreedz** | jump chains, a timer | cvars. **Built: `climb`**, with one map — the gap is maps |
| **HE / grenade** | grenades only | cvars plus restriction; we have one `he_` map |
| **Knife / pistol** | one weapon | cvars, and we already do pistols-only for bots |
| **35hp / low-HP duels** | duels at low health | cvars; maps missing |

### A plugin, which we can compile ourselves

Our server image carries the AMX Mod X compiler (`amxxpc`), so a plugin is a file we write
rather than a binary we trust.

| kind | what it is | the work |
|---|---|---|
| **Quake sounds** | announcer over kills and streaks (see §3) | ~100 lines of Pawn; the sounds are the hard part |
| **PUG / match plugin** | knife round, ready-up, half switch, score | a few hundred lines, or port an existing one |
| **Deathrun** | one runner triggers traps, the rest run | a plugin plus `deathrun_` maps |
| **Hide and seek** | as it sounds | a plugin plus maps |
| **Jailbreak** | guards, prisoners, a warden giving orders | a plugin, maps, and a referee |
| **Furien** | one side fast and invisible, the other armed | a plugin |
| **Zombie mod** (simple) | infection, one hit turns you | a plugin; the simple ones are small |
| **Base builder** | build a fort out of blocks, then defend it | a plugin |
| **Soccer / football** | a ball entity and two goals | a plugin plus maps |

### A whole mod — someone else's, thousands of lines

| kind | what it is | the risk |
|---|---|---|
| **Zombie Plague 4.3 / 5.0** | classes, an item shop, ammo packs, many zombie types. The biggest mod CS 1.6 ever had | Reported working on AMX Mod X 1.10 with ReGameDLL, which is our stack. Large; brings its own models and sounds, which our bundle pipeline must carry |
| **Warcraft 3 (War3FT / WC3FT)** | races, experience, levels, skills. The other giant | Same shape. Later forks target AMXX 1.8–1.10 |
| **Superhero** | pick powers, level up | same family as Warcraft 3, smaller |
| **CSDM / ReDeathmatch** | respawn, weapon menus | already installed and running |
| **Gun Game** | the weapon ladder | already installed and running |

### What Shane was forgetting

From the server lists of the era: **deathrun**, **jailbreak** (and its "hosties" variant),
**hide and seek**, **furien**, **base builder**, **zombie escape** (a mode of the zombie
mods, on `ze_` maps), **soccer jam**, **kreedz/KZ** as distinct from plain bhop, **HNS**,
**35hp duels**, **respawn/instagib** servers, **Mario Kart** (yes, really), **The Hidden**
style asymmetric mods, **paintball**, **war3 + zombie hybrids**, and the two that are not
mods at all but were half the server list: **aim** and **awp** maps. Also **1v1 arena**
servers, and **retake/execute** practice, which came later.

## 2. Five-on-five, properly

The league numbers barely changed for a decade, and `match` now carries them: a 1:45
round, six seconds of freeze, fifteen seconds of buy time, a 35-second bomb, eight hundred
dollars to start, friendly fire on, auto-balance off, and the dead watching only their own
team so nobody calls out what they can see.

What the cvars cannot do is **run a match**: the knife round for side choice, the
ready-up, the switch at fifteen rounds, the score and the overtime are all a plugin's job.
That plugin is the next piece of work here, and it is ours to write — a few hundred lines
of Pawn against a compiler we already have.

## 3. The sounds, which is a better question than it looks

The announcer packs — "Headshot", "Killing Spree", "Dominating", "Godlike", "Holy Shit" —
are Quake 3 and Unreal Tournament audio, carried into Counter-Strike by AMX Mod X plugins:
**Quake Sounds**, then **Advanced Quake Sounds** (v3 through v8), plus **AMX Super**, which
bundled them with chat-triggered sounds (`say lol` plays a clip). Beside those: MP3 players
on the server, round-start music, and per-map ambience.

**We already have the evidence.** The Kreedz recording from 2007 that the demos page plays
asks its client for five files nobody here has:

    sound/misc/impressive.wav   sound/misc/perfect.wav
    sound/misc/mod_godlike.wav  sound/misc/holyshit.wav   sound/misc/mod_wickedsick.wav

That is an Advanced Quake Sounds pack, named exactly as that plugin names it. A recording
in our museum is missing its own soundtrack, and restoring it is a museum act rather than
a feature.

**How it would work here.** Two halves.

1. *The plugin.* Ours, compiled in the image: hook a death, count the streak, play the
   sound, print the word. It must precache only files that exist, so a missing pack
   degrades to silence rather than a server that will not start.
2. *The files.* Our browser client does not download from `sv_downloadurl` the way a
   desktop client does; it plays out of the bundles the packager builds. So a mode's own
   sounds need one of: a place in the base bundle (a 202 MB rebuild everyone
   re-downloads), or — better — **mode content**: a short list of extra files in
   `modes.json` that the play page fetches from `/raw` before it connects, exactly as the
   demo page already fetches what a recording's server had. A megabyte of announcer
   sounds, fetched once, cached like everything else.

The audio itself should come from Shane's own drive rather than from a download site: it
is Quake and Unreal audio, and the museum's rule is that other people's work is credited
and not re-hosted casually. Every CS install of that era had it.

## 4. Could we run 1.5? Or 1.0? Or a beta?

The honest answer has three layers, and the middle one is where the fun is.

**The client is the hard boundary.** What the browser runs is `cs16-client`, a
reimplementation of Counter-Strike 1.6's client library. The 1.5 client was a different
binary, and nobody has ported it to WebAssembly; doing so is a project on the scale of
this whole one. So a *true* 1.5 client — its HUD, its recoil drawing, its viewmodels'
timing — is out of reach for now.

**The server can be made to behave older.** ReGameDLL already carries legacy switches
(`mp_legacy_bombtarget_touch`, `mp_legacy_vehicle_block`, `mp_old_bomb_defused_sound`),
and AMX Mod X's `restmenu` can forbid the weapons 1.5 did not have — the **Famas** and the
**Galil**, added in 1.6, and the **Tactical Shield**, also 1.6's. Round times, economy and
buy rules are all cvars. That gets a recognisable 1.5 *ruleset*.

**The content is where it actually lives.** What made 1.5 look and sound like 1.5 was its
files: the older player and weapon models (including the separate right-handed `_r.mdl`
weapon models that 1.6 dropped — compLexity Demo Player's converter renames them, which is
how we know), the older HUD sprites, the older sounds, and the *earlier versions of the
maps*: de_aztec and de_inferno were visibly different, and de_dust2 has had several. All of
that is fan-preserved and downloadable, and the Internet Archive carries full 1.0, 1.3, 1.5
and 1.6 installations as single items.

So **"1.5 mode" is achievable as a costume with older rules underneath**, which is a
perfectly good museum exhibit as long as the label is honest: *this is 1.6's engine and
client wearing 1.5's content and 1.5's rules*. The same trick goes back further — 1.3, 1.1,
even the betas — and gets less accurate the further back it goes, because more of the
difference was in code we are not running.

A fourth layer, mentioned for completeness and not recommended yet: running the **actual
1.5 game library** (`cs_i386.so`) on our server instead of ReGameDLL. The engine interface
was stable enough that it might load. It would lose Metamod, AMX Mod X, the bots and every
mode we have, and the browser client would still be 1.6's. A curiosity to try on a throwaway
server, once, and write up.

## 5. What was built today

Four modes, from parts already on the server, no new content:

- **`match`** — 5v5 league rules, twelve classic maps.
- **`aim`** — ten `aim_` maps, AK against M4, no economy; the guns come from ReGameDLL's
  own default-weapon cvars rather than a plugin.
- **`awp`** — eight `awp_` maps, one rifle.
- **`climb`** — Kreedz settings on `kz_longjumps2`, the one climbing map we have.

All four are proven by `bench/modes.mjs`: the server switches, a browser joins, and the
cvars read back. In `aim` the game itself hands out the guns — `mp_t_default_weapons_primary`
reads `ak47`, the counter-terrorists' `m4a1`, both with a Deagle and armour, no buy time
and no money — which is a plugin's worth of behaviour bought with four cvars.

The packager rebuilt the bundles for the twenty-five new maps: 27 MB of new map bundles,
and the base grew from 202 MB to 221 MB with a new hash, so every browser downloads the
base once more. That is the price of widening the rotation and it is worth knowing before
the next widening.

### One thing the trying broke, and fixed

Adding `kz_longjumps2` to the server's content on 11 September was not enough to make it
playable: the entrypoint links `/content/maps/*` into the game's map directory **at
start**, so a map added while the container runs is invisible until it restarts. And the
restart itself failed. The entrypoint copies the mode's addons over the image's, and one
of those files — `users.ini`, the admin list — has since become a symlink to the relay's
copy, made by the entrypoint's own next line. On a second start `cp` found source and
destination were the same file, refused, and `set -e` killed the container into a restart
loop. It had been that way since invitations shipped on 9 September and nobody had
restarted the container to find out. The fix is one `rm -f` before the copy, and the
proof is a second restart that comes up.

## 5b. The second batch, and the plugin under it

Shane picked four: zombie escape, hide and seek, jailbreak, 35hp. Three needed a
mechanic no cvar expresses, so the image's Pawn compiler earned its place — one small
plugin, `cs-server/plugins/museum.sma`, all of it off until a mode turns it on:

| cvar | what it does | which mode wants it |
|---|---|---|
| `mm_health` | health on spawn | 35hp |
| `mm_armor` | armour on spawn | several |
| `mm_strip` | take the guns on spawn, by team (1 = T, 2 = CT) | hide and seek, jailbreak, infection |
| `mm_knife` | give the knife back to whoever was stripped | the same |
| `mm_speed` | maximum speed on spawn | infection |
| `mm_infect` | dying puts you on the terrorists' side | infection |

It compiles to 2 KB, loads as plugin 18, and `35hp` shows 35 on the HUD with a Deagle in
hand — the screenshot is the proof. The four modes:

- **`35hp`** — 35 health, a Deagle each, small maps.
- **`hns`** — hiders stripped to a knife, fifteen seconds of freeze time, six-minute rounds.
- **`jail`** — guards with an MP5, prisoners with knives, and nothing enforcing the rules,
  which is what jailbreak always was: a game held together by a person on a microphone.
- **`infect`** — armed against knives, and everyone who dies changes sides. The idea under
  every zombie mod, without their models, classes or shops.

**Zombie Escape specifically** is `infect` plus `ze_` maps, and we have none. Those maps
are the mode: a long route, chokepoints to hold, a door at the end and a timer. Until the
drive supplies them, what we have is the infection, not the escape, and the tour says so.

## 6. What is next, in order

1. **Maps.** The biggest gap is not code, it is `surf_`, `bhop_`, `kz_`, `deathrun_` and
   `he_` maps. The drive first, then the archives. A mode with one map is a placeholder.
2. **Mode content.** The mechanism in §3: a mode may name extra files, fetched from `/raw`
   before connecting. It unlocks sounds, custom models and eventually whole mods without a
   base rebuild.
3. **Our Quake sounds plugin**, on that mechanism, with the recording's own missing files
   as the first thing it restores.
4. **A match plugin** so `match` can actually run a match.
5. **The 1.5 costume:** the ruleset (weapon restriction, legacy cvars) plus a content set
   from the archive, as one mode and one museum exhibit that explains what is and is not
   authentic about it.
6. **One big mod**, as a trial — Zombie Plague or Warcraft 3 — to learn what a large
   third-party mod costs us in bundle size and in maintenance. Not before the mechanism in
   step 2 exists.
