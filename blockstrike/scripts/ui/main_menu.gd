class_name MainMenu
extends Node3D
## Title screen. Shows a turning voxel character preview and the menu.
## Only the Training Ground is playable in this build; other modes are visibly
## labelled as not available instead of being faked.

var _rig: CharacterRig
var _camera: Camera3D
var _ui: Control
var _root_box: VBoxContainer
var _difficulty_box: VBoxContainer
var _settings: SettingsPanel
var _turn := 0.0


func _ready() -> void:
	_build_scene()
	_build_ui()


func _process(delta: float) -> void:
	_turn += delta * 0.35
	if _rig != null:
		_rig.rotation.y = _turn
	if _camera != null:
		_camera.position = Vector3(sin(_turn * 0.2) * 0.4, 1.7, 4.2)
		_camera.look_at(Vector3(0, 1.0, 0), Vector3.UP)


func _build_scene() -> void:
	var sky_material := ProceduralSkyMaterial.new()
	sky_material.sky_top_color = Color("#2f7fd1")
	sky_material.sky_horizon_color = Color("#bfe6ff")
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = Sky.new()
	env.sky.sky_material = sky_material
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.9
	var world_env := WorldEnvironment.new()
	world_env.environment = env
	add_child(world_env)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, -30, 0)
	sun.shadow_enabled = false
	add_child(sun)

	var floor_mesh := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(6, 0.5, 6)
	floor_mesh.mesh = box
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color("#5b9b4a")
	floor_mesh.material_override = mat
	floor_mesh.position = Vector3(0, -0.25, 0)
	add_child(floor_mesh)

	_rig = CharacterRig.new()
	_rig.name = "PreviewRig"
	add_child(_rig)
	_rig.set_outfit(Color("#2f6fd6"), Color("#2b2f3a"), Color("#f2c7a0"), Color("#ffb020"))

	_camera = Camera3D.new()
	_camera.fov = 40.0
	add_child(_camera)
	_camera.current = true


func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	_ui = Control.new()
	_ui.set_anchors_preset(Control.PRESET_FULL_RECT)
	layer.add_child(_ui)

	var left := MarginContainer.new()
	left.set_anchors_preset(Control.PRESET_FULL_RECT)
	left.add_theme_constant_override("margin_left", 48)
	left.add_theme_constant_override("margin_top", 36)
	left.add_theme_constant_override("margin_bottom", 24)
	_ui.add_child(left)
	var column := VBoxContainer.new()
	column.custom_minimum_size = Vector2(420, 0)
	column.add_theme_constant_override("separation", 10)
	left.add_child(column)

	var title := Label.new()
	title.text = "BLOCKSTRIKE ROYALE"
	title.add_theme_font_size_override("font_size", 40)
	title.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	title.add_theme_constant_override("outline_size", 8)
	column.add_child(title)
	var subtitle := Label.new()
	subtitle.text = "Phase 1 prototype  -  Emerald Island"
	subtitle.modulate = Color(0.85, 0.95, 1.0)
	column.add_child(subtitle)

	_root_box = VBoxContainer.new()
	_root_box.add_theme_constant_override("separation", 8)
	column.add_child(_root_box)
	_add_button(_root_box, "Training Ground", _show_difficulty)
	_add_button(_root_box, "Settings", _show_settings_panel)
	_add_button(_root_box, "Quit", func() -> void: get_tree().quit())
	_add_unavailable(_root_box, "Battle Royale", "not built yet")
	_add_unavailable(_root_box, "Clash Squad", "not built yet")
	_add_unavailable(_root_box, "2v2", "not built yet")
	_add_unavailable(_root_box, "Custom Rooms", "not built yet")
	_add_unavailable(_root_box, "Multiplayer (LAN / Internet)", "needs a game server; not configured")
	_add_unavailable(_root_box, "Shop & Cosmetics", "not built yet")

	_difficulty_box = VBoxContainer.new()
	_difficulty_box.add_theme_constant_override("separation", 8)
	_difficulty_box.visible = false
	column.add_child(_difficulty_box)
	var pick := Label.new()
	pick.text = "Choose the training bot:"
	_difficulty_box.add_child(pick)
	_add_button(_difficulty_box, "Beginner bot", func() -> void: _start("beginner"))
	_add_button(_difficulty_box, "Normal bot", func() -> void: _start("normal"))
	_add_button(_difficulty_box, "Advanced bot", func() -> void: _start("advanced"))
	_add_button(_difficulty_box, "Back", _show_root)

	_settings = SettingsPanel.new()
	_settings.allow_layout_edit = false
	_settings.visible = false
	_settings.closed.connect(_show_root)
	_ui.add_child(_settings)
	_settings.set_anchors_preset(Control.PRESET_CENTER_RIGHT)
	_settings.position = Vector2(-700, -260)

	var footer := Label.new()
	footer.text = "Touch-first. Landscape. Original voxel assets. No online services in this build."
	footer.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	footer.position = Vector2(48, -30)
	footer.modulate = Color(1, 1, 1, 0.7)
	_ui.add_child(footer)


func _add_button(parent: Control, text: String, on_press: Callable) -> void:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(0, 52)
	b.pressed.connect(on_press)
	parent.add_child(b)


func _add_unavailable(parent: Control, text: String, reason: String) -> void:
	var b := Button.new()
	b.text = "%s  (%s)" % [text, reason]
	b.disabled = true
	b.custom_minimum_size = Vector2(0, 44)
	b.tooltip_text = "Not available in this build."
	parent.add_child(b)


func _show_difficulty() -> void:
	_root_box.visible = false
	_difficulty_box.visible = true


func _show_root() -> void:
	_settings.visible = false
	_difficulty_box.visible = false
	_root_box.visible = true


func _show_settings_panel() -> void:
	_root_box.visible = false
	_settings.visible = true


func _start(difficulty: String) -> void:
	Sfx.play_ui("ui_click")
	GameState.start_training(difficulty)
