extends RefCounted
## Game mode catalogue. Only `playable` modes can be started in this build.

const MODES := {
	"training": {"name": "Training Ground", "playable": true, "br": false, "bots": 6, "team_size": 1,
		"desc": "Practise aim and movement against respawning bots. Unlimited reserve ammo."},
	"br_solo": {"name": "Battle Royale · Solo", "playable": true, "br": true, "bots": 15, "team_size": 1,
		"desc": "16 players drop in with a pistol. Find weapons, shrink the zone, last one standing wins."},
	"br_duo": {"name": "Battle Royale · Duo", "playable": true, "br": true, "bots": 15, "team_size": 2,
		"desc": "Team up with an AI partner. Last team standing wins. (Human duo needs online play.)"},
	"br_squad": {"name": "Battle Royale · Squad", "playable": true, "br": true, "bots": 15, "team_size": 4,
		"desc": "Squads of 4 with AI teammates. Last squad standing wins. (Human squads need online play.)"},
	"clash": {"name": "Clash Squad 4v4", "playable": false, "br": false, "bots": 0, "team_size": 4,
		"desc": "Planned: round-based 4v4 with a weapon buy menu. Not implemented yet."},
	"arena_2v2": {"name": "2v2 Arena", "playable": false, "br": false, "bots": 0, "team_size": 2,
		"desc": "Planned: fast 2v2 on small arena maps. Not implemented yet."},
	"custom": {"name": "Custom Room", "playable": false, "br": false, "bots": 0, "team_size": 1,
		"desc": "Planned: private room codes and invites. Requires the online room server."},
}


static func get_mode(id: String) -> Dictionary:
	return MODES.get(id, MODES["br_solo"])
