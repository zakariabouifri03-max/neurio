class_name TouchControls
extends Control
## Professional mobile controls: floating stick, look area, action buttons and a
## built-in layout editor.
##
## Layout is data: every button has an id, a centre and a diameter stored in
## `Settings.controls["touch_layout"]` (saved with the rest of the settings), so
## a player can move, resize, hide or reset controls and keep that between runs.
## The stick is "floating": it appears wherever the thumb lands in the left half
## of the screen, which is what makes phone shooters feel right.

signal action(id: String)
signal layout_changed()
signal pause_requested()

const DEFAULT_LAYOUT := {
	"fire": {"pos": [0.84, 0.72], "size": 120.0, "icon": "icon_fire", "label": ""},
	"aim": {"pos": [0.68, 0.86], "size": 96.0, "icon": "icon_crosshair", "label": ""},
	"jump": {"pos": [0.93, 0.44], "size": 92.0, "icon": "icon_jump", "label": ""},
	"crouch": {"pos": [0.74, 0.63], "size": 88.0, "icon": "icon_crouch", "label": ""},
	"reload": {"pos": [0.60, 0.72], "size": 86.0, "icon": "icon_reload", "label": ""},
	"interact": {"pos": [0.46, 0.80], "size": 86.0, "icon": "icon_interact", "label": ""},
	"heal": {"pos": [0.33, 0.86], "size": 84.0, "icon": "icon_medkit", "label": ""},
	"build": {"pos": [0.37, 0.70], "size": 86.0, "icon": "icon_build", "label": ""},
	"grenade": {"pos": [0.50, 0.66], "size": 82.0, "icon": "icon_grenade", "label": ""},
	"weapon": {"pos": [0.92, 0.86], "size": 88.0, "icon": "icon_weapon_ar", "label": ""},
	"melee": {"pos": [0.80, 0.90], "size": 78.0, "icon": "icon_weapon_melee", "label": ""},
	"sprint": {"pos": [0.16, 0.76], "size": 80.0, "icon": "icon_bolt", "label": ""},
	"map": {"pos": [0.06, 0.16], "size": 74.0, "icon": "icon_map", "label": ""},
	"pause": {"pos": [0.94, 0.12], "size": 76.0, "icon": "icon_pause", "label": ""},
}

const LOOK_SENSITIVITY_REFERENCE := 0.0022   ## Radians per pixel at sensitivity 1.0
const STICK_RADIUS_RATIO := 0.11             ## Fraction of screen height

var buttons: Dictionary = {}          ## id -> TouchButton
var layout: Dictionary = {}           ## id -> {pos, size, icon, label, hidden}
var edit_mode: bool = false
var enabled: bool = true
## Desktop captures the mouse for FPS-style look; when it does, the touch layer
## must ignore mouse events so a click does not also drag the look area.
var mouse_input_enabled: bool = true

var move_vector: Vector2 = Vector2.ZERO
var look_delta: Vector2 = Vector2.ZERO
var sprint_held: bool = false
var crouch_held: bool = false
var aim_held: bool = false
var fire_held: bool = false
var build_pressed: bool = false

var _stick_index: int = -1
var _stick_origin: Vector2 = Vector2.ZERO
var _stick_current: Vector2 = Vector2.ZERO
var _look_index: int = -1
var _look_last: Vector2 = Vector2.ZERO
var _look_pixels: float = 0.0
var _look_started: float = 0.0
var _tap_to_fire: bool = true
var _left_handed: bool = false
var _scale: float = 1.0
var _editor_button: TouchButton

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	load_layout()
	_rebuild_buttons()
	set_process(true)

func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED:
		_position_buttons()

# ------------------------------------------------------------------- layout
func load_layout() -> void:
	var stored: Dictionary = Settings.control_value("touch_layout", {})
	layout = {}
	for id: String in DEFAULT_LAYOUT.keys():
		var entry: Dictionary = (DEFAULT_LAYOUT[id] as Dictionary).duplicate(true)
		if stored.has(id):
			var saved: Dictionary = stored[id]
			entry["pos"] = saved.get("pos", entry["pos"])
			entry["size"] = float(saved.get("size", entry["size"]))
			entry["hidden"] = bool(saved.get("hidden", false))
		layout[id] = entry
	_scale = float(Settings.control_value("touch_scale", 1.0))
	_left_handed = bool(Settings.control_value("left_handed", false))
	_tap_to_fire = bool(Settings.control_value("tap_to_fire", true))
	if _left_handed:
		_mirror_layout()

func _mirror_layout() -> void:
	for id: String in layout.keys():
		var entry: Dictionary = layout[id]
		var pos: Array = entry["pos"]
		entry["pos"] = [1.0 - float(pos[0]), float(pos[1])]

func save_layout() -> void:
	var payload: Dictionary = {}
	for id: String in layout.keys():
		var entry: Dictionary = layout[id]
		payload[id] = {"pos": entry["pos"], "size": entry["size"],
			"hidden": bool(entry.get("hidden", false))}
	Settings.controls["touch_layout"] = payload
	Settings.controls["touch_scale"] = _scale
	Settings.persist()
	layout_changed.emit()

func reset_layout() -> void:
	Settings.controls.erase("touch_layout")
	Settings.controls["touch_scale"] = 1.0
	Settings.persist()
	load_layout()
	_rebuild_buttons()
	layout_changed.emit()

func _rebuild_buttons() -> void:
	for child: Node in get_children():
		child.queue_free()
	buttons.clear()
	for id: String in layout.keys():
		var entry: Dictionary = layout[id]
		var button := TouchButton.new()
		button.name = "Touch_" + id
		button.configure(id, str(entry.get("label", "")), str(entry.get("icon", "")),
			float(entry.get("size", UiKit.TOUCH_MIN)) * _scale)
		button.visible = not bool(entry.get("hidden", false))
		button.hold_action = id in ["fire", "sprint", "aim"]
		if id == "weapon":
			button.repeat_interval = 0.0
		button.pressed.connect(_on_button_pressed)
		button.released.connect(_on_button_released)
		button.repeat.connect(_on_button_repeat)
		button.moved.connect(_on_button_moved)
		button.drag_finished.connect(_on_button_drag_finished)
		add_child(button)
		buttons[id] = button
	_position_buttons()

func _position_buttons() -> void:
	var screen := size
	if screen.x <= 1.0 or screen.y <= 1.0:
		screen = get_viewport_rect().size
	for id: String in buttons.keys():
		var button: TouchButton = buttons[id]
		var entry: Dictionary = layout[id]
		var pos: Array = entry["pos"]
		var center := Vector2(float(pos[0]) * screen.x, float(pos[1]) * screen.y)
		var diameter := float(entry.get("size", UiKit.TOUCH_MIN)) * _scale
		button.set_diameter(diameter)
		button.set_global_position(center - Vector2(diameter, diameter) * 0.5)

# ------------------------------------------------------------------- input
func _input(event: InputEvent) -> void:
	if not enabled or edit_mode:
		return
	if event is InputEventScreenTouch:
		var touch := event as InputEventScreenTouch
		if touch.pressed:
			_begin_touch(touch.index, touch.position)
		else:
			_end_touch(touch.index)
	elif event is InputEventScreenDrag:
		var drag := event as InputEventScreenDrag
		_update_touch(drag.index, drag.position)
	elif event is InputEventMouseButton and mouse_input_enabled:
		var mouse := event as InputEventMouseButton
		if mouse.button_index != MOUSE_BUTTON_LEFT:
			return
		if mouse.pressed:
			_begin_touch(-2, mouse.position)
		else:
			_end_touch(-2)
	elif event is InputEventMouseMotion and mouse_input_enabled and _look_index == -2:
		_update_touch(-2, (event as InputEventMouseMotion).position)

## True when a point is inside one of the visible action buttons, so a tap on a
## button never doubles as a look-drag (which would jerk the camera mid-fight).
func _over_button(point: Vector2) -> bool:
	for id: String in buttons.keys():
		var button: TouchButton = buttons[id]
		if not button.visible:
			continue
		if Rect2(button.global_position, button.size).has_point(point):
			return true
	if _editor_button != null and _editor_button.visible \
			and Rect2(_editor_button.global_position, _editor_button.size).has_point(point):
		return true
	return false

func _begin_touch(index: int, point: Vector2) -> void:
	if _over_button(point):
		return
	var left_half := point.x < size.x * 0.45
	if _left_handed:
		left_half = not left_half
	if left_half and _stick_index < 0:
		_stick_index = index
		_stick_origin = point
		_stick_current = point
		move_vector = Vector2.ZERO
		queue_redraw()
		return
	if _look_index < 0:
		_look_index = index
		_look_last = point
		_look_pixels = 0.0
		_look_started = float(Time.get_ticks_msec())

func _update_touch(index: int, point: Vector2) -> void:
	if index == _stick_index:
		_stick_current = point
		var radius := size.y * STICK_RADIUS_RATIO
		var offset := point - _stick_origin
		if offset.length() > radius:
			# The stick follows the thumb once it leaves the base circle.
			_stick_origin += offset.normalized() * (offset.length() - radius)
			offset = point - _stick_origin
		move_vector = offset / radius
		queue_redraw()
		return
	if index == _look_index:
		look_delta = point - _look_last
		_look_last = point
		_look_pixels += look_delta.length()

func _end_touch(index: int) -> void:
	if index == _stick_index:
		if _sprint_consumed_by_stick():
			sprint_held = false
			action.emit("sprint_release")
		_stick_index = -1
		move_vector = Vector2.ZERO
		queue_redraw()
		return
	if index == _look_index:
		var duration := float(Time.get_ticks_msec()) - _look_started
		if _tap_to_fire and _look_pixels < 24.0 and duration < 260.0:
			action.emit("tap_fire")
		_look_index = -1

func _sprint_consumed_by_stick() -> bool:
	return move_vector.length() > 0.85 and sprint_held

func _on_button_pressed(id: String) -> void:
	match id:
		"fire":
			fire_held = true
		"sprint":
			sprint_held = true
		"aim":
			aim_held = not aim_held
		"crouch":
			crouch_held = not crouch_held
		"build":
			build_pressed = true
		"pause":
			pause_requested.emit()
	action.emit(id)

func _on_button_released(id: String) -> void:
	match id:
		"fire":
			fire_held = false
		"sprint":
			sprint_held = false
		"build":
			build_pressed = false
	action.emit(id + "_release")

## Held buttons that cycle (weapon, build material) report here every 0.14 s.
func _on_button_repeat(id: String, count: int) -> void:
	action.emit("%s_repeat:%d" % [id, count])

func _on_button_moved(id: String, center: Vector2) -> void:
	var entry: Dictionary = layout[id]
	var diameter := float(entry.get("size", UiKit.TOUCH_MIN)) * _scale
	entry["pos"] = [(center.x + diameter * 0.5) / maxf(1.0, size.x),
		(center.y + diameter * 0.5) / maxf(1.0, size.y)]

func _on_button_drag_finished(_id: String) -> void:
	save_layout()

# ------------------------------------------------------------------- editing
func set_edit_mode(value: bool) -> void:
	edit_mode = value
	enabled = not value
	for id: String in buttons.keys():
		var button: TouchButton = buttons[id]
		button.editable = value
		button.queue_redraw()
	if value and _editor_button == null:
		var button := TouchButton.new()
		button.configure("editor_done", "", "icon_check", 96.0)
		button.pressed.connect(func(_id: String) -> void:
			set_edit_mode(false)
			save_layout())
		add_child(button)
		button.set_global_position(Vector2(size.x * 0.5 - 48.0, size.y * 0.12))
		_editor_button = button
	elif _editor_button != null:
		_editor_button.visible = value
		_editor_button.editable = value
	queue_redraw()

func set_button_hidden(id: String, hidden: bool) -> void:
	if not layout.has(id):
		return
	(layout[id] as Dictionary)["hidden"] = hidden
	if buttons.has(id):
		(buttons[id] as TouchButton).visible = not hidden
	save_layout()

func hidden_ids() -> Array:
	var out: Array = []
	for id: String in layout.keys():
		if bool((layout[id] as Dictionary).get("hidden", false)):
			out.append(id)
	return out

func set_scale(value: float) -> void:
	_scale = clampf(value, 0.7, 1.6)
	_position_buttons()
	save_layout()

func scale_value() -> float:
	return _scale

func set_left_handed(value: bool) -> void:
	if value == _left_handed:
		return
	_left_handed = value
	_mirror_layout()
	Settings.controls["left_handed"] = value
	Settings.persist()
	_position_buttons()

## True while the build button is held down (drives hold-to-build).
func is_build_held() -> bool:
	return build_pressed

# ------------------------------------------------------------------- readout
## Returns the movement vector, clamped so diagonal movement is not faster.
func movement() -> Vector2:
	return move_vector.limit_length(1.0)

## Consumes the accumulated look delta (radians) and clears it.
func consume_look() -> Vector2:
	var out := look_delta * LOOK_SENSITIVITY_REFERENCE
	look_delta = Vector2.ZERO
	return out

func _process(_delta: float) -> void:
	if _stick_index >= 0 and move_vector.length() > 0.9:
		sprint_held = true

func _draw() -> void:
	if _stick_index < 0:
		return
	var radius := size.y * STICK_RADIUS_RATIO
	draw_circle(_stick_origin, radius, Color(1, 1, 1, 0.10))
	draw_arc(_stick_origin, radius, 0.0, TAU, 48, Color(1, 1, 1, 0.30), 3.0, true)
	var knob := _stick_origin + move_vector.limit_length(1.0) * radius
	draw_circle(knob, radius * 0.42, Color(1, 1, 1, 0.32))
	draw_arc(knob, radius * 0.42, 0.0, TAU, 32, Color(1, 1, 1, 0.55), 2.0, true)

## Human readable list of the current layout (used by the settings screen).
func layout_summary() -> Array:
	var out: Array = []
	for id: String in layout.keys():
		var entry: Dictionary = layout[id]
		var pos: Array = entry["pos"]
		out.append("%s: %d%% / %d%% %s" % [id.capitalize(), int(float(pos[0]) * 100.0),
			int(float(pos[1]) * 100.0), "(hidden)" if bool(entry.get("hidden", false)) else ""])
	return out
