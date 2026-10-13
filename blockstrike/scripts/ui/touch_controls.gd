class_name TouchControls
extends Control
## Multi-touch gameplay controls.
##
## Every finger is tracked by its touch index and assigned exactly one role when it
## goes down: move stick (left half, floating), camera look (right half), or a
## button. Buttons are hit-tested manually, so several fingers can move, look, jump
## and fire at the same time. Positions are stored as fractions of the device's
## safe area so they adapt to notches and unusual aspect ratios.

signal pause_pressed

const LOOK_RADIANS_PER_PIXEL := 0.0065
const STICK_DEADZONE := 0.12

const BUTTON_IDS := ["fire", "aim", "jump", "crouch", "reload", "sprint", "pause"]
const BUTTON_LABELS := {
	"fire": "FIRE", "aim": "AIM", "jump": "JUMP", "crouch": "CROUCH",
	"reload": "RELOAD", "sprint": "SPRINT", "pause": "II",
}
const BASE_RADIUS := {
	"fire": 64.0, "aim": 48.0, "jump": 46.0, "crouch": 40.0,
	"reload": 40.0, "sprint": 40.0, "pause": 28.0,
}
## Standard layout: normalised centres inside the safe area.
const STANDARD_LAYOUT := {
	"move": Vector2(0.14, 0.72),
	"fire": Vector2(0.88, 0.74),
	"aim": Vector2(0.73, 0.88),
	"jump": Vector2(0.92, 0.48),
	"crouch": Vector2(0.78, 0.60),
	"reload": Vector2(0.60, 0.88),
	"sprint": Vector2(0.30, 0.90),
	"pause": Vector2(0.96, 0.07),
}

enum Role { MOVE, LOOK, BUTTON }

var input: PlayerInput
## Only active while a match is running and the game is not paused.
var active := false
var edit_mode := false

var _positions: Dictionary = {}
var _touches: Dictionary = {}          # touch index -> {role, id, origin, last}
var _pressed: Dictionary = {}          # button id -> number of fingers holding it
var _crouch_toggled := false
var _stick_origin := Vector2.ZERO
var _stick_value := Vector2.ZERO
var _stick_visible := false
var _edit_drag_id := ""


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_preset(Control.PRESET_FULL_RECT)
	process_mode = Node.PROCESS_MODE_PAUSABLE
	refresh_from_settings()
	AppSettings.changed.connect(_on_setting_changed)
	visible = false


func _on_setting_changed(_key: String, _value: Variant) -> void:
	refresh_from_settings()


func refresh_from_settings() -> void:
	_positions = _resolve_layout()
	queue_redraw()


func set_active(value: bool) -> void:
	active = value
	visible = value
	if not value:
		_release_all()
	queue_redraw()


func set_edit_mode(value: bool) -> void:
	edit_mode = value
	_release_all()
	if not value:
		_save_positions()
	queue_redraw()


func reset_layout() -> void:
	AppSettings.set_value("touch_positions", {})
	refresh_from_settings()


func get_safe_rect() -> Rect2:
	var vp := get_viewport_rect().size
	var safe := DisplayServer.get_display_safe_area()
	if safe.size.x <= 0 or safe.size.y <= 0:
		return Rect2(Vector2.ZERO, vp)
	var win := Vector2(DisplayServer.window_get_size())
	if win.x <= 0.0 or win.y <= 0.0:
		return Rect2(Vector2.ZERO, vp)
	var k := vp / win
	return Rect2(Vector2(safe.position) * k, Vector2(safe.size) * k)


func button_center(id: String) -> Vector2:
	var r := get_safe_rect()
	var p: Vector2 = _positions.get(id, STANDARD_LAYOUT.get(id, Vector2(0.5, 0.5)))
	return r.position + Vector2(p.x, p.y) * r.size


func button_radius(id: String) -> float:
	var scale_factor := float(AppSettings.get_value("button_scale"))
	var vp_scale := clampf(get_viewport_rect().size.y / 720.0, 0.75, 1.6)
	return float(BASE_RADIUS.get(id, 40.0)) * scale_factor * vp_scale


func stick_radius() -> float:
	return 92.0 * float(AppSettings.get_value("button_scale")) * clampf(get_viewport_rect().size.y / 720.0, 0.75, 1.6)


func hit_button(pos: Vector2) -> String:
	var best := ""
	var best_d := INF
	for id in BUTTON_IDS:
		var c := button_center(id)
		var r := button_radius(id) * 1.1
		var d := pos.distance_to(c)
		if d <= r and d < best_d:
			best = id
			best_d = d
	return best


func _input(event: InputEvent) -> void:
	if not active or get_tree().paused or input == null:
		return
	## In edit mode touches are NOT marked handled, so the DONE button still receives taps.
	if event is InputEventScreenTouch:
		var st := event as InputEventScreenTouch
		if st.pressed:
			_on_touch_down(st.index, st.position)
		else:
			_on_touch_up(st.index)
		if not edit_mode:
			get_viewport().set_input_as_handled()
	elif event is InputEventScreenDrag:
		_on_touch_drag(event as InputEventScreenDrag)
		if not edit_mode:
			get_viewport().set_input_as_handled()


func _on_touch_down(index: int, pos: Vector2) -> void:
	if edit_mode:
		var id := hit_button(pos)
		if id != "":
			_edit_drag_id = id
			_touches[index] = {"role": Role.BUTTON, "id": id}
		return
	var button := hit_button(pos)
	if button != "":
		_touches[index] = {"role": Role.BUTTON, "id": button}
		_press_button(button)
		return
	var half := get_viewport_rect().size.x * 0.5
	var moving := _has_role(Role.MOVE)
	if (pos.x < half) != _is_left_handed() and not moving:
		_touches[index] = {"role": Role.MOVE, "origin": pos}
		_stick_origin = pos
		_stick_visible = true
	else:
		_touches[index] = {"role": Role.LOOK, "last": pos}
	queue_redraw()


func _on_touch_up(index: int) -> void:
	if not _touches.has(index):
		return
	var t: Dictionary = _touches[index]
	_touches.erase(index)
	match int(t["role"]):
		Role.MOVE:
			_stick_value = Vector2.ZERO
			_stick_visible = false
			input.move = Vector2.ZERO
		Role.BUTTON:
			if edit_mode:
				_edit_drag_id = ""
			else:
				_release_button(str(t["id"]))
	queue_redraw()


func _on_touch_drag(e: InputEventScreenDrag) -> void:
	if not _touches.has(e.index):
		return
	var t: Dictionary = _touches[e.index]
	match int(t["role"]):
		Role.MOVE:
			var offset: Vector2 = e.position - t["origin"]
			var r := stick_radius()
			var v := offset / maxf(r, 1.0)
			var m := v.limit_length(1.0)
			_stick_value = m
			if m.length() < STICK_DEADZONE:
				input.move = Vector2.ZERO
			else:
				var scaled := (m.length() - STICK_DEADZONE) / (1.0 - STICK_DEADZONE)
				var dir := m.normalized() * scaled
				input.move = Vector2(dir.x, -dir.y).limit_length(1.0)
			queue_redraw()
		Role.LOOK:
			var k := LOOK_RADIANS_PER_PIXEL * (720.0 / maxf(get_viewport_rect().size.y, 1.0))
			input.look_delta += Vector2(e.relative.x, e.relative.y) * k
		Role.BUTTON:
			if edit_mode and _edit_drag_id != "":
				var r := get_safe_rect()
				var local := (e.position - r.position) / r.size
				_positions[_edit_drag_id] = Vector2(clampf(local.x, 0.04, 0.96), clampf(local.y, 0.04, 0.96))
				queue_redraw()


func _press_button(id: String) -> void:
	_pressed[id] = int(_pressed.get(id, 0)) + 1
	match id:
		"fire":
			input.fire_held = true
		"aim":
			input.aim_held = true
		"sprint":
			input.sprint_held = true
		"jump":
			input.request_jump()
		"crouch":
			_crouch_toggled = not _crouch_toggled
			input.crouch_held = _crouch_toggled
		"reload":
			input.request_reload()
	queue_redraw()


func _release_button(id: String) -> void:
	var count := int(_pressed.get(id, 1)) - 1
	_pressed[id] = maxi(count, 0)
	if count > 0:
		return
	match id:
		"fire":
			input.fire_held = false
		"aim":
			input.aim_held = false
		"sprint":
			input.sprint_held = false
		"pause":
			pause_pressed.emit()
	queue_redraw()


func _release_all() -> void:
	if input != null:
		input.fire_held = false
		input.aim_held = false
		input.sprint_held = false
		input.move = Vector2.ZERO
	_touches.clear()
	_pressed.clear()
	_stick_value = Vector2.ZERO
	_stick_visible = false
	_edit_drag_id = ""


func _has_role(role: int) -> bool:
	for t in _touches.values():
		if int(t["role"]) == role:
			return true
	return false


func _is_left_handed() -> bool:
	return str(AppSettings.get_value("touch_layout")) == "left_handed"


func _resolve_layout() -> Dictionary:
	var out: Dictionary = {}
	var mirror := _is_left_handed()
	for id in STANDARD_LAYOUT.keys():
		var p: Vector2 = STANDARD_LAYOUT[id]
		if mirror and id != "pause":
			p.x = 1.0 - p.x
		out[id] = p
	var custom: Variant = AppSettings.get_value("touch_positions")
	if typeof(custom) == TYPE_DICTIONARY:
		for id in custom.keys():
			if out.has(id) and typeof(custom[id]) == TYPE_ARRAY and custom[id].size() == 2:
				out[id] = Vector2(float(custom[id][0]), float(custom[id][1]))
	return out


func _save_positions() -> void:
	var stored := {}
	for id in _positions.keys():
		var p: Vector2 = _positions[id]
		stored[id] = [snappedf(p.x, 0.001), snappedf(p.y, 0.001)]
	AppSettings.set_value("touch_positions", stored)


func _draw() -> void:
	if not visible:
		return
	var font := ThemeDB.fallback_font
	var opacity := float(AppSettings.get_value("button_opacity"))
	if _stick_visible:
		draw_circle(_stick_origin, stick_radius(), Color(1, 1, 1, opacity * 0.12))
		draw_arc(_stick_origin, stick_radius(), 0.0, TAU, 48, Color(1, 1, 1, opacity * 0.5), 3.0)
		var knob := _stick_origin + _stick_value * stick_radius()
		draw_circle(knob, 34.0, Color(1, 1, 1, opacity * 0.55))
	else:
		var move_center := button_center("move")
		var r := stick_radius() * 0.75
		draw_arc(move_center, r, 0.0, TAU, 48, Color(1, 1, 1, opacity * 0.35), 2.0)
		draw_string(font, move_center + Vector2(-r, 6.0), "MOVE", HORIZONTAL_ALIGNMENT_CENTER,
			r * 2.0, 18, Color(1, 1, 1, opacity * 0.6))
	for id in BUTTON_IDS:
		var c := button_center(id)
		var rad := button_radius(id)
		var held: bool = int(_pressed.get(id, 0)) > 0 or (id == "crouch" and _crouch_toggled)
		var fill := Color(0.1, 0.12, 0.16, opacity * (0.6 if held else 0.35))
		var ring := Color(0.6, 0.95, 1.0, opacity * (0.95 if held else 0.6))
		if id == "fire":
			fill = Color(0.95, 0.35, 0.2, opacity * (0.85 if held else 0.45))
			ring = Color(1.0, 0.8, 0.5, opacity * 0.9)
		draw_circle(c, rad, fill)
		draw_arc(c, rad, 0.0, TAU, 40, ring, 3.0)
		var label: String = BUTTON_LABELS.get(id, id.to_upper())
		var font_px := 22 if rad > 44.0 else 17
		draw_string(font, c + Vector2(-rad, font_px * 0.35), label, HORIZONTAL_ALIGNMENT_CENTER,
			rad * 2.0, font_px, Color(1, 1, 1, minf(opacity + 0.2, 1.0)))
	if edit_mode:
		var bar := Rect2(get_safe_rect().position + Vector2(20, 20), Vector2(get_safe_rect().size.x - 40, 52))
		draw_rect(bar, Color(0, 0, 0, 0.6))
		draw_string(font, bar.position + Vector2(16, 34),
			"EDIT LAYOUT: drag any button. Leave edit mode from Settings to save.",
			HORIZONTAL_ALIGNMENT_LEFT, bar.size.x - 32, 20, Color(1, 0.95, 0.6))
