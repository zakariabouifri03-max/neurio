extends RefCounted
## Weapon statistics. Every weapon has its own damage, fire interval, recoil,
## spread, range, magazine size, reload time and ammo type.
## Melee weapons use the same record with magazine = 0.

const WEAPONS := {
	"ar": {"name": "VANGUARD AR-7", "kind": "rifle", "slot": 0, "damage": 24.0, "interval": 0.11,
		"auto": true, "magazine": 30, "reload": 2.1, "range": 150.0, "spread": 1.1, "recoil": 1.6,
		"headshot": 2.0, "ammo": "medium", "pellets": 1, "ads_fov": 52.0, "length": 1.0,
		"sound": "shot_rifle", "accent": Color(0.95, 0.55, 0.15)},
	"smg": {"name": "VIPER-9 SMG", "kind": "smg", "slot": 0, "damage": 14.0, "interval": 0.065,
		"auto": true, "magazine": 35, "reload": 1.7, "range": 60.0, "spread": 2.2, "recoil": 0.9,
		"headshot": 1.8, "ammo": "light", "pellets": 1, "ads_fov": 58.0, "length": 0.75,
		"sound": "shot_smg", "accent": Color(0.2, 0.8, 0.9)},
	"shotgun": {"name": "BREACHER 12", "kind": "shotgun", "slot": 0, "damage": 11.0, "interval": 0.85,
		"auto": false, "magazine": 6, "reload": 2.8, "range": 28.0, "spread": 5.5, "recoil": 4.0,
		"headshot": 1.5, "ammo": "shell", "pellets": 8, "ads_fov": 60.0, "length": 0.9,
		"sound": "shot_shotgun", "accent": Color(0.9, 0.25, 0.2)},
	"sniper": {"name": "LONGSHOT X5", "kind": "sniper", "slot": 0, "damage": 92.0, "interval": 1.3,
		"auto": false, "magazine": 5, "reload": 3.3, "range": 400.0, "spread": 0.12, "recoil": 5.0,
		"headshot": 2.5, "ammo": "heavy", "pellets": 1, "ads_fov": 25.0, "length": 1.3,
		"sound": "shot_sniper", "accent": Color(0.4, 0.9, 0.4)},
	"pistol": {"name": "RANGER P1", "kind": "pistol", "slot": 1, "damage": 19.0, "interval": 0.22,
		"auto": false, "magazine": 12, "reload": 1.2, "range": 70.0, "spread": 1.4, "recoil": 1.2,
		"headshot": 2.0, "ammo": "light", "pellets": 1, "ads_fov": 60.0, "length": 0.45,
		"sound": "shot_pistol", "accent": Color(0.95, 0.85, 0.3)},
	"knife": {"name": "TACTICAL KNIFE", "kind": "melee", "slot": 2, "damage": 45.0, "interval": 0.55,
		"auto": false, "magazine": 0, "reload": 0.0, "range": 2.2, "spread": 0.0, "recoil": 0.0,
		"headshot": 1.0, "ammo": "", "pellets": 1, "ads_fov": 70.0, "length": 0.3,
		"sound": "switch", "accent": Color(0.8, 0.8, 0.85)},
}

const AMMO_TYPES := ["light", "medium", "shell", "heavy"]
const AMMO_PICKUP := {"light": 30, "medium": 30, "shell": 8, "heavy": 6}
const START_AMMO := {"light": 60, "medium": 60, "shell": 16, "heavy": 10}
## Weapons that can appear as loot on the map.
const LOOT_WEAPONS := ["ar", "ar", "smg", "smg", "shotgun", "sniper", "pistol"]


static func get_def(id: String) -> Dictionary:
	return WEAPONS.get(id, {})


static func is_melee(id: String) -> bool:
	return get_def(id).get("kind", "") == "melee"
