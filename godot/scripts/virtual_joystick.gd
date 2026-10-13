extends Control
## Touch joystick with mouse emulation for desktop testing.

signal value_changed(value: Vector2)

var value := Vector2.ZERO
var active_index := -1
var mouse_active := false
var knob_radius := 34.0
var deadzone := 0.08

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	queue_redraw()

func _gui_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed and active_index == -1:
			active_index = event.index
			_update_value(event.position)
		elif not event.pressed and event.index == active_index:
			active_index = -1
			_set_value(Vector2.ZERO)
	elif event is InputEventScreenDrag and event.index == active_index:
		_update_value(event.position)
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		mouse_active = event.pressed
		if mouse_active:
			_update_value(event.position)
		else:
			_set_value(Vector2.ZERO)
	elif event is InputEventMouseMotion and mouse_active:
		_update_value(event.position)

func _update_value(pointer: Vector2) -> void:
	var center := size * 0.5
	var offset := pointer - center
	var max_radius := minf(size.x, size.y) * 0.34
	if offset.length() > max_radius:
		offset = offset.normalized() * max_radius
	var normalized := offset / max_radius
	if normalized.length() < deadzone:
		normalized = Vector2.ZERO
	_set_value(normalized)

func _set_value(next_value: Vector2) -> void:
	value = next_value
	value_changed.emit(value)
	queue_redraw()

func _draw() -> void:
	var center := size * 0.5
	var base_radius := minf(size.x, size.y) * 0.38
	draw_circle(center, base_radius, Color(0.03, 0.08, 0.14, 0.62))
	draw_arc(center, base_radius, 0.0, TAU, 48, Color(0.34, 0.89, 0.78, 0.52), 3.0)
	var max_radius := minf(size.x, size.y) * 0.34
	draw_circle(center + value * max_radius, knob_radius, Color(0.30, 0.84, 0.73, 0.86))
	draw_arc(center + value * max_radius, knob_radius, 0.0, TAU, 32, Color(0.83, 1.0, 0.96, 0.75), 2.0)
