class_name PauseMenu
extends Control
## Pause overlay. Runs while the tree is paused (ALWAYS), so it can resume the match.
## Buttons are only shown when they have a working implementation.

signal resume_requested
signal edit_layout_requested
signal return_to_menu_requested

var _main_box: VBoxContainer
var _settings: SettingsPanel
var _center: CenterContainer


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.55)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(dim)

	_center = CenterContainer.new()
	_center.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_center)

	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(420, 0)
	_center.add_child(panel)
	_main_box = VBoxContainer.new()
	_main_box.add_theme_constant_override("separation", 12)
	panel.add_child(_main_box)

	var title := Label.new()
	title.text = "PAUSED"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 30)
	_main_box.add_child(title)

	_add_button("Resume", func() -> void: resume_requested.emit())
	_add_button("Settings", _show_settings)
	_add_button("Edit touch button layout", func() -> void: edit_layout_requested.emit())
	_add_button("Return to main menu", func() -> void: return_to_menu_requested.emit())

	_settings = SettingsPanel.new()
	_settings.visible = false
	_settings.closed.connect(_show_main)
	_settings.edit_layout_requested.connect(func() -> void: edit_layout_requested.emit())
	_center.add_child(_settings)
	visible = false


func open() -> void:
	_show_main()
	visible = true


func close() -> void:
	visible = false
	_show_main()


func _unhandled_input(event: InputEvent) -> void:
	if visible and event.is_action_pressed("ui_cancel"):
		get_viewport().set_input_as_handled()
		if _settings.visible:
			_show_main()
		else:
			resume_requested.emit()


func _show_settings() -> void:
	_main_box.get_parent().visible = false
	_settings.visible = true


func _show_main() -> void:
	_settings.visible = false
	_main_box.get_parent().visible = true


func _add_button(text: String, on_press: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(0, 56)
	b.pressed.connect(on_press)
	_main_box.add_child(b)
	return b
