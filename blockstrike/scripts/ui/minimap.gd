class_name Minimap
extends Control
## North-up minimap (window around the player) or full map overlay.

var m: Match
var tex: ImageTexture
var full := false
var window_m := 110.0
var _t := 0

func setup(match_node: Match, is_full: bool) -> void:
	m = match_node
	full = is_full
	tex = ImageTexture.create_from_image(WorldGen.minimap_image(m.world))
	mouse_filter = Control.MOUSE_FILTER_IGNORE if not full else Control.MOUSE_FILTER_STOP
	clip_contents = true

func _process(_dt: float) -> void:
	_t += 1
	if full or _t % 2 == 0:
		queue_redraw()

func _w2s(p: Vector2, origin: Vector2, scale: float) -> Vector2:
	return (p - origin) * scale

func _draw() -> void:
	if m == null or tex == null:
		return
	var me := m.local_actor()
	var center := Vector2(m.world.sx * 0.5, m.world.sz * 0.5)
	var follow: Actor = me
	if me == null or me.state == Actor.St.DEAD:
		follow = m.actors.get(m.controller.spectate_id) if m.controller else null
	if follow and not full:
		center = Vector2(follow.pos.x, follow.pos.z)
	var span := maxf(m.world.sx, m.world.sz) if full else window_m
	var scale := minf(size.x, size.y) / span
	var origin := center - Vector2(size.x, size.y) * 0.5 / scale
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.05, 0.1, 0.2, 0.9))
	var src := Rect2(origin, size / scale)
	draw_texture_rect_region(tex, Rect2(Vector2.ZERO, size), src)
	var mz := m.zone_view_dict()
	if not mz.is_empty() and bool(mz.get("on", false)):
		var zc: Vector2 = mz["c"]
		var zr: float = mz["r"]
		draw_arc(_w2s(zc, origin, scale), zr * scale, 0, TAU, 96, Color(0.3, 0.65, 1.0, 0.95), 2.5, true)
		if m.kind == "br" and int(mz.get("i", -1)) >= 0:
			draw_arc(_w2s(mz["nc"], origin, scale), float(mz["nr"]) * scale, 0, TAU, 96, Color(1, 1, 1, 0.9), 2.0, true)
	if m.kind == "br" and str(m.hud_summary().get("ph", "")) == "plane":
		draw_line(_w2s(Vector2(m.rules.plane_a.x, m.rules.plane_a.z), origin, scale), _w2s(Vector2(m.rules.plane_b.x, m.rules.plane_b.z), origin, scale), Color(1, 1, 1, 0.7), 2.0)
		var pp := m.rules.plane_pos(m.time)
		UI.draw_icon(self, "chute", _w2s(Vector2(pp.x, pp.z), origin, scale), 9.0, Color.WHITE)
	if full:
		for poi in m.world.pois:
			var sp := _w2s(poi["pos"], origin, scale)
			draw_string_outline(UI.font, sp + Vector2(-80, 6), str(poi["name"]), HORIZONTAL_ALIGNMENT_CENTER, 160, 18, 5, Color(0, 0, 0, 0.9))
			draw_string(UI.font, sp + Vector2(-80, 6), str(poi["name"]), HORIZONTAL_ALIGNMENT_CENTER, 160, 18, Color.WHITE)
	for id in m.crates:
		var c: Dictionary = m.crates[id]
		var cp: Vector3 = c["pos"]
		var sp2 := _w2s(Vector2(cp.x, cp.z), origin, scale)
		draw_rect(Rect2(sp2 - Vector2(5, 5), Vector2(10, 10)), Color(1.0, 0.55, 0.1))
		draw_rect(Rect2(sp2 - Vector2(5, 5), Vector2(10, 10)), Color.WHITE, false, 1.5)
	var now := m.time
	for s in m.recent_shots:
		var age: float = now - float(s[1])
		if age < 1.6:
			var p3: Vector3 = s[0]
			draw_circle(_w2s(Vector2(p3.x, p3.z), origin, scale), 4.0, Color(1.0, 0.25, 0.2, 1.0 - age / 1.6))
	if me:
		for id in m.actors:
			var o: Actor = m.actors[id]
			if o == me or o.team != me.team or not o.is_alive() or o.dummy:
				continue
			var tp := _w2s(Vector2(o.pos.x, o.pos.z), origin, scale)
			draw_circle(tp, 5.5, Color(0.1, 0.1, 0.1))
			draw_circle(tp, 4.5, Color(0.35, 1.0, 0.5) if o.state == Actor.St.ALIVE else Color(1.0, 0.7, 0.2))
	if follow:
		var fp := _w2s(Vector2(follow.pos.x, follow.pos.z), origin, scale)
		var fwd := Vector2(-sin(follow.yaw), -cos(follow.yaw))
		var right := Vector2(-fwd.y, fwd.x)
		var tri := PackedVector2Array([fp + fwd * 10.0, fp - fwd * 6.0 + right * 6.5, fp - fwd * 3.0, fp - fwd * 6.0 - right * 6.5])
		draw_colored_polygon(tri, Color(1.0, 0.85, 0.2))
		draw_polyline(tri + PackedVector2Array([tri[0]]), Color(0.1, 0.1, 0.1), 1.5)
	draw_rect(Rect2(Vector2.ZERO, size), Color(1, 1, 1, 0.5), false, 2.0)
