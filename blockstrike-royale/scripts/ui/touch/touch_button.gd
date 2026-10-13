class_name TouchButton
extends Control
## One on-screen touch button: icon, label, hold/repeat behaviour and drag-to-move
## support for the layout editor.
##
## Implemented as a Control (not a Button) so the whole touch layer draws with one
## consistent look and so button size/position can be stored in the save file as
## plain numbers.  It reports presses through signals; the owner decides what an
## action means, which keeps input wiring in a single place.

signal pressed(id: String)
signal released(id: String)
signal repeat(id: String, count: int)
signal moved(id: String, center: Vector2)
signal drag_started(id: String)
signal drag_finished(id: String)

const DRAG_THRESHOLD := 18.0

var id: String = ""
var label_text: String = ""
var icon_name: String = ""
var hold_action: bool = false
var repeat_delay: float = 0.0
var repeat_interval: float = 0.14
var accent_color: Color = Color(1, 1, 1, 0.16)
var editable: bool = false
var font_size: int = 20

var _pressed: bool = false
var _touch_index: int = -1
var _press_time: float = 0.0
var _repeat_timer: float = 0.0
var _repeat_count: int = 0
var _drag_offset: Vector2 = Vector2.ZERO
var _dragging: bool = false
var _icon_rect: TextureRect

func configure(id_value: String, text_value: String, icon_value: String,
			   diameter: float = UiKit.TOUCH_MIN) -> void:
	id = id_value
	label_text = text_value
	icon_name = icon_value
	custom_minimum_size = Vector2(diameter, diameter)
	size = Vector2(diameter, diameter)
	mouse_filter = Control.MOUSE_FILTER_STOP

func _ready() -> void:
	if _icon_rect == null:
		_build()

func _build() -> void:
	var texture := UiKit.icon(icon_name)
	if texture != null:
		_icon_rect = TextureRect.new()
		_icon_rect.texture = texture
		_icon_rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		_icon_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		_icon_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
		_icon_rect.offset_left = size.x * 0.18
		_icon_rect.offset_top = size.y * 0.18
		_icon_rect.offset_right = -size.x * 0.18
		_icon_rect.offset_bottom = -size.y * 0.18
		_icon_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(_icon_rect)
	if not label_text.is_empty():
		var label := UiKit.text(label_text, font_size, UiKit.TEXT, HORIZONTAL_ALIGNMENT_CENTER)
		label.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
		label.offset_top = -size.y * 0.42
		label.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(label)

func _draw() -> void:
	var radius := minf(size.x, size.y) * 0.5
	var center := size * 0.5
	var fill := accent_color
	if _pressed:
		fill = accent_color.lightened(0.35)
	draw_circle(center, radius, fill)
	draw_arc(center, radius - 2.0, 0.0, TAU, 48, Color(1, 1, 1, 0.35 if _pressed else 0.18),
		3.0, true)
	if editable:
		draw_arc(center, radius - 6.0, 0.0, TAU, 48, UiKit.ACCENT, 2.0, true)

func set_diameter(diameter: float) -> void:
	custom_minimum_size = Vector2(diameter, diameter)
	size = Vector2(diameter, diameter)
	queue_redraw()

# ------------------------------------------------------------------- input
func _input(event: InputEvent) -> void:
	if not visible or not is_inside_tree():
		return
	if event is InputEventScreenTouch:
		var touch := event as InputEventScreenTouch
		if touch.pressed:
			if _touch_index >= 0 or not _contains(touch.position):
				return
			_touch_index = touch.index
			_begin_press(touch.position)
		elif touch.index == _touch_index:
			_end_press()
	elif event is InputEventScreenDrag:
		var drag := event as InputEventScreenDrag
		if drag.index == _touch_index:
			_update_press(drag.position)
	elif event is InputEventMouseButton:
		var mouse := event as InputEventMouseButton
		if mouse.button_index != MOUSE_BUTTON_LEFT:
			return
		if mouse.pressed and _touch_index < 0 and _contains(mouse.position):
			_touch_index = -2
			_begin_press(mouse.position)
		elif not mouse.pressed and _touch_index == -2:
			_end_press()
	elif event is InputEventMouseMotion and _touch_index == -2:
		_update_press((event as InputEventMouseMotion).position)

func _contains(point: Vector2) -> bool:
	return Rect2(global_position, size).has_point(point)

func _begin_press(point: Vector2) -> void:
	_press_time = 0.0
	_repeat_count = 0
	_repeat_timer = repeat_delay
	if editable:
		_drag_offset = global_position - point
		_dragging = false
		return
	_pressed = true
	queue_redraw()
	pressed.emit(id)

func _update_press(point: Vector2) -> void:
	if editable:
		if not _dragging and point.distance_to(global_position + _drag_offset) > DRAG_THRESHOLD:
			_dragging = true
			drag_started.emit(id)
		if _dragging:
			set_global_position(point + _drag_offset)
			moved.emit(id, global_position)
		return
	if not _pressed:
		return

func _end_press() -> void:
	var was_pressed := _pressed
	_touch_index = -1
	if editable:
		if _dragging:
			drag_finished.emit(id)
		_dragging = false
		_drag_offset = Vector2.ZERO
		queue_redraw()
		return
	_pressed = false
	queue_redraw()
	if was_pressed:
		released.emit(id)

func _process(delta: float) -> void:
	if not _pressed:
		return
	_press_time += delta
	if repeat_interval <= 0.0:
		return
	_repeat_timer -= delta
	if _repeat_timer <= 0.0:
		_repeat_timer = repeat_interval
		_repeat_count += 1
		repeat.emit(id, _repeat_count)

func is_held() -> bool:
	return _pressed

func press_duration() -> float:
	return _press_time
