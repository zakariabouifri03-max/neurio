class_name VoxelWorld
extends Node3D
## Streaming voxel world.
##
## Chunks are generated lazily around a viewer and meshed at a bounded rate
## (a few per frame) so a 320x320 island never blocks the main thread.  Chunk
## data is cached in memory with an LRU cap so walking across the map on a
## 2 GB device does not grow without bound.
##
## Public block API (`get_block`, `set_block`) is what gameplay uses:
## bullets query it, the building system writes to it, bots path over it.

signal chunk_ready(coord: Vector2i)
signal block_changed(position: Vector3i, block_id: int)
signal generation_progress(done: int, total: int)
signal world_ready()

const MESH_BUDGET_PER_FRAME := 2
const MAX_LOADED_CHUNKS := 220
const UNLOAD_MARGIN := 2

var generator: TerrainGenerator
var map_id: String = ""
var seed: int = 0
var world_name: String = ""
var chunks: Dictionary = {}              ## Vector2i -> VoxelChunk
var ready: bool = false

var _viewer: Node3D = null
var _mesh_queue: Array[Vector2i] = []
var _unload_queue: Array[Vector2i] = []
var _chunk_cache: Dictionary = {}        ## coord -> PackedByteArray for unloaded chunks
var _decorated: Dictionary = {}
var _block_overrides: Dictionary = {}    ## Vector3i -> block id (player edits persist)
var _view_distance: int = 3
var _total_chunks: int = 0
var _progress_counter: int = 0
var _container_space: Node3D
var _spawn_cache: Array = []
var _drop_cache: Array = []
var _rng := RandomNumberGenerator.new()

func setup(map_id_value: String, world_seed: int, viewer: Node3D) -> void:
	map_id = map_id_value
	seed = world_seed
	_viewer = viewer
	generator = TerrainGenerator.new()
	generator.setup(map_id, seed)
	world_name = str(generator.map.get("name", map_id))
	_rng.seed = seed
	_view_distance = int(Settings.graphics_value("view_distance", 3))
	var size_chunks: Vector2i = Vector2i(generator.chunks_x(), generator.chunks_z())
	_total_chunks = size_chunks.x * size_chunks.y

func container_space() -> Node3D:
	return _container_space

func _ready() -> void:
	_container_space = Node3D.new()
	_container_space.name = "Loot"
	add_child(_container_space)
	# Changing the view distance in the settings screen re-streams the world.
	Settings.settings_changed.connect(_on_settings_changed)

func chunk_coord_for(position: Vector3) -> Vector2i:
	var size := generator.chunk_size
	return Vector2i(int(floor(position.x / float(size))), int(floor(position.z / float(size))))

func chunk_at(coord: Vector2i) -> VoxelChunk:
	return chunks.get(coord)

# ------------------------------------------------------------------ block API
func get_block(x: int, y: int, z: int) -> int:
	if y < 0 or y >= VoxelChunk.HEIGHT:
		return VoxelLibrary.Block.AIR
	if not generator.in_bounds(x, z):
		return VoxelLibrary.Block.AIR
	var override: Variant = _block_overrides.get(Vector3i(x, y, z))
	if override != null:
		return int(override)
	var coord := Vector2i(int(floor(float(x) / generator.chunk_size)),
		int(floor(float(z) / generator.chunk_size)))
	var chunk: VoxelChunk = chunks.get(coord)
	if chunk != null:
		return chunk.get_block(x - coord.x * generator.chunk_size, y,
			z - coord.y * generator.chunk_size)
	var cached: Variant = _chunk_cache.get(coord)
	if cached != null:
		var lx := x - coord.x * generator.chunk_size
		var lz := z - coord.y * generator.chunk_size
		return (cached as PackedByteArray)[VoxelChunk.index(lx, y, lz)]
	return _generate_block_on_demand(x, y, z)

## Exact lookup for columns whose chunk is not loaded (used by ballistic checks
## and spawn validation before streaming catches up).
func _generate_block_on_demand(x: int, y: int, z: int) -> int:
	var height := generator.height_at(x, z)
	if y > height:
		if y <= generator.sea_level:
			return VoxelLibrary.Block.WATER
		return VoxelLibrary.Block.AIR
	var surface := generator.surface_block(x, z, height)
	if y == height:
		return surface
	if y >= height - int(generator.biome.get("dirt_depth", 4)):
		return VoxelLibrary.Block.DIRT
	return VoxelLibrary.Block.STONE

## Writes a block.  Neighbouring chunks rebuild; the edit is recorded so it
## survives chunk streaming and can be replicated to clients.
func set_block(x: int, y: int, z: int, block_id: int, record: bool = true) -> bool:
	if not generator.in_bounds(x, z) or y < 0 or y >= VoxelChunk.HEIGHT:
		return false
	var coord := Vector2i(int(floor(float(x) / generator.chunk_size)),
		int(floor(float(z) / generator.chunk_size)))
	if record:
		_block_overrides[Vector3i(x, y, z)] = block_id
	var chunk: VoxelChunk = chunks.get(coord)
	if chunk == null:
		return false
	chunk.set_block(x - coord.x * generator.chunk_size, y, z - coord.y * generator.chunk_size, block_id)
	_enqueue_mesh(coord)
	block_changed.emit(Vector3i(x, y, z), block_id)
	return true

## Returns true when the column has standing room at that height.
## True when this cell was placed or removed by a player (not generated terrain).
func is_player_edit(coord: Vector3i) -> bool:
	return _block_overrides.has(coord)

func is_space_free(x: int, y: int, z: int) -> bool:
	return not VoxelLibrary.is_solid(get_block(x, y, z)) \
		and not VoxelLibrary.is_solid(get_block(x, y + 1, z))

func ground_height(x: int, z: int) -> int:
	for y in range(VoxelChunk.HEIGHT - 1, -1, -1):
		if VoxelLibrary.is_solid(get_block(x, y, z)):
			return y + 1
	return 0

## Camera/bot friendly ground level as a float, with no integer casts at call sites.
func ground_y(x: float, z: float) -> float:
	return float(ground_height(int(floor(x)), int(floor(z))))

## Nearest loot container or pickup within `radius` (used by bots and the HUD prompt).
func nearest_loot(from: Vector3, radius: float = 30.0) -> Node3D:
	var space := container_space()
	if space == null:
		return null
	var best: Node3D = null
	var best_distance := radius
	for child: Node in space.get_children():
		var candidate := child as Node3D
		if candidate == null:
			continue
		if candidate.has_method("is_empty") and bool(candidate.call("is_empty")):
			continue
		var distance := from.distance_to(candidate.global_position)
		if distance < best_distance:
			best_distance = distance
			best = candidate
	return best

func surface_block_at(x: int, z: int) -> int:
	var height := ground_height(x, z) - 1
	if height < 0:
		return VoxelLibrary.Block.AIR
	return get_block(x, height, z)

func impact_sound_at(position: Vector3) -> String:
	var block := get_block(int(floor(position.x)), int(floor(position.y)), int(floor(position.z)))
	return VoxelLibrary.impact_sound(block)

func footstep_sound_at(position: Vector3) -> String:
	var block := get_block(int(floor(position.x)), int(floor(position.y)) - 1, int(floor(position.z)))
	return VoxelLibrary.footstep_sound(block)

func is_water_at(position: Vector3) -> bool:
	return VoxelLibrary.is_water(get_block(int(floor(position.x)), int(floor(position.y)),
		int(floor(position.z))))

# ------------------------------------------------------------------- streaming
func _process(_delta: float) -> void:
	if _viewer == null:
		return
	_update_needed_chunks()
	var budget := MESH_BUDGET_PER_FRAME
	while budget > 0 and not _mesh_queue.is_empty():
		var coord: Vector2i = _mesh_queue.pop_front()
		var chunk: VoxelChunk = chunks.get(coord)
		if chunk == null:
			continue
		if not chunk.is_dirty():
			continue
		chunk.rebuild()
		chunk_ready.emit(coord)
		_progress_counter += 1
		budget -= 1
		if _progress_counter % 12 == 0:
			generation_progress.emit(_progress_counter, _total_chunks)
	_unload_far_chunks()
	if not ready and _has_chunks_around_viewer():
		ready = true
		world_ready.emit()

func _has_chunks_around_viewer() -> bool:
	if _viewer == null:
		return false
	var center := chunk_coord_for(_viewer.global_position)
	for dx in range(-1, 2):
		for dz in range(-1, 2):
			var chunk: VoxelChunk = chunks.get(center + Vector2i(dx, dz))
			if chunk == null or not chunk.is_meshed():
				return false
	return true

func _update_needed_chunks() -> void:
	var center := chunk_coord_for(_viewer.global_position)
	var wanted: Array[Vector2i] = []
	for dx in range(-_view_distance, _view_distance + 1):
		for dz in range(-_view_distance, _view_distance + 1):
			if absi(dx) + absi(dz) > _view_distance * 2:
				continue
			var coord := center + Vector2i(dx, dz)
			if coord.x < 0 or coord.y < 0 or coord.x >= generator.chunks_x() \
					or coord.y >= generator.chunks_z():
				continue
			wanted.append(coord)
	for coord: Vector2i in wanted:
		if not chunks.has(coord):
			_create_chunk(coord)
	# Sort the mesh queue by distance so the nearest ring appears first.
	_mesh_queue.sort_custom(func(a: Vector2i, b: Vector2i) -> bool:
		return (a - center).length_squared() < (b - center).length_squared())

func _create_chunk(coord: Vector2i) -> void:
	var chunk := VoxelChunk.new()
	chunk.name = "Chunk_%d_%d" % [coord.x, coord.y]
	chunk.coord = coord
	chunk.world = self
	add_child(chunk)
	chunks[coord] = chunk
	var cached: Variant = _chunk_cache.get(coord)
	if cached != null:
		chunk.blocks = (cached as PackedByteArray).duplicate()
		_chunk_cache.erase(coord)
	else:
		generator.generate_chunk(chunk)
		_apply_overrides(chunk, coord)
	# Trees/rocks may cross borders, so decoration happens after every neighbour
	# chunk exists; it is retried until all four neighbours are present.
	_try_decorate(chunk)
	for neighbour: Vector2i in [coord + Vector2i(1, 0), coord + Vector2i(-1, 0),
			coord + Vector2i(0, 1), coord + Vector2i(0, -1)]:
		if chunks.has(neighbour):
			(chunks[neighbour] as VoxelChunk).mark_dirty()
			_enqueue_mesh(neighbour)
	_enqueue_mesh(coord)

func _apply_overrides(chunk: VoxelChunk, coord: Vector2i) -> void:
	var size := generator.chunk_size
	var base_x := coord.x * size
	var base_z := coord.y * size
	for key: Variant in _block_overrides.keys():
		var position: Vector3i = key
		if position.x < base_x or position.x >= base_x + size:
			continue
		if position.z < base_z or position.z >= base_z + size:
			continue
		var lx := position.x - base_x
		var lz := position.z - base_z
		if chunk.in_bounds(lx, position.y, lz):
			chunk.blocks[VoxelChunk.index(lx, position.y, lz)] = int(_block_overrides[key])

func _try_decorate(chunk: VoxelChunk) -> void:
	var coord := chunk.coord
	if _decorated.has(coord):
		return
	for neighbour: Vector2i in [coord + Vector2i(1, 0), coord + Vector2i(-1, 0),
			coord + Vector2i(0, 1), coord + Vector2i(0, -1)]:
		if not chunks.has(neighbour):
			return   # retry once the neighbour exists
	_decorated[coord] = true
	generator.decorate_chunk(chunk, self)

func _enqueue_mesh(coord: Vector2i) -> void:
	if not _mesh_queue.has(coord):
		_mesh_queue.append(coord)

## Marks the four neighbours dirty when a block changes on a chunk border.
func mark_neighbours_dirty(coord: Vector2i) -> void:
	for neighbour: Vector2i in [coord + Vector2i(1, 0), coord + Vector2i(-1, 0),
			coord + Vector2i(0, 1), coord + Vector2i(0, -1)]:
		var other: VoxelChunk = chunks.get(neighbour)
		if other != null:
			other.mark_dirty()
			_enqueue_mesh(neighbour)

func _unload_far_chunks() -> void:
	if chunks.size() <= MAX_LOADED_CHUNKS:
		return
	var center := chunk_coord_for(_viewer.global_position)
	var limit := _view_distance + UNLOAD_MARGIN
	var candidates: Array[Vector2i] = []
	for coord: Vector2i in chunks.keys():
		var distance := maxi(absi(coord.x - center.x), absi(coord.y - center.y))
		if distance > limit:
			candidates.append(coord)
	candidates.sort_custom(func(a: Vector2i, b: Vector2i) -> bool:
		return maxi(absi(a.x - center.x), absi(a.y - center.y)) \
			> maxi(absi(b.x - center.x), absi(b.y - center.y)))
	while chunks.size() > MAX_LOADED_CHUNKS and not candidates.is_empty():
		var coord: Vector2i = candidates.pop_front()
		_release_chunk(coord)

func _release_chunk(coord: Vector2i) -> void:
	var chunk: VoxelChunk = chunks.get(coord)
	if chunk == null:
		return
	if _chunk_cache.size() > MAX_LOADED_CHUNKS:
		_chunk_cache.clear()
	_chunk_cache[coord] = chunk.blocks
	chunks.erase(coord)
	_decorated.erase(coord)
	_mesh_queue.erase(coord)
	chunk.queue_free()

## Number of chunks that currently exist as nodes (used by the HUD/perf overlay).
func loaded_chunk_count() -> int:
	return chunks.size()

func vertex_total() -> int:
	var total := 0
	for coord: Vector2i in chunks.keys():
		total += (chunks[coord] as VoxelChunk).vertex_total()
	return total

## Rebuilds every loaded chunk (used when the graphics preset changes LOD).
func refresh_all() -> void:
	for coord: Vector2i in chunks.keys():
		(chunks[coord] as VoxelChunk).mark_dirty()
		_enqueue_mesh(coord)

## Re-reads graphics settings: view distance changes how far chunks are kept.
func _on_settings_changed(section: String) -> void:
	if section == "graphics":
		apply_graphics_settings()

func apply_graphics_settings() -> void:
	_view_distance = int(Settings.graphics_value("view_distance", 3))

# -------------------------------------------------------------------- gameplay
## Point the streaming world at a moving observer (the local player).
func set_viewer(viewer: Node3D) -> void:
	_viewer = viewer

## Every named place on this map (id, name, kind, loot tier, centre, radius).
func places() -> Array:
	return generator.map.get("places", [])

## Loot positions for one place, with the tier recorded in the place data.
func loot_points(place_id: String, count: int) -> Array:
	return generator.loot_points(place_id, count)

## Deployment positions for battle royale drops.
func drop_points(count: int = 24) -> Array:
	if _drop_cache.is_empty():
		_drop_cache = generator.drop_points(count)
	return _drop_cache

func spawn_points() -> Array:
	if _spawn_cache.is_empty():
		_spawn_cache = generator.spawn_points()
	return _spawn_cache

func spawn_points_for_teams(team_count: int) -> Dictionary:
	var points := spawn_points()
	var out: Dictionary = {}
	for team: int in team_count:
		out[team + 1] = []
	var first_half := points.slice(0, int(points.size() / 2.0))
	var second_half := points.slice(int(points.size() / 2.0), points.size())
	if team_count == 2:
		out[1] = first_half
		out[2] = second_half
		return out
	var index := 0
	for point: Variant in points:
		var team := (index % team_count) + 1
		(out[team] as Array).append(point)
		index += 1
	return out

## Finds a spawn away from other players, used for respawns and bot spawns.
func find_spawn_near(position: Vector3, minimum_distance: float, occupied: Array = []) -> Vector3:
	var best := Vector3.ZERO
	var best_score := -INF
	for i: int in 24:
		var angle := _rng.randf() * TAU
		var distance := minimum_distance + _rng.randf() * 24.0
		var x := int(position.x + cos(angle) * distance)
		var z := int(position.z + sin(angle) * distance)
		if not generator.in_bounds(x, z):
			continue
		var ground := ground_height(x, z)
		if ground <= generator.sea_level:
			continue
		var candidate := Vector3(float(x) + 0.5, float(ground) + 0.1, float(z) + 0.5)
		var score := 0.0
		for other: Variant in occupied:
			score += candidate.distance_to(other)
		if score > best_score:
			best_score = score
			best = candidate
	return best

## Raycast against the voxel grid (fast, no physics query) for line of sight,
## hitscan fallback and bot vision.
## Exact block pick: returns the hit cell, the entry face normal and the distance.
func raycast_voxel(from: Vector3, direction: Vector3, max_distance: float,
				   hit_water: bool = false) -> Dictionary:
	var hit := VoxelRay.cast(self, from, direction, max_distance, hit_water)
	if hit.is_empty():
		return {"hit": false, "position": from + direction.normalized() * max_distance,
				"block": VoxelLibrary.Block.AIR, "distance": max_distance,
				"normal": Vector3i.ZERO, "coord": Vector3i.ZERO}
	return {"hit": true, "position": hit["position"], "block": hit["block"],
			"distance": hit["distance"], "normal": hit["normal"], "coord": hit["coord"]}

## True when a straight line between two points is unobstructed (bot line of sight).
func has_line_of_sight(from: Vector3, to: Vector3) -> bool:
	var delta := to - from
	var distance := delta.length()
	if distance <= 0.01:
		return true
	return VoxelRay.cast(self, from, delta / distance, distance).is_empty()

## The cell a player builds in when aiming along `direction`.
func placement_cell(from: Vector3, direction: Vector3, max_distance: float = 6.0) -> Dictionary:
	return VoxelRay.placement_cell(self, from, direction, max_distance)
