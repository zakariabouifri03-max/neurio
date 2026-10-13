extends Control
## Simple world-space minimap. It deliberately renders only a few primitives for mobile.

var player_position := Vector3.ZERO
var bots: Array[Vector3] = []
var safe_radius := 68.0
const WORLD_HALF := 75.0

func set_state(player_pos: Vector3, bot_positions: Array, zone_radius: float) -> void:
	player_position = player_pos
	bots.clear()
	for position in bot_positions:
		bots.append(position)
	safe_radius = zone_radius
	queue_redraw()

func _draw() -> void:
	var center := size * 0.5
	var radius := minf(size.x, size.y) * 0.43
	draw_circle(center, radius + 7.0, Color(0.02, 0.06, 0.11, 0.9))
	draw_circle(center, radius, Color(0.08, 0.18, 0.22, 0.94))
	# road axes and river band
	draw_rect(Rect2(center + Vector2(-radius, -radius * 0.25), Vector2(radius * 2.0, radius * 0.12)), Color(0.15, 0.45, 0.5, 0.6))
	draw_line(center + Vector2(-radius, -radius * 0.25), center + Vector2(radius, -radius * 0.25), Color(0.62, 0.69, 0.65, 0.55), 3.0)
	draw_line(center + Vector2(0, -radius), center + Vector2(0, radius), Color(0.63, 0.69, 0.63, 0.5), 3.0)
	var zone_scale := radius * safe_radius / WORLD_HALF
	draw_arc(center, zone_scale, 0.0, TAU, 56, Color(0.35, 0.98, 0.78, 0.88), 2.0)
	for bot_position in bots:
		var bot_point := _world_to_map(bot_position, center, radius)
		draw_circle(bot_point, 4.0, Color("#ff8066"))
	var player_point := _world_to_map(player_position, center, radius)
	draw_circle(player_point, 5.0, Color("#fff1a8"))
	draw_arc(player_point, 9.0, -PI * 0.5, PI * 0.5, 12, Color(0.95, 1.0, 0.8, 0.8), 2.0)

func _world_to_map(world_position: Vector3, center: Vector2, radius: float) -> Vector2:
	return center + Vector2(world_position.x / WORLD_HALF, world_position.z / WORLD_HALF) * radius
