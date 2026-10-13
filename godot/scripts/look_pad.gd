extends Control
## Invisible-ish right-side camera pad. Dragging sends relative look deltas to the player.

signal look_changed(delta: Vector2)
var active_index := -1
var mouse_active := false

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	queue_redraw()

func _gui_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed and active_index == -1:
			active_index = event.index
		elif not event.pressed and event.index == active_index:
			active_index = -1
	elif event is InputEventScreenDrag and event.index == active_index:
		look_changed.emit(event.relative)
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_RIGHT:
		mouse_active = event.pressed
	elif event is InputEventMouseMotion and mouse_active:
		look_changed.emit(event.relative)

func _draw() -> void:
	# A faint guide keeps the touch surface discoverable without covering the world.
	if size.x > 0.0:
		draw_line(Vector2(size.x * 0.5, size.y * 0.5 - 22), Vector2(size.x * 0.5, size.y * 0.5 + 22), Color(0.65, 0.95, 0.9, 0.12), 2.0)
		draw_line(Vector2(size.x * 0.5 - 22, size.y * 0.5), Vector2(size.x * 0.5 + 22, size.y * 0.5), Color(0.65, 0.95, 0.9, 0.12), 2.0)
