class_name TouchControls
extends Control
## Multi-touch on-screen controls. Handles every finger independently (InputEventScreenTouch/Drag) so the
## player can move, look, shoot and tap buttons at the same time. Layout is user-editable and saved.

signal action(name: String)
signal slot_tapped(index: int)
signal row_tapped(id: int)

const DEFAULTS := {
	"fire_r": {"p": Vector2(0.865, 0.64), "r": 64.0, "icon": "fire", "kind": "hold", "look": true},
	"fire_l": {"p": Vector2(0.085, 0.36), "r": 44.0, "icon": "fire", "kind": "hold", "look": true},
	"aim": {"p": Vector2(0.95, 0.42), "r": 40.0, "icon": "aim", "kind": "toggle"},
	"jump": {"p": Vector2(0.955, 0.8), "r": 42.0, "icon": "jump", "kind": "tap"},
	"crouch": {"p": Vector2(0.775, 0.88), "r": 38.0, "icon": "crouch", "kind": "toggle"},
	"reload": {"p": Vector2(0.765, 0.43), "r": 34.0, "icon": "reload", "kind": "tap"},
	"heal": {"p": Vector2(0.655, 0.88), "r": 34.0, "icon": "heal", "kind": "tap"},
	"build": {"p": Vector2(0.69, 0.66), "r": 32.0, "icon": "build", "kind": "toggle"},
	"throw": {"p": Vector2(0.86, 0.29), "r": 32.0, "icon": "throw", "kind": "tap"},
	"interact": {"p": Vector2(0.6, 0.62), "r": 40.0, "icon": "interact", "kind": "tap"},
	"emote": {"p": Vector2(0.255, 0.075), "r": 26.0, "icon": "emote", "kind": "tap"},
	"bag": {"p": Vector2(0.3, 0.92), "r": 30.0, "icon": "bag", "kind": "tap"},
	"pause": {"p": Vector2(0.972, 0.055), "r": 24.0, "icon": "pause", "kind": "tap"},
}

var buttons := {}
var fingers := {}
var joy_active := false
var joy_center := Vector2.ZERO
var joy_pos := Vector2.ZERO
var joy_vec := Vector2.ZERO
var look_acc := Vector2.ZERO
var fire_down := false
var edit_mode := false
var edit_sel := ""
var slots: Array = []            # [{text, sub, active, empty}] x4, filled by HUD
var rows: Array = []             # [{id, text, col}] nearby loot rows, filled by HUD
var map_rect := Rect2()
var _slot_rects: Array = []
var _row_rects: Array = []
var _mouse_finger := -99

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for id in DEFAULTS:
		var d: Dictionary = DEFAULTS[id]
		buttons[id] = {"p": d["p"], "r": d["r"], "icon": d["icon"], "kind": d["kind"], "look": d.get("look", false),
			"visible": true, "pressed": false, "on": false, "badge": "", "label": "", "finger": -1, "scale": 1.0}
	load_layout()

func load_layout() -> void:
	var lay: Dictionary = Settings.get_v("layout")
	for id in buttons:
		var b: Dictionary = buttons[id]
		b["p"] = DEFAULTS[id]["p"]
		b["scale"] = 1.0
		if lay.has(id):
			var e = lay[id]
			if e is Array and e.size() >= 3:
				b["p"] = Vector2(float(e[0]), float(e[1]))
				b["scale"] = float(e[2])
	buttons["fire_l"]["visible"] = bool(Settings.get_v("left_fire"))

func save_layout() -> void:
	var lay := {}
	for id in buttons:
		var b: Dictionary = buttons[id]
		lay[id] = [b["p"].x, b["p"].y, b["scale"]]
	Settings.set_v("layout", lay)

func _ui_scale() -> float:
	return size.y / 720.0 * float(Settings.get_v("btn_scale"))

func btn_center(id: String) -> Vector2:
	return (buttons[id]["p"] as Vector2) * size

func btn_radius(id: String) -> float:
	return float(buttons[id]["r"]) * float(buttons[id]["scale"]) * _ui_scale()

func set_visible_btn(id: String, v: bool) -> void:
	if buttons.has(id):
		buttons[id]["visible"] = v and (id != "fire_l" or bool(Settings.get_v("left_fire")))

func set_badge(id: String, text: String) -> void:
	buttons[id]["badge"] = text

func set_label(id: String, text: String) -> void:
	buttons[id]["label"] = text

func set_on(id: String, on: bool) -> void:
	buttons[id]["on"] = on

func is_on(id: String) -> bool:
	return bool(buttons[id]["on"])

func take_look() -> Vector2:
	var v := look_acc
	look_acc = Vector2.ZERO
	return v

func release_all() -> void:
	for f in fingers.keys():
		_release(f)
	fingers.clear()

# ------------------------------------------------------------------ input
func _input(event: InputEvent) -> void:
	if not is_visible_in_tree():
		return
	if event is InputEventScreenTouch:
		if event.pressed:
			if _press(event.index, event.position):
				get_viewport().set_input_as_handled()
		else:
			_release(event.index)
	elif event is InputEventScreenDrag:
		if _drag(event.index, event.position, event.relative):
			get_viewport().set_input_as_handled()
	elif not Settings.is_mobile and event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		if event.pressed:
			if _press(_mouse_finger, event.position):
				get_viewport().set_input_as_handled()
		else:
			_release(_mouse_finger)
	elif not Settings.is_mobile and event is InputEventMouseMotion and fingers.has(_mouse_finger):
		_drag(_mouse_finger, event.position, event.relative)

func _press(f: int, p: Vector2) -> bool:
	if edit_mode:
		for id in buttons:
			if buttons[id]["visible"] and p.distance_to(btn_center(id)) <= btn_radius(id) * 1.2:
				edit_sel = id
				fingers[f] = {"type": "edit", "id": id}
				queue_redraw()
				return true
		return false
	# loot rows and weapon slots first
	for i in _row_rects.size():
		if (_row_rects[i] as Rect2).has_point(p) and i < rows.size():
			row_tapped.emit(int(rows[i]["id"]))
			fingers[f] = {"type": "none"}
			return true
	for i in _slot_rects.size():
		if (_slot_rects[i] as Rect2).has_point(p):
			slot_tapped.emit(i)
			fingers[f] = {"type": "none"}
			return true
	if map_rect.has_point(p):
		action.emit("map")
		fingers[f] = {"type": "none"}
		return true
	var best := ""
	var best_d := 1e9
	for id in buttons:
		var b: Dictionary = buttons[id]
		if not b["visible"]:
			continue
		var d := p.distance_to(btn_center(id))
		if d <= btn_radius(id) * 1.15 and d < best_d:
			best = id
			best_d = d
	if best != "":
		var b2: Dictionary = buttons[best]
		b2["finger"] = f
		b2["pressed"] = true
		fingers[f] = {"type": "btn", "id": best, "last": p}
		match str(b2["kind"]):
			"hold":
				_update_fire()
			"toggle":
				b2["on"] = not b2["on"]
				action.emit(best)
			_:
				action.emit(best)
		Audio.vibrate(12)
		queue_redraw()
		return true
	if p.x < size.x * 0.42 and p.y > size.y * 0.3 and not joy_active:
		joy_active = true
		joy_center = p
		joy_pos = p
		joy_vec = Vector2.ZERO
		fingers[f] = {"type": "joy"}
		queue_redraw()
		return true
	fingers[f] = {"type": "look", "last": p}
	return true

func _drag(f: int, p: Vector2, rel: Vector2) -> bool:
	if not fingers.has(f):
		return false
	var fi: Dictionary = fingers[f]
	match str(fi["type"]):
		"edit":
			var id: String = fi["id"]
			buttons[id]["p"] = Vector2(clampf(p.x / size.x, 0.03, 0.97), clampf(p.y / size.y, 0.04, 0.96))
			queue_redraw()
		"joy":
			joy_pos = p
			var r := 72.0 * _ui_scale()
			var d := p - joy_center
			if d.length() > r * 1.6:
				joy_center = p - d.normalized() * r * 1.6
			joy_vec = (p - joy_center) / r
			joy_vec = joy_vec.limit_length(1.0)
			joy_vec.y = -joy_vec.y
			queue_redraw()
		"look":
			look_acc += rel
		"btn":
			if bool(buttons[fi["id"]]["look"]):
				look_acc += rel
	return true

func _release(f: int) -> void:
	if not fingers.has(f):
		return
	var fi: Dictionary = fingers[f]
	fingers.erase(f)
	match str(fi["type"]):
		"joy":
			joy_active = false
			joy_vec = Vector2.ZERO
		"btn":
			var b: Dictionary = buttons[fi["id"]]
			b["pressed"] = false
			b["finger"] = -1
			_update_fire()
	queue_redraw()

func _update_fire() -> void:
	fire_down = bool(buttons["fire_r"]["pressed"]) or bool(buttons["fire_l"]["pressed"])

# ------------------------------------------------------------------ drawing
func _process(_dt: float) -> void:
	queue_redraw()

func _draw() -> void:
	if size.y < 50.0:
		return
	var font := UI.font
	var opa: float = float(Settings.get_v("btn_opacity"))
	var s := _ui_scale()
	# joystick
	var jc := joy_center if joy_active else Vector2(size.x * 0.13, size.y * 0.74)
	var jr := 72.0 * s
	draw_circle(jc, jr * 1.15, Color(0, 0, 0, 0.22 * opa))
	draw_arc(jc, jr * 1.15, 0, TAU, 48, Color(1, 1, 1, 0.35 * opa), 3.0 * s, true)
	var knob := jc + Vector2(joy_vec.x, -joy_vec.y) * jr
	draw_circle(knob, jr * 0.45, Color(1, 1, 1, (0.55 if joy_active else 0.3) * opa))
	if joy_active and joy_vec.length() > 0.95:
		draw_arc(jc, jr * 1.15, 0, TAU, 48, Color(UI.ACCENT, 0.8 * opa), 4.0 * s, true)
	# buttons
	for id in buttons:
		var b: Dictionary = buttons[id]
		if not b["visible"]:
			continue
		var c := btn_center(id)
		var r := btn_radius(id)
		var on: bool = b["on"]
		var pressed: bool = b["pressed"]
		var bg := Color(0.05, 0.07, 0.12, 0.45 * opa)
		if on:
			bg = Color(UI.ACCENT, 0.55 * opa)
		if pressed:
			bg = Color(1, 1, 1, 0.35 * opa)
		draw_circle(c, r, bg)
		draw_arc(c, r, 0, TAU, 40, Color(1, 1, 1, (0.85 if edit_mode and edit_sel == id else 0.45) * opa), 2.5 * s, true)
		var icon: String = b["icon"]
		UI.draw_icon(self, icon, c, r * 0.62, Color(1, 1, 1, 0.92 * opa))
		var badge: String = b["badge"]
		if badge != "":
			var bp := c + Vector2(r * 0.62, -r * 0.62)
			draw_circle(bp, 13.0 * s, Color(0.1, 0.12, 0.18, 0.9))
			draw_string(font, bp + Vector2(-12 * s, 6 * s), badge, HORIZONTAL_ALIGNMENT_CENTER, 24 * s, int(16 * s), Color.WHITE)
		var lab: String = b["label"]
		if lab != "":
			draw_string_outline(font, c + Vector2(-110 * s, r + 22 * s), lab, HORIZONTAL_ALIGNMENT_CENTER, 220 * s, int(17 * s), 5, Color(0, 0, 0, 0.9))
			draw_string(font, c + Vector2(-110 * s, r + 22 * s), lab, HORIZONTAL_ALIGNMENT_CENTER, 220 * s, int(17 * s), Color.WHITE)
	# weapon slots (bottom centre)
	_slot_rects.clear()
	var sw := 138.0 * s
	var sh := 54.0 * s
	var total := sw * 4 + 8 * s * 3
	var x0 := size.x * 0.5 - total * 0.5
	var y0 := size.y - sh - 10 * s
	for i in slots.size():
		var sl: Dictionary = slots[i]
		var r2 := Rect2(x0 + i * (sw + 8 * s), y0, sw, sh)
		_slot_rects.append(r2)
		var active: bool = sl.get("active", false)
		var empty: bool = sl.get("empty", true)
		draw_style_box(UI.box(Color(0.05, 0.07, 0.12, (0.75 if active else 0.5) * opa), int(10 * s), UI.ACCENT if active else Color(1, 1, 1, 0.25), int(2 * s)), r2)
		if empty:
			draw_string(font, r2.position + Vector2(0, sh * 0.62), "-", HORIZONTAL_ALIGNMENT_CENTER, sw, int(20 * s), Color(1, 1, 1, 0.35))
			continue
		var col: Color = sl.get("col", Color.WHITE)
		draw_rect(Rect2(r2.position + Vector2(6 * s, sh - 6 * s), Vector2(sw - 12 * s, 3 * s)), col)
		draw_string(font, r2.position + Vector2(8 * s, 22 * s), str(sl.get("text", "")), HORIZONTAL_ALIGNMENT_LEFT, sw - 16 * s, int(17 * s), Color.WHITE)
		draw_string(font, r2.position + Vector2(8 * s, 44 * s), str(sl.get("sub", "")), HORIZONTAL_ALIGNMENT_LEFT, sw - 16 * s, int(18 * s), UI.GOLD if active else UI.DIM)
	# loot rows (right of centre)
	_row_rects.clear()
	var rx := size.x * 0.6 + 60 * s
	var ry := size.y * 0.2
	for i in rows.size():
		var row: Dictionary = rows[i]
		var rr := Rect2(rx, ry + i * 46 * s, 250 * s, 40 * s)
		_row_rects.append(rr)
		draw_style_box(UI.box(Color(0.05, 0.07, 0.12, 0.72), int(8 * s), row.get("col", Color.WHITE), int(2 * s)), rr)
		draw_string(font, rr.position + Vector2(12 * s, 27 * s), str(row["text"]), HORIZONTAL_ALIGNMENT_LEFT, 230 * s, int(18 * s), Color.WHITE)
	if edit_mode:
		draw_string_outline(font, Vector2(0, size.y * 0.5), "Drag buttons to move them", HORIZONTAL_ALIGNMENT_CENTER, size.x, int(28 * s), 6, Color.BLACK)
		draw_string(font, Vector2(0, size.y * 0.5), "Drag buttons to move them", HORIZONTAL_ALIGNMENT_CENTER, size.x, int(28 * s), UI.ACCENT)
