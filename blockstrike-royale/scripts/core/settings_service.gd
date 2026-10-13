extends Node
## Settings - graphics / audio / control preferences with persistence.
##
## Graphics presets are applied through a single `apply_graphics()` call so the
## settings screen can preview changes and the Android build can fall back to a
## cheap preset on weak hardware without touching gameplay code.

signal settings_changed(section: String)

const PRESETS := ["low", "medium", "high", "ultra"]

const PRESET_VALUES := {
	"low": {"render_scale": 0.72, "shadow_quality": 0, "foliage_density": 0.35,
			"particle_density": 0.35, "view_distance": 2, "fps_target": 30,
			"texture_quality": 0, "msaa": 0, "water_effects": false},
	"medium": {"render_scale": 0.85, "shadow_quality": 1, "foliage_density": 0.65,
			   "particle_density": 0.6, "view_distance": 3, "fps_target": 45,
			   "texture_quality": 1, "msaa": 0, "water_effects": true},
	"high": {"render_scale": 1.0, "shadow_quality": 2, "foliage_density": 0.85,
			 "particle_density": 0.85, "view_distance": 4, "fps_target": 60,
			 "texture_quality": 2, "msaa": 1, "water_effects": true},
	"ultra": {"render_scale": 1.0, "shadow_quality": 3, "foliage_density": 1.0,
			  "particle_density": 1.0, "view_distance": 5, "fps_target": 60,
			  "texture_quality": 2, "msaa": 2, "water_effects": true},
}

var graphics: Dictionary = {}
var audio: Dictionary = {}
var controls: Dictionary = {}

func _ready() -> void:
	load_from_save()
	AudioDirector.apply_audio_settings(audio)
	apply_graphics()

func _defaults() -> void:
	graphics = {
		"preset": detect_recommended_preset(),
		"render_scale": 0.85,
		"shadow_quality": 1,
		"foliage_density": 0.65,
		"particle_density": 0.6,
		"view_distance": 3,
		"fps_target": 45,
		"texture_quality": 1,
		"msaa": 0,
		"water_effects": true,
		"show_fps": false,
		"auto_detect": true,
	}
	audio = {"master": 0.9, "music": 0.55, "sfx": 0.9, "ui": 0.8, "voice": 0.8, "muted": false}
	controls = {
		"sensitivity": GameConfig.CAMERA["default_sensitivity"],
		"aim_sensitivity": GameConfig.CAMERA["default_aim_sensitivity"],
		"invert_y": false,
		"left_handed": false,
		"button_scale": 1.0,
		"button_opacity": 0.75,
		"layout": "standard",
		"aim_assist": true,
		"auto_sprint": false,
		"toggle_crouch": true,
		"fire_mode": "auto",
		"joystick_size": 1.0,
		"hud_scale": 1.0,
	}
	apply_preset(graphics["preset"], false)

## Chooses a starting preset from device characteristics (can be overridden).
func detect_recommended_preset() -> String:
	if GameConfig.is_android:
		var screen := DisplayServer.screen_get_size()
		var pixels := screen.x * screen.y
		if pixels >= 2200000:
			return "high"
		if pixels >= 1200000:
			return "medium"
		return "low"
	if GameConfig.is_mobile:
		return "medium"
	return "ultra"

func load_from_save() -> void:
	_defaults()
	var stored: Dictionary = SaveManager.data.settings
	if stored.has("graphics"):
		graphics.merge(stored["graphics"], true)
	if stored.has("audio"):
		audio.merge(stored["audio"], true)
	if stored.has("controls"):
		controls.merge(stored["controls"], true)
	var stored_controls: Dictionary = SaveManager.data.controls
	controls.merge(stored_controls, true)

func persist() -> void:
	SaveManager.data.settings = {
		"graphics": graphics,
		"audio": audio,
	}
	SaveManager.data.controls = controls
	SaveManager.mark_dirty()
	settings_changed.emit("all")

func apply_preset(preset: String, persist_after: bool = true) -> void:
	if not PRESET_VALUES.has(preset):
		preset = "medium"
	graphics["preset"] = preset
	var values: Dictionary = PRESET_VALUES[preset]
	for key: String in values.keys():
		graphics[key] = values[key]
	apply_graphics()
	if persist_after:
		persist()

func set_graphics(key: String, value: Variant) -> void:
	graphics[key] = value
	graphics["auto_detect"] = false
	apply_graphics()
	persist()

func set_audio(key: String, value: Variant) -> void:
	audio[key] = value
	AudioDirector.apply_audio_settings(audio)
	persist()

func set_control(key: String, value: Variant) -> void:
	controls[key] = value
	persist()

func graphics_value(key: String, fallback: Variant) -> Variant:
	return graphics.get(key, fallback)

func control_value(key: String, fallback: Variant) -> Variant:
	return controls.get(key, fallback)

## Applies the graphics block to the renderer, the window and every registered
## quality-sensitive node (lights, foliage, particles).
func apply_graphics() -> void:
	var scale_factor: float = float(graphics.get("render_scale", 1.0))
	var root := get_tree().root
	if root != null:
		root.content_scale_factor = clampf(scale_factor, 0.5, 1.0)
	Engine.max_fps = int(graphics.get("fps_target", 60))
	var shadows := int(graphics.get("shadow_quality", 1))
	for node: Node in get_tree().get_nodes_in_group("quality_lights"):
		if node is DirectionalLight3D:
			var light := node as DirectionalLight3D
			light.shadow_enabled = shadows > 0
			if shadows == 1:
				light.directional_shadow_max_distance = 60.0
			elif shadows == 2:
				light.directional_shadow_max_distance = 90.0
			else:
				light.directional_shadow_max_distance = 140.0
	var msaa := int(graphics.get("msaa", 0))
	if root != null:
		root.msaa_3d = msaa
	for node: Node in get_tree().get_nodes_in_group("quality_foliage"):
		if node is MultiMeshInstance3D:
			var mmi := node as MultiMeshInstance3D
			if mmi.multimesh != null:
				var total: int = mmi.multimesh.instance_count
				var density: float = clampf(float(graphics.get("foliage_density", 1.0)), 0.05, 1.0)
				mmi.multimesh.visible_instance_count = maxi(1, int(total * density))
	settings_changed.emit("graphics")

func master_volume_db() -> float:
	if bool(audio.get("muted", false)):
		return -80.0
	return linear_to_db(clampf(float(audio.get("master", 1.0)), 0.0001, 1.0))

func reset_all() -> void:
	_defaults()
	apply_graphics()
	AudioDirector.apply_audio_settings(audio)
	persist()
