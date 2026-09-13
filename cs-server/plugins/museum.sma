/*
 * museum.amxx — the mechanics the old game types needed that cvars cannot express.
 *
 * One plugin for several modes, because each of these is three lines of behaviour and a
 * name. Everything is off unless a mode's .cfg turns it on, so the plugin is loaded
 * always and does nothing until asked.
 *
 *   mm_health  <n>    health on spawn (0 = leave it alone).  35hp duels.
 *   mm_armor   <n>    armour on spawn (-1 = leave it alone).
 *   mm_strip   <bits> take the guns on spawn: 1 = terrorists, 2 = counter-terrorists.
 *                     Hide and seek strips the hiders; jailbreak strips the prisoners.
 *   mm_knife   <0|1>  give a knife back to whoever was stripped.
 *   mm_speed   <n>    maximum speed on spawn (0 = the map's own).
 *   mm_infect  <0|1>  dying puts you on the terrorists' side: the infection mods' one
 *                     idea, without their models or their shop.
 *   mm_forceaim <name>  THE LAB'S AIMBOT (the player's exact name), for the museum's cheats exhibit: the server
 *                     turns the named player's view to the nearest enemy's eyes twenty
 *                     times a second, exactly as a client-side aimbot would from the
 *                     other end. A recording of that player is what "an aimbot in the
 *                     usercmd stream" looks like. Empty = off (the default, always).
 *   mm_aimlog <name>  the server-side detector's raw material: the named player's view
 *                     angles as each of their commands arrives, one line per command in
 *                     addons/amxmodx/logs/aim.csv. What HLGuard and the AMXX aim
 *                     detectors looked at. Empty = off.
 *
 * Built for cs16-web's museum. The mods this imitates were other people's work and are
 * credited on the tour; this is the mechanic, not the mod.
 */
#include <amxmodx>
#include <cstrike>
#include <fun>
#include <fakemeta>
#include <xs>

new pHealth, pArmor, pStrip, pKnife, pSpeed, pInfect, pForceAim, pAimLog;

public plugin_init()
{
    register_plugin("Museum modes", "1.0", "cs16-web");

    pHealth = register_cvar("mm_health", "0");
    pArmor  = register_cvar("mm_armor",  "-1");
    pStrip  = register_cvar("mm_strip",  "0");
    pKnife  = register_cvar("mm_knife",  "1");
    pSpeed  = register_cvar("mm_speed",  "0");
    pInfect = register_cvar("mm_infect", "0");
    pForceAim = register_cvar("mm_forceaim", "");
    pAimLog = register_cvar("mm_aimlog", "");
    set_task(0.05, "force_aim", .flags = "b");
    register_forward(FM_PlayerPreThink, "on_prethink");

    // ResetHUD is the engine telling one client its HUD is new, which is what a spawn is.
    register_event("ResetHUD", "on_spawn", "be");
    register_event("DeathMsg", "on_death", "a");
}

public on_spawn(id)
{
    if (!is_user_alive(id))
        return;

    new health = get_pcvar_num(pHealth);
    if (health > 0)
        set_user_health(id, health);

    new armor = get_pcvar_num(pArmor);
    if (armor >= 0)
        set_user_armor(id, armor);

    new strip = get_pcvar_num(pStrip);
    if (strip)
    {
        new CsTeams:team = cs_get_user_team(id);
        if ((strip & 1 && team == CS_TEAM_T) || (strip & 2 && team == CS_TEAM_CT))
        {
            strip_user_weapons(id);
            if (get_pcvar_num(pKnife))
                give_item(id, "weapon_knife");
        }
    }

    new speed = get_pcvar_num(pSpeed);
    if (speed > 0)
        set_user_maxspeed(id, float(speed));
}

public on_death()
{
    if (!get_pcvar_num(pInfect))
        return;

    new victim = read_data(2);
    if (!is_user_connected(victim))
        return;
    if (cs_get_user_team(victim) == CS_TEAM_T)
        return;

    // Turned. Whatever brings players back — a round, or the deathmatch plugin — brings
    // this one back on the other side.
    cs_set_user_team(victim, CS_TEAM_T);
    client_print(victim, print_center, "You have been infected.");
}

// The lab's aimbot: pick the named player, find the nearest living enemy, and point the
// player's view at its eyes. pev_fixangle makes the client adopt the angles, so the
// player's own usercmds carry them from then on — which is the signature the exhibit
// is about: no curve, a jump, then a lock.
public force_aim()
{
    new who[32];
    get_pcvar_string(pForceAim, who, charsmax(who));
    if (!who[0])
        return;
    new players[32], count, name[32], id = 0;
    get_players(players, count, "a");
    for (new i = 0; i < count; i++)
    {
        get_user_name(players[i], name, charsmax(name));
        if (equali(name, who)) { id = players[i]; break; }
    }
    if (!id)
        return;
    new Float:eyes[3], Float:best = 999999.0, Float:aim[3], Float:target[3];
    pev(id, pev_origin, eyes);
    new Float:ofs[3]; pev(id, pev_view_ofs, ofs); eyes[2] += ofs[2];
    new CsTeams:team = cs_get_user_team(id);
    for (new i = 0; i < count; i++)
    {
        new t = players[i];
        if (t == id || cs_get_user_team(t) == team)
            continue;
        pev(t, pev_origin, target);
        pev(t, pev_view_ofs, ofs); target[2] += ofs[2];
        new Float:d = get_distance_f(eyes, target);
        if (d < best) { best = d; aim = target; }
    }
    if (best >= 999999.0)
        return;
    new Float:dir[3], Float:ang[3];
    xs_vec_sub(aim, eyes, dir);
    vector_to_angle(dir, ang);
    ang[0] = -ang[0];   // vector_to_angle gives pitch up-positive; the view wants down-positive
    if (ang[0] > 89.0) ang[0] = 89.0; else if (ang[0] < -89.0) ang[0] = -89.0;
    ang[2] = 0.0;
    set_pev(id, pev_angles, ang);
    set_pev(id, pev_v_angle, ang);
    set_pev(id, pev_fixangle, 1);
}

// One line per command from the named player: the time, and the view angles their
// usercmd carried. The server sees exactly this, and it is all the statistical
// anti-cheats ever had.
public on_prethink(id)
{
    static who[32];
    get_pcvar_string(pAimLog, who, charsmax(who));
    if (!who[0] || !is_user_alive(id))
        return FMRES_IGNORED;
    static name[32];
    get_user_name(id, name, charsmax(name));
    if (!equali(name, who))
        return FMRES_IGNORED;
    static Float:ang[3], line[96];
    pev(id, pev_v_angle, ang);
    formatex(line, charsmax(line), "%.3f,%.3f,%.3f,%d", get_gametime(), ang[0], ang[1], pev(id, pev_button));
    write_file("addons/amxmodx/logs/aim.csv", line);
    return FMRES_IGNORED;
}
