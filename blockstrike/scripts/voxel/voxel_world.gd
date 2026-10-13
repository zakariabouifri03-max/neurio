class_name VoxelWorld
extends Node3D
## Chunked voxel terrain.
##
## Storage is a flat PackedByteArray (x + z * size_x + y * size_x * size_z).
## Each 16x16 column chunk owns one opaque mesh, one water mesh and one static
## collision body. Edits only mark the affected chunk (and any neighbour that
## shares an edited border) as dirty; dirty chunks are rebuilt incrementally.

signal build_progress(done: int, total: int)
signal chunk_rebuilt(coord: Vector2i)

const CHUNK := 16

var size_x := 0
var size_y := 0
var size_z := 0
var data := PackedByteArray()
## Maximum distance at which chunk meshes stay visible (cheap distance culling).
var view_distance := 160.0
var cast_shadows := true

var _views: Dictionary = {}   # Vector2i -> ChunkView
var _dirty: Dictionary = {}   # Vector2i -> true (ordered insertion)
var _solid_material: StandardMaterial3D
var _water_material: StandardMaterial3D


class ChunkView:
	extends RefCounted
	var solid: MeshInstance3D
	var water: MeshInstance3D
	var body: StaticBody3D
	var shape: ConcavePolygonShape3D
	var shape_node: CollisionShape3D


func setup(sx: int, sy: int, sz: int) -> void:
	size_x = sx
	size_y = sy
	size_z = sz
	data = PackedByteArray()
	data.resize(sx * sy * sz)
	data.fill(0)
	_solid_material = StandardMaterial3D.new()
	_solid_material.vertex_color_use_as_albedo = true
	_solid_material.roughness = 0.92
	_solid_material.metallic = 0.0
	_water_material = StandardMaterial3D.new()
	_water_material.vertex_color_use_as_albedo = true
	_water_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_water_material.roughness = 0.12
	_water_material.metallic = 0.15
	_water_material.cull_mode = BaseMaterial3D.CULL_DISABLED


func chunks_x() -> int:
	return ceili(float(size_x) / CHUNK)


func chunks_z() -> int:
	return ceili(float(size_z) / CHUNK)


func in_bounds(x: int, y: int, z: int) -> bool:
	return x >= 0 and y >= 0 and z >= 0 and x < size_x and y < size_y and z < size_z


func index_of(x: int, y: int, z: int) -> int:
	return x + z * size_x + y * size_x * size_z


func get_block(x: int, y: int, z: int) -> int:
	if not in_bounds(x, y, z):
		return BlockIds.AIR
	return data[index_of(x, y, z)]


func set_block(x: int, y: int, z: int, id: int) -> void:
	if not in_bounds(x, y, z):
		return
	var idx := index_of(x, y, z)
	if data[idx] == id:
		return
	data[idx] = id
	_mark_edit_dirty(x, z)


func fill_box(x0: int, y0: int, z0: int, x1: int, y1: int, z1: int, id: int) -> void:
	## Inclusive box fill. Marks affected chunks dirty once at the end.
	var lo := Vector3i(mini(x0, x1), mini(y0, y1), mini(z0, z1))
	var hi := Vector3i(maxi(x0, x1), maxi(y0, y1), maxi(z0, z1))
	lo = Vector3i(maxi(lo.x, 0), maxi(lo.y, 0), maxi(lo.z, 0))
	hi = Vector3i(mini(hi.x, size_x - 1), mini(hi.y, size_y - 1), mini(hi.z, size_z - 1))
	if lo.x > hi.x or lo.y > hi.y or lo.z > hi.z:
		return
	for y in range(lo.y, hi.y + 1):
		for z in range(lo.z, hi.z + 1):
			var row := index_of(0, y, z)
			for x in range(lo.x, hi.x + 1):
				data[row + x] = id
	for cz in range(lo.z / CHUNK, hi.z / CHUNK + 1):
		for cx in range(lo.x / CHUNK, hi.x / CHUNK + 1):
			mark_chunk_dirty(Vector2i(cx, cz))


func surface_height(x: int, z: int) -> int:
	## Returns the first air y above the highest solid block (standing height),
	## or -1 when the column is empty or out of bounds.
	if x < 0 or z < 0 or x >= size_x or z >= size_z:
		return -1
	for y in range(size_y - 1, -1, -1):
		if BlockDB.is_solid(data[index_of(x, y, z)]):
			return y + 1
	return -1


func mark_chunk_dirty(coord: Vector2i) -> void:
	if coord.x < 0 or coord.y < 0 or coord.x >= chunks_x() or coord.y >= chunks_z():
		return
	_dirty[coord] = true


func dirty_count() -> int:
	return _dirty.size()


func rebuild_dirty(max_chunks: int = 4) -> int:
	var done := 0
	while done < max_chunks and not _dirty.is_empty():
		var key: Vector2i = _dirty.keys()[0]
		_dirty.erase(key)
		_rebuild_chunk(key)
		done += 1
	return done


func rebuild_all_now() -> void:
	for cz in range(chunks_z()):
		for cx in range(chunks_x()):
			mark_chunk_dirty(Vector2i(cx, cz))
	while not _dirty.is_empty():
		rebuild_dirty(64)


func build_all_async(frames_between: int = 1) -> void:
	## Builds every chunk, yielding to the frame loop so a loading screen can animate.
	var total := chunks_x() * chunks_z()
	var done := 0
	for cz in range(chunks_z()):
		for cx in range(chunks_x()):
			mark_chunk_dirty(Vector2i(cx, cz))
	while not _dirty.is_empty():
		rebuild_dirty(2)
		done += 2
		build_progress.emit(mini(done, total), total)
		if frames_between > 0:
			await get_tree().process_frame
	build_progress.emit(total, total)


func apply_quality(view_dist: float, shadows: bool) -> void:
	view_distance = view_dist
	cast_shadows = shadows
	for view in _views.values():
		var cv := view as ChunkView
		_apply_view_settings(cv)


func chunk_count_built() -> int:
	return _views.size()


func _mark_edit_dirty(x: int, z: int) -> void:
	var cx := x / CHUNK
	var cz := z / CHUNK
	mark_chunk_dirty(Vector2i(cx, cz))
	if x % CHUNK == 0:
		mark_chunk_dirty(Vector2i(cx - 1, cz))
	if x % CHUNK == CHUNK - 1:
		mark_chunk_dirty(Vector2i(cx + 1, cz))
	if z % CHUNK == 0:
		mark_chunk_dirty(Vector2i(cx, cz - 1))
	if z % CHUNK == CHUNK - 1:
		mark_chunk_dirty(Vector2i(cx, cz + 1))


func _rebuild_chunk(coord: Vector2i) -> void:
	var res: Dictionary = ChunkMesher.build(self, coord.x, coord.y)
	var view: ChunkView = _views.get(coord)
	if view == null:
		view = _create_view(coord)
		_views[coord] = view
	_set_surface(view.solid, res["opaque"] as ChunkMesher.MeshData, _solid_material)
	_set_surface(view.water, res["water"] as ChunkMesher.MeshData, _water_material)
	var faces: PackedVector3Array = res["collision"]
	if faces.is_empty():
		view.shape_node.disabled = true
		view.shape.set_faces(PackedVector3Array())
	else:
		view.shape_node.disabled = false
		view.shape.set_faces(faces)
	_apply_view_settings(view)
	chunk_rebuilt.emit(coord)


func _create_view(coord: Vector2i) -> ChunkView:
	var view := ChunkView.new()
	view.solid = MeshInstance3D.new()
	view.solid.name = "Opaque"
	view.water = MeshInstance3D.new()
	view.water.name = "Water"
	view.body = StaticBody3D.new()
	view.body.name = "Collision"
	view.body.collision_layer = GameConstants.LAYER_WORLD
	view.body.collision_mask = 0
	view.shape = ConcavePolygonShape3D.new()
	view.shape.backface_collision = true
	view.shape_node = CollisionShape3D.new()
	view.shape_node.shape = view.shape
	view.body.add_child(view.shape_node)
	var holder := Node3D.new()
	holder.name = "Chunk_%d_%d" % [coord.x, coord.y]
	holder.position = Vector3(coord.x * CHUNK, 0, coord.y * CHUNK)
	add_child(holder)
	holder.add_child(view.solid)
	holder.add_child(view.water)
	holder.add_child(view.body)
	return view


func _set_surface(mi: MeshInstance3D, md: ChunkMesher.MeshData, mat: Material) -> void:
	if md == null or md.is_empty():
		mi.mesh = null
		mi.visible = false
		return
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = md.verts
	arrays[Mesh.ARRAY_NORMAL] = md.normals
	arrays[Mesh.ARRAY_COLOR] = md.colors
	arrays[Mesh.ARRAY_INDEX] = md.indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	mi.mesh = mesh
	mi.material_override = mat
	mi.visible = true


func _apply_view_settings(view: ChunkView) -> void:
	for mi in [view.solid, view.water]:
		mi.visibility_range_end = view_distance
		mi.visibility_range_end_margin = 12.0
		mi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
	view.solid.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if cast_shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	view.water.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
