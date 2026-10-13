class_name VoxelTerrain
extends Node3D
## Owns one MeshInstance3D per 16x16 column chunk. Initial build runs on WorkerThreadPool in batches;
## edited chunks are re-meshed on the main thread a few per frame.

signal build_progress(fraction: float)
signal build_done

var world: VoxelWorld
var chunks := {}            # Vector2i -> MeshInstance3D
var view_distance := 96.0
var cast_shadows := true
var _queue: Array = []      # chunk coords left to build
var _results: Array = []    # index -> Array (mesh arrays); pre-sized so worker threads never resize it
var _batch: Array = []
var _task_id := -1
var _total := 0
var _building := false
var _batch_size := 24

func start_build(w: VoxelWorld) -> void:
	world = w
	_queue.clear()
	for cx in w.chunks_x():
		for cz in w.chunks_z():
			_queue.append(Vector2i(cx, cz))
	# build chunks near the map centre first (players spawn / look there first)
	var c := Vector2(w.chunks_x() * 0.5, w.chunks_z() * 0.5)
	_queue.sort_custom(func(a, b): return Vector2(a).distance_squared_to(c) < Vector2(b).distance_squared_to(c))
	_total = _queue.size()
	_building = true
	VoxelMesher.prepare()
	_batch_size = clampi(OS.get_processor_count() * 6, 8, 48)
	_next_batch()

func build_sync(w: VoxelWorld) -> void:
	world = w
	for cx in w.chunks_x():
		for cz in w.chunks_z():
			_apply(Vector2i(cx, cz), VoxelMesher.build_chunk(w, cx, cz))

func is_building() -> bool:
	return _building

func _next_batch() -> void:
	_batch = []
	for i in mini(_batch_size, _queue.size()):
		_batch.append(_queue.pop_front())
	if _batch.is_empty():
		_building = false
		build_progress.emit(1.0)
		build_done.emit()
		return
	_results = []
	_results.resize(_batch.size())
	_task_id = WorkerThreadPool.add_group_task(_build_one, _batch.size(), -1, true, "chunk_mesh")

func _build_one(i: int) -> void:
	var c: Vector2i = _batch[i]
	var res := VoxelMesher.build_chunk(world, c.x, c.y)
	_results[i] = res

func _process(_dt: float) -> void:
	if _building and _task_id != -1:
		if WorkerThreadPool.is_group_task_completed(_task_id):
			WorkerThreadPool.wait_for_group_task_completion(_task_id)
			_task_id = -1
			for i in _batch.size():
				if _results[i] != null:
					_apply(_batch[i], _results[i])
			build_progress.emit(1.0 - float(_queue.size()) / float(maxi(1, _total)))
			_next_batch()
		return
	if world and not world.dirty.is_empty():
		var n := 0
		for key in world.dirty.keys():
			world.dirty.erase(key)
			_apply(key, VoxelMesher.build_chunk(world, key.x, key.y))
			n += 1
			if n >= 2:
				break

func _apply(c: Vector2i, res: Array) -> void:
	var mi: MeshInstance3D = chunks.get(c)
	if res[0] == null and res[1] == null:
		if mi:
			mi.queue_free()
			chunks.erase(c)
		return
	if mi == null:
		mi = MeshInstance3D.new()
		mi.position = Vector3(c.x * VoxelWorld.CHUNK, 0, c.y * VoxelWorld.CHUNK)
		add_child(mi)
		chunks[c] = mi
	mi.mesh = VoxelMesher.arrays_to_mesh(res)
	_apply_settings(mi)

func _apply_settings(mi: MeshInstance3D) -> void:
	mi.visibility_range_end = view_distance + 24.0
	mi.visibility_range_end_margin = 8.0
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if cast_shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

func apply_quality(dist: float, shadows: bool) -> void:
	view_distance = dist
	cast_shadows = shadows
	var tm := VoxelArt.terrain_material()
	for c in chunks:
		var mi: MeshInstance3D = chunks[c]
		_apply_settings(mi)
		var m: ArrayMesh = mi.mesh
		for s in m.get_surface_count():
			var cur := m.surface_get_material(s)
			if cur == VoxelArt.mat_lit or cur == VoxelArt.mat_unlit:
				m.surface_set_material(s, tm)
