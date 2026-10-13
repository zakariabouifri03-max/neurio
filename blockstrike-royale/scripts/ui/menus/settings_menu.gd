class_name SettingsMenu
extends Control
## Settings screen: graphics presets, audio mix, controls and gameplay options.
##
## Every control here writes to the Settings service, which persists to the save
## file immediately and applies the change to the running game (render scale,
## shadows, view distance, volumes, touch layout).  Nothing is stored only in the
## UI, so changing a setting and leaving the screen keeps it.

var _tabs: TabContainer
var _fps_label: Label

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	UiKit.apply_theme(self)
	_build()

func _build() -> void:
	var root := UiKit.vbox(14)
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.offset_left = 40
	root.offset_top = 32
	root.offset_right = -40
	root.offset_bottom = -32
	add_child(root)
	var header := UiKit.hbox(16)
	header.add_child(UiKit.button("Back", func() -> void: GameRouter.goto_menu(), false, 140.0))
	header.add_child(UiKit.title("Settings", UiKit.FONT_TITLE))
	header.add_child(UiKit.spacer(0, false))
	_fps_label = UiKit.text("", UiKit.FONT_SMALL, UiKit.TEXT_DIM)
	header.add_child(_fps_label)
	root.add_child(header)

	_tabs = TabContainer.new()
	_tabs.size_flags_vertical = Control.SIZE_EXPAND_FILL
	root.add_child(_tabs)
	_tabs.add_child(_graphics_tab())
	_tabs.add_child(_audio_tab())
	_tabs.add_child(_controls_tab())
	_tabs.add_child(_gameplay_tab())
	_refresh_fps_label()

func _graphics_tab() -> Control:
	var scroll := UiKit.scroll()
	scroll.name = "Graphics"
	var column := UiKit.vbox(14)
	scroll.add_child(column)
	column.add_child(UiKit.text("Preset", UiKit.FONT_BODY, UiKit.TEXT))
	var preset_row := UiKit.hbox(10)
	for preset: String in Settings.PRESETS:
		var button := UiKit.button(preset.capitalize(),
			func() -> void: _apply_preset(preset), false, 150.0)
		preset_row.add_child(button)
	column.add_child(preset_row)
	column.add_child(UiKit.text("Presets set render scale, shadows, foliage, particle " \
		+ "density, view distance and the frame-rate target together. Fine tune below.",
		UiKit.FONT_SMALL, UiKit.TEXT_DIM))
	column.add_child(_slider_row("Render scale", 0.5, 1.0, 0.05,
		float(Settings.graphics_value("render_scale", 0.85)), func(value: float) -> void:
			Settings.set_graphics("render_scale", value)))
	column.add_child(_slider_row("View distance (chunks)", 1, 6, 1,
		float(Settings.graphics_value("view_distance", 3)), func(value: float) -> void:
			Settings.set_graphics("view_distance", int(value))))
	column.add_child(_option_row("Shadows", ["Off", "Low", "Medium", "High"],
		int(Settings.graphics_value("shadow_quality", 1)), func(index: int) -> void:
			Settings.set_graphics("shadow_quality", index)))
	column.add_child(_slider_row("Foliage density", 0.0, 1.0, 0.05,
		float(Settings.graphics_value("foliage_density", 0.65)), func(value: float) -> void:
			Settings.set_graphics("foliage_density", value)))
	column.add_child(_slider_row("Particle density", 0.15, 1.0, 0.05,
		float(Settings.graphics_value("particle_density", 0.6)), func(value: float) -> void:
			Settings.set_graphics("particle_density", value)))
	column.add_child(_option_row("Frame-rate target", ["30", "45", "60", "90", "120", "Unlimited"],
		_fps_index(int(Settings.graphics_value("fps_target", 45))), func(index: int) -> void:
			Settings.set_graphics("fps_target", [30, 45, 60, 90, 120, 0][index])))
	column.add_child(_option_row("MSAA", ["Off", "2x", "4x"],
		int(Settings.graphics_value("msaa", 0)), func(index: int) -> void:
			Settings.set_graphics("msaa", index)))
	column.add_child(UiKit.check("Show FPS counter", bool(Settings.graphics_value("show_fps", false)),
		func(pressed: bool) -> void:
			Settings.set_graphics("show_fps", pressed)
			_refresh_fps_label()))
	column.add_child(UiKit.check("Auto-detect on start", bool(Settings.graphics_value("auto_detect", true)),
		func(pressed: bool) -> void: Settings.set_graphics("auto_detect", pressed)))
	column.add_child(UiKit.button("Detect best preset for this device", func() -> void:
		_apply_preset(Settings.detect_recommended_preset()), false, 380.0))
	return scroll

func _audio_tab() -> Control:
	var scroll := UiKit.scroll()
	scroll.name = "Audio"
	var column := UiKit.vbox(14)
	scroll.add_child(column)
	for key: String in ["master", "music", "sfx", "ui", "voice"]:
		column.add_child(_slider_row(key.capitalize(), 0.0, 1.0, 0.05,
			float(Settings.audio.get(key, 0.8)), func(value: float) -> void:
				Settings.set_audio(key, value)))
	column.add_child(UiKit.check("Mute everything", bool(Settings.audio.get("muted", false)),
		func(pressed: bool) -> void: Settings.set_audio("muted", pressed)))
	column.add_child(UiKit.text("Changes apply instantly and are saved.", UiKit.FONT_SMALL,
		UiKit.TEXT_DIM))
	return scroll

func _controls_tab() -> Control:
	var scroll := UiKit.scroll()
	scroll.name = "Controls"
	var column := UiKit.vbox(14)
	scroll.add_child(column)
	column.add_child(_slider_row("Look sensitivity", 0.3, 3.0, 0.05,
		float(Settings.control_value("sensitivity", 1.0)), func(value: float) -> void:
			Settings.set_control("sensitivity", value)))
	column.add_child(_slider_row("Aim (ADS) sensitivity", 0.2, 2.0, 0.05,
		float(Settings.control_value("aim_sensitivity", 0.6)), func(value: float) -> void:
			Settings.set_control("aim_sensitivity", value)))
	column.add_child(UiKit.check("Invert vertical look", bool(Settings.control_value("invert_y", false)),
		func(pressed: bool) -> void: Settings.set_control("invert_y", pressed)))
	column.add_child(UiKit.check("Left-handed touch layout",
		bool(Settings.control_value("left_handed", false)), func(pressed: bool) -> void:
			Settings.set_control("left_handed", pressed)))
	column.add_child(UiKit.check("Tap the right side to fire",
		bool(Settings.control_value("tap_to_fire", true)), func(pressed: bool) -> void:
			Settings.set_control("tap_to_fire", pressed)))
	column.add_child(_slider_row("Touch control size", 0.7, 1.6, 0.05,
		float(Settings.control_value("touch_scale", 1.0)), func(value: float) -> void:
			Settings.set_control("touch_scale", value)))
	column.add_child(UiKit.text("Use \"Edit controls\" in the pause menu to drag buttons " \
		+ "to any position; the layout is saved with your settings.", UiKit.FONT_SMALL,
		UiKit.TEXT_DIM))
	column.add_child(UiKit.button("Restore default layout", func() -> void:
		Settings.controls.erase("touch_layout")
		Settings.controls["touch_scale"] = 1.0
		Settings.persist(), false, 340.0))
	return scroll

func _gameplay_tab() -> Control:
	var scroll := UiKit.scroll()
	scroll.name = "Gameplay"
	var column := UiKit.vbox(14)
	scroll.add_child(column)
	column.add_child(UiKit.text("Player name", UiKit.FONT_BODY, UiKit.TEXT))
	var name_field := UiKit.field("Display name",
		str(SaveManager.data.profile.get("display_name", "Player")))
	name_field.text_changed.connect(func(value: String) -> void:
		SaveManager.data.profile["display_name"] = value.strip_edges()
		SaveManager.mark_dirty())
	column.add_child(name_field)
	column.add_child(_option_row("Bot difficulty", ["Easy", "Normal", "Hard", "Expert", "Auto"],
		_difficulty_index(str(Settings.controls.get("bot_difficulty", "auto"))),
		func(index: int) -> void:
			var value: String = ["easy", "normal", "hard", "expert", "auto"][index]
			Settings.set_control("bot_difficulty", value)
			SaveManager.data.flags["training_bot_difficulty"] = value
			SaveManager.mark_dirty()))
	column.add_child(UiKit.text("Auto scales bots to your level and matches: new players " \
		+ "meet Easy bots, veterans meet Hard and Expert.", UiKit.FONT_SMALL, UiKit.TEXT_DIM))
	column.add_child(UiKit.check("Aim assist (touch pads)", bool(Settings.control_value("aim_assist", true)),
		func(pressed: bool) -> void: Settings.set_control("aim_assist", pressed)))
	column.add_child(UiKit.check("Auto sprint when the stick is pushed fully",
		bool(Settings.control_value("auto_sprint", false)), func(pressed: bool) -> void:
			Settings.set_control("auto_sprint", pressed)))
	return scroll

func _slider_row(label: String, minimum: float, maximum: float, step: float, value: float,
				 on_changed: Callable) -> Control:
	var column := UiKit.vbox(2)
	var row := UiKit.hbox(10)
	row.add_child(UiKit.text(label, UiKit.FONT_BODY, UiKit.TEXT))
	var value_label := UiKit.text(_format_value(value), UiKit.FONT_SMALL, UiKit.ACCENT)
	row.add_child(UiKit.spacer(0, false))
	row.add_child(value_label)
	column.add_child(row)
	column.add_child(UiKit.slider(minimum, maximum, step, value, func(new_value: float) -> void:
		value_label.text = _format_value(new_value)
		on_changed.call(new_value)))
	return column

func _option_row(label: String, items: Array, selected: int, on_selected: Callable) -> Control:
	var row := UiKit.hbox(10)
	row.add_child(UiKit.text(label, UiKit.FONT_BODY, UiKit.TEXT))
	row.add_child(UiKit.spacer(0, false))
	row.add_child(UiKit.option(items, selected, func(index: int) -> void: on_selected.call(index)))
	return row

func _format_value(value: float) -> String:
	if absf(value - roundf(value)) < 0.001:
		return str(int(round(value)))
	return "%.2f" % value

func _fps_index(target: int) -> int:
	var options: Array = [30, 45, 60, 90, 120, 0]
	var index := options.find(target)
	return index if index >= 0 else 2

func _difficulty_index(value: String) -> int:
	var options: Array = ["easy", "normal", "hard", "expert", "auto"]
	var index := options.find(value)
	return index if index >= 0 else 4

func _apply_preset(preset: String) -> void:
	Settings.apply_preset(preset, true)
	_refresh_fps_label()

func _refresh_fps_label() -> void:
	if _fps_label == null:
		return
	var target := int(Settings.graphics_value("fps_target", 60))
	_fps_label.text = "Preset %s - %s" % [str(Settings.graphics_value("preset", "medium")).capitalize(),
		("%d FPS" % target) if target > 0 else "Unlimited FPS"]
