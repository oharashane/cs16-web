/*
 * dib3.amxx - death-info beams: for the dead only, a beam from where the killer stood to
 * where the victim fell, and a cross at each end, for a few seconds.
 *
 * BMJ's Death-info beams III (GPL), the "only the dead see" build Shane kept from the uG
 * servers. The living see nothing, so it gives nothing away; a spectator sees how every
 * fight went. Museum changes are marked {museum}.
 *
 *   amx_dib_holdtime  life of the beams, in tenths of a second (200)
 *   amx_dib_width     width, in tenths of a unit (10)
 *   amx_dib_cross     size of the end markers (30)
 *   amx_dib_color     RRRGGGBBB (000255000)
 */
/* AMX Mod X
*   Death-info beams III
*
*  cvars:
*   amx_dib_holdtime <time in 0.1 seconds> - Life of beams
*   amx_dib_width <width in 0.1 units> - Width of beams
*   amx_dib_cross <size in 0.1 units> - Size of markers
*   amx_dib_color <RRRGGGBBB> - RGB color of beam
*
*  This program is free software; you can redistribute it and/or modify it
*  under the terms of the GNU General Public License as published by the
*  Free Software Foundation; either version 2 of the License, or (at
*  your option) any later version.
*
*  This program is distributed in the hope that it will be useful, but
*  WITHOUT ANY WARRANTY; without even the implied warranty of
*  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
*  General Public License for more details.
*
*  You should have received a copy of the GNU General Public License
*  along with this program; if not, write to the Free Software Foundation,
*  Inc., 59 Temple Place, Suite 330, Boston, MA 02111-1307 USA
*
*  In addition, as a special exception, the author gives permission to
*  link the code of this program with the Half-Life Game Engine ("HL
*  Engine") and Modified Game Libraries ("MODs") developed by Valve,
*  L.L.C ("Valve"). You must obey the GNU General Public License in all
*  respects for all of the code used other than the HL Engine and MODs
*  from Valve. If you modify this file, you may extend this exception
*  to your version of the file, but you are not obligated to do so. If
*  you do not wish to do so, delete this exception statement from your
*  version.
*/


#include <amxmodx>
// #include <csstats>  {museum} the stats module's CS_DeathMsg is the game's DeathMsg with a weapon name; only the two ids are read here, so the plain event does without the module

new g_sprite;
new g_iMaxPlayers

public plugin_init()
{
	register_plugin("Death-info beams", "3.0", "BMJ");
	register_event("DeathMsg", "death_msg", "a"); // {museum} was CS_DeathMsg
	
	register_cvar("amx_dib_holdtime", "200");
	register_cvar("amx_dib_width", "10");
	register_cvar("amx_dib_cross", "30");
	register_cvar("amx_dib_color", "000255000");
	
	g_iMaxPlayers = get_maxplayers()
}


public plugin_precache()
{
	g_sprite = precache_model("sprites/dot.spr");
}


public death_msg()
{
	new killer = read_data(1);
	new victim = read_data(2);
	if (killer == victim)
		return PLUGIN_HANDLED;
	
	new vec_killer[3];
	new vec_victim[3];
	get_user_origin(killer, vec_killer, 1);
	get_user_origin(victim, vec_victim);
	
	new color[12];
	get_cvar_string("amx_dib_color", color, 11);
	new b = str_to_num(color[6]);
	color[6] = 0;
	new g = str_to_num(color[3]);
	color[3] = 0;
	new r = str_to_num(color[0]);
	
	new size = get_cvar_num("amx_dib_cross");
	
	for(new id = 1; id <= g_iMaxPlayers; id++)
	{
		if(is_user_connected(id) && !is_user_alive(id))
		{
			message_begin(MSG_ONE, SVC_TEMPENTITY, {0, 0, 0}, id);
			write_byte(0);
			write_coord(vec_killer[0] + size);
			write_coord(vec_killer[1]);
			write_coord(vec_killer[2]);
			write_coord(vec_killer[0] - size);
			write_coord(vec_killer[1]);
			write_coord(vec_killer[2]);
			write_short(g_sprite);
			write_byte(1);
			write_byte(1);
			write_byte(get_cvar_num("amx_dib_holdtime"));	// x 0.1
			write_byte(get_cvar_num("amx_dib_width"));	// x 0.1
			write_byte(0);
			if (get_user_team(killer) == 1)
			{
				write_byte(255);
				write_byte(50);
				write_byte(50);
			}
			else
			{
				write_byte(100);
				write_byte(100);
				write_byte(255);
			}
			write_byte(100);
			write_byte(0);
			message_end();
			
			message_begin(MSG_ONE, SVC_TEMPENTITY, {0, 0, 0}, id);
			write_byte(0);
			write_coord(vec_killer[0]);
			write_coord(vec_killer[1] + size);
			write_coord(vec_killer[2]);
			write_coord(vec_killer[0]);
			write_coord(vec_killer[1] - size);
			write_coord(vec_killer[2]);
			write_short(g_sprite);
			write_byte(1);
			write_byte(1);
			write_byte(get_cvar_num("amx_dib_holdtime"));	// x 0.1
			write_byte(get_cvar_num("amx_dib_width"));	// x 0.1
			write_byte(0);
			if (get_user_team(killer) == 1)
			{
				write_byte(255);
				write_byte(50);
				write_byte(50);
			}
			else
			{
				write_byte(100);
				write_byte(100);
				write_byte(255);
			}
			write_byte(100);
			write_byte(0);
			message_end();
			
			message_begin(MSG_ONE, SVC_TEMPENTITY, {0, 0, 0}, id);
			write_byte(0);
			write_coord(vec_killer[0]);
			write_coord(vec_killer[1]);
			write_coord(vec_killer[2] + size);
			write_coord(vec_killer[0]);
			write_coord(vec_killer[1]);
			write_coord(vec_killer[2] - size);
			write_short(g_sprite);
			write_byte(1);
			write_byte(1);
			write_byte(get_cvar_num("amx_dib_holdtime"));	// x 0.1
			write_byte(get_cvar_num("amx_dib_width"));	// x 0.1
			write_byte(0);
			if (get_user_team(killer) == 1)
			{
				write_byte(255);
				write_byte(50);
				write_byte(50);
			}
			else
			{
				write_byte(100);
				write_byte(100);
				write_byte(255);
			}
			write_byte(100);
			write_byte(0);
			message_end();
			
			message_begin(MSG_ONE, SVC_TEMPENTITY, {0, 0, 0}, id);
			write_byte(0);
			write_coord(vec_victim[0] + size);
			write_coord(vec_victim[1]);
			write_coord(vec_victim[2]);
			write_coord(vec_victim[0] - size);
			write_coord(vec_victim[1]);
			write_coord(vec_victim[2]);
			write_short(g_sprite);
			write_byte(1);
			write_byte(1);
			write_byte(get_cvar_num("amx_dib_holdtime"));	// x 0.1
			write_byte(get_cvar_num("amx_dib_width"));	// x 0.1
			write_byte(0);
			if (get_user_team(victim) == 1)
			{
				write_byte(255);
				write_byte(50);
				write_byte(50);
			}
			else
			{
				write_byte(100);
				write_byte(100);
				write_byte(255);
			}
			write_byte(100);
			write_byte(0);
			message_end();
			
			message_begin(MSG_ONE, SVC_TEMPENTITY, {0, 0, 0}, id);
			write_byte(0);
			write_coord(vec_victim[0]);
			write_coord(vec_victim[1] + size);
			write_coord(vec_victim[2]);
			write_coord(vec_victim[0]);
			write_coord(vec_victim[1] - size);
			write_coord(vec_victim[2]);
			write_short(g_sprite);
			write_byte(1);
			write_byte(1);
			write_byte(get_cvar_num("amx_dib_holdtime"));	// x 0.1
			write_byte(get_cvar_num("amx_dib_width"));	// x 0.1
			write_byte(0);
			if (get_user_team(victim) == 1)
			{
				write_byte(255);
				write_byte(50);
				write_byte(50);
			}
			else
			{
				write_byte(50);
				write_byte(50);
				write_byte(255);
			}
			write_byte(100);
			write_byte(0);
			message_end();
			
			message_begin(MSG_ONE, SVC_TEMPENTITY, {0, 0, 0}, id);
			write_byte(0);
			write_coord(vec_victim[0]);
			write_coord(vec_victim[1]);
			write_coord(vec_victim[2] + size);
			write_coord(vec_victim[0]);
			write_coord(vec_victim[1]);
			write_coord(vec_victim[2] - size);
			write_short(g_sprite);
			write_byte(1);
			write_byte(1);
			write_byte(get_cvar_num("amx_dib_holdtime"));	// x 0.1
			write_byte(get_cvar_num("amx_dib_width"));	// x 0.1
			write_byte(0);
			if (get_user_team(victim) == 1)
			{
				write_byte(255);
				write_byte(50);
				write_byte(50);
			}
			else
			{
				write_byte(100);
				write_byte(100);
				write_byte(255);
			}
			write_byte(100);
			write_byte(0);
			message_end();
			
			message_begin(MSG_ONE, SVC_TEMPENTITY, {0, 0, 0}, id);
			write_byte(0);
			write_coord(vec_killer[0]);
			write_coord(vec_killer[1]);
			write_coord(vec_killer[2]);
			write_coord(vec_victim[0]);
			write_coord(vec_victim[1]);
			write_coord(vec_victim[2]);
			write_short(g_sprite);
			write_byte(1);
			write_byte(1);
			write_byte(get_cvar_num("amx_dib_holdtime"));	// x 0.1
			write_byte(get_cvar_num("amx_dib_width"));	// x 0.1
			write_byte(0);
			write_byte(r);
			write_byte(g);
			write_byte(b);
			write_byte(100);
			write_byte(0);
			message_end();
		}
	}
	return PLUGIN_HANDLED;
}
/* AMXX-Studio Notes - DO NOT MODIFY BELOW HERE
*{\\ rtf1\\ ansi\\ deff0{\\ fonttbl{\\ f0\\ fnil Tahoma;}}\n\\ viewkind4\\ uc1\\ pard\\ lang1031\\ f0\\ fs16 \n\\ par }
*/
