extends Node3D
## Chunked voxel world: builds one ArrayMesh (solid + water surfaces) and one
## ConcavePolygon collider per 16x16x16 chunk, with per-vertex ambient occlusion.
## Only faces that touch air/water are emitted; chunks outside view distance are hidden.

const BD := preload("res://scripts/world/block_defs.gd")
const TA := preload("res://scripts/world/texture_atlas.gd")

const CS := 16
const WORLD_LAYER := 1

## Face order: +X, -X, +Y (top), -Y (bottom), +Z, -Z
const FACE_DIRS := [Vector3i(1, 0, 0), Vector3i(-1, 0, 0), Vector3i(0, 1, 0), Vector3i(0, -1, 0), Vector3i(0, 0, 1), Vector3i(0, 0, -1)]
const FACE_U := [Vector3i(0, 0, -1), Vector3i(0, 0, 1), Vector3i(1, 0, 0), Vector3i(1, 0, 0), Vector3i(-1, 0, 0), Vector3i(1, 0, 0)]
const FACE_V := [Vector3i(0, 1, 0), Vector3i(0, 1, 0), Vector3i(0, 0, 1), Vector3i(0, 0, -1), Vector3i(0, 1, 0), Vector3i(0, 1, 0)]
const FACE_SHADE := [0.82, 0.82, 1.0, 0.5, 0.7, 0.7]
const AO_LIGHT := [0.5, 0.67, 0.84, 1.0]

signal chunks_built(done: int, total: int)

var size: Vector3i = Vector3i.ZERO
var blocks := PackedByteArray()
var surface := PackedInt32Array()
var chunks: Dictionary = {}
var chunk_count: Vector3i = Vector3i.ZERO
var total_triangles := 0
var _mat_solid: StandardMaterial3D
var _mat_water: StandardMaterial3D
var _atlas_size := Vector2(256, 128)


func setup(gen) -> void:
	size = gen.size
	blocks = gen.blocks
	surface = gen.surface
	chunk_count = Vector3i(ceili(size.x / float(CS)), ceili(size.y / float(CS)), ceili(size.z / float(CS)))
	_make_materials()


func _make_materials() -> void:
	var img: Image = TA.build_image()
	var tex := ImageTexture.create_from_image(img)
	_atlas_size = Vector2(img.get_width(), img.get_height())
	_mat_solid = StandardMaterial3D.new()
	_mat_solid.albedo_texture = tex
	_mat_solid.vertex_color_use_as_albedo = true
	_mat_solid.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST_WITH_MIPMAPS
	_mat_solid.roughness = 0.95
	_mat_water = StandardMaterial3D.new()
	_mat_water.albedo_texture = tex
	_mat_water.vertex_color_use_as_albedo = true
	_mat_water.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST_WITH_MIPMAPS
	_mat_water.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_mat_water.roughness = 0.12
	_mat_water.metallic_specular = 0.7
	_mat_water.cull_mode = BaseMaterial3D.CULL_DISABLED
	_mat_water.shading_mode = BaseMaterial3D.SHADING_MODE_PER_PIXEL


## Builds every chunk, yielding between batches so the loading screen stays responsive.
func build_all_async(batch: int = 8) -> void:
	var keys: Array = []
	for z in chunk_count.z:
		for y in chunk_count.y:
			for x in chunk_count.x:
				keys.append(Vector3i(x, y, z))
	var done := 0
	for k in keys:
		_build_chunk(k)
		done += 1
		if done % batch == 0:
			chunks_built.emit(done, keys.size())
			await get_tree().process_frame
	chunks_built.emit(done, keys.size())


func build_all_sync() -> void:
	for z in chunk_count.z:
		for y in chunk_count.y:
			for x in chunk_count.x:
				_build_chunk(Vector3i(x, y, z))


func get_block(x: int, y: int, z: int) -> int:
	if x < 0 or y < 0 or z < 0 or x >= size.x or y >= size.y or z >= size.z:
		return BD.AIR
	return blocks[(y * size.z + z) * size.x + x]


func set_block(p: Vector3i, id: int) -> void:
	if p.x < 0 or p.y < 0 or p.z < 0 or p.x >= size.x or p.y >= size.y or p.z >= size.z:
		return
	blocks[(p.y * size.z + p.z) * size.x + p.x] = id
	var cc := Vector3i(p.x / CS, p.y / CS, p.z / CS)
	_build_chunk(cc)
	# neighbouring chunks expose faces that changed when the block sits on a border
	for d in [Vector3i(-1, 0, 0), Vector3i(1, 0, 0), Vector3i(0, -1, 0), Vector3i(0, 1, 0), Vector3i(0, 0, -1), Vector3i(0, 0, 1)]:
		var n := Vector3i(p.x + d.x, p.y + d.y, p.z + d.z)
		if n.x < 0 or n.y < 0 or n.z < 0 or n.x >= size.x or n.y >= size.y or n.z >= size.z:
			continue
		var ncc := Vector3i(n.x / CS, n.y / CS, n.z / CS)
		if ncc != cc:
			_build_chunk(ncc)


func is_solid_at(world_pos: Vector3) -> bool:
	return BD.is_solid(get_block(floori(world_pos.x), floori(world_pos.y), floori(world_pos.z)))


func block_at(world_pos: Vector3) -> int:
	return get_block(floori(world_pos.x), floori(world_pos.y), floori(world_pos.z))


func ground_y(x: int, z: int) -> int:
	if x < 0 or z < 0 or x >= size.x or z >= size.z:
		return 0
	return surface[z * size.x + x]


func raycast(from: Vector3, to: Vector3, mask: int = 3, exclude: Array = []) -> Dictionary:
	var space := get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.create(from, to, mask, exclude)
	q.collide_with_areas = false
	return space.intersect_ray(q)


func update_visibility(cam_pos: Vector3, max_dist: float) -> void:
	for k in chunks.keys():
		var entry: Dictionary = chunks[k]
		var center := Vector3(k.x * CS + CS * 0.5, k.y * CS + CS * 0.5, k.z * CS + CS * 0.5)
		var mi: MeshInstance3D = entry.get("mi")
		if mi:
			mi.visible = center.distance_to(cam_pos) <= max_dist + CS


func chunk_count_built() -> int:
	return chunks.size()


# ---------------------------------------------------------------- meshing
func _build_chunk(cc: Vector3i) -> void:
	var old: Dictionary = chunks.get(cc, {})
	for key in ["mi", "body"]:
		if old.has(key) and is_instance_valid(old[key]):
			old[key].queue_free()
	chunks.erase(cc)

	var data := _mesh_chunk(cc)
	var entry := {}
	var sv: PackedVector3Array = data["sv"]
	var wv: PackedVector3Array = data["wv"]
	if sv.size() > 0 or wv.size() > 0:
		var am := ArrayMesh.new()
		if sv.size() > 0:
			am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, data["solid"])
			am.surface_set_material(am.get_surface_count() - 1, _mat_solid)
		if wv.size() > 0:
			am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, data["water"])
			am.surface_set_material(am.get_surface_count() - 1, _mat_water)
		var mi := MeshInstance3D.new()
		mi.mesh = am
		mi.name = "Chunk_%d_%d_%d" % [cc.x, cc.y, cc.z]
		add_child(mi)
		entry["mi"] = mi
		total_triangles += int(data["tris"])
	var coll: PackedVector3Array = data["coll"]
	if coll.size() > 0:
		var body := StaticBody3D.new()
		body.collision_layer = WORLD_LAYER
		body.collision_mask = 0
		var cs := CollisionShape3D.new()
		var shape := ConcavePolygonShape3D.new()
		shape.set_faces(coll)
		cs.shape = shape
		body.add_child(cs)
		add_child(body)
		entry["body"] = body
	if not entry.is_empty():
		chunks[cc] = entry


func _mesh_chunk(cc: Vector3i) -> Dictionary:
	var x0: int = cc.x * CS
	var y0: int = cc.y * CS
	var z0: int = cc.z * CS
	var x1: int = mini(x0 + CS, size.x)
	var y1: int = mini(y0 + CS, size.y)
	var z1: int = mini(z0 + CS, size.z)
	var out := _MeshBuffers.new()
	for y in range(y0, y1):
		for z in range(z0, z1):
			for x in range(x0, x1):
				var id: int = blocks[(y * size.z + z) * size.x + x]
				if id == BD.AIR:
					continue
				if id == BD.WATER:
					if get_block(x, y + 1, z) == BD.AIR:
						_emit_face(out, x, y, z, 2, id, true)
					continue
				for f in 6:
					var d: Vector3i = FACE_DIRS[f]
					var nid: int = get_block(x + d.x, y + d.y, z + d.z)
					if BD.is_opaque(nid):
						continue
					_emit_face(out, x, y, z, f, id, false)
	return out.finish()


func _opaque(x: int, y: int, z: int) -> int:
	return 1 if BD.is_opaque(get_block(x, y, z)) else 0


func _emit_face(out: _MeshBuffers, x: int, y: int, z: int, f: int, id: int, is_water: bool) -> void:
	var fd: Vector3i = FACE_DIRS[f]
	var fn := Vector3(fd)
	var ui: Vector3i = FACE_U[f]
	var vi: Vector3i = FACE_V[f]
	var center := Vector3(x + 0.5, y + 0.5, z + 0.5) + fn * 0.5
	var ax: int = x + fd.x
	var ay: int = y + fd.y
	var az: int = z + fd.z
	var tile: int = BD.TILE_SIDE[id]
	if f == 2:
		tile = BD.TILE_TOP[id]
	elif f == 3:
		tile = BD.TILE_BOTTOM[id]
	var tcol: int = tile % TA.COLS
	var trow: int = tile / TA.COLS
	var u0: float = (tcol * TA.TILE + 0.5) / _atlas_size.x
	var v0: float = (trow * TA.TILE + 0.5) / _atlas_size.y
	var su_span: float = (TA.TILE - 1) / _atlas_size.x
	var sv_span: float = (TA.TILE - 1) / _atlas_size.y
	var base_col: Color = BD.color_of(id)
	var shade: float = FACE_SHADE[f]
	var corners := [Vector2i(-1, -1), Vector2i(1, -1), Vector2i(1, 1), Vector2i(-1, 1)]
	var pts: Array = []
	var ao: Array = []
	for k in 4:
		var sx: int = corners[k].x
		var sy: int = corners[k].y
		var p: Vector3 = center + Vector3(ui) * (sx * 0.5) + Vector3(vi) * (sy * 0.5)
		pts.append(p)
		var level := 3
		if not is_water:
			var s1: int = _opaque(ax + ui.x * sx, ay + ui.y * sx, az + ui.z * sx)
			var s2: int = _opaque(ax + vi.x * sy, ay + vi.y * sy, az + vi.z * sy)
			var cn: int = _opaque(ax + ui.x * sx + vi.x * sy, ay + ui.y * sx + vi.y * sy, az + ui.z * sx + vi.z * sy)
			level = 0 if (s1 == 1 and s2 == 1) else 3 - (s1 + s2 + cn)
		ao.append(level)
	var c0: Vector3 = pts[1] - pts[0]
	var c1: Vector3 = pts[2] - pts[0]
	var reverse: bool = c0.cross(c1).dot(fn) > 0.0
	var flip: bool = int(ao[0]) + int(ao[2]) > int(ao[1]) + int(ao[3])
	var tri: Array = [0, 1, 2, 0, 2, 3]
	if flip:
		tri = [0, 1, 3, 1, 2, 3]
	var vbuf: PackedVector3Array = out.wv if is_water else out.sv
	var nbuf: PackedVector3Array = out.wn if is_water else out.sn
	var ubuf: PackedVector2Array = out.wuv if is_water else out.suv
	var cbuf: PackedColorArray = out.wc if is_water else out.sc
	var ibuf: PackedInt32Array = out.wi if is_water else out.si
	var base: int = vbuf.size()
	for k in 4:
		var lu: float = (corners[k].x + 1) * 0.5
		var lv: float = (1 - corners[k].y) * 0.5
		var bright: float = AO_LIGHT[int(ao[k])] if not is_water else 1.0
		var c: Color = base_col * (shade * bright)
		if is_water:
			c = Color(0.55, 0.78, 1.0, 0.78) * (0.9 + 0.1 * shade)
		vbuf.append(pts[k])
		nbuf.append(fn)
		ubuf.append(Vector2(u0 + lu * su_span, v0 + lv * sv_span))
		cbuf.append(c)
	var seq: Array = tri
	var count: int = seq.size()
	var t := 0
	while t < count:
		var a: int = seq[t]
		var b: int = seq[t + 1]
		var cidx: int = seq[t + 2]
		if reverse:
			var tmp: int = b
			b = cidx
			cidx = tmp
		ibuf.append(base + a)
		ibuf.append(base + b)
		ibuf.append(base + cidx)
		if not is_water:
			out.coll.append(vbuf[base + a])
			out.coll.append(vbuf[base + b])
			out.coll.append(vbuf[base + cidx])
		out.tris += 1
		t += 3


class _MeshBuffers:
	var sv := PackedVector3Array()
	var sn := PackedVector3Array()
	var suv := PackedVector2Array()
	var sc := PackedColorArray()
	var si := PackedInt32Array()
	var wv := PackedVector3Array()
	var wn := PackedVector3Array()
	var wuv := PackedVector2Array()
	var wc := PackedColorArray()
	var wi := PackedInt32Array()
	var coll := PackedVector3Array()
	var tris := 0

	func finish() -> Dictionary:
		var solid: Array = []
		solid.resize(Mesh.ARRAY_MAX)
		solid[Mesh.ARRAY_VERTEX] = sv
		solid[Mesh.ARRAY_NORMAL] = sn
		solid[Mesh.ARRAY_TEX_UV] = suv
		solid[Mesh.ARRAY_COLOR] = sc
		solid[Mesh.ARRAY_INDEX] = si
		var water: Array = []
		water.resize(Mesh.ARRAY_MAX)
		water[Mesh.ARRAY_VERTEX] = wv
		water[Mesh.ARRAY_NORMAL] = wn
		water[Mesh.ARRAY_TEX_UV] = wuv
		water[Mesh.ARRAY_COLOR] = wc
		water[Mesh.ARRAY_INDEX] = wi
		return {"sv": sv, "wv": wv, "solid": solid, "water": water, "coll": coll, "tris": tris}
