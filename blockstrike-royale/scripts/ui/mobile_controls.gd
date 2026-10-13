extends Control
## Landscape touch overlay. Left side: floating virtual joystick. Right side: swipe to look.
## Buttons are positioned as normalised centres (fraction of the viewport) and saved in
## Game.settings.button_layout. Edit mode lets the player drag every button.
## Everything writes into the Controls autoload, the same as the keyboard does.

signal pause_pressed
signal edit_finished

const JOY_DEFAULT := Vector2(0.14, 0.74)
const LOOK_MIN_X := 0.42   # touches right of this fraction of the width start a look drag
const SPRINT_LEVEL := 0.9

## action: Controls action to press. hold: "fire" or "aim" keep state while touched.
const BUTTONS := {
	"fire": {"label": "FIRE", "pos": Vector2(0.90, 0.80), "d": 0.20, "hold": "fire", "color": Color(0.95, 0.35, 0.25)},
	"aim": {"label": "AIM", "pos": Vector2(0.74, 0.84), "d": 0.13, "hold": "aim", "color": Color(0.35, 0.65, 1.0)},
	"jump": {"label": "JUMP", "pos": Vector2(0.93, 0.52), "d": 0.12, "action": "jump"},
	"crouch": {"label": "CROUCH", "pos": Vector2(0.80, 0.60), "d": 0.11, "action": "crouch"},
	"reload": {"label": "RELOAD", "pos": Vector2(0.67, 0.50), "d": 0.11, "action": "reload"},
	"switch": {"label": "SWAP", "pos": Vector2(0.62, 0.72), "d": 0.10, "action": "switch"},
	"use": {"label": "USE", "pos": Vector2(0.80, 0.41), "d": 0.10, "action": "use"},
	"heal": {"label": "HEAL", "pos": Vector2(0.93, 0.33), "d": 0.11, "action": "heal"},
	"build": {"label": "BUILD", "pos": Vector2(0.67, 0.31), "d": 0.10, "action": "build"},
	"bag": {"label": "BAG", "pos": Vector2(0.84, 0.10), "d": 0.09, "action": "bag"},
	"pause": {"label": "II", "pos": Vector2(0.95, 0.10), "d": 0.09, "action": "pause"},
}

var enabled_for_device: bool = false
var _active: bool = false
var _edit: bool = false
var _touches: Dictionary = {}     # index -> {"kind", "name"/"origin"/"last"}
var _joy_origin: Vector2 = Vector2.ZERO
var _joy_vec: Vector2 = Vector2.ZERO
var _joy_on: bool = false
var _held: Dictionary = {}        # button name -> true while touched
var _drag_name: String = ""
var _done_rect: Rect2 = Rect2()
var _font: Font


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_font = ThemeDB.fallback_font
	enabled_for_device = DisplayServer.is_touchscreen_available() or bool(Game.settings.get("force_touch_ui", false))
	visible = false
	set_process_input(true)


## Called by the match/menu each frame. Hides the overlay while menus are open.
func set_active(on: bool) -> void:
	on = on and enabled_for_device
	if not on and _active:
		_release_all()
	_active = on
	visible = on or _edit
	queue_redraw()


func start_edit() -> void:
	_edit = true
	_release_all()
	visible = true
	queue_redraw()


func _viewport_size() -> Vector2:
	return get_viewport_rect().size


func _pos_of(name_key: String) -> Vector2:
	var vs := _viewport_size()
	var layout: Dictionary = Game.settings.get("button_layout", {})
	if layout.has(name_key):
		var a: Array = layout[name_key]
		return Vector2(float(a[0]), float(a[1])) * vs
	return (BUTTONS[name_key]["pos"] as Vector2) * vs


func _radius_of(name_key: String) -> float:
	var vs := _viewport_size()
	var scale: float = float(Game.settings.get("button_scale", 1.0))
	return float(BUTTONS[name_key]["d"]) * vs.y * scale * 0.5


func _joy_radius() -> float:
	return 0.12 * _viewport_size().y * float(Game.settings.get("joystick_size", 1.0))


func _button_at(p: Vector2) -> String:
	var best := ""
	var best_d := 1.0e9
	for k in BUTTONS.keys():
		var d: float = _pos_of(k).distance_to(p)
		if d <= _radius_of(k) * 1.15 and d < best_d:
			best_d = d
			best = k
	return best


func _input(event: InputEvent) -> void:
	if not is_visible_in_tree():
		return
	if _edit:
		_input_edit(event)
		return
	if not _active:
		return
	if event is InputEventScreenTouch:
		if event.pressed:
			if _touch_down(event.index, event.position):
				get_viewport().set_input_as_handled()
		else:
			if _touches.has(event.index):
				_touch_up(event.index)
				get_viewport().set_input_as_handled()
	elif event is InputEventScreenDrag:
		if _touches.has(event.index):
			_touch_drag(event.index, event.position, event.relative)
			get_viewport().set_input_as_handled()


func _touch_down(index: int, p: Vector2) -> bool:
	var vs := _viewport_size()
	if _button_at(p) != "":
		var name_key := _button_at(p)
		_touches[index] = {"kind": "btn", "name": name_key}
		_press_button(name_key, true)
		queue_redraw()
		return true
	if p.x < vs.x * LOOK_MIN_X:
		_touches[index] = {"kind": "joy"}
		_joy_origin = p
		_joy_on = true
		_joy_vec = Vector2.ZERO
		queue_redraw()
		return true
	if p.x >= vs.x * 0.5:
		_touches[index] = {"kind": "look", "last": p}
		return true
	return false


func _touch_drag(index: int, p: Vector2, rel: Vector2) -> void:
	var t: Dictionary = _touches[index]
	match t["kind"]:
		"joy":
			var r := _joy_radius()
			var v := (p - _joy_origin) / r
			if v.length() > 1.0:
				v = v.normalized()
			_joy_vec = v
			Controls.touch_move = Vector2(v.x, -v.y)
			Controls.touch_sprint = v.length() >= SPRINT_LEVEL
			queue_redraw()
		"look":
			var gain := 720.0 / _viewport_size().y
			Controls.look_delta += rel * gain
			t["last"] = p


func _touch_up(index: int) -> void:
	var t: Dictionary = _touches[index]
	_touches.erase(index)
	match t["kind"]:
		"btn":
			_press_button(t["name"], false)
		"joy":
			_joy_on = false
			_joy_vec = Vector2.ZERO
			Controls.touch_move = Vector2.ZERO
			Controls.touch_sprint = false
	queue_redraw()


func _press_button(name_key: String, down: bool) -> void:
	var def: Dictionary = BUTTONS[name_key]
	if def.has("hold"):
		var h: String = def["hold"]
		_held[name_key] = down
		if h == "fire":
			Controls.fire_held = down
			if down:
				Controls.press("fire")
		else:
			Controls.aim_held = down
		return
	if not down:
		return
	if def["action"] == "pause":
		pause_pressed.emit()
		return
	Controls.press(def["action"])


func _release_all() -> void:
	_touches.clear()
	_joy_on = false
	_joy_vec = Vector2.ZERO
	_held.clear()
	Controls.touch_move = Vector2.ZERO
	Controls.touch_sprint = false
	Controls.fire_held = false
	Controls.aim_held = false


# ---------------------------------------------------------------- edit mode
func _input_edit(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed:
			if _done_rect.has_point(event.position):
				_finish_edit()
				get_viewport().set_input_as_handled()
				return
			_drag_name = _button_at(event.position)
			get_viewport().set_input_as_handled()
		else:
			_drag_name = ""
	elif event is InputEventScreenDrag and _drag_name != "":
		var vs := _viewport_size()
		var c: Vector2 = event.position
		c.x = clampf(c.x, 20.0, vs.x - 20.0)
		c.y = clampf(c.y, 20.0, vs.y - 20.0)
		var layout: Dictionary = Game.settings.get("button_layout", {})
		layout[_drag_name] = [c.x / vs.x, c.y / vs.y]
		Game.settings["button_layout"] = layout
		get_viewport().set_input_as_handled()
		queue_redraw()


func _finish_edit() -> void:
	_edit = false
	_drag_name = ""
	Game.save_all()
	visible = _active
	queue_redraw()
	edit_finished.emit()


# ---------------------------------------------------------------- drawing
func _draw() -> void:
	if not visible:
		return
	var vs := _viewport_size()
	if _edit:
		draw_rect(Rect2(Vector2.ZERO, vs), Color(0, 0, 0, 0.35))
		_done_rect = Rect2(vs.x * 0.5 - 90, 12, 180, 46)
		draw_rect(_done_rect, Color(0.2, 0.7, 0.35, 0.95))
		_text(Vector2(vs.x * 0.5, 42), "DONE", 20, true, Color.WHITE)
		_text(Vector2(vs.x * 0.5, 84), "Drag the buttons to move them. Tap DONE to save.", 16, true, Color(1, 1, 0.8))
	# joystick
	var jr := _joy_radius()
	if _joy_on:
		draw_circle(_joy_origin, jr, Color(1, 1, 1, 0.12))
		draw_arc(_joy_origin, jr, 0, TAU, 48, Color(1, 1, 1, 0.5), 3.0, true)
		draw_circle(_joy_origin + _joy_vec * jr, jr * 0.42, Color(1, 1, 1, 0.45))
	else:
		var jc := JOY_DEFAULT * vs
		draw_arc(jc, jr, 0, TAU, 48, Color(1, 1, 1, 0.22), 3.0, true)
		draw_circle(jc, jr * 0.35, Color(1, 1, 1, 0.16))
	# buttons
	for k in BUTTONS.keys():
		var c := _pos_of(k)
		var r := _radius_of(k)
		var def: Dictionary = BUTTONS[k]
		var base: Color = def.get("color", Color(0.12, 0.16, 0.2))
		var fill := Color(base.r, base.g, base.b, 0.7 if _held.get(k, false) else 0.38)
		draw_circle(c, r, fill)
		draw_arc(c, r, 0, TAU, 40, Color(1, 1, 1, 0.55), 2.5, true)
		var fs := clampi(int(r * 0.42), 12, 24)
		_text(c + Vector2(0, fs * 0.36), str(def["label"]), fs, true, Color(1, 1, 1, 0.92))
		if _edit:
			draw_arc(c, r + 6, 0, TAU, 40, Color(1, 0.9, 0.3, 0.9), 2.0, true)


func _text(p: Vector2, s: String, fs: int, centered: bool, col: Color) -> void:
	if _font == null:
		return
	var w := _font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	var x := p.x - w * 0.5 if centered else p.x
	draw_string_outline(_font, Vector2(x, p.y), s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 4, Color(0, 0, 0, 0.7))
	draw_string(_font, Vector2(x, p.y), s, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)
