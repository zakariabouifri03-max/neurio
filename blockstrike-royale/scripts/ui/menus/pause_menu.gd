class_name PauseMenu
extends Control
## In-match pause overlay: resume, quick settings, control layout editing, leave.
##
## Opening it pauses the scene tree (so bots, physics and the zone stop), which is
## the correct behaviour for the single-player and offline modes; in a networked
## match the server keeps running, so the menu says so instead of lying about it.

signal resume_requested()
signal leave_requested()
signal settings_applied()
signal layout_edit_requested(active: bool)

var touch: TouchControls = null
var is_networked: bool = false

var _panel: PanelContainer
var _sensitivity_slider: HSlider
var _scale_slider: HSlider
var _tap_to_fire: CheckButton
var _left_handed: CheckButton
var _edit_button: Button
var _note: Label
var _layout_grid: GridContainer

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	visible = false
	mouse_filter = Control.MOUSE_FILTER_STOP
	_build()

func _build() -> void:
	add_child(UiKit.dim_overlay(0.62))
	_panel = UiKit.panel(UiKit.BG_PANEL, 20)
	UiKit.place(_panel, Control.PRESET_CENTER, Vector2(-310, -280), Vector2(620, 560))
	add_child(_panel)
	var column := UiKit.vbox(12)
	_panel.add_child(column)
	column.add_child(UiKit.title("Paused", UiKit.FONT_TITLE))
	_note = UiKit.text("", UiKit.FONT_SMALL, UiKit.TEXT_DIM)
	column.add_child(_note)

	column.add_child(UiKit.text("Look sensitivity", UiKit.FONT_SMALL, UiKit.TEXT))
	_sensitivity_slider = UiKit.slider(0.4, 3.0, 0.05, float(Settings.control_value(
		"sensitivity", GameConfig.CAMERA["default_sensitivity"])), _on_sensitivity_changed)
	column.add_child(_sensitivity_slider)

	column.add_child(UiKit.text("Touch control size", UiKit.FONT_SMALL, UiKit.TEXT))
	_scale_slider = UiKit.slider(0.7, 1.6, 0.05, float(Settings.control_value("touch_scale", 1.0)),
		_on_scale_changed)
	column.add_child(_scale_slider)

	_tap_to_fire = UiKit.check("Tap right side to fire", bool(Settings.control_value("tap_to_fire", true)),
		_on_tap_to_fire)
	column.add_child(_tap_to_fire)
	_left_handed = UiKit.check("Left handed layout", bool(Settings.control_value("left_handed", false)),
		_on_left_handed)
	column.add_child(_left_handed)

	var row := UiKit.hbox(10)
	_edit_button = UiKit.button("Edit controls", func() -> void: _toggle_edit(), false, 220.0)
	row.add_child(_edit_button)
	row.add_child(UiKit.button("Reset layout", func() -> void: _reset_layout(), false, 200.0))
	column.add_child(row)

	_layout_grid = UiKit.grid(2, 6)
	var scroll := UiKit.scroll()
	scroll.custom_minimum_size = Vector2(560, 150)
	scroll.add_child(_layout_grid)
	column.add_child(scroll)

	column.add_child(UiKit.button("Resume", func() -> void: resume_requested.emit(), true, 220.0))
	column.add_child(UiKit.button("Leave match", func() -> void: leave_requested.emit(), false, 220.0))

func bind(touch_controls: TouchControls, networked: bool) -> void:
	touch = touch_controls
	is_networked = networked
	_note.text = "The server keeps the match running while you are paused." if networked \
		else "Single player: the match is suspended while paused."
	_refresh_layout_list()

func open() -> void:
	visible = true
	_refresh_layout_list()

func close() -> void:
	visible = false
	_set_edit(false)

func _on_sensitivity_changed(value: float) -> void:
	Settings.controls["sensitivity"] = value
	Settings.persist()
	settings_applied.emit()

func _on_scale_changed(value: float) -> void:
	if touch != null:
		touch.set_scale(value)

func _on_tap_to_fire(pressed: bool) -> void:
	Settings.controls["tap_to_fire"] = pressed
	Settings.persist()
	settings_applied.emit()

func _on_left_handed(pressed: bool) -> void:
	Settings.controls["left_handed"] = pressed
	Settings.persist()
	if touch != null:
		touch.set_left_handed(pressed)
	settings_applied.emit()

func _toggle_edit() -> void:
	var active := not (touch != null and touch.edit_mode)
	_set_edit(active)

func _set_edit(active: bool) -> void:
	if touch != null:
		touch.set_edit_mode(active)
	_edit_button.text = "Done editing" if active else "Edit controls"
	layout_edit_requested.emit(active)
	_refresh_layout_list()

func _reset_layout() -> void:
	if touch != null:
		touch.reset_layout()
		_scale_slider.value = 1.0
	_refresh_layout_list()

func _refresh_layout_list() -> void:
	if _layout_grid == null:
		return
	for child: Node in _layout_grid.get_children():
		child.queue_free()
	if touch == null:
		return
	for entry: Variant in touch.layout_summary():
		_layout_grid.add_child(UiKit.text(str(entry), UiKit.FONT_SMALL, UiKit.TEXT_DIM))
