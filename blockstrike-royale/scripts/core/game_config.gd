extends Node
## Global tuning constants and shared enums for BlockStrike Royale.
##
## Registered as the `GameConfig` autoload.  Everything here is data that other
## systems read; nothing here depends on other autoloads so it can be loaded first.

const GAME_NAME := "BlockStrike Royale"
const SAVE_VERSION := 3
const PROTOCOL_VERSION := 4

## Physics layers (mirrors the names in project.godot -> [layer_names]).
enum Layer {
	WORLD = 1 << 0,
	PLAYER = 1 << 1,
	PROP = 1 << 2,
	LOOT = 1 << 3,
	PROJECTILE = 1 << 4,
	HITBOX = 1 << 5,
	BOT = 1 << 6,
	TRIGGER = 1 << 7,
}

## Player movement tuning.  Values are metres / seconds for a 1.8 m tall voxel character.
const PLAYER := {
	"walk_speed": 4.6,
	"sprint_speed": 7.0,
	"crouch_speed": 2.3,
	"acceleration": 34.0,
	"air_acceleration": 9.0,
	"deceleration": 28.0,
	"jump_velocity": 6.4,
	"gravity": 18.0,
	"max_fall_speed": 42.0,
	"crouch_height": 1.2,
	"stand_height": 1.8,
	"radius": 0.32,
	"step_height": 0.45,
	"max_health": 100.0,
	"max_armor": 100.0,
	"revive_time": 6.0,
	"fall_damage_min_speed": 16.0,
	"fall_damage_per_ms": 7.5,
}

## Third person camera defaults, superseded by Settings when the player changes them.
const CAMERA := {
	"distance": 4.4,
	"ads_distance": 2.1,
	"min_distance": 1.4,
	"max_distance": 7.5,
	"height_offset": 1.35,
	"pitch_min_deg": -68.0,
	"pitch_max_deg": 62.0,
	"default_sensitivity": 0.22,
	"default_aim_sensitivity": 0.12,
	"collision_mask": 1 << 0 | 1 << 2,
	"fov_default": 75.0,
	"fov_ads": 55.0,
	"follow_lag": 14.0,
}

## Match / world defaults.
const WORLD := {
	"chunk_size": 16,
	"chunk_view_distance": 3,
	"block_size": 1.0,
	"gravity": 18.0,
	"water_drag": 6.0,
	"max_fall_time": 12.0,
}

## Networking.
const NET := {
	"default_port": 27015,
	"lan_discovery_port": 27016,
	"max_players_internet": 32,
	"max_players_lan": 12,
	"server_tick_rate": 30,
	"state_send_rate": 20,
	"input_send_rate": 30,
	"interp_back_time": 0.1,
	"max_aim_delta_deg": 60.0,
	"timeout_ms": 12000,
}

## Bot difficulty profiles: reaction time, aim error, decision rate.
const BOTS := {
	"beginner": {"reaction": 0.85, "aim_error_deg": 7.5, "burst": 0.45, "fov_deg": 95.0,
				 "view_distance": 34.0, "seek_loot": 0.45, "accuracy": 0.45},
	"normal": {"reaction": 0.45, "aim_error_deg": 4.0, "burst": 0.65, "fov_deg": 120.0,
			   "view_distance": 55.0, "seek_loot": 0.7, "accuracy": 0.65},
	"advanced": {"reaction": 0.22, "aim_error_deg": 1.8, "burst": 0.8, "fov_deg": 150.0,
				 "view_distance": 80.0, "seek_loot": 0.85, "accuracy": 0.82},
}

## Team colours used by markers, banners and bot tinting (index 0 = neutral).
const TEAM_COLORS := [
	Color(0.75, 0.78, 0.82),
	Color(0.35, 0.72, 1.0),
	Color(1.0, 0.45, 0.38),
	Color(0.55, 0.9, 0.45),
	Color(0.95, 0.82, 0.35),
	Color(0.78, 0.5, 0.95),
]

## Every input action the game reads.  Kept in sync with project.godot; missing
## entries are added at runtime so a hand-edited project file cannot break input.
const ACTION_DEFAULTS := {
	"move_forward": [KEY_W], "move_back": [KEY_S], "move_left": [KEY_A], "move_right": [KEY_D],
	"jump": [KEY_SPACE], "crouch": [KEY_CTRL], "sprint": [KEY_SHIFT],
	"fire": [], "aim": [], "reload": [KEY_R], "interact": [KEY_F],
	"weapon_next": [KEY_E], "weapon_prev": [KEY_Q],
	"slot_primary": [KEY_1], "slot_secondary": [KEY_2], "slot_melee": [KEY_3],
	"slot_throwable": [KEY_4], "use_heal": [KEY_H], "toggle_inventory": [KEY_I],
	"toggle_map": [KEY_M], "emote_wheel": [KEY_Z], "pause": [KEY_ESCAPE],
	"scoreboard": [KEY_TAB],
	"ping": [KEY_V], "toggle_build": [KEY_B], "start_match": [KEY_ENTER],
}

var is_mobile: bool = false
var is_android: bool = false
var low_memory_device: bool = false
var build_channel: String = "development"

func _ready() -> void:
	is_mobile = OS.has_feature("mobile") or OS.has_feature("android")
	is_android = OS.get_name() == "Android"
	low_memory_device = is_android and OS.get_static_memory_usage() > 0
	_ensure_input_actions()

## Adds any action from ACTION_DEFAULTS that project.godot does not define.
func _ensure_input_actions() -> void:
	for action: String in ACTION_DEFAULTS.keys():
		if not InputMap.has_action(action):
			InputMap.add_action(action, 0.2)
		var events := InputMap.action_get_events(action)
		if not events.is_empty():
			continue
		for keycode: int in ACTION_DEFAULTS[action]:
			var event := InputEventKey.new()
			event.physical_keycode = keycode
			InputMap.action_add_event(action, event)

## Convenience accessor with fallback so a missing key never crashes a match.
func tuning(section: String, key: String, fallback: Variant) -> Variant:
	if not has_constant_value(section):
		return fallback
	var table: Dictionary = get(section)
	return table.get(key, fallback)

func has_constant_value(section: String) -> bool:
	return section in ["PLAYER", "CAMERA", "WORLD", "NET", "BOTS"]

func team_color(team: int) -> Color:
	if team < 0 or team >= TEAM_COLORS.size():
		return TEAM_COLORS[0]
	return TEAM_COLORS[team]
