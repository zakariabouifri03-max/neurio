class_name SettingsPanel
extends PanelContainer
## Settings screen used from the main menu and the pause menu. Every control writes
## straight into AppSettings, which validates and persists the value.

signal closed
signal edit_layout_requested

const GRAPHICS_LABELS := {"low": "Low", "medium": "Medium", "high": "High"}

## Set false by screens that cannot edit the touch layout (the title screen).
var allow_layout_edit := true
var _content: VBoxContainer


func _ready() -> void:
	custom_minimum_size = Vector2(620, 520)
	process_mode = Node.PROCESS_MODE_ALWAYS
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(scroll)
	var root := VBoxContainer.new()
	root.custom_minimum_size = Vector2(580, 0)
	root.add_theme_constant_override("separation", 8)
	scroll.add_child(root)
	_content = root

	_header("Settings")
	_section("Controls")
	_slider("look_sensitivity", "Look sensitivity", 0.2, 3.0, 0.05)
	_slider("aim_sensitivity", "Aim sensitivity", 0.2, 2.0, 0.05)
	_slider("camera_distance", "Camera distance", 2.2, 5.0, 0.1)
	_slider("fov", "Field of view", 60.0, 95.0, 1.0)
	_slider("button_scale", "Touch button size", 0.7, 1.5, 0.05)
	_slider("button_opacity", "Touch button opacity", 0.2, 1.0, 0.05)
	_check("invert_y", "Invert vertical look")
	_check("aim_assist", "Aim assist near bots")
	_option("touch_layout", "Touch layout", {"standard": "Standard (right-hand)", "left_handed": "Left-handed"})
	if allow_layout_edit:
		_button("Edit button positions", func() -> void: edit_layout_requested.emit())
	_button("Reset button layout", func() -> void: AppSettings.set_value("touch_positions", {}))
	_section("Graphics")
	_option("graphics_preset", "Graphics preset", GRAPHICS_LABELS)
	_check("show_fps", "Show FPS counter")
	_section("Audio")
	_slider("sfx_volume", "Effects volume", 0.0, 1.0, 0.05)
	_check("muted", "Mute all sound")
	_button("Restore default settings", func() -> void: AppSettings.reset_to_defaults(); _sync_all())
	_button("Back", func() -> void: closed.emit())


func _header(text: String) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 28)
	_content.add_child(l)


func _section(text: String) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 20)
	l.modulate = Color(0.6, 0.9, 1.0)
	_content.add_child(l)


func _slider(key: String, label: String, lo: float, hi: float, step: float) -> void:
	var row := HBoxContainer.new()
	var name_label := Label.new()
	name_label.text = label
	name_label.custom_minimum_size = Vector2(260, 0)
	row.add_child(name_label)
	var s := HSlider.new()
	s.min_value = lo
	s.max_value = hi
	s.step = step
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.value = float(AppSettings.get_value(key))
	s.value_changed.connect(func(v: float) -> void: AppSettings.set_value(key, v))
	s.set_meta("key", key)
	row.add_child(s)
	_content.add_child(row)


func _check(key: String, label: String) -> void:
	var c := CheckBox.new()
	c.text = label
	c.button_pressed = bool(AppSettings.get_value(key))
	c.toggled.connect(func(on: bool) -> void: AppSettings.set_value(key, on))
	c.set_meta("key", key)
	_content.add_child(c)


func _option(key: String, label: String, choices: Dictionary) -> OptionButton:
	var row := HBoxContainer.new()
	var name_label := Label.new()
	name_label.text = label
	name_label.custom_minimum_size = Vector2(260, 0)
	row.add_child(name_label)
	var ob := OptionButton.new()
	var keys: Array = choices.keys()
	for i in range(keys.size()):
		ob.add_item(str(choices[keys[i]]), i)
		ob.set_item_metadata(i, keys[i])
	var current := str(AppSettings.get_value(key))
	ob.select(maxi(keys.find(current), 0))
	ob.item_selected.connect(func(i: int) -> void: AppSettings.set_value(key, ob.get_item_metadata(i)))
	ob.set_meta("key", key)
	row.add_child(ob)
	_content.add_child(row)
	return ob


func _button(text: String, on_press: Callable) -> void:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(0, 52)
	b.pressed.connect(on_press)
	_content.add_child(b)


func _sync_all() -> void:
	for child in _content.get_children():
		if child.has_meta("key"):
			var key := str(child.get_meta("key"))
			if child is HSlider:
				(child as HSlider).set_value_no_signal(float(AppSettings.get_value(key)))
			elif child is CheckBox:
				(child as CheckBox).set_pressed_no_signal(bool(AppSettings.get_value(key)))
		for sub in child.get_children():
			if sub.has_meta("key") and sub is HSlider:
				(sub as HSlider).set_value_no_signal(float(AppSettings.get_value(str(sub.get_meta("key")))))
			elif sub.has_meta("key") and sub is OptionButton:
				var keys_ob := sub as OptionButton
				var k := str(AppSettings.get_value(str(sub.get_meta("key"))))
				for i in range(keys_ob.item_count):
					if str(keys_ob.get_item_metadata(i)) == k:
						keys_ob.select(i)
			elif sub.has_meta("key") and sub is CheckBox:
				(sub as CheckBox).set_pressed_no_signal(bool(AppSettings.get_value(str(sub.get_meta("key")))))
