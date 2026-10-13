extends Node
## Player settings: graphics presets (Low/Medium/High + auto detect), resolution scale, FPS cap,
## sensitivity, HUD layout, audio volumes and server address. Saved to user://settings.cfg.

signal changed

const PATH := "user://settings.cfg"
const QUALITY_NAMES := ["Low", "Medium", "High"]

var data := {
	"quality": -1,
	"render_scale": 0.0,
	"fps": 0,
	"shadows": -1,
	"view_dist": 0,
	"sens_look": 1.0,
	"sens_aim": 0.65,
	"invert_y": false,
	"btn_opacity": 0.85,
	"btn_scale": 1.0,
	"layout": {},
	"left_fire": true,
	"auto_pickup": true,
	"show_fps": false,
	"damage_numbers": true,
	"vol_master": 0.9,
	"vol_music": 0.55,
	"vol_sfx": 0.9,
	"vibration": true,
	"building": true,
	"difficulty": 1,
	"server_addr": "",
	"server_port": 7777,
	"lan_port": 7777,
}
var detected_quality := 1
var is_mobile := false

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	is_mobile = OS.has_feature("mobile") or OS.get_name() in ["Android", "iOS"]
	detected_quality = _detect_quality()
	_load()
	_setup_input()
	apply()

func _detect_quality() -> int:
	if DisplayServer.get_name() == "headless":
		return 0
	var cores := OS.get_processor_count()
	var mem: Dictionary = OS.get_memory_info()
	var phys_gb := float(mem.get("physical", 0)) / 1073741824.0
	if not is_mobile:
		return 2
	if phys_gb > 0.0 and phys_gb < 3.2 or cores <= 4:
		return 0
	if phys_gb > 0.0 and phys_gb < 5.5 or cores <= 6:
		return 1
	return 2

func quality() -> int:
	var q: int = int(data["quality"])
	return detected_quality if q < 0 else clampi(q, 0, 2)

func render_scale() -> float:
	var s: float = float(data["render_scale"])
	if s <= 0.0:
		return [0.7, 0.85, 1.0][quality()]
	return clampf(s, 0.5, 1.0)

func fps_cap() -> int:
	var f: int = int(data["fps"])
	if f <= 0:
		return [30, 60, 60][quality()]
	return f

func shadows_enabled() -> bool:
	var s: int = int(data["shadows"])
	if s < 0:
		return quality() >= 1
	return s == 1

func view_distance() -> float:
	var v: int = int(data["view_dist"])
	if v <= 0:
		return [64.0, 96.0, 140.0][quality()]
	return float(clampi(v, 48, 200))

func is_unlit() -> bool:
	return quality() == 0

func get_v(key: String) -> Variant:
	return data.get(key)

func set_v(key: String, value: Variant, save_now := true) -> void:
	data[key] = value
	if save_now:
		save()
	apply()
	changed.emit()

func apply() -> void:
	if DisplayServer.get_name() == "headless":
		Engine.max_fps = 30
		return
	Engine.max_fps = fps_cap()
	var vp := get_viewport()
	if vp:
		vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR
		vp.scaling_3d_scale = render_scale()
		vp.msaa_3d = Viewport.MSAA_2X if quality() >= 2 and not is_mobile else Viewport.MSAA_DISABLED
	AudioServer.set_bus_volume_db(0, linear_to_db(maxf(0.0001, float(data["vol_master"]))))
	var mb := AudioServer.get_bus_index("Music")
	if mb >= 0:
		AudioServer.set_bus_volume_db(mb, linear_to_db(maxf(0.0001, float(data["vol_music"]))))
	var sb := AudioServer.get_bus_index("SFX")
	if sb >= 0:
		AudioServer.set_bus_volume_db(sb, linear_to_db(maxf(0.0001, float(data["vol_sfx"]))))

func save() -> void:
	var cf := ConfigFile.new()
	for k in data:
		cf.set_value("settings", k, data[k])
	cf.save(PATH)

func _load() -> void:
	var cf := ConfigFile.new()
	if cf.load(PATH) != OK:
		return
	for k in data:
		if cf.has_section_key("settings", k):
			data[k] = cf.get_value("settings", k)

func reset_layout() -> void:
	set_v("layout", {})

## Keyboard / mouse bindings for desktop play and testing.
func _setup_input() -> void:
	var binds := {
		"move_forward": [KEY_W, KEY_UP], "move_back": [KEY_S, KEY_DOWN], "move_left": [KEY_A, KEY_LEFT], "move_right": [KEY_D, KEY_RIGHT],
		"jump": [KEY_SPACE], "crouch": [KEY_C, KEY_CTRL], "sprint": [KEY_SHIFT], "reload": [KEY_R], "interact": [KEY_F, KEY_E],
		"slot_1": [KEY_1], "slot_2": [KEY_2], "slot_3": [KEY_3], "slot_4": [KEY_4], "slot_5": [KEY_5], "next_weapon": [KEY_Q],
		"heal": [KEY_H], "build": [KEY_B], "throw": [KEY_G], "map": [KEY_M], "inventory": [KEY_TAB, KEY_I], "emote": [KEY_T],
		"pause": [KEY_ESCAPE], "place_block": [KEY_V],
	}
	for action in binds:
		if not InputMap.has_action(action):
			InputMap.add_action(action)
		for k in binds[action]:
			var ev := InputEventKey.new()
			ev.physical_keycode = k
			InputMap.action_add_event(action, ev)
	for pair in [["fire", MOUSE_BUTTON_LEFT], ["aim", MOUSE_BUTTON_RIGHT]]:
		if not InputMap.has_action(pair[0]):
			InputMap.add_action(pair[0])
		var mb := InputEventMouseButton.new()
		mb.button_index = pair[1]
		InputMap.action_add_event(pair[0], mb)
