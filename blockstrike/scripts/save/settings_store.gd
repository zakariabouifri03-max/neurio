extends Node
## Autoload "AppSettings": persistent user preferences (versioned).
##
## Holds device-local preferences only (controls, camera, graphics, audio).
## Nothing in here is trusted for online play.

signal changed(key: String, value: Variant)

const SCHEMA_VERSION := 1
const SAVE_PATH := "user://settings.json"

const GRAPHICS_PRESETS := ["low", "medium", "high"]
const LAYOUT_PRESETS := ["standard", "left_handed"]

var _values: Dictionary = {}
var last_load_status: int = SaveFile.ReadStatus.MISSING


func _ready() -> void:
	load_settings()


static func defaults() -> Dictionary:
	return {
		"version": SCHEMA_VERSION,
		"look_sensitivity": 1.0,
		"aim_sensitivity": 0.7,
		"invert_y": false,
		"camera_distance": 3.6,
		"fov": 75.0,
		"button_scale": 1.0,
		"button_opacity": 0.75,
		"touch_layout": "standard",
		"touch_positions": {},
		"aim_assist": true,
		"graphics_preset": "medium",
		"sfx_volume": 0.8,
		"muted": false,
		"show_fps": false,
	}


func load_settings(path: String = SAVE_PATH) -> void:
	var result := SaveFile.read_json(path)
	last_load_status = result["status"]
	var merged := defaults()
	if last_load_status == SaveFile.ReadStatus.OK or last_load_status == SaveFile.ReadStatus.CORRUPT_RECOVERED:
		merged = _migrate(result["data"])
	_values = _sanitize(merged)


func save_settings(path: String = SAVE_PATH) -> Error:
	return SaveFile.write_json(path, _values)


func get_value(key: String) -> Variant:
	return _values.get(key, defaults().get(key))


func set_value(key: String, value: Variant, autosave: bool = true) -> void:
	if not defaults().has(key):
		push_warning("AppSettings: unknown key '%s' ignored." % key)
		return
	_values[key] = _sanitize_one(key, value)
	changed.emit(key, _values[key])
	if autosave:
		save_settings()


func get_all() -> Dictionary:
	return _values.duplicate(true)


func reset_to_defaults() -> void:
	_values = defaults()
	save_settings()
	changed.emit("", null)


func _migrate(data: Dictionary) -> Dictionary:
	var version := int(data.get("version", 0))
	# Version 0 was never released; keep the same keys, just stamp the version.
	if version < SCHEMA_VERSION:
		data["version"] = SCHEMA_VERSION
	return data


func _sanitize(data: Dictionary) -> Dictionary:
	var out := defaults()
	for key in out.keys():
		if data.has(key):
			out[key] = _sanitize_one(key, data[key])
	out["version"] = SCHEMA_VERSION
	return out


func _sanitize_one(key: String, value: Variant) -> Variant:
	var base: Variant = defaults().get(key)
	match typeof(base):
		TYPE_FLOAT:
			var f := float(value) if (typeof(value) == TYPE_FLOAT or typeof(value) == TYPE_INT) else float(base)
			match key:
				"look_sensitivity": return clampf(f, 0.2, 3.0)
				"aim_sensitivity": return clampf(f, 0.2, 2.0)
				"camera_distance": return clampf(f, 2.2, 5.0)
				"fov": return clampf(f, 60.0, 95.0)
				"button_scale": return clampf(f, 0.7, 1.5)
				"button_opacity": return clampf(f, 0.2, 1.0)
				"sfx_volume": return clampf(f, 0.0, 1.0)
			return f
		TYPE_BOOL:
			return bool(value) if typeof(value) == TYPE_BOOL else base
		TYPE_STRING:
			var s := str(value)
			if key == "touch_layout" and not LAYOUT_PRESETS.has(s):
				return base
			if key == "graphics_preset" and not GRAPHICS_PRESETS.has(s):
				return base
			return s
		TYPE_DICTIONARY:
			return value if typeof(value) == TYPE_DICTIONARY else base
	return base
