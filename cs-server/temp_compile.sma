/**
 * Simple CSDM 1.x Style Weapon Menu
 * Provides weapon selection menus for deathmatch gameplay
 * Based on classic CSDM functionality
 */

#include <amxmodx>
#include <amxmisc>
#include <cstrike>
#include <fun>

#define PLUGIN "CSDM Weapon Menu"
#define VERSION "1.0"
#define AUTHOR "CS16-Web"

new g_PrimaryMenu, g_SecondaryMenu, g_EquipMenu
new g_UserPrimary[33], g_UserSecondary[33]
new bool:g_ShowMenuOnSpawn[33] = {true, ...}

// Weapon arrays
new const g_PrimaryWeapons[][] = {
    "weapon_ak47", "weapon_m4a1", "weapon_awp", "weapon_mp5navy", 
    "weapon_m3", "weapon_xm1014", "weapon_p90", "weapon_ump45",
    "weapon_famas", "weapon_galil", "weapon_scout", "weapon_sg552",
    "weapon_aug", "weapon_g3sg1", "weapon_sg550", "weapon_m249"
}

new const g_PrimaryNames[][] = {
    "AK-47", "M4A1", "AWP", "MP5 Navy",
    "M3 Shotgun", "XM1014", "P90", "UMP45", 
    "Famas", "Galil", "Scout", "SG552",
    "AUG", "G3SG1", "SG550", "M249"
}

new const g_SecondaryWeapons[][] = {
    "weapon_glock18", "weapon_usp", "weapon_deagle", 
    "weapon_p228", "weapon_elite", "weapon_fiveseven"
}

new const g_SecondaryNames[][] = {
    "Glock 18", "USP", "Desert Eagle",
    "P228", "Dual Elites", "Five-Seven"
}

public plugin_init() {
    register_plugin(PLUGIN, VERSION, AUTHOR)
    
    register_event("DeathMsg", "event_death", "a")
    register_event("HLTV", "event_new_round", "a", "1=0", "2=0")
    
    register_clcmd("say /guns", "show_primary_menu")
    register_clcmd("say guns", "show_primary_menu")
    register_clcmd("say /weapons", "show_primary_menu")
    register_clcmd("say weapons", "show_primary_menu")
    
    // Create menus
    create_menus()
}

public plugin_precache() {
    // Precache weapon models if needed
}

create_menus() {
    // Primary weapons menu
    g_PrimaryMenu = menu_create("Select Primary Weapon:", "primary_menu_handler")
    
    for(new i = 0; i < sizeof(g_PrimaryNames); i++) {
        new info[8]
        num_to_str(i, info, 7)
        menu_additem(g_PrimaryMenu, g_PrimaryNames[i], info)
    }
    
    menu_setprop(g_PrimaryMenu, MPROP_EXIT, MEXIT_ALL)
    
    // Secondary weapons menu
    g_SecondaryMenu = menu_create("Select Secondary Weapon:", "secondary_menu_handler")
    
    for(new i = 0; i < sizeof(g_SecondaryNames); i++) {
        new info[8]
        num_to_str(i, info, 7)
        menu_additem(g_SecondaryMenu, g_SecondaryNames[i], info)
    }
    
    menu_setprop(g_SecondaryMenu, MPROP_EXIT, MEXIT_ALL)
    
    // Equipment menu
    g_EquipMenu = menu_create("Select Equipment:", "equip_menu_handler")
    menu_additem(g_EquipMenu, "Kevlar", "0")
    menu_additem(g_EquipMenu, "Kevlar + Helmet", "1")
    menu_additem(g_EquipMenu, "HE Grenade", "2")
    menu_additem(g_EquipMenu, "Flashbang", "3")
    menu_additem(g_EquipMenu, "Smoke Grenade", "4")
    menu_additem(g_EquipMenu, "Defuse Kit (CT)", "5")
    menu_setprop(g_EquipMenu, MPROP_EXIT, MEXIT_ALL)
}

public client_connect(id) {
    g_UserPrimary[id] = 0  // Default to AK47/M4A1
    g_UserSecondary[id] = 2 // Default to Deagle
    g_ShowMenuOnSpawn[id] = true
}

public event_death() {
    new id = read_data(2)
    if(!is_user_connected(id) || is_user_bot(id))
        return
        
    // Show menu after a short delay to allow respawn
    set_task(2.0, "delayed_spawn_menu", id)
}

public event_new_round() {
    // Give weapons to all players at round start
    for(new id = 1; id <= 32; id++) {
        if(is_user_connected(id) && is_user_alive(id)) {
            give_user_weapons(id)
        }
    }
}

public delayed_spawn_menu(id) {
    if(is_user_connected(id) && is_user_alive(id) && g_ShowMenuOnSpawn[id]) {
        show_primary_menu(id)
    }
}

public show_primary_menu(id) {
    if(!is_user_connected(id))
        return PLUGIN_HANDLED
        
    menu_display(id, g_PrimaryMenu, 0)
    return PLUGIN_HANDLED
}

public primary_menu_handler(id, menu, item) {
    if(item == MENU_EXIT)
        return PLUGIN_HANDLED
        
    new data[8], name[64], access, callback
    menu_item_getinfo(menu, item, access, data, 7, name, 63, callback)
    
    g_UserPrimary[id] = str_to_num(data)
    
    // Show secondary menu
    menu_display(id, g_SecondaryMenu, 0)
    
    return PLUGIN_HANDLED
}

public secondary_menu_handler(id, menu, item) {
    if(item == MENU_EXIT) {
        // If they exit secondary menu, just give them the primary weapon
        give_user_weapons(id)
        return PLUGIN_HANDLED
    }
        
    new data[8], name[64], access, callback
    menu_item_getinfo(menu, item, access, data, 7, name, 63, callback)
    
    g_UserSecondary[id] = str_to_num(data)
    
    // Show equipment menu
    menu_display(id, g_EquipMenu, 0)
    
    return PLUGIN_HANDLED
}

public equip_menu_handler(id, menu, item) {
    if(item == MENU_EXIT) {
        // If they exit equipment menu, just give them weapons
        give_user_weapons(id)
        return PLUGIN_HANDLED
    }
        
    new data[8], name[64], access, callback
    menu_item_getinfo(menu, item, access, data, 7, name, 63, callback)
    
    new choice = str_to_num(data)
    
    // Give equipment
    switch(choice) {
        case 0: cs_set_user_armor(id, 100, CS_ARMOR_KEVLAR)
        case 1: cs_set_user_armor(id, 100, CS_ARMOR_ASSAULTSUIT)
        case 2: give_item(id, "weapon_hegrenade")
        case 3: give_item(id, "weapon_flashbang")
        case 4: give_item(id, "weapon_smokegrenade")
        case 5: {
            if(cs_get_user_team(id) == CS_TEAM_CT) {
                cs_set_user_defuse(id, 1)
            }
        }
    }
    
    // Give weapons after equipment selection
    give_user_weapons(id)
    
    return PLUGIN_HANDLED
}

give_user_weapons(id) {
    if(!is_user_alive(id))
        return
        
    // Strip current weapons except knife
    new weapons[32], num, index, weaponid
    get_user_weapons(id, weapons, num)
    
    for(new i = 0; i < num; i++) {
        weaponid = weapons[i]
        if(weaponid != CSW_KNIFE) {
            new weapon_name[32]
            get_weaponname(weaponid, weapon_name, 31)
            engclient_cmd(id, "drop", weapon_name)
        }
    }
    
    // Give selected weapons
    give_item(id, g_PrimaryWeapons[g_UserPrimary[id]])
    give_item(id, g_SecondaryWeapons[g_UserSecondary[id]])
    
    // Give full ammo
    cs_set_user_bpammo(id, get_weaponid(g_PrimaryWeapons[g_UserPrimary[id]]), 200)
    cs_set_user_bpammo(id, get_weaponid(g_SecondaryWeapons[g_UserSecondary[id]]), 200)
    
    client_print(id, print_chat, "[CSDM] Weapons equipped: %s + %s", 
        g_PrimaryNames[g_UserPrimary[id]], g_SecondaryNames[g_UserSecondary[id]])
}

public client_putinserver(id) {
    if(is_user_bot(id))
        return
        
    set_task(3.0, "welcome_message", id)
}

public welcome_message(id) {
    client_print(id, print_chat, "[CSDM] Type 'guns' or '/guns' to select weapons")
    client_print(id, print_chat, "[CSDM] Weapon menu will appear automatically on spawn")
}
