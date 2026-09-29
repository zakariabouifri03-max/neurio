class_name RoadfallMapView
extends Control

var world: RoadfallWorldStream
var match_director: Node
var full_screen := false
var marker := Vector2(-1, -1)
var pan := Vector2.ZERO
var zoom := 1.0

func configure(owner_world: RoadfallWorldStream, owner_match: Node) -> void:
    world = owner_world
    match_director = owner_match
    mouse_filter = Control.MOUSE_FILTER_IGNORE
    queue_redraw()

func set_full_screen(enabled: bool) -> void:
    full_screen = enabled
    mouse_filter = Control.MOUSE_FILTER_STOP if enabled else Control.MOUSE_FILTER_IGNORE
    queue_redraw()

func _process(_delta: float) -> void:
    if visible:
        queue_redraw()

func _gui_input(event: InputEvent) -> void:
    if not full_screen:
        return
    if event is InputEventMouseButton and event.pressed:
        if event.button_index == MOUSE_BUTTON_WHEEL_UP:
            zoom = minf(2.5, zoom + 0.15)
        elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
            zoom = maxf(0.6, zoom - 0.15)
        elif event.button_index == MOUSE_BUTTON_LEFT:
            marker = (event.position - size * 0.5 - pan) / (size.x * zoom) + Vector2(0.5, 0.5)
    elif event is InputEventMouseMotion and event.button_mask & MOUSE_BUTTON_MASK_MIDDLE:
        pan += event.relative

func _draw() -> void:
    if world == null:
        return
    var panel_color := Color(0.025, 0.055, 0.085, 0.94 if full_screen else 0.88)
    draw_rect(Rect2(Vector2.ZERO, size), panel_color, true)
    var map_rect := Rect2(Vector2.ZERO, size)
    if not full_screen:
        map_rect = Rect2(Vector2(8, 8), size - Vector2(16, 16))
    var map_center := map_rect.position + map_rect.size * 0.5 + pan
    var map_scale := minf(map_rect.size.x, map_rect.size.y) * zoom
    for i in range(0, 21):
        var p := float(i) / 20.0
        draw_line(Vector2(map_center.x - map_scale * 0.5 + map_scale * p, map_center.y - map_scale * 0.5), Vector2(map_center.x - map_scale * 0.5 + map_scale * p, map_center.y + map_scale * 0.5), Color(0.24, 0.36, 0.42, 0.32), 1.0)
        draw_line(Vector2(map_center.x - map_scale * 0.5, map_center.y - map_scale * 0.5 + map_scale * p), Vector2(map_center.x + map_scale * 0.5, map_center.y - map_scale * 0.5 + map_scale * p), Color(0.24, 0.36, 0.42, 0.32), 1.0)
    for destination in RoadfallData.DESTINATIONS:
        var d := _map_point(world.world_to_map(destination.pos), map_center, map_scale)
        draw_circle(d, 5.0 if full_screen else 3.0, Color("#f0b85d"))
    if match_director and is_instance_valid(match_director):
        var player = match_director.player
        if player and is_instance_valid(player):
            var p := _map_point(world.world_to_map(player.global_position), map_center, map_scale)
            draw_circle(p, 7.0 if full_screen else 4.0, Color("#4de3ff"))
            var heading := Vector2(player.forward_direction().x, player.forward_direction().z).normalized() * (16.0 if full_screen else 8.0)
            draw_line(p, p + heading, Color("#e7fbff"), 2.0)
        if match_director.current_destination < match_director.destinations.size():
            var target: Vector3 = match_director.destinations[match_director.current_destination].pos
            var t := _map_point(world.world_to_map(target), map_center, map_scale)
            draw_circle(t, 10.0 if full_screen else 5.0, Color("#ff6d62", 0.75))
            if player and is_instance_valid(player):
                draw_dashed_line(_map_point(world.world_to_map(player.global_position), map_center, map_scale), t, Color("#ffda70"), 2.0, 6.0)
        for bot in match_director.bots:
            if bot and is_instance_valid(bot) and not bot.is_eliminated:
                draw_circle(_map_point(world.world_to_map(bot.global_position), map_center, map_scale), 2.0 if full_screen else 1.2, Color("#f48d77", 0.62))
    if marker.x >= 0.0:
        draw_circle(_map_point(marker, map_center, map_scale), 6.0, Color("#ffffff"))
    draw_rect(map_rect, Color("#75d7e4", 0.7), false, 2.0)

func _map_point(point: Vector2, center: Vector2, map_scale: float) -> Vector2:
    return center + (point - Vector2(0.5, 0.5)) * map_scale
