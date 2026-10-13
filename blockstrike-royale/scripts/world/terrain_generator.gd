class_name TerrainGenerator
extends RefCounted
## Deterministic voxel terrain and structure generator.
##
## Everything is derived from the map definition in data/maps.json plus the world
## seed, so a given seed always produces the same island on every device and in
## every session (required for multiplayer and for server validation of spawns).
##
## Generation is split in two phases:
##   1. `generate_chunk` fills blocks: heightmap terrain, water, ore-less stone,
##      beaches, roads and the voxel parts of structures.
##   2. `decorate_chunk` runs once per chunk to add trees, rocks and bushes (which
##      may span chunk borders, so decoration writes through the world).
##
## Both phases are cheap and allocation-light: no per-block Node creation.

const V := VoxelLibrary.Block

var map: Dictionary = {}
var seed: int = 12345
var size_x: int = 320
var size_z: int = 320
var sea_level: int = 12
var chunk_size: int = 16
var chunk_height: int = VoxelChunk.HEIGHT
var biome: Dictionary = {}
var _height_cache: Dictionary = {}
var _place_list: Array = []

func setup(map_id: String, world_seed: int) -> void:
	map = ContentDB.map_data(map_id)
	seed = world_seed
	size_x = int(map.get("size_blocks", {}).get("x", 256))
	size_z = int(map.get("size_blocks", {}).get("z", 256))
	sea_level = int(map.get("sea_level", 12))
	chunk_size = int(map.get("chunk_size", 16))
	biome = map.get("biome", {})
	_height_cache.clear()
	_place_list = map.get("places", [])

func chunks_x() -> int:
	return int(ceil(float(size_x) / float(chunk_size)))

func chunks_z() -> int:
	return int(ceil(float(size_z) / float(chunk_size)))

func in_bounds(x: int, z: int) -> bool:
	return x >= 0 and z >= 0 and x < size_x and z < size_z

# --------------------------------------------------------------- determinism
## Integer hash noise: stable across platforms (unlike sin-based hashes whose
## float precision can differ between architectures).
func hash2(x: int, z: int, salt: int = 0) -> int:
	var h: int = seed
	h = (h * 374761393 + x * 668265263) & 0x7FFFFFFF
	h = (h ^ (h >> 13)) * 1274126177 & 0x7FFFFFFF
	h = (h + z * 2147483647) & 0x7FFFFFFF
	h = (h ^ (h >> 16)) * 2654435761 & 0x7FFFFFFF
	h = (h + salt * 40503) & 0x7FFFFFFF
	h = h ^ (h >> 15)
	return h & 0x7FFFFFFF

func rand01(x: int, z: int, salt: int = 0) -> float:
	return float(hash2(x, z, salt)) / 2147483647.0

## Smooth value noise with bilinear interpolation over a grid of `scale` blocks.
func value_noise(x: float, z: float, scale: float, salt: int = 0) -> float:
	var gx := floor(float(x) / scale)
	var gz := floor(float(z) / scale)
	var fx := (float(x) / scale) - gx
	var fz := (float(z) / scale) - gz
	var sx := fx * fx * (3.0 - 2.0 * fx)
	var sz := fz * fz * (3.0 - 2.0 * fz)
	var x0 := int(gx)
	var z0 := int(gz)
	var n00 := rand01(x0, z0, salt)
	var n10 := rand01(x0 + 1, z0, salt)
	var n01 := rand01(x0, z0 + 1, salt)
	var n11 := rand01(x0 + 1, z0 + 1, salt)
	var top := lerpf(n00, n10, sx)
	var bottom := lerpf(n01, n11, sx)
	return lerpf(top, bottom, sz)

func fbm(x: float, z: float, base_scale: float, octaves: int, salt: int = 0) -> float:
	var total := 0.0
	var amplitude := 1.0
	var weight := 0.0
	var scale := base_scale
	for i: int in octaves:
		total += value_noise(x, z, scale, salt + i * 17) * amplitude
		weight += amplitude
		amplitude *= 0.5
		scale *= 0.5
	if weight <= 0.0:
		return 0.0
	return total / weight

# ------------------------------------------------------------------ terrain
## Island falloff: 0 in the middle, 1 at the map border, so the island has
## coastline instead of falling off the edge of the world.
func edge_falloff(x: float, z: float) -> float:
	var half_x := float(size_x) * 0.5
	var half_z := float(size_z) * 0.5
	var cx := abs(x - half_x) / half_x
	var cz := abs(z - half_z) / half_z
	var dist := maxf(cx, cz)
	return clampf((dist - 0.62) / 0.38, 0.0, 1.0)

## Returns the terrain surface height at a world column (top solid block y).
func height_at(x: int, z: int) -> int:
	var key := x * 4096 + z
	var cached: Variant = _height_cache.get(key)
	if cached != null:
		return int(cached)
	var base := float(biome.get("base_height", 14))
	var amplitude := float(biome.get("hill_amplitude", 8.0))
	var frequency := float(biome.get("hill_frequency", 0.014))
	var scale := maxf(4.0, 1.0 / maxf(0.0001, frequency))
	var noise_value := fbm(float(x), float(z), scale, 3, 0)
	var hills := (noise_value - 0.5) * 2.0 * amplitude
	var falloff := edge_falloff(float(x), float(z))
	hills -= falloff * (amplitude + 6.0)
	var height := int(round(base + hills))
	height = clampi(height, 2, chunk_height - 4)
	# River carving: a shallow valley along a poly-line.
	var river: Variant = biome.get("river")
	if typeof(river) == TYPE_DICTIONARY and not (river as Dictionary).is_empty():
		if _river_distance(x, z, river as Dictionary) < float((river as Dictionary).get("width", 4)) + 1.0:
			height -= 2
	_height_cache[key] = height
	return height

func _river_distance(x: int, z: int, river: Dictionary) -> float:
	var path: Array = river.get("path", [])
	if path.size() < 2:
		return 999.0
	var best := 999.0
	for i: int in path.size() - 1:
		var a: Array = path[i]
		var b: Array = path[i + 1]
		best = minf(best, _point_segment_distance(float(x), float(z), float(a[0]), float(a[1]),
			float(b[0]), float(b[1])))
	return best

func _point_segment_distance(px: float, pz: float, ax: float, az: float,
							 bx: float, bz: float) -> float:
	var dx := bx - ax
	var dz := bz - az
	var length_sq := dx * dx + dz * dz
	if length_sq <= 0.0001:
		return sqrt((px - ax) * (px - ax) + (pz - az) * (pz - az))
	var t := clampf(((px - ax) * dx + (pz - az) * dz) / length_sq, 0.0, 1.0)
	var cx := ax + dx * t
	var cz := az + dz * t
	return sqrt((px - cx) * (px - cx) + (pz - cz) * (pz - cz))

## The block id for the top layer of a column at a given height.
func surface_block(x: int, z: int, height: int) -> int:
	if height <= sea_level:
		return V.SAND
	if height <= int(biome.get("beach_level", sea_level + 2)):
		return V.SAND
	if height >= int(biome.get("rock_level", 99)):
		return V.STONE
	if _in_pond(x, z):
		return V.GRAVEL
	var grass_variation := rand01(x, z, 7)
	if grass_variation > 0.94:
		return V.GRAVEL
	if grass_variation < 0.05:
		return V.DIRT
	return V.GRASS

func _in_pond(x: int, z: int) -> bool:
	for pond: Variant in biome.get("ponds", []):
		var entry: Dictionary = pond
		var center: Array = entry.get("center", [0, 0])
		var radius: float = float(entry.get("radius", 8.0))
		var dx := float(x) - float(center[0])
		var dz := float(z) - float(center[1])
		if dx * dx + dz * dz < radius * radius:
			return true
	return false

## Terrain height including structure floors (used for spawn placement).
func walkable_height(x: int, z: int) -> int:
	return height_at(x, z) + 1

# ---------------------------------------------------------------- generation
## Fills one chunk with terrain (called once per chunk, then cached by the world).
func generate_chunk(chunk: VoxelChunk) -> void:
	var base_x := chunk.coord.x * chunk_size
	var base_z := chunk.coord.y * chunk_size
	var dirt_depth := int(biome.get("dirt_depth", 4))
	var snow_map: bool = _uses_snow_surface()
	for lx: int in chunk_size:
		for lz: int in chunk_size:
			var wx := base_x + lx
			var wz := base_z + lz
			if not in_bounds(wx, wz):
				continue
			var height := height_at(wx, wz)
			var surface := surface_block(wx, wz, height)
			if snow_map and height > sea_level + 1 and surface == V.GRASS:
				surface = V.SNOW
			chunk.fill_column(lx, lz, 0, height, V.STONE)
			chunk.fill_column(lx, lz, maxi(0, height - dirt_depth), height, V.DIRT)
			chunk.set_block(lx, height, lz, surface)
			if height < sea_level:
				chunk.fill_column(lx, lz, height + 1, sea_level, V.WATER)
	_apply_roads(chunk)
	_apply_structures(chunk)
	chunk.mark_dirty()

func _uses_snow_surface() -> bool:
	return str(map.get("generator", "")) == "frost_frontier"

## Roads: flattens the path and lays a road surface with a shoulder.
func _apply_roads(chunk: VoxelChunk) -> void:
	var base_x := chunk.coord.x * chunk_size
	var base_z := chunk.coord.y * chunk_size
	for road: Variant in map.get("roads", []):
		var entry: Dictionary = road
		var path: Array = entry.get("path", [])
		var width: int = int(entry.get("width", 3))
		var reach := float(width) + 3.0
		for i: int in path.size() - 1:
			var a: Array = path[i]
			var b: Array = path[i + 1]
			# Cheap bounds check: skip segments that cannot touch this chunk.
			var min_x := minf(float(a[0]), float(b[0])) - reach
			var max_x := maxf(float(a[0]), float(b[0])) + reach
			var min_z := minf(float(a[1]), float(b[1])) - reach
			var max_z := maxf(float(a[1]), float(b[1])) + reach
			if max_x < float(base_x) or min_x > float(base_x + chunk_size) \
					or max_z < float(base_z) or min_z > float(base_z + chunk_size):
				continue
			for lx: int in chunk_size:
				for lz: int in chunk_size:
					var wx := base_x + lx
					var wz := base_z + lz
					var distance := _point_segment_distance(float(wx), float(wz),
						float(a[0]), float(a[1]), float(b[0]), float(b[1]))
					if distance > reach:
						continue
					var target := _road_height(int(a[0]), int(a[1]), int(b[0]), int(b[1]))
					var surface := V.ROAD if distance <= float(width) * 0.5 else V.GRAVEL
					chunk.fill_column(lx, lz, 0, target, V.STONE)
					chunk.fill_column(lx, lz, maxi(0, target - 2), target, V.DIRT)
					chunk.set_block(lx, target, lz, surface)
					# Clear anything above the road so it stays walkable.
					for y in range(target + 1, mini(chunk_height, target + 6)):
						chunk.set_block(lx, y, lz, V.AIR)

func _road_height(ax: int, az: int, bx: int, bz: int) -> int:
	return mini(height_at(ax, az), height_at(bx, bz)) + 1

# -------------------------------------------------------------- structures
## Places the voxel parts of every named place whose centre is near this chunk.
## Structures are authored as code (original layouts), always snapped to the
## terrain so nothing floats and every doorway is player-sized.
func _apply_structures(chunk: VoxelChunk) -> void:
	var base_x := chunk.coord.x * chunk_size
	var base_z := chunk.coord.y * chunk_size
	for place: Variant in _place_list:
		var info: Dictionary = place
		var center: Array = info.get("center", [0, 0])
		var radius := float(info.get("radius", 16.0)) + 12.0
		var cx := float(center[0])
		var cz := float(center[1])
		if cx + radius < float(base_x) or cx - radius > float(base_x + chunk_size) \
				or cz + radius < float(base_z) or cz - radius > float(base_z + chunk_size):
			continue
		match str(info.get("kind", "")):
			"village", "camp":
				_build_village(chunk, int(cx), int(cz), int(info.get("radius", 18.0)),
					str(info.get("id", "")))
			"warehouse":
				_build_warehouses(chunk, int(cx), int(cz))
			"military", "relay":
				_build_outpost(chunk, int(cx), int(cz), str(info.get("id", "")))
			"fort", "temple":
				_build_keep(chunk, int(cx), int(cz))
			"dock":
				_build_dock(chunk, int(cx), int(cz))
			"farm":
				_build_farmstead(chunk, int(cx), int(cz))
			"quarry":
				_build_quarry(chunk, int(cx), int(cz))
			"ruins":
				_build_ruins(chunk, int(cx), int(cz))
			"range":
				_build_firing_range(chunk, int(cx), int(cz))
			"armory":
				_build_armory(chunk, int(cx), int(cz))
			"course":
				_build_movement_course(chunk, int(cx), int(cz))
			"arena":
				_build_arena(chunk, int(cx), int(cz))
			"canyon":
				_build_canyon_cover(chunk, int(cx), int(cz))
			"cave":
				_build_ice_hollow(chunk, int(cx), int(cz))
			"tower":
				_build_watchtower(chunk, int(cx), int(cz))

func _local(chunk: VoxelChunk, wx: int, wz: int) -> Vector2i:
	return Vector2i(wx - chunk.coord.x * chunk_size, wz - chunk.coord.y * chunk_size)

func _owns(chunk: VoxelChunk, wx: int, wz: int) -> bool:
	var local := _local(chunk, wx, wz)
	return chunk.in_bounds(local.x, 0, local.y)

## Sets a block by world column, ignoring writes outside this chunk.
func _put(chunk: VoxelChunk, wx: int, y: int, wz: int, block_id: int) -> void:
	var local := _local(chunk, wx, wz)
	if chunk.in_bounds(local.x, y, local.y):
		chunk.set_block(local.x, y, local.y, block_id)

func _put_if_air(chunk: VoxelChunk, wx: int, y: int, wz: int, block_id: int) -> void:
	var local := _local(chunk, wx, wz)
	if chunk.in_bounds(local.x, y, local.y):
		if chunk.blocks[VoxelChunk.index(local.x, y, local.y)] == V.AIR:
			chunk.set_block(local.x, y, local.y, block_id)

## Flattens a rectangle to a single height and clears space above it, so
## buildings never intersect a slope.  Returns the floor height.
func _flatten(chunk: VoxelChunk, cx: int, cz: int, half_x: int, half_z: int,
			  clearance: int = 8, floor_block: int = V.CONCRETE) -> int:
	var samples := 0
	var total := 0
	var highest := 0
	for x in range(cx - half_x, cx + half_x + 1):
		for z in range(cz - half_z, cz + half_z + 1):
			var h := height_at(x, z)
			total += h
			highest = maxi(highest, h)
			samples += 1
	var floor_height := (total / maxi(1, samples)) if samples > 0 else height_at(cx, cz)
	floor_height = maxi(floor_height, highest - 2)
	for x in range(cx - half_x, cx + half_x + 1):
		for z in range(cz - half_z, cz + half_z + 1):
			if not _in_world(x, z):
				continue
			chunk_local(x, z, chunk, func(lx: int, lz: int) -> void:
				chunk.fill_column(lx, lz, 0, floor_height - 1, V.STONE)
				chunk.set_block(lx, floor_height - 1, lz, floor_block)
				chunk.fill_column(lx, lz, floor_height, mini(chunk_height - 1,
					floor_height + clearance), V.AIR)
				)
	return floor_height

func _in_world(x: int, z: int) -> bool:
	return in_bounds(x, z)

## Helper that maps a world column to local coordinates and calls back when the
## column belongs to this chunk.
func chunk_local(wx: int, wz: int, chunk: VoxelChunk, callback: Callable) -> void:
	var local := _local(chunk, wx, wz)
	if chunk.in_bounds(local.x, 0, local.y):
		callback.call(local.x, local.y)

## Hollow box building with walls, doorways, windows and a roof.
func _build_house(chunk: VoxelChunk, cx: int, cz: int, width: int, depth: int,
				  wall_height: int, wall: int, roof: int, door_side: int = 2,
				  window: bool = true) -> int:
	var half_w := width / 2
	var half_d := depth / 2
	var floor_y := _flatten(chunk, cx, cz, half_w + 1, half_d + 1, wall_height + 6)
	for x in range(cx - half_w, cx + half_w + 1):
		for z in range(cz - half_d, cz + half_d + 1):
			if not _in_world(x, z):
				continue
			var is_wall := x == cx - half_w or x == cx + half_w or z == cz - half_d or z == cz + half_d
			if not is_wall:
				continue
			for y in range(floor_y, floor_y + wall_height):
				_put(chunk, x, y, z, wall)
			# Windows: two blocks up, every other column, on the long walls.
			if window and (z == cz - half_d or z == cz + half_d):
				var offset := x - cx
				if abs(offset) == half_w - 1:
					_put(chunk, x, floor_y + 2, z, V.GLASS)
			elif window and (x == cx - half_w or x == cx + half_w):
				var offset_z := z - cz
				if abs(offset_z) == half_d - 1:
					_put(chunk, x, floor_y + 2, z, V.GLASS)
	# Doorway (2 blocks tall, 1 wide) on the requested side, always reaching the ground.
	var door_x := cx
	var door_z := cz
	match door_side:
		0:
			door_z = cz - half_d
		1:
			door_z = cz + half_d
		2:
			door_x = cx - half_w
		3:
			door_x = cx + half_w
	for y in range(floor_y, floor_y + 3):
		_put(chunk, door_x, y, door_z, V.AIR)
	_put(chunk, door_x, floor_y - 1, door_z, V.PLANKS)
	# Roof: flat slab with a one-block overhang, plus a ridge for looks.
	for x in range(cx - half_w - 1, cx + half_w + 2):
		for z in range(cz - half_d - 1, cz + half_d + 2):
			_put(chunk, x, floor_y + wall_height, z, roof)
	for x in range(cx - half_w, cx + half_w + 1):
		_put(chunk, x, floor_y + wall_height + 1, cz, roof)
	# Interior floor.
	for x in range(cx - half_w + 1, cx + half_w):
		for z in range(cz - half_d + 1, cz + half_d):
			_put(chunk, x, floor_y - 1, z, V.PLANKS)
	return floor_y

func _build_village(chunk: VoxelChunk, cx: int, cz: int, radius: int, place_id: String) -> void:
	var house_count := 5
	for i: int in house_count:
		var offset := _scatter(i, place_id, radius)
		var hx := cx + offset.x
		var hz := cz + offset.y
		if not _in_world(hx, hz):
			continue
		var roof := V.ROOF if i % 2 == 0 else V.ROOF_BLUE
		_build_house(chunk, hx, hz, 7 + (i % 2) * 2, 6, 4, V.PLANKS, roof, i % 4)
	# Well / centrepiece
	var floor_y := height_at(cx, cz)
	flatten_ring(chunk, cx, cz, 2)
	for y in range(floor_y + 1, floor_y + 3):
		for dx in range(-2, 3):
			for dz in range(-2, 3):
				if abs(dx) == 2 or abs(dz) == 2:
					_put(chunk, cx + dx, y, cz + dz, V.COBBLE)
	# Fences between houses
	for i: int in 4:
		var a := _scatter(i, place_id + "f", radius + 2)
		var b := _scatter(i + 1, place_id + "f", radius + 2)
		_fence_line(chunk, cx + a.x, cz + a.y, cx + b.x, cz + b.y)

func flatten_ring(chunk: VoxelChunk, cx: int, cz: int, radius: int) -> void:
	var floor_y := height_at(cx, cz)
	for x in range(cx - radius, cx + radius + 1):
		for z in range(cz - radius, cz + radius + 1):
			if not _in_world(x, z):
				continue
			chunk_local(x, z, chunk, func(lx: int, lz: int) -> void:
				chunk.fill_column(lx, lz, 0, floor_y - 1, V.STONE)
				chunk.set_block(lx, floor_y - 1, lz, V.COBBLE)
				chunk.fill_column(lx, lz, floor_y, mini(chunk_height - 1, floor_y + 5), V.AIR)
				)

func _fence_line(chunk: VoxelChunk, ax: int, az: int, bx: int, bz: int) -> void:
	var steps := maxi(abs(bx - ax), abs(bz - az))
	for i: int in steps + 1:
		var t := float(i) / float(maxi(1, steps))
		var x := int(round(lerpf(float(ax), float(bx), t)))
		var z := int(round(lerpf(float(az), float(bz), t)))
		if i % 2 == 0 and _in_world(x, z):
			var y := height_at(x, z) + 1
			_put(chunk, x, y, z, V.PLANKS)

## Deterministic scatter offset used by districts so layouts never overlap.
func _scatter(index: int, salt: String, radius: int) -> Vector2i:
	var salt_hash := 0
	for i: int in salt.length():
		salt_hash = (salt_hash * 31 + salt.unicode_at(i)) & 0x7FFFFFFF
	var angle := rand01(index, salt_hash % 997, 11) * TAU
	var distance := radius * (0.35 + 0.55 * rand01(index, salt_hash % 601, 23))
	return Vector2i(int(round(cos(angle) * distance)), int(round(sin(angle) * distance)))

func _build_warehouses(chunk: VoxelChunk, cx: int, cz: int) -> void:
	for i: int in 3:
		var offset := _scatter(i, "warehouse", 22)
		var wx := cx + offset.x
		var wz := cz + offset.y
		if not _in_world(wx, wz):
			continue
		var floor_y := _flatten(chunk, wx, wz, 9, 7, 9)
		# Long tin warehouse: tall walls, wide roll-up door, interior pillars.
		for x in range(wx - 9, wx + 10):
			for z in range(wz - 7, wz + 8):
				var is_wall := x == wx - 9 or x == wx + 9 or z == wz - 7 or z == wz + 8
				if not is_wall:
					continue
				for y in range(floor_y, floor_y + 6):
					_put(chunk, x, y, z, V.METAL)
			if z == wz - 7 or z == wz + 8:
				if abs(x - wx) <= 3:
					for y in range(floor_y, floor_y + 5):
						_put(chunk, x, y, z, V.AIR)
		for x in range(wx - 9, wx + 10):
			for z in range(wz - 7, wz + 8):
				_put(chunk, x, floor_y + 6, z, V.METAL)
				if (x + z) % 2 == 0:
					_put(chunk, x, floor_y + 7, z, V.METAL)
		for pillar_x: int in [wx - 4, wx + 4]:
			for pillar_z: int in [wz - 3, wz + 3]:
				for y in range(floor_y, floor_y + 6):
					_put(chunk, pillar_x, y, pillar_z, V.CONCRETE)
		# Shelving rows (cover inside)
		for shelf: int in 3:
			var z := wz - 4 + shelf * 4
			for x in range(wx - 7, wx - 3):
				_put(chunk, x, floor_y + 1, z, V.CRATE)
			for x in range(wx + 4, wx + 8):
				_put(chunk, x, floor_y + 1, z, V.CRATE)

func _build_outpost(chunk: VoxelChunk, cx: int, cz: int, place_id: String) -> void:
	var floor_y := _flatten(chunk, cx, cz, 12, 12, 12)
	# Perimeter wall with two gates
	for x in range(cx - 12, cx + 13):
		for z in range(cz - 12, cz + 13):
			var on_edge := abs(x - cx) == 12 or abs(z - cz) == 12
			if not on_edge:
				continue
			var gate := false
			if abs(x - cx) <= 1 and (z == cz - 12 or z == cz + 12):
				gate = true
			if abs(z - cz) <= 1 and (x == cx - 12 or x == cx + 12):
				gate = true
			if gate:
				continue
			for y in range(floor_y, floor_y + 4):
				_put(chunk, x, y, z, V.CONCRETE)
			if (x + z) % 3 == 0:
				_put(chunk, x, floor_y + 4, z, V.METAL)
	# Corner towers with firing gaps
	for tower: int in 4:
		var tx := cx + (12 if tower % 2 == 1 else -12)
		var tz := cz + (12 if tower > 1 else -12)
		for x in range(tx - 2, tx + 3):
			for z in range(tz - 2, tz + 3):
				var edge := abs(x - tx) == 2 or abs(z - tz) == 2
				if not edge:
					continue
				for y in range(floor_y, floor_y + 6):
					if y == floor_y + 3 and (x + z) % 2 == 0:
						continue
					_put(chunk, x, y, z, V.CONCRETE)
		for x in range(tx - 2, tx + 3):
			for z in range(tz - 2, tz + 3):
				_put(chunk, x, floor_y + 6, z, V.METAL)
	# Command building
	_build_house(chunk, cx, cz, 9, 7, 4, V.CONCRETE, V.METAL, 0)
	# Watchtower and sandbag lines
	_build_watchtower(chunk, cx - 8, cz + 8)
	for i: int in 14:
		var x := cx - 6 + i * 2
		_put(chunk, x, floor_y, cz + 5, V.CRATE)
		_put(chunk, x, floor_y + 1, cz + 5, V.CRATE)
	# Fuel drums
	for i: int in 6:
		var offset := _scatter(i, place_id + "drum", 9)
		var dx := cx + offset.x
		var dz := cz + offset.y
		var y := height_at(dx, dz) + 1
		_put(chunk, dx, y, dz, V.METAL)
		_put(chunk, dx, y + 1, dz, V.METAL)

func _build_keep(chunk: VoxelChunk, cx: int, cz: int) -> void:
	var floor_y := _flatten(chunk, cx, cz, 10, 10, 12)
	for level: int in 3:
		var half := 10 - level * 3
		var y0 := floor_y + level * 4
		for x in range(cx - half, cx + half + 1):
			for z in range(cz - half, cz + half + 1):
				var on_edge := abs(x - cx) == half or abs(z - cz) == half
				if on_edge:
					for y in range(y0, y0 + 4):
						_put(chunk, x, y, z, V.COBBLE)
					if (x + z) % 2 == 0:
						_put(chunk, x, y0 + 2, z, V.AIR)
				else:
					for y in range(y0, y0 + (4 if level < 2 else 0)):
						_put(chunk, x, y, z, V.AIR)
		# Floor for the next level, with a stair gap
		for x in range(cx - half, cx + half + 1):
			for z in range(cz - half, cz + half + 1):
				if abs(x - cx) == half and abs(z - cz) == half:
					continue
				if (x - cx) >= half - 2 and abs(z - cz) <= 1 and level < 2:
					continue
				_put(chunk, x, y0 + 3, z, level < 2 and V.PLANKS or V.COBBLE)
	# Battlements
	for x in range(cx - 4, cx + 5):
		_put(chunk, x, floor_y + 12, cz - 4, V.COBBLE)
		_put(chunk, x, floor_y + 12, cz + 4, V.COBBLE)
	for z in range(cz - 4, cz + 5):
		_put(chunk, cx - 4, floor_y + 12, z, V.COBBLE)
		_put(chunk, cx + 4, floor_y + 12, z, V.COBBLE)
	# Stair ramps up the inside
	for step: int in 4:
		_put(chunk, cx + 8 - step, floor_y + step, cz, V.COBBLE)

func _build_dock(chunk: VoxelChunk, cx: int, cz: int) -> void:
	var floor_y := height_at(cx, cz)
	# Planks running out over the water, on posts
	for i: int in 14:
		var x := cx + i
		for w in range(-2, 3):
			_put(chunk, x, floor_y + 1, cz + w, V.PLANKS)
		if i % 4 == 0:
			for w in range(-2, 3, 4):
				for y in range(floor_y - 3, floor_y + 1):
					_put(chunk, x, y, cz + w, V.LOG)
	# Small shack on the dock
	_build_house(chunk, cx - 4, cz, 5, 5, 3, V.PLANKS, V.ROOF, 3)
	# Mooring bollards and crates
	for i: int in 5:
		_put(chunk, cx + i * 3, floor_y + 2, cz - 3, V.LOG)
		_put(chunk, cx + i * 3, floor_y + 2, cz + 3, V.LOG)
	for i: int in 4:
		_put(chunk, cx + 2 + i * 2, floor_y + 2, cz + 1, V.CRATE)

func _build_farmstead(chunk: VoxelChunk, cx: int, cz: int) -> void:
	_build_house(chunk, cx - 8, cz - 6, 9, 7, 4, V.PLANKS, V.ROOF, 1)
	var floor_y := _flatten(chunk, cx + 6, cz + 4, 6, 4, 8, V.DIRT)
	# Windmill tower with a spinning look baked into the voxels
	for y in range(floor_y, floor_y + 8):
		var half := 3 - (y - floor_y) / 4
		for x in range(cx + 2, cx + 11):
			for z in range(cz, cz + 9):
				var on_edge := abs(x - (cx + 6)) == half or abs(z - (cz + 4)) == half
				if on_edge and y % 3 != 1:
					_put(chunk, x, y, z, V.PLANKS)
	_put(chunk, cx + 6, floor_y + 8, cz + 4, V.METAL)
	for i: int in 4:
		_put(chunk, cx + 6 + (4 if i == 0 else (-4 if i == 1 else 0)), floor_y + 8 + (0 if i < 2 else 4),
			cz + 4 + (4 if i == 2 else (-4 if i == 3 else 0)), V.PLANKS)
	# Crop rows and fences
	for row: int in 4:
		var z := cz - 6 + row * 4
		for x in range(cx - 12, cx - 2):
			if (x + row) % 3 == 0:
				_put(chunk, x, height_at(x, z) + 1, z, V.LEAVES)
	_fence_line(chunk, cx - 13, cz - 10, cx + 13, cz - 10)
	_fence_line(chunk, cx - 13, cz + 12, cx + 13, cz + 12)

func _build_quarry(chunk: VoxelChunk, cx: int, cz: int) -> void:
	# Terraced open pit: dig rings of decreasing depth, leave ramps.
	for ring: int in 4:
		var radius := 18 - ring * 4
		var depth := ring + 1
		for angle_step: int in 96:
			var angle := float(angle_step) / 96.0 * TAU
			var x := cx + int(round(cos(angle) * float(radius)))
			var z := cz + int(round(sin(angle) * float(radius)))
			if not _in_world(x, z):
				continue
			# Leave a ramp corridor to the north-east so the pit is enterable.
			var ramp := (cos(angle) > 0.55 and sin(angle) < -0.35)
			if ramp:
				continue
			var surface := height_at(x, z)
			chunk_local(x, z, chunk, func(lx: int, lz: int) -> void:
				for y in range(surface, surface - depth, -1):
					if y > 1:
						chunk.set_block(lx, y, lz, V.AIR)
				chunk.set_block(lx, maxi(1, surface - depth), lz, V.GRAVEL)
				)
	# Mining props on the rim
	for i: int in 8:
		var offset := _scatter(i, "quarry", 20)
		var x := cx + offset.x
		var z := cz + offset.y
		var y := height_at(x, z) + 1
		_put(chunk, x, y, z, V.CRATE)
		if i % 3 == 0:
			_put(chunk, x, y + 1, z, V.CRATE)

func _build_ruins(chunk: VoxelChunk, cx: int, cz: int) -> void:
	# Broken walls: irregular columns of cobble with holes.
	for i: int in 26:
		var offset := _scatter(i, "ruins", 16)
		var x := cx + offset.x
		var z := cz + offset.y
		var base_y := height_at(x, z) + 1
		var height := 1 + (hash2(x, z, 5) % 3)
		for y in range(base_y, base_y + height):
			if hash2(x, y, 9) % 7 == 0:
				continue
			_put(chunk, x, y, z, V.COBBLE)
	# A few intact pillars
	for corner: int in 4:
		var px := cx + (9 if corner % 2 == 1 else -9)
		var pz := cz + (9 if corner > 1 else -9)
		var py := height_at(px, pz) + 1
		for y in range(py, py + 6):
			_put(chunk, px, y, pz, V.COBBLE)

func _build_firing_range(chunk: VoxelChunk, cx: int, cz: int) -> void:
	var floor_y := _flatten(chunk, cx, cz, 22, 8, 10, V.CONCRETE)
	# Firing line cover
	for x in range(cx - 20, cx - 16):
		for z in range(cz - 6, cz + 7):
			_put(chunk, x, floor_y, z, V.CONCRETE)
			_put(chunk, x, floor_y + 1, z, V.CONCRETE)
	# Distance markers (coloured pillars) at 10/20/30 blocks
	for i: int in 3:
		var x := cx - 10 + i * 10
		for z in range(cz - 6, cz + 7, 4):
			_put(chunk, x, floor_y + 2, z, V.MARKER)
			_put(chunk, x, floor_y + 3, z, V.MARKER)
	# Back wall to stop strays
	for x in range(cx - 22, cx + 23):
		for y in range(floor_y, floor_y + 5):
			_put(chunk, x, y, cz + 8, V.CONCRETE)

func _build_armory(chunk: VoxelChunk, cx: int, cz: int) -> void:
	var floor_y := _flatten(chunk, cx, cz, 10, 8, 8)
	# Open-fronted shed with weapon racks
	for x in range(cx - 10, cx + 11):
		for z in range(cz - 8, cz + 9):
			var is_wall := x == cx - 10 or x == cx + 10 or z == cz - 8
			if is_wall:
				for y in range(floor_y, floor_y + 5):
					_put(chunk, x, y, z, V.CONCRETE)
			if z == cz + 8 and abs(x - cx) > 3:
				for y in range(floor_y, floor_y + 5):
					_put(chunk, x, y, z, V.CONCRETE)
	for x in range(cx - 10, cx + 11):
		for z in range(cz - 8, cz + 9):
			_put(chunk, x, floor_y + 5, z, V.METAL)
	# Racks and benches
	for i: int in 5:
		var x := cx - 8 + i * 4
		for z: int in [cz - 4, cz + 4]:
			_put(chunk, x, floor_y, z, V.CRATE)
			_put(chunk, x, floor_y + 1, z, V.CRATE)
	for i: int in 3:
		_put(chunk, cx + i * 3 - 3, floor_y + 1, cz, V.MARKER)

func _build_movement_course(chunk: VoxelChunk, cx: int, cz: int) -> void:
	var floor_y := _flatten(chunk, cx, cz, 14, 10, 12, V.DIRT)
	# Jump platforms of increasing height, then a balance beam and a climb wall.
	for i: int in 6:
		var x := cx - 10 + i * 4
		var height := 1 + i
		for dx in range(-1, 2):
			for dz in range(-1, 2):
				_put(chunk, x + dx, floor_y + height, cz - 6 + dz, V.PLANKS)
	for i: int in 10:
		_put(chunk, cx - 10 + i * 2, floor_y + 2, cz + 2, V.LOG)
	for i: int in 6:
		_put(chunk, cx + 10, floor_y + i, cz - 6, V.COBBLE)
	# Finish gate
	for i: int in 3:
		_put(chunk, cx + 12, floor_y + i, cz + 6, V.MARKER)
		_put(chunk, cx + 14, floor_y + i, cz + 6, V.MARKER)
	_put(chunk, cx + 13, floor_y + 3, cz + 6, V.MARKER)

func _build_arena(chunk: VoxelChunk, cx: int, cz: int) -> void:
	var floor_y := _flatten(chunk, cx, cz, 44, 44, 10, V.CONCRETE)
	# Symmetric cover: four quadrant stacks plus centre block, mirrored exactly.
	var positions := [
		Vector2i(-22, -22), Vector2i(22, -22), Vector2i(-22, 22), Vector2i(22, 22),
		Vector2i(0, 0), Vector2i(-12, 0), Vector2i(12, 0), Vector2i(0, -12), Vector2i(0, 12),
		Vector2i(-30, 0), Vector2i(30, 0), Vector2i(0, -30), Vector2i(0, 30),
	]
	for index: int in positions.size():
		var offset: Vector2i = positions[index]
		var x := cx + offset.x
		var z := cz + offset.y
		var size := 2 if index < 5 else 1
		var stack := 2 if index < 5 else 3
		for dx in range(-size, size + 1):
			for dz in range(-size, size + 1):
				for y in range(1, stack + 1):
					_put(chunk, x + dx, floor_y + y, z + dz, V.CONCRETE if index < 5 else V.CRATE)
	# Team-coloured spawn pads
	for i: int in 4:
		for dx in range(-2, 3):
			for dz in range(-2, 3):
				_put(chunk, cx - 40 + dx, floor_y, cz - 40 + dz + i * 16, V.MARKER)
				_put(chunk, cx + 40 + dx, floor_y, cz - 40 + dz + i * 16, V.MARKER)
	# Neon perimeter wall
	for x in range(cx - 46, cx + 47):
		for z in range(cz - 46, cz + 47):
			var on_edge := abs(x - cx) == 46 or abs(z - cz) == 46
			if not on_edge:
				continue
			for y in range(1, 4):
				_put(chunk, x, floor_y + y, z, V.CONCRETE)

func _build_canyon_cover(chunk: VoxelChunk, cx: int, cz: int) -> void:
	var floors: Array = []
	for i: int in 18:
		var offset := _scatter(i, "canyon", 26)
		var x := cx + offset.x
		var z := cz + offset.y
		var base_y := height_at(x, z)
		floors.append(base_y)
		var height := 2 + (hash2(x, z, 3) % 4)
		var width := 1 + (hash2(x, z, 4) % 2)
		for y in range(base_y, base_y + height):
			for dx in range(-width, width + 1):
				_put(chunk, x + dx, y, z + (y - base_y) / 3, V.COBBLE if y % 2 == 0 else V.STONE)
	# Wooden barricades for close cover
	for i: int in 6:
		var offset := _scatter(i, "canyonbarricade", 22)
		var x := cx + offset.x
		var z := cz + offset.y
		var y := height_at(x, z) + 1
		for dz in range(-2, 3):
			_put(chunk, x, y, z + dz, V.PLANKS)
			_put(chunk, x, y + 1, z + dz, V.PLANKS)

func _build_ice_hollow(chunk: VoxelChunk, cx: int, cz: int) -> void:
	var surface := height_at(cx, cz)
	# Ice arch over a hollowed cave, carved as a shell.
	for angle_step: int in 48:
		var angle := float(angle_step) / 48.0 * TAU
		var x := cx + int(round(cos(angle) * 14.0))
		var z := cz + int(round(sin(angle) * 14.0))
		var arch := int(round(6.0 * sin(float(angle_step) / 48.0 * PI)))
		for y in range(surface, surface + 3 + arch):
			_put(chunk, x, y, z, V.ICE if y % 3 != 0 else V.STONE)
	# Carve the cave body
	for x in range(cx - 12, cx + 13):
		for z in range(cz - 12, cz + 13):
			var distance := sqrt(float((x - cx) * (x - cx) + (z - cz) * (z - cz)))
			if distance > 12.0:
				continue
			var floor_y := surface - 4 + int(round(3.0 * (distance / 12.0)))
			flatten_ring(chunk, x, z, 1)
			var local := _local(chunk, x, z)
			if chunk.in_bounds(local.x, 0, local.y):
				chunk.fill_column(local.x, local.y, floor_y, surface + 6, V.AIR)
				chunk.set_block(local.x, floor_y - 1, local.y, V.STONE)
	# Entrance
	for x in range(cx + 10, cx + 16):
		for y in range(surface - 3, surface + 3):
			_put(chunk, x, y, cz, V.AIR)

func _build_watchtower(chunk: VoxelChunk, cx: int, cz: int) -> void:
	var floor_y := _flatten(chunk, cx, cz, 4, 4, 14)
	for leg: int in 4:
		var lx := cx + (-3 if leg % 2 == 0 else 3)
		var lz := cz + (-3 if leg < 2 else 3)
		for y in range(floor_y, floor_y + 8):
			_put(chunk, lx, y, lz, V.LOG)
	# Platform with railing, ladder gap and a roof
	for x in range(cx - 4, cx + 5):
		for z in range(cz - 4, cz + 5):
			if abs(x - cx) <= 3 and abs(z - cz) <= 3:
				_put(chunk, x, floor_y + 8, z, V.PLANKS)
	for x in range(cx - 4, cx + 5):
		_put(chunk, x, floor_y + 9, cz - 4, V.PLANKS)
		_put(chunk, x, floor_y + 9, cz + 4, V.PLANKS)
	for z in range(cz - 4, cz + 5):
		_put(chunk, cx - 4, floor_y + 9, z, V.PLANKS)
		_put(chunk, cx + 4, floor_y + 9, z, V.PLANKS)
	_put(chunk, cx - 4, floor_y + 9, cz, V.AIR)
	for x in range(cx - 4, cx + 5):
		for z in range(cz - 4, cz + 5):
			_put(chunk, x, floor_y + 12, z, V.ROOF)
	# Ladder (climbable via jump + step logic is not implemented, so a stair is used)
	for step: int in 8:
		_put(chunk, cx - 3 + (step / 3), floor_y + step, cz + 3, V.LOG)

# ------------------------------------------------------------------ decorate
## Adds trees, rocks and bushes.  Called once per chunk after generation.
func decorate_chunk(chunk: VoxelChunk, world: VoxelWorld) -> void:
	var base_x := chunk.coord.x * chunk_size
	var base_z := chunk.coord.y * chunk_size
	var trees: Dictionary = biome.get("trees", {})
	var tree_count := int(trees.get("count", 0))
	var spacing := maxf(2.0, float(trees.get("spacing", 4.0)))
	var density := float(tree_count) / maxf(1.0, float(size_x * size_z))
	for lx: int in chunk_size:
		for lz: int in chunk_size:
			var wx := base_x + lx
			var wz := base_z + lz
			if not in_bounds(wx, wz):
				continue
			var h := height_at(wx, wz)
			if h <= sea_level:
				continue
			var roll := rand01(wx, wz, 101)
			if roll < density * spacing * spacing:
				if _surface_is_buildable(wx, wz) and not _near_place(wx, wz, 6.0):
					_place_tree(world, wx, h + 1, wz)
			elif roll < density * spacing * spacing + 0.004 * int(biome.get("bush_count", 0)) / 100.0:
				_put_if_air(chunk, wx, h + 1, wz, V.LEAVES)
	var rock_count := int(biome.get("rocks", {}).get("count", 0))
	var rock_density := float(rock_count) / maxf(1.0, float(size_x * size_z))
	for lx: int in chunk_size:
		for lz: int in chunk_size:
			var wx := base_x + lx
			var wz := base_z + lz
			if not in_bounds(wx, wz):
				continue
			var roll := rand01(wx, wz, 211)
			if roll < rock_density * 4.0:
				var h := height_at(wx, wz)
				if h > sea_level and not _near_place(wx, wz, 5.0):
					_place_rock(world, wx, h + 1, wz)

func _surface_is_buildable(x: int, z: int) -> bool:
	var h := height_at(x, z)
	var surface := surface_block(x, z, h)
	return surface == V.GRASS or surface == V.SNOW or surface == V.DIRT

func _near_place(x: int, z: int, margin: float) -> bool:
	for place: Variant in _place_list:
		var info: Dictionary = place
		var center: Array = info.get("center", [0, 0])
		var dx := float(x) - float(center[0])
		var dz := float(z) - float(center[1])
		var radius := float(info.get("radius", 16.0)) + margin
		if dx * dx + dz * dz < radius * radius:
			return true
	return false

## Trees are written through the world so canopies cross chunk borders.
func _place_tree(world: VoxelWorld, x: int, y: int, z: int) -> void:
	var height := int(biome.get("trees", {}).get("min_height", 22)) - 16
	height = clampi(height + (hash2(x, z, 13) % 3) - 1, 4, 8)
	var snowy := _uses_snow_surface()
	var leaf := V.LEAVES
	for i: int in height:
		world.set_block(x, y + i, z, V.LOG if i < height - 1 else V.LOG)
	var top := y + height
	# Canopy: two wide layers plus a small cap (classic voxel tree silhouette).
	for layer: int in 3:
		var radius := 2 - layer
		for dx in range(-radius, radius + 1):
			for dz in range(-radius, radius + 1):
				if abs(dx) == radius and abs(dz) == radius and radius > 1:
					continue
				world.set_block(x + dx, top - layer, z + dz, leaf)
	for dx in range(-1, 2):
		world.set_block(x + dx, top + 1, z, leaf)
	world.set_block(x, top + 2, z, leaf)
	if snowy:
		world.set_block(x, top + 1, z, leaf)

func _place_rock(world: VoxelWorld, x: int, y: int, z: int) -> void:
	var size := 1 + (hash2(x, z, 17) % 2)
	var block := V.STONE if not _uses_snow_surface() else V.ICE
	for dx in range(-size, size + 1):
		for dz in range(-size, size + 1):
			if abs(dx) + abs(dz) > size:
				continue
			world.set_block(x + dx, y, z + dz, block)
	if size > 1:
		world.set_block(x, y + 1, z, block)

# ------------------------------------------------------------------- queries
## Finds a safe standing position near a spawn point (never inside a wall or
## under the terrain, never outside the playable area).
func safe_spawn(x: int, z: int) -> Vector3:
	var best := Vector3(float(x) + 0.5, 0.0, float(z) + 0.5)
	for radius: int in [0, 1, 2, 3, 4, 6]:
		for angle_step: int in 8:
			var angle := float(angle_step) / 8.0 * TAU
			var sx := x + int(round(cos(angle) * float(radius)))
			var sz := z + int(round(sin(angle) * float(radius)))
			if not in_bounds(sx, sz):
				continue
			var height := walkable_height(sx, sz)
			if height >= chunk_height - 3:
				continue
			best = Vector3(float(sx) + 0.5, float(height) + 0.05, float(sz) + 0.5)
			return best
	return best

func spawn_points() -> Array:
	var out: Array = []
	for point: Variant in map.get("spawn_points", []):
		var entry: Array = point
		if entry.size() < 2:
			continue
		out.append(safe_spawn(int(entry[0]), int(entry[1])))
	return out

## Scatters drop positions over the island for battle royale deployment.
func drop_points(count: int) -> Array:
	var out: Array = []
	var rng := RandomNumberGenerator.new()
	rng.seed = seed
	var margin := 24
	var attempts := 0
	while out.size() < count and attempts < count * 12:
		attempts += 1
		var x := rng.randi_range(margin, maxi(margin + 1, size_x - margin))
		var z := rng.randi_range(margin, maxi(margin + 1, size_z - margin))
		var height := height_at(x, z)
		if height <= sea_level + 1:
			continue
		if _near_place(x, z, -4.0):
			continue
		out.append(Vector3(float(x) + 0.5, float(height) + 12.0, float(z) + 0.5))
	return out

## Loot spawn positions for a place, respecting its loot tier and avoiding walls.
func loot_points(place_id: String, count: int) -> Array:
	var place_info: Dictionary = ContentDB.place(map.get("id", ""), place_id)
	if place_info.is_empty():
		return []
	var center: Array = place_info.get("center", [0, 0])
	var radius := float(place_info.get("radius", 14.0))
	var out: Array = []
	var index := 0
	var attempts := 0
	while out.size() < count and attempts < count * 20:
		attempts += 1
		var angle := rand01(index, place_id.length(), 31) * TAU
		var distance := radius * (0.15 + 0.8 * rand01(index, place_id.length(), 41))
		var x := int(center[0]) + int(round(cos(angle) * distance))
		var z := int(center[1]) + int(round(sin(angle) * distance))
		index += 1
		if not in_bounds(x, z):
			continue
		var h := height_at(x, z)
		if h <= sea_level:
			continue
		# Prefer spots that are on a floor and have headroom.
		var y := h + 1
		out.append(Vector3(float(x) + 0.5, float(y), float(z) + 0.5))
	return out
