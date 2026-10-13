class_name Models
extends RefCounted
## Procedural low-poly models made of coloured boxes: weapons (with cosmetic wraps), loot, crate, plane, parachute.
## Meshes are cached per key, so 32 players carrying rifles share one mesh resource.

static var _cache := {}
const LENS := Color(0.35, 0.8, 1.0)
const RED := Color(0.9, 0.15, 0.12)

## Weapon part lists: [centre, size, colour key ("a" main, "b" secondary, "c" metal) or Color]. Metres, -Z forward, origin at grip.
const WEAPON_PARTS := {
	"ar_strike": [[Vector3(0, 0.07, -0.1), Vector3(0.07, 0.1, 0.36), "a"], [Vector3(0, 0.085, -0.4), Vector3(0.035, 0.035, 0.26), "c"],
		[Vector3(0, 0.06, -0.3), Vector3(0.064, 0.072, 0.16), "b"], [Vector3(0, 0.05, 0.16), Vector3(0.06, 0.1, 0.22), "b"],
		[Vector3(0, -0.04, 0.02), Vector3(0.05, 0.1, 0.05), "c"], [Vector3(0, -0.08, -0.15), Vector3(0.045, 0.15, 0.07), "c"],
		[Vector3(0, 0.135, -0.04), Vector3(0.02, 0.03, 0.05), "c"], [Vector3(0, 0.12, -0.5), Vector3(0.015, 0.035, 0.02), "c"]],
	"ar_cobalt": [[Vector3(0, 0.07, -0.08), Vector3(0.07, 0.1, 0.34), "a"], [Vector3(0, 0.08, -0.42), Vector3(0.032, 0.032, 0.24), "c"],
		[Vector3(0, 0.07, -0.32), Vector3(0.07, 0.08, 0.2), "a"], [Vector3(0, 0.06, 0.15), Vector3(0.05, 0.08, 0.2), "c"],
		[Vector3(0, -0.04, 0.02), Vector3(0.05, 0.1, 0.05), "b"], [Vector3(0, -0.075, -0.14), Vector3(0.042, 0.13, 0.06), "c"],
		[Vector3(0, 0.15, -0.08), Vector3(0.045, 0.05, 0.08), "c"], [Vector3(0, 0.155, -0.125), Vector3(0.03, 0.03, 0.01), LENS]],
	"smg_buzz": [[Vector3(0, 0.06, -0.06), Vector3(0.06, 0.09, 0.26), "a"], [Vector3(0, 0.07, -0.25), Vector3(0.03, 0.03, 0.12), "c"],
		[Vector3(0, 0.07, 0.13), Vector3(0.03, 0.05, 0.16), "c"], [Vector3(0, -0.04, 0.03), Vector3(0.045, 0.09, 0.045), "b"],
		[Vector3(0, -0.07, -0.08), Vector3(0.038, 0.18, 0.05), "c"], [Vector3(0, 0.115, -0.04), Vector3(0.02, 0.025, 0.04), "c"]],
	"smg_hornet": [[Vector3(0, 0.065, -0.06), Vector3(0.07, 0.11, 0.28), "a"], [Vector3(0, 0.075, -0.28), Vector3(0.05, 0.05, 0.16), "c"],
		[Vector3(0, 0.06, 0.12), Vector3(0.05, 0.08, 0.14), "b"], [Vector3(0, -0.04, 0.03), Vector3(0.045, 0.09, 0.045), "b"],
		[Vector3(0, -0.07, -0.08), Vector3(0.04, 0.12, 0.06), "c"], [Vector3(0, -0.02, -0.18), Vector3(0.035, 0.07, 0.035), "b"]],
	"sg_boom": [[Vector3(0, 0.085, -0.33), Vector3(0.05, 0.05, 0.55), "c"], [Vector3(0, 0.035, -0.28), Vector3(0.06, 0.06, 0.16), "b"],
		[Vector3(0, 0.07, -0.02), Vector3(0.07, 0.1, 0.18), "a"], [Vector3(0, 0.04, 0.18), Vector3(0.06, 0.11, 0.26), "b"],
		[Vector3(0, -0.04, 0.03), Vector3(0.045, 0.09, 0.045), "b"]],
	"sg_thunder": [[Vector3(0, 0.075, -0.08), Vector3(0.08, 0.11, 0.3), "a"], [Vector3(0, 0.085, -0.36), Vector3(0.045, 0.045, 0.3), "c"],
		[Vector3(0, -0.06, -0.12), Vector3(0.1, 0.1, 0.09), "c"], [Vector3(0, 0.05, 0.15), Vector3(0.06, 0.1, 0.2), "b"],
		[Vector3(0, -0.04, 0.04), Vector3(0.045, 0.09, 0.045), "b"], [Vector3(0, 0.14, -0.06), Vector3(0.02, 0.03, 0.05), "c"]],
	"sr_longshot": [[Vector3(0, 0.07, -0.05), Vector3(0.06, 0.09, 0.3), "a"], [Vector3(0, 0.08, -0.48), Vector3(0.03, 0.03, 0.56), "c"],
		[Vector3(0, 0.05, 0.22), Vector3(0.06, 0.12, 0.3), "b"], [Vector3(0, 0.155, -0.06), Vector3(0.05, 0.05, 0.26), "c"],
		[Vector3(0, 0.155, -0.195), Vector3(0.04, 0.04, 0.01), LENS], [Vector3(0, 0.155, 0.075), Vector3(0.035, 0.035, 0.01), LENS],
		[Vector3(0.045, 0.08, 0.02), Vector3(0.03, 0.02, 0.02), "c"], [Vector3(0, -0.04, 0.04), Vector3(0.045, 0.09, 0.045), "b"],
		[Vector3(0, -0.03, -0.1), Vector3(0.04, 0.06, 0.07), "c"]],
	"sr_hawk": [[Vector3(0, 0.07, -0.06), Vector3(0.065, 0.1, 0.32), "a"], [Vector3(0, 0.08, -0.4), Vector3(0.032, 0.032, 0.4), "c"],
		[Vector3(0, 0.05, 0.18), Vector3(0.055, 0.1, 0.24), "b"], [Vector3(0, 0.15, -0.06), Vector3(0.045, 0.045, 0.18), "c"],
		[Vector3(0, 0.15, -0.155), Vector3(0.035, 0.035, 0.01), LENS], [Vector3(0, -0.07, -0.12), Vector3(0.045, 0.12, 0.07), "c"],
		[Vector3(0, -0.04, 0.04), Vector3(0.045, 0.09, 0.045), "b"]],
	"pi_pea": [[Vector3(0, 0.07, -0.06), Vector3(0.04, 0.05, 0.18), "a"], [Vector3(0, 0.035, -0.05), Vector3(0.038, 0.03, 0.15), "c"],
		[Vector3(0, -0.02, 0.01), Vector3(0.04, 0.11, 0.05), "b"]],
	"pi_hammer": [[Vector3(0, 0.075, -0.08), Vector3(0.05, 0.065, 0.24), "a"], [Vector3(0, 0.035, -0.06), Vector3(0.046, 0.035, 0.18), "c"],
		[Vector3(0, -0.025, 0.01), Vector3(0.05, 0.12, 0.06), "b"], [Vector3(0, 0.115, -0.18), Vector3(0.012, 0.02, 0.02), "c"]],
	"me_pick": [[Vector3(0, 0.0, -0.22), Vector3(0.04, 0.04, 0.55), "b"], [Vector3(0, 0.0, -0.48), Vector3(0.05, 0.4, 0.06), "c"],
		[Vector3(0, 0.21, -0.45), Vector3(0.04, 0.05, 0.05), "c"], [Vector3(0, -0.21, -0.45), Vector3(0.04, 0.05, 0.05), "c"]],
	"me_bat": [[Vector3(0, 0.0, -0.06), Vector3(0.035, 0.035, 0.26), "c"], [Vector3(0, 0.0, -0.36), Vector3(0.075, 0.075, 0.42), "b"],
		[Vector3(0, 0.0, 0.08), Vector3(0.05, 0.05, 0.03), "c"]],
	"gr_frag": [[Vector3(0, 0.0, -0.02), Vector3(0.1, 0.1, 0.1), Color(0.25, 0.4, 0.2)], [Vector3(0, 0.065, -0.02), Vector3(0.03, 0.03, 0.03), Color(0.75, 0.75, 0.7)]],
	"gr_smoke": [[Vector3(0, 0.0, -0.02), Vector3(0.08, 0.14, 0.08), Color(0.55, 0.57, 0.6)], [Vector3(0, 0.08, -0.02), Vector3(0.05, 0.02, 0.05), Color(0.9, 0.9, 0.9)]],
	"gr_wall": [[Vector3(0, 0.0, -0.02), Vector3(0.1, 0.1, 0.1), Color(0.25, 0.7, 0.95)], [Vector3(0, 0.0, -0.075), Vector3(0.06, 0.06, 0.01), Color(0.9, 0.97, 1.0)]],
}

static func weapon_mesh(id: String, wrap: String = "wrap_none") -> ArrayMesh:
	var key := "w:%s:%s" % [id, wrap]
	if _cache.has(key):
		return _cache[key]
	var w: Dictionary = DB.COSMETICS.get(wrap, DB.COSMETICS.get("wrap_none", {}))
	var cols := {"a": w.get("a", Color(0.22, 0.23, 0.25)), "b": w.get("b", Color(0.42, 0.3, 0.2)), "c": w.get("c", Color(0.12, 0.12, 0.13))}
	var parts: Array = WEAPON_PARTS.get(id, WEAPON_PARTS["pi_pea"])
	var boxes := []
	for p in parts:
		var col: Color = cols[p[2]] if p[2] is String else p[2]
		boxes.append([p[0], p[1], col])
	var m := boxes_mesh(boxes)
	_cache[key] = m
	return m

static func item_mesh(item: String) -> ArrayMesh:
	if DB.is_weapon(item):
		return weapon_mesh(item)
	var key := "i:" + item
	if _cache.has(key):
		return _cache[key]
	var boxes := []
	if item.begins_with("ammo_"):
		var c: Color = DB.AMMO_COLORS.get(item.substr(5), Color.GRAY)
		boxes = [[Vector3(0, 0.07, 0), Vector3(0.24, 0.14, 0.16), Color(0.25, 0.27, 0.2)], [Vector3(0, 0.15, 0), Vector3(0.25, 0.03, 0.17), c],
			[Vector3(0, 0.07, -0.081), Vector3(0.12, 0.05, 0.005), c]]
	else:
		match item:
			"med_bandage":
				boxes = [[Vector3(0, 0.06, 0), Vector3(0.2, 0.12, 0.12), Color(0.93, 0.88, 0.75)], [Vector3(0, 0.06, 0), Vector3(0.04, 0.125, 0.125), RED]]
			"med_kit":
				boxes = [[Vector3(0, 0.1, 0), Vector3(0.34, 0.2, 0.24), Color(0.95, 0.95, 0.95)], [Vector3(0, 0.201, 0), Vector3(0.16, 0.01, 0.05), RED],
					[Vector3(0, 0.201, 0), Vector3(0.05, 0.012, 0.16), RED], [Vector3(0, 0.22, 0), Vector3(0.1, 0.03, 0.03), Color(0.3, 0.3, 0.3)]]
			"med_drink":
				boxes = [[Vector3(0, 0.1, 0), Vector3(0.1, 0.2, 0.1), Color(1.0, 0.55, 0.1)], [Vector3(0, 0.205, 0), Vector3(0.08, 0.02, 0.08), Color(0.8, 0.8, 0.85)],
					[Vector3(0, 0.1, -0.051), Vector3(0.06, 0.08, 0.005), Color(0.2, 0.9, 0.4)]]
			"blocks":
				var c2 := Color(0.25, 0.68, 0.95)
				boxes = [[Vector3(-0.09, 0.08, 0), Vector3(0.16, 0.16, 0.16), c2], [Vector3(0.09, 0.08, 0.02), Vector3(0.16, 0.16, 0.16), c2.lightened(0.15)],
					[Vector3(0, 0.24, 0.01), Vector3(0.16, 0.16, 0.16), c2.darkened(0.1)]]
			_:
				if item.begins_with("vest_"):
					var lv := int(item.substr(5))
					var vc: Color = [Color.GRAY, Color(0.55, 0.47, 0.33), Color(0.28, 0.33, 0.24), Color(0.12, 0.12, 0.14)][lv]
					boxes = [[Vector3(0, 0.21, 0), Vector3(0.4, 0.42, 0.14), vc], [Vector3(0, 0.33, 0.0), Vector3(0.18, 0.12, 0.15), vc.darkened(0.25)],
						[Vector3(0, 0.14, -0.075), Vector3(0.3, 0.05, 0.01), DB.RARITY_COLORS[DB.item_rarity(item)]]]
				elif item.begins_with("helm_"):
					var lv2 := int(item.substr(5))
					var hc: Color = [Color.GRAY, Color(0.55, 0.47, 0.33), Color(0.28, 0.33, 0.24), Color(0.12, 0.12, 0.14)][lv2]
					boxes = [[Vector3(0, 0.1, 0), Vector3(0.3, 0.18, 0.3), hc], [Vector3(0, 0.03, -0.12), Vector3(0.32, 0.04, 0.12), hc.darkened(0.2)],
						[Vector3(0, 0.12, -0.151), Vector3(0.2, 0.04, 0.01), DB.RARITY_COLORS[DB.item_rarity(item)]]]
				else:
					boxes = [[Vector3(0, 0.1, 0), Vector3(0.2, 0.2, 0.2), Color.MAGENTA]]
	var m := boxes_mesh(boxes)
	_cache[key] = m
	return m

static func beam_mesh(rarity: int) -> ArrayMesh:
	var key := "beam:%d" % rarity
	if _cache.has(key):
		return _cache[key]
	var c: Color = DB.RARITY_COLORS[rarity]
	var col := Color(c.r, c.g, c.b, 0.35)
	var m := boxes_mesh([[Vector3(0, 1.3, 0), Vector3(0.05, 2.6, 0.05), col], [Vector3(0, 0.01, 0), Vector3(0.7, 0.02, 0.7), Color(c.r, c.g, c.b, 0.25)]], false)
	_cache[key] = m
	return m

static func crate_mesh() -> ArrayMesh:
	if _cache.has("crate"):
		return _cache["crate"]
	var blue := Color(0.15, 0.35, 0.75)
	var orange := Color(1.0, 0.55, 0.1)
	var m := boxes_mesh([[Vector3(0, 0.5, 0), Vector3(1.0, 1.0, 1.0), blue], [Vector3(0, 0.5, 0), Vector3(1.02, 0.16, 1.02), orange],
		[Vector3(0, 0.5, 0), Vector3(0.16, 1.02, 1.02), orange], [Vector3(0, 1.02, 0), Vector3(0.5, 0.05, 0.5), Color(1, 1, 1)]])
	_cache["crate"] = m
	return m

static func parachute_mesh(col: Color) -> ArrayMesh:
	var key := "chute:" + col.to_html()
	if _cache.has(key):
		return _cache[key]
	var boxes := []
	for i in 5:
		var x := (i - 2) * 1.15
		var y := 3.6 - absf(i - 2) * 0.45 * absf(i - 2) * 0.6
		boxes.append([Vector3(x, y, 0), Vector3(1.2, 0.18, 2.4), col if i % 2 == 0 else Color(0.95, 0.95, 0.95)])
	for s in [-1, 1]:
		boxes.append([Vector3(s * 1.1, 2.2, 0), Vector3(0.03, 2.6, 0.03), Color(0.2, 0.2, 0.2)])
	var m := boxes_mesh(boxes)
	_cache[key] = m
	return m

static func plane_mesh() -> ArrayMesh:
	if _cache.has("plane"):
		return _cache["plane"]
	var body := Color(0.86, 0.88, 0.9)
	var acc := Color(1.0, 0.5, 0.1)
	var dark := Color(0.2, 0.22, 0.25)
	var m := boxes_mesh([
		[Vector3(0, 0, 0), Vector3(2.4, 2.4, 13), body], [Vector3(0, 0.2, -6.9), Vector3(1.8, 1.6, 1.0), body],
		[Vector3(0, 0.6, -6.2), Vector3(1.9, 0.7, 1.2), Color(0.3, 0.6, 0.9)], [Vector3(0, -0.2, -1), Vector3(17, 0.3, 2.8), body],
		[Vector3(0, -0.2, -1), Vector3(17.2, 0.32, 0.5), acc], [Vector3(0, 2.0, 5.6), Vector3(0.3, 2.6, 2.2), acc],
		[Vector3(0, 0.6, 5.9), Vector3(6, 0.25, 1.6), body], [Vector3(4.5, -0.6, -2.4), Vector3(1.1, 1.1, 2.4), dark],
		[Vector3(-4.5, -0.6, -2.4), Vector3(1.1, 1.1, 2.4), dark], [Vector3(4.5, -0.6, -3.7), Vector3(2.6, 0.18, 0.12), dark],
		[Vector3(-4.5, -0.6, -3.7), Vector3(2.6, 0.18, 0.12), dark], [Vector3(0, -0.9, 0), Vector3(2.45, 0.4, 10), acc]])
	_cache["plane"] = m
	return m

static func dummy_mesh() -> ArrayMesh:
	if _cache.has("dummy"):
		return _cache["dummy"]
	var straw := Color(0.85, 0.72, 0.3)
	var m := boxes_mesh([[Vector3(0, 0.5, 0), Vector3(0.12, 1.0, 0.12), Color(0.45, 0.3, 0.15)], [Vector3(0, 1.2, 0), Vector3(0.6, 0.7, 0.32), straw],
		[Vector3(0, 1.62, 0), Vector3(0.42, 0.4, 0.42), straw], [Vector3(0, 1.2, -0.165), Vector3(0.3, 0.3, 0.01), RED],
		[Vector3(0, 1.2, 0), Vector3(1.0, 0.12, 0.12), Color(0.45, 0.3, 0.15)]])
	_cache["dummy"] = m
	return m

## Generic coloured box mesh (vertex colours, baked face shading).
static func boxes_mesh(boxes: Array, shade := true) -> ArrayMesh:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var c := PackedColorArray()
	var idx := PackedInt32Array()
	for b in boxes:
		var ctr: Vector3 = b[0]
		var sz: Vector3 = b[1]
		var col: Color = b[2]
		for f in CharacterBuilder.FACES:
			var start := v.size()
			var s: float = f[3] if shade else 1.0
			for k in 4:
				var cp: Vector3 = f[1][k]
				v.append(ctr + cp * sz)
				n.append(f[0])
				c.append(Color(col.r * s, col.g * s, col.b * s, col.a))
			idx.append_array([start, start + 1, start + 2, start, start + 2, start + 3])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	arr[Mesh.ARRAY_NORMAL] = n
	arr[Mesh.ARRAY_COLOR] = c
	arr[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m
