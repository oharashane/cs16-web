/*
 * announcer.amxx — the "Quake sounds": a voice that shouts FIRST BLOOD and MONSTER KILL.
 *
 * Every public server of 2004 had them, and nearly all of them were Unreal Tournament's
 * announcer, not Quake's; the name stuck anyway. This is the mechanic in one file, with
 * the rules the popular plugins settled on:
 *
 *   first blood      the first kill of the round
 *   headshot         a kill by headshot (one of three takes of the word)
 *   knife / nade     a kill with the knife or a grenade
 *   humiliation      a suicide
 *   payback          killing the one who killed you last
 *   double … holy    2–9 kills in one round without dying: double, triple, multi, mega,
 *                    ultra, monster, ludicrous, holy shit
 *   spree … sick     kills across rounds without dying: 5 killing spree, 10 rampage,
 *                    15 dominating, 20 unstoppable, 25 godlike, 30 wicked sick
 *   hat trick        three headshots in a round
 *
 *   qs_enabled <0|1>   the whole thing (a mode's .cfg can turn it off; match does)
 *   qs_hud     <0|1>   the words on screen as well as the voice
 *   qs_prepare <0|1>   "prepare to fight" at every round start; off, it wears thin
 *
 * The sound is played on the client ("play"), so the files ride in the browser's extras
 * bundle and are precached as generic files for the native game to download. The wavs
 * are the set every server passed around; the voice is Unreal Tournament's (Epic, 1999).
 */
#include <amxmodx>

#define STREAK_NAMES 6
#define MULTI_NAMES 8

new pEnabled, pHud, pPrepare;
new g_roundKills[33];     // kills this round without dying — the multi-kill ladder
new g_streak[33];         // kills since the last death — the spree ladder
new g_headshots[33];      // headshots this round
new g_lastKiller[33];     // who killed me last, for payback
new bool:g_firstBlood;    // has the round's first blood been drawn
new g_dir[] = "QuakeSounds";

new const g_multi[MULTI_NAMES][] = { "doublekill", "triplekill", "multikill", "megakill", "ultrakill", "monsterkill", "ludicrouskill", "holyshit" };
new const g_multiWords[MULTI_NAMES][] = { "Double kill", "Triple kill", "Multi kill", "Mega kill", "Ultra kill", "MONSTER KILL", "Ludicrous kill", "HOLY SHIT" };
new const g_streakAt[STREAK_NAMES] = { 5, 10, 15, 20, 25, 30 };
new const g_streakSound[STREAK_NAMES][] = { "killingspree", "rampage", "dominating", "unstoppable", "godlike", "whickedsick" };
new const g_streakWords[STREAK_NAMES][] = { "Killing spree", "Rampage", "Dominating", "Unstoppable", "GODLIKE", "Wicked sick" };
new const g_all[][] = { "firstblood", "firstblood2", "firstblood3", "headshot", "headshot2", "headshot3", "knife", "knife2", "knife3", "nade",
    "suicide", "suicide2", "suicide3", "suicide4", "payback", "hattrick", "prepare", "prepare2", "prepare3", "prepare4",
    "doublekill", "triplekill", "multikill", "megakill", "ultrakill", "monsterkill", "ludicrouskill", "holyshit",
    "killingspree", "rampage", "dominating", "unstoppable", "godlike", "whickedsick" };

public plugin_precache()
{
    new path[64];
    for (new i = 0; i < sizeof g_all; i++) {
        formatex(path, charsmax(path), "sound/%s/%s.wav", g_dir, g_all[i]);
        precache_generic(path);
    }
}

public plugin_init()
{
    register_plugin("Announcer", "1.0", "cs16-web");
    pEnabled = register_cvar("qs_enabled", "1");
    pHud     = register_cvar("qs_hud", "1");
    pPrepare = register_cvar("qs_prepare", "0");
    // Cvars outlive a map change and register_cvar leaves an existing one alone, so a mode
    // that turned the announcer off would keep it off for every mode after. Back to on at
    // every map; the mode's .cfg, exec'd after this, has the last word.
    set_pcvar_num(pEnabled, 1);
    register_event("DeathMsg", "on_death", "a");
    register_event("HLTV", "on_round_start", "a", "1=0", "2=0");
    register_logevent("on_round_end", 2, "1=Round_End");
}

public client_putinserver(id) { g_streak[id] = 0; g_roundKills[id] = 0; g_headshots[id] = 0; g_lastKiller[id] = 0; }

public on_round_start()
{
    g_firstBlood = false;
    for (new i = 1; i <= 32; i++) { g_roundKills[i] = 0; g_headshots[i] = 0; }
    if (get_pcvar_num(pEnabled) && get_pcvar_num(pPrepare)) {
        new const takes[][] = { "prepare", "prepare2", "prepare3", "prepare4" };
        shout(0, takes[random(sizeof takes)], "");
    }
}

public on_round_end() { }

public on_death()
{
    if (!get_pcvar_num(pEnabled)) return;
    new killer = read_data(1), victim = read_data(2), headshot = read_data(3);
    new weapon[24]; read_data(4, weapon, charsmax(weapon));
    if (victim < 1 || victim > 32) return;
    new name[32];

    g_streak[victim] = 0; g_roundKills[victim] = 0;
    if (killer == victim || killer < 1 || killer > 32) {
        new const takes[][] = { "suicide", "suicide2", "suicide3", "suicide4" };
        get_user_name(victim, name, charsmax(name));
        shout(0, takes[random(sizeof takes)], name);
        return;
    }
    if (get_user_team(killer) == get_user_team(victim)) return;   // a team kill earns nothing

    get_user_name(killer, name, charsmax(name));
    g_streak[killer]++; g_roundKills[killer]++;
    new bool:said = false;

    if (!g_firstBlood) {
        g_firstBlood = true;
        new const takes[][] = { "firstblood", "firstblood2", "firstblood3" };
        shout(0, takes[random(sizeof takes)], name); said = true;
    }
    // The ladders outrank the manner of the kill: a monster kill says monster kill.
    if (!said && g_roundKills[killer] >= 2 && g_roundKills[killer] <= MULTI_NAMES + 1) {
        new words[64]; formatex(words, charsmax(words), "%s — %s", g_multiWords[g_roundKills[killer] - 2], name);
        shout(0, g_multi[g_roundKills[killer] - 2], words); said = true;
    }
    for (new i = 0; i < STREAK_NAMES && !said; i++) {
        if (g_streak[killer] == g_streakAt[i]) {
            new words[64]; formatex(words, charsmax(words), "%s — %s, %d in a row", g_streakWords[i], name, g_streak[killer]);
            shout(0, g_streakSound[i], words); said = true;
        }
    }
    if (headshot) {
        g_headshots[killer]++;
        if (g_headshots[killer] == 3) { new words[64]; formatex(words, charsmax(words), "Hat trick — %s", name); shout(0, "hattrick", words); said = true; }
        else if (!said) { new const takes[][] = { "headshot", "headshot2", "headshot3" }; shout(0, takes[random(sizeof takes)], ""); said = true; }
    }
    if (!said && equal(weapon, "knife")) { new const takes[][] = { "knife", "knife2", "knife3" }; shout(0, takes[random(sizeof takes)], ""); said = true; }
    if (!said && (equal(weapon, "grenade") || equal(weapon, "hegrenade"))) { shout(0, "nade", ""); said = true; }
    // Payback is personal: only the avenger hears it.
    if (g_lastKiller[killer] == victim) shout(killer, "payback", "");
    g_lastKiller[victim] = killer;
}

// A shout: the sound on the client, and the words on everyone's screen if asked.
shout(who, const sound[], const words[])
{
    // "play", not the classic "spk": spk names a sentence, and the browser's engine will
    // build a sentence from a console command but not from one the server stuffed (the
    // same line typed works; the same line sent does nothing — measured 13 September 2026).
    // play takes the file by name in both engines.
    client_cmd(who, "play %s/%s.wav", g_dir, sound);
    if (words[0] && get_pcvar_num(pHud)) {
        set_hudmessage(0, 200, 60, -1.0, 0.30, 0, 0.0, 2.5, 0.1, 0.4, -1);
        show_hudmessage(who, "%s", words);
    }
}
