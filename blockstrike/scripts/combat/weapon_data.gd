class_name WeaponData
extends RefCounted
## Typed view of one entry in res://data/weapons.json.

const DATA_PATH := "res://data/weapons.json"

static var _cache: Dictionary = {}

var id := ""
var display_name := ""
var category := ""
var rarity := "common"
var shop_available := false
var projectile := "hitscan"
var damage := 10
var headshot_multiplier := 2.0
var fire_rate_rpm := 600.0
var magazine := 30
var reserve_ammo := 90
var reload_time := 2.0
var effective_range := 40.0
var max_range := 100.0
var min_damage_factor_at_max_range := 0.5
var recoil_pitch := 0.02
var recoil_yaw := 0.005
var spread_deg := 1.0
var moving_spread_penalty_deg := 1.0
var aim_spread_multiplier := 0.5
var movement_speed_multiplier := 1.0
var body_color := Color.DARK_SLATE_GRAY
var accent_color := Color.CYAN


static func get_by_id(weapon_id: String) -> WeaponData:
	if _cache.is_empty():
		_load_all()
	return _cache.get(weapon_id)


static func all_ids() -> PackedStringArray:
	if _cache.is_empty():
		_load_all()
	return PackedStringArray(_cache.keys())


static func _load_all() -> void:
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(DATA_PATH))
	if typeof(parsed) != TYPE_DICTIONARY or not parsed.has("weapons"):
		push_error("WeaponData: invalid %s" % DATA_PATH)
		return
	for entry in parsed["weapons"]:
		var w := WeaponData.from_dict(entry)
		if w.validate().is_empty():
			_cache[w.id] = w
		else:
			push_error("WeaponData: %s invalid: %s" % [w.id, w.validate()])


static func from_dict(d: Dictionary) -> WeaponData:
	var w := WeaponData.new()
	w.id = str(d.get("id", ""))
	w.display_name = str(d.get("name", w.id))
	w.category = str(d.get("category", ""))
	w.rarity = str(d.get("rarity", "common"))
	w.shop_available = bool(d.get("shop_available", false))
	w.projectile = str(d.get("projectile", "hitscan"))
	w.damage = int(d.get("damage", 10))
	w.headshot_multiplier = float(d.get("headshot_multiplier", 2.0))
	w.fire_rate_rpm = float(d.get("fire_rate_rpm", 600.0))
	w.magazine = int(d.get("magazine", 30))
	w.reserve_ammo = int(d.get("reserve_ammo", 90))
	w.reload_time = float(d.get("reload_time", 2.0))
	w.effective_range = float(d.get("effective_range", 40.0))
	w.max_range = float(d.get("max_range", 100.0))
	w.min_damage_factor_at_max_range = float(d.get("min_damage_factor_at_max_range", 0.5))
	w.recoil_pitch = deg_to_rad(float(d.get("recoil_pitch_deg", 1.0)))
	w.recoil_yaw = deg_to_rad(float(d.get("recoil_yaw_deg", 0.3)))
	w.spread_deg = float(d.get("spread_deg", 1.0))
	w.moving_spread_penalty_deg = float(d.get("moving_spread_penalty_deg", 1.0))
	w.aim_spread_multiplier = float(d.get("aim_spread_multiplier", 0.5))
	w.movement_speed_multiplier = float(d.get("movement_speed_multiplier", 1.0))
	w.body_color = Color.html(str(d.get("body_color", "#333333")))
	w.accent_color = Color.html(str(d.get("accent_color", "#ffffff")))
	return w


## Returns an empty string when valid, otherwise a human-readable reason.
func validate() -> String:
	if id.is_empty():
		return "missing id"
	if damage <= 0:
		return "damage must be positive"
	if fire_rate_rpm <= 0.0:
		return "fire rate must be positive"
	if magazine <= 0 or reserve_ammo < 0:
		return "invalid ammunition"
	if max_range < effective_range:
		return "max_range below effective_range"
	if headshot_multiplier < 1.0:
		return "headshot multiplier below 1"
	return ""


func seconds_per_shot() -> float:
	return 60.0 / fire_rate_rpm


## Damage after range falloff. Full damage up to effective range, then linear falloff.
func damage_at_distance(distance: float) -> float:
	if distance <= effective_range:
		return float(damage)
	var t := clampf((distance - effective_range) / maxf(max_range - effective_range, 0.001), 0.0, 1.0)
	return float(damage) * lerpf(1.0, min_damage_factor_at_max_range, t)
