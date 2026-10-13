extends Control
## Top-down minimap: terrain image, zone circle, supply markers and the local player.

var _tex: Texture2D
var _map_size: Vector2 = Vector2(112, 112)
var _zone_center: Vector2 = Vector2(56, 56)
var _zone_radius: float = 80.0
var _player: Vector2 = Vector2.ZERO
var _yaw: float = 0.0
var _supply: Array = []
var _show_zone: bool = true


func set_map(tex: Texture2D, map_size: Vector2) -> void:
	_tex = tex
	_map_size = map_size
	queue_redraw()


func set_state(zone_center: Vector2, zone_radius: float, player_xz: Vector2, yaw: float, supply: Array) -> void:
	_zone_center = zone_center
	_zone_radius = zone_radius
	_player = player_xz
	_yaw = yaw
	_supply = supply
	queue_redraw()


func _to_px(world_xz: Vector2) -> Vector2:
	return Vector2(world_xz.x / _map_size.x * size.x, world_xz.y / _map_size.y * size.y)


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.05, 0.07, 0.09, 0.85))
	if _tex:
		draw_texture_rect(_tex, Rect2(Vector2.ZERO, size), false, Color(1, 1, 1, 0.95))
	# zone: outside is darkened by drawing a ring of semi-transparent red
	if _show_zone:
		var c := _to_px(_zone_center)
		var r := _zone_radius / _map_size.x * size.x
		draw_arc(c, r, 0.0, TAU, 96, Color(1.0, 0.3, 0.25, 0.95), 2.0, true)
		draw_arc(c, r + 1.0, 0.0, TAU, 96, Color(1.0, 0.3, 0.25, 0.4), 6.0, true)
	for s in _supply:
		var p := _to_px(s)
		draw_rect(Rect2(p - Vector2(4, 4), Vector2(8, 8)), Color(1.0, 0.85, 0.2))
	var pp := _to_px(_player)
	var dir := Vector2(-sin(_yaw), -cos(_yaw))
	draw_colored_polygon(PackedVector2Array([pp + dir * 9.0, pp + dir.rotated(2.5) * 5.0, pp + dir.rotated(-2.5) * 5.0]),
		Color(0.3, 0.9, 1.0))
	draw_circle(pp, 3.0, Color(0.3, 0.9, 1.0))
	draw_rect(Rect2(Vector2.ZERO, size), Color(1, 1, 1, 0.5), false, 2.0)
