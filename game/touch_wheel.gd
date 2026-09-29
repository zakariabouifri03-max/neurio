class_name RoadfallTouchWheel
extends Control

var game: RoadfallGame
var radius := 108.0
var active := false
var value := 0.0

func configure(owner_game: RoadfallGame) -> void:
    game = owner_game
    mouse_filter = Control.MOUSE_FILTER_STOP
    queue_redraw()

func _gui_input(event: InputEvent) -> void:
    if event is InputEventScreenTouch:
        active = event.pressed
        if not active:
            value = 0.0
            game.set_touch_steering(0.0)
        else:
            _set_from_position(event.position)
    elif event is InputEventScreenDrag:
        _set_from_position(event.position)
    elif event is InputEventMouseButton:
        active = event.pressed
        if active:
            _set_from_position(event.position)
        else:
            value = 0.0
            game.set_touch_steering(0.0)

func _set_from_position(point: Vector2) -> void:
    var center := size * 0.5
    value = clampf((point.x - center.x) / radius, -1.0, 1.0)
    game.set_touch_steering(value)
    queue_redraw()

func _draw() -> void:
    var center := size * 0.5
    draw_circle(center, radius, Color(0.04, 0.10, 0.15, 0.82))
    draw_arc(center, radius, 0, TAU, 48, Color("#45d4ef"), 4.0)
    draw_arc(center, radius * 0.72, 0, TAU, 48, Color(0.35, 0.63, 0.7, 0.45), 2.0)
    var hub := center + Vector2(value * radius * 0.68, 0)
    draw_circle(hub, 32, Color("#1d6e85"))
    draw_circle(hub, 26, Color("#42d8ff"))
