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
 *
 * Built for cs16-web's museum. The mods this imitates were other people's work and are
 * credited on the tour; this is the mechanic, not the mod.
 */
#include <amxmodx>
#include <cstrike>
#include <fun>

new pHealth, pArmor, pStrip, pKnife, pSpeed, pInfect;

public plugin_init()
{
    register_plugin("Museum modes", "1.0", "cs16-web");

    pHealth = register_cvar("mm_health", "0");
    pArmor  = register_cvar("mm_armor",  "-1");
    pStrip  = register_cvar("mm_strip",  "0");
    pKnife  = register_cvar("mm_knife",  "1");
    pSpeed  = register_cvar("mm_speed",  "0");
    pInfect = register_cvar("mm_infect", "0");

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
