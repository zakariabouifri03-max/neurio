extends Node
## Global state: settings, graphics presets, persistent profile, rewards and missions.
## Everything is stored locally in user://blockstrike_save.json (no server needed).

const SAVE_PATH := "user://blockstrike_save.json"
const VERSION := "0.1.0-prototype"

signal settings_changed

## Graphics presets. render_scale is the default for the resolution slider.
const QUALITY := {
	"low": {"render_scale": 0.7, "view_distance": 70.0, "shadows": false, "shadow_distance": 0.0,
		"msaa": 0, "ssao": false, "glow": false, "particles": 0.4, "fps": 30, "fog": 0.008},
	"medium": {"render_scale": 0.85, "view_distance": 110.0, "shadows": true, "shadow_distance": 50.0,
		"msaa": 0, "ssao": false, "glow": false, "particles": 0.7, "fps": 45, "fog": 0.005},
	"high": {"render_scale": 1.0, "view_distance": 170.0, "shadows": true, "shadow_distance": 90.0,
		"msaa": 1, "ssao": true, "glow": true, "particles": 1.0, "fps": 60, "fog": 0.003},
}

const LEAGUES := [
	{"name": "Bronze", "min": 0},
	{"name": "Silver", "min": 100},
	{"name": "Gold", "min": 250},
	{"name": "Platinum", "min": 500},
	{"name": "Diamond", "min": 900},
	{"name": "Champion", "min": 1400},
]

const DAILY_TEMPLATES := [
	{"id": "d_kills", "title": "Eliminate 5 enemies", "stat": "kills", "target": 5, "coins": 150, "xp": 100},
	{"id": "d_matches", "title": "Play 2 matches", "stat": "matches", "target": 2, "coins": 100, "xp": 80},
	{"id": "d_headshots", "title": "Score 2 headshots", "stat": "headshots", "target": 2, "coins": 120, "xp": 90},
	{"id": "d_wins", "title": "Win 1 battle royale", "stat": "wins", "target": 1, "coins": 250, "xp": 150},
]

## Cosmetic catalogue. Cosmetics are purely visual: no stat or damage changes.
const CATALOG := [
	{"id": "outfit_blue", "cat": "outfit", "name": "Storm Blue Vest", "price": 300, "currency": "coins", "color": Color(0.22, 0.46, 0.92)},
	{"id": "outfit_orange", "cat": "outfit", "name": "Blaze Orange Vest", "price": 300, "currency": "coins", "color": Color(0.95, 0.5, 0.15)},
	{"id": "outfit_camo", "cat": "outfit", "name": "Jungle Camo Vest", "price": 500, "currency": "coins", "color": Color(0.3, 0.42, 0.2)},
	{"id": "outfit_gold", "cat": "outfit", "name": "Champion Gold Vest", "price": 40, "currency": "gems", "color": Color(0.9, 0.75, 0.2)},
	{"id": "helmet_steel", "cat": "helmet", "name": "Steel Helmet", "price": 200, "currency": "coins", "color": Color(0.55, 0.58, 0.62)},
	{"id": "helmet_red", "cat": "helmet", "name": "Crimson Helmet", "price": 250, "currency": "coins", "color": Color(0.7, 0.14, 0.14)},
	{"id": "backpack_tan", "cat": "backpack", "name": "Desert Backpack", "price": 180, "currency": "coins", "color": Color(0.7, 0.58, 0.36)},
	{"id": "backpack_black", "cat": "backpack", "name": "Shadow Backpack", "price": 30, "currency": "gems", "color": Color(0.1, 0.1, 0.12)},
	{"id": "skin_neon", "cat": "weapon_skin", "name": "Neon Weapon Tint", "price": 60, "currency": "gems", "color": Color(0.2, 1.0, 0.7)},
]

var settings: Dictionary = {}
var profile: Dictionary = {}
var current_mode: String = "br_solo"


func _ready() -> void:
	_reset_settings()
	_reset_profile()
	load_all()
	apply_audio()


# ---------------------------------------------------------------- settings
func _reset_settings() -> void:
	settings = {
		"quality": "medium",
		"render_scale": 0.85,
		"fps_cap": 45,
		"look_sensitivity": 1.0,
		"ads_multiplier": 0.6,
		"invert_y": false,
		"joystick_size": 1.0,
		"button_scale": 1.0,
		"button_layout": {},
		"master_volume": 0.8,
		"show_fps": false,
		"force_touch_ui": false,
	}


func _reset_profile() -> void:
	profile = {
		"name": "Survivor",
		"xp": 0,
		"coins": 500,
		"gems": 25,
		"matches": 0,
		"wins": 0,
		"kills": 0,
		"headshots": 0,
		"best_placement": 0,
		"rank_points": 0,
		"owned": ["outfit_camo"],
		"equipped": {"outfit": "outfit_camo", "helmet": "", "backpack": "", "weapon_skin": ""},
		"missions": {"day": "", "progress": {}, "claimed": []},
	}


func set_setting(key: String, value: Variant) -> void:
	settings[key] = value
	if key == "render_scale" or key == "fps_cap" or key == "quality":
		apply_graphics()
	if key == "master_volume":
		apply_audio()
	settings_changed.emit()
	save_all()


func apply_quality_preset(preset: String) -> void:
	if not QUALITY.has(preset):
		return
	settings["quality"] = preset
	settings["render_scale"] = QUALITY[preset]["render_scale"]
	settings["fps_cap"] = QUALITY[preset]["fps"]
	apply_graphics()
	settings_changed.emit()
	save_all()


func apply_graphics(env: Environment = null, sun: DirectionalLight3D = null) -> void:
	var p: Dictionary = QUALITY.get(settings["quality"], QUALITY["medium"])
	var vp := get_viewport()
	if vp:
		vp.scaling_3d_scale = clampf(float(settings["render_scale"]), 0.5, 1.0)
		vp.msaa_3d = int(p["msaa"])
	Engine.max_fps = int(settings["fps_cap"])
	if env:
		env.fog_enabled = true
		env.fog_density = float(p["fog"])
		env.ssao_enabled = bool(p["ssao"])
		env.glow_enabled = bool(p["glow"])
	if sun:
		sun.shadow_enabled = bool(p["shadows"])
		sun.directional_shadow_max_distance = float(p["shadow_distance"])


func preset() -> Dictionary:
	return QUALITY.get(settings["quality"], QUALITY["medium"])


func apply_audio() -> void:
	var bus := AudioServer.get_bus_index("Master")
	if bus >= 0:
		AudioServer.set_bus_volume_db(bus, linear_to_db(maxf(float(settings["master_volume"]), 0.001)))


# ---------------------------------------------------------------- save file
func save_all() -> void:
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f == null:
		push_warning("Could not write save file: %s" % SAVE_PATH)
		return
	f.store_string(JSON.stringify({"version": VERSION, "settings": settings, "profile": profile}, "\t"))
	f.close()


func load_all() -> void:
	if not FileAccess.file_exists(SAVE_PATH):
		return
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
	if typeof(parsed) != TYPE_DICTIONARY:
		push_warning("Save file unreadable, using defaults.")
		return
	if parsed.has("settings") and typeof(parsed["settings"]) == TYPE_DICTIONARY:
		_merge_known(settings, parsed["settings"])
	if parsed.has("profile") and typeof(parsed["profile"]) == TYPE_DICTIONARY:
		_merge_known(profile, parsed["profile"])


func _merge_known(target: Dictionary, src: Dictionary) -> void:
	for k in src.keys():
		if target.has(k):
			var cur: Variant = target[k]
			var val: Variant = src[k]
			if typeof(cur) == TYPE_DICTIONARY and typeof(val) == TYPE_DICTIONARY:
				_merge_known(cur, val)
			elif typeof(cur) == TYPE_FLOAT or typeof(cur) == TYPE_INT:
				if typeof(val) == TYPE_FLOAT or typeof(val) == TYPE_INT:
					target[k] = val
			elif typeof(cur) == typeof(val):
				target[k] = val


# ---------------------------------------------------------------- progression
static func xp_for_level(level: int) -> int:
	# Total XP needed to reach `level` (level 1 starts at 0 XP).
	return 250 * (level - 1) * level / 2


func level_info() -> Dictionary:
	var xp: int = int(profile["xp"])
	var level := 1
	while xp >= xp_for_level(level + 1):
		level += 1
	var base := xp_for_level(level)
	var need := xp_for_level(level + 1) - base
	return {"level": level, "into": xp - base, "need": need}


func league_for_points(points: int) -> Dictionary:
	var result: Dictionary = LEAGUES[0]
	for lg in LEAGUES:
		if points >= int(lg["min"]):
			result = lg
	return result


func grant_match_rewards(mode_id: String, kills: int, placement: int, won: bool, headshots: int) -> Dictionary:
	var before: int = level_info()["level"]
	var xp := 40 + kills * 35
	var coins := 25 + kills * 12
	if won:
		xp += 150
		coins += 120
	else:
		xp += maxi(0, 17 - placement) * 5
	var rank_gain := 0
	if mode_id.begins_with("br"):
		rank_gain = 25 if won else (10 if placement <= 5 else 0) + mini(kills, 5) * 2
	profile["xp"] = int(profile["xp"]) + xp
	profile["coins"] = int(profile["coins"]) + coins
	profile["rank_points"] = int(profile["rank_points"]) + rank_gain
	profile["matches"] = int(profile["matches"]) + 1
	profile["kills"] = int(profile["kills"]) + kills
	profile["headshots"] = int(profile["headshots"]) + headshots
	if won:
		profile["wins"] = int(profile["wins"]) + 1
	if placement > 0 and (int(profile["best_placement"]) == 0 or placement < int(profile["best_placement"])):
		profile["best_placement"] = placement
	_bump_missions({"kills": kills, "matches": 1, "headshots": headshots, "wins": 1 if won else 0})
	save_all()
	return {"xp": xp, "coins": coins, "rank_points": rank_gain,
		"level_before": before, "level_after": level_info()["level"]}


func _today() -> String:
	return Time.get_date_string_from_system()


func _ensure_mission_day() -> void:
	var m: Dictionary = profile["missions"]
	if m["day"] != _today():
		m["day"] = _today()
		m["progress"] = {}
		m["claimed"] = []


func _bump_missions(delta: Dictionary) -> void:
	_ensure_mission_day()
	var prog: Dictionary = profile["missions"]["progress"]
	for k in delta.keys():
		prog[k] = int(prog.get(k, 0)) + int(delta[k])


func daily_missions() -> Array:
	_ensure_mission_day()
	var out: Array = []
	var prog: Dictionary = profile["missions"]["progress"]
	var claimed: Array = profile["missions"]["claimed"]
	for t in DAILY_TEMPLATES:
		var cur := int(prog.get(t["stat"], 0))
		out.append({"id": t["id"], "title": t["title"], "progress": mini(cur, int(t["target"])),
			"target": t["target"], "coins": t["coins"], "xp": t["xp"],
			"claimed": claimed.has(t["id"])})
	return out


func claim_mission(mission_id: String) -> String:
	for m in daily_missions():
		if m["id"] == mission_id:
			if m["claimed"]:
				return "Already claimed."
			if m["progress"] < m["target"]:
				return "Not finished yet."
			profile["coins"] = int(profile["coins"]) + int(m["coins"])
			profile["xp"] = int(profile["xp"]) + int(m["xp"])
			profile["missions"]["claimed"].append(mission_id)
			save_all()
			return ""
	return "Unknown mission."


# ---------------------------------------------------------------- shop
func catalog_item(item_id: String) -> Dictionary:
	for it in CATALOG:
		if it["id"] == item_id:
			return it
	return {}


func owns(item_id: String) -> bool:
	return (profile["owned"] as Array).has(item_id)


func buy_item(item_id: String) -> String:
	var it := catalog_item(item_id)
	if it.is_empty():
		return "Unknown item."
	if owns(item_id):
		return "Already owned."
	var cur: String = it["currency"]
	if int(profile[cur]) < int(it["price"]):
		return "Not enough %s." % cur
	profile[cur] = int(profile[cur]) - int(it["price"])
	(profile["owned"] as Array).append(item_id)
	save_all()
	return ""


func equip_item(item_id: String) -> void:
	var it := catalog_item(item_id)
	if it.is_empty() or not owns(item_id):
		return
	(profile["equipped"] as Dictionary)[it["cat"]] = item_id
	save_all()


func equipped_color(cat: String, fallback: Color) -> Color:
	var id: String = profile["equipped"].get(cat, "")
	if id == "":
		return fallback
	var it := catalog_item(id)
	return it.get("color", fallback)
