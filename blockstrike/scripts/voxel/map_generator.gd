class_name MapGenerator
extends RefCounted
## Deterministic generator for EMERALD ISLAND (original map).
##
## Terrain comes from seeded noise with an island falloff, hills, a river with
## two bridges, and flattened build zones for hand-placed landmarks (village,
## signal outpost, warehouse row, hilltop tower, ruins). Forests and boulders are
## scattered with a seeded RNG, and spawn points are validated against the final
## geometry so nobody spawns inside walls or beneath terrain.

const W := 128
const H := 40
const SEA := 9
const BANK := 11
const BOUNDS_RADIUS := 50.0
const CENTER := Vector2(64.0, 64.0)

## Flattened build zones: Rect2i(x, z, w, d) at a fixed ground level.
const VILLAGE_RECT := Rect2i(14, 40, 32, 16)
const VILLAGE_LEVEL := 11
const OUTPOST_RECT := Rect2i(84, 18, 28, 25)
const OUTPOST_LEVEL := 14
const WAREHOUSE_RECT := Rect2i(66, 86, 25, 19)
const WAREHOUSE_LEVEL := 12
const HILL_A := Vector2(34.0, 30.0)
const HILL_B := Vector2(106.0, 100.0)
const BRIDGE_XS := [47, 96]

static func river_z(x: float) -> float:
	return 66.0 + 7.0 * sin(x * 0.06)


static func generate(world: VoxelWorld, seed_value: int) -> Dictionary:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value

	var terrain := FastNoiseLite.new()
	terrain.seed = seed_value
	terrain.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	terrain.frequency = 0.035
	terrain.fractal_octaves = 3

	var detail := FastNoiseLite.new()
	detail.seed = seed_value + 1
	detail.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	detail.frequency = 0.09

	var forest := FastNoiseLite.new()
	forest.seed = seed_value + 2
	forest.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	forest.frequency = 0.045

	var heights := PackedFloat32Array()
	heights.resize(W * W)
	for z in range(W):
		for x in range(W):
			heights[z * W + x] = _raw_height(x, z, terrain, detail)
	_flatten_rect(heights, VILLAGE_RECT, VILLAGE_LEVEL, 3)
	_flatten_rect(heights, OUTPOST_RECT, OUTPOST_LEVEL, 3)
	_flatten_rect(heights, WAREHOUSE_RECT, WAREHOUSE_LEVEL, 3)

	_fill_terrain(world, heights, detail)
	_place_river_bridges(world)
	_place_village(world)
	_place_outpost(world)
	_place_warehouse(world)
	_place_hilltop_tower(world)
	_place_ruins(world)
	_place_trees(world, rng, forest)
	_place_boulders(world, rng)

	var spawns := _pick_spawns(world, rng, 12, 24.0)
	var landmarks := _landmarks(world)
	return {
		"spawns": spawns,
		"landmarks": landmarks,
		"sea_level": SEA,
		"bounds_radius": BOUNDS_RADIUS,
		"center": Vector3(CENTER.x, 0.0, CENTER.y),
	}


static func _raw_height(x: int, z: int, terrain: FastNoiseLite, detail: FastNoiseLite) -> float:
	var d := Vector2(x - CENTER.x, z - CENTER.y).length() / (W * 0.48)
	var h := 10.0 + terrain.get_noise_2d(x, z) * 4.5 + detail.get_noise_2d(x, z) * 0.9
	var land := smoothstep(0.0, 1.0, clampf((1.0 - d) / 0.2, 0.0, 1.0))
	h = lerpf(float(SEA - 6), h, land)
	h += _bump(x, z, HILL_A, 9.0, 13.0)
	h += _bump(x, z, HILL_B, 7.0, 12.0)
	if d < 0.92:
		var dz := absf(z - river_z(x))
		if dz <= 6.0:
			h = float(BANK)
		elif dz <= 9.0:
			h = lerpf(float(BANK), h, (dz - 6.0) / 3.0)
		if dz <= 2.6:
			h = float(SEA - 2)
	return h


static func _bump(x: int, z: int, center: Vector2, amp: float, radius: float) -> float:
	var d2 := (Vector2(x, z) - center).length_squared()
	return amp * exp(-d2 / (radius * radius * 0.5))


static func _flatten_rect(heights: PackedFloat32Array, rect: Rect2i, level: int, margin: int) -> void:
	for z in range(W):
		for x in range(W):
			var dx := maxi(maxi(rect.position.x - x, x - (rect.position.x + rect.size.x - 1)), 0)
			var dz := maxi(maxi(rect.position.y - z, z - (rect.position.y + rect.size.y - 1)), 0)
			var dist := maxi(dx, dz)
			var idx := z * W + x
			if dist == 0:
				heights[idx] = float(level)
			elif dist <= margin:
				var t := 1.0 - float(dist) / float(margin + 1)
				heights[idx] = lerpf(heights[idx], float(level), t)


static func _fill_terrain(world: VoxelWorld, heights: PackedFloat32Array, detail: FastNoiseLite) -> void:
	for z in range(W):
		for x in range(W):
			var top := clampi(roundi(heights[z * W + x]), 2, H - 8)
			var surface := BlockIds.GRASS
			if top <= SEA + 1:
				surface = BlockIds.SAND
			elif top >= 24:
				surface = BlockIds.SNOW
			elif top >= 19:
				surface = BlockIds.STONE
			elif detail.get_noise_2d(x * 1.7, z * 1.7) > 0.42 and top >= SEA + 2:
				surface = BlockIds.GRAVEL
			var sub := BlockIds.DIRT if (surface == BlockIds.GRASS or surface == BlockIds.SAND or surface == BlockIds.GRAVEL) else BlockIds.STONE
			for y in range(0, top + 1):
				var id := BlockIds.STONE
				if y == top:
					id = surface
				elif y >= top - 3:
					id = sub
				world.data[world.index_of(x, y, z)] = id
			for y in range(top + 1, SEA + 1):
				world.data[world.index_of(x, y, z)] = BlockIds.WATER


static func _place_river_bridges(world: VoxelWorld) -> void:
	for bx in BRIDGE_XS:
		var zs := 58
		var ze := 76
		# Support pillars stand in the river channel.
		for z in range(zs, ze + 1):
			if absf(z - river_z(bx)) <= 2.8:
				world.fill_box(bx, 7, z, bx, BANK - 1, z, BlockIds.STONE)
				world.fill_box(bx + 2, 7, z, bx + 2, BANK - 1, z, BlockIds.STONE)
		world.fill_box(bx, BANK, zs, bx + 2, BANK, ze, BlockIds.PLANKS)


static func _house(world: VoxelWorld, x0: int, z0: int, w: int, d: int, ground: int,
		wall: int, door_side: String) -> void:
	var x1 := x0 + w - 1
	var z1 := z0 + d - 1
	world.fill_box(x0, ground, z0, x1, ground, z1, BlockIds.PLANKS)
	world.fill_box(x0, ground + 1, z0, x1, ground + 4, z0, wall)
	world.fill_box(x0, ground + 1, z1, x1, ground + 4, z1, wall)
	world.fill_box(x0, ground + 1, z0, x0, ground + 4, z1, wall)
	world.fill_box(x1, ground + 1, z0, x1, ground + 4, z1, wall)
	world.fill_box(x0 + 1, ground + 1, z0 + 1, x1 - 1, ground + 4, z1 - 1, BlockIds.AIR)
	var door_x := (x0 + x1) / 2
	var door_z := z1 if door_side == "south" else z0
	world.fill_box(door_x, ground + 1, door_z, door_x + 1, ground + 3, door_z, BlockIds.AIR)
	var mid_z := (z0 + z1) / 2
	world.set_block(x0, ground + 2, mid_z, BlockIds.AIR)
	world.set_block(x1, ground + 2, mid_z, BlockIds.AIR)
	world.fill_box(x0 - 1, ground + 5, z0 - 1, x1 + 1, ground + 5, z1 + 1, BlockIds.PLANKS)


static func _place_village(world: VoxelWorld) -> void:
	var g := VILLAGE_LEVEL
	world.fill_box(14, g, 47, 45, g, 49, BlockIds.GRAVEL)
	_house(world, 16, 41, 8, 6, g, BlockIds.PLANKS, "south")
	_house(world, 27, 41, 7, 6, g, BlockIds.BRICK, "south")
	_house(world, 16, 50, 6, 5, g, BlockIds.PLANKS, "north")
	_house(world, 28, 50, 7, 5, g, BlockIds.BRICK, "north")
	# Village well: brick ring with water in the middle.
	world.fill_box(36, g + 1, 43, 38, g + 1, 45, BlockIds.BRICK)
	world.set_block(37, g + 1, 44, BlockIds.AIR)
	world.set_block(37, g, 44, BlockIds.WATER)


static func _place_outpost(world: VoxelWorld) -> void:
	var g := OUTPOST_LEVEL
	var r := OUTPOST_RECT
	var x0 := r.position.x
	var z0 := r.position.y
	var x1 := x0 + r.size.x - 1
	var z1 := z0 + r.size.y - 1
	world.fill_box(x0, g, z0, x1, g, z1, BlockIds.CONCRETE)
	world.fill_box(x0, g + 1, z0, x1, g + 6, z0 + 1, BlockIds.CONCRETE)
	world.fill_box(x0, g + 1, z1 - 1, x1, g + 6, z1, BlockIds.CONCRETE)
	world.fill_box(x0, g + 1, z0, x0 + 1, g + 6, z1, BlockIds.CONCRETE)
	world.fill_box(x1 - 1, g + 1, z0, x1, g + 6, z1, BlockIds.CONCRETE)
	# West gate opening.
	world.fill_box(x0, g + 1, 28, x0 + 1, g + 3, 31, BlockIds.AIR)
	# Corner watch towers.
	for corner in [Vector2i(x0, z0), Vector2i(x1 - 2, z0), Vector2i(x0, z1 - 2), Vector2i(x1 - 2, z1 - 2)]:
		world.fill_box(corner.x, g + 1, corner.y, corner.x + 2, g + 9, corner.y + 2, BlockIds.METAL)
		world.fill_box(corner.x, g + 9, corner.y, corner.x + 2, g + 9, corner.y + 2, BlockIds.METAL)
	# Central bunker (higher-risk loot room).
	_house(world, 96, 27, 7, 6, g, BlockIds.METAL, "south")
	# Crate stacks for cover.
	for p in [Vector2i(88, 22), Vector2i(90, 36), Vector2i(104, 38), Vector2i(108, 22), Vector2i(92, 31)]:
		world.fill_box(p.x, g + 1, p.y, p.x + 1, g + 2, p.y + 1, BlockIds.PLANKS)


static func _place_warehouse(world: VoxelWorld) -> void:
	var g := WAREHOUSE_LEVEL
	var x0 := 66
	var z0 := 86
	var x1 := 90
	var z1 := 104
	world.fill_box(x0, g, z0, x1, g, z1, BlockIds.CONCRETE)
	world.fill_box(x0, g + 1, z0, x1, g + 7, z0, BlockIds.METAL)
	world.fill_box(x0, g + 1, z1, x1, g + 7, z1, BlockIds.METAL)
	world.fill_box(x0, g + 1, z0, x0, g + 7, z1, BlockIds.METAL)
	world.fill_box(x1, g + 1, z0, x1, g + 7, z1, BlockIds.METAL)
	# North door, four blocks wide.
	world.fill_box(75, g + 1, z0, 78, g + 5, z0, BlockIds.AIR)
	# Half roof (north side) for mixed open/covered combat.
	world.fill_box(x0, g + 8, z0, x1, g + 8, 94, BlockIds.METAL)
	for p in [Vector2i(70, 92), Vector2i(72, 98), Vector2i(84, 92), Vector2i(86, 100)]:
		world.fill_box(p.x, g + 1, p.y, p.x + 1, g + 3, p.y + 1, BlockIds.PLANKS)


static func _place_hilltop_tower(world: VoxelWorld) -> void:
	var cx := int(HILL_A.x)
	var cz := int(HILL_A.y)
	var base := world.surface_height(cx, cz)
	if base < 0:
		return
	world.fill_box(cx - 2, base, cz - 2, cx + 2, base, cz + 2, BlockIds.STONE)
	world.fill_box(cx - 1, base + 1, cz - 1, cx + 1, base + 6, cz + 1, BlockIds.STONE)
	world.fill_box(cx - 1, base + 2, cz - 1, cx + 1, base + 5, cz + 1, BlockIds.AIR)
	world.fill_box(cx - 1, base + 7, cz - 1, cx + 1, base + 7, cz + 1, BlockIds.PLANKS)
	world.fill_box(cx, base + 1, cz - 1, cx, base + 2, cz - 1, BlockIds.AIR)


static func _place_ruins(world: VoxelWorld) -> void:
	var spots := [Vector2i(54, 30), Vector2i(60, 42), Vector2i(116, 56), Vector2i(20, 96)]
	for p in spots:
		var top := world.surface_height(p.x, p.y)
		if top < 0:
			continue
		world.fill_box(p.x, top, p.y, p.x + 1, top + 2, p.y + 1, BlockIds.STONE)
		world.fill_box(p.x + 3, top, p.y, p.x + 3, top + 4, p.y, BlockIds.STONE)
		world.fill_box(p.x + 3, top, p.y + 3, p.x + 3, top + 1, p.y + 3, BlockIds.BRICK)


static func _in_reserved(x: int, z: int) -> bool:
	var pad := 2
	var zones := [VILLAGE_RECT, OUTPOST_RECT, WAREHOUSE_RECT]
	for r in zones:
		if x >= r.position.x - pad and x < r.position.x + r.size.x + pad \
				and z >= r.position.y - pad and z < r.position.y + r.size.y + pad:
			return true
	for bx in BRIDGE_XS:
		if x >= bx - 3 and x <= bx + 5 and absf(z - river_z(x)) <= 10.0:
			return true
	if absf(z - river_z(x)) <= 4.0:
		return true
	return Vector2(x, z).distance_to(HILL_A) < 5.0


static func _place_trees(world: VoxelWorld, rng: RandomNumberGenerator, forest: FastNoiseLite) -> void:
	for z in range(3, W - 3):
		for x in range(3, W - 3):
			if _in_reserved(x, z):
				continue
			var top := world.surface_height(x, z)
			if top < 0 or top >= 20:
				continue
			if world.get_block(x, top - 1, z) != BlockIds.GRASS:
				continue
			var f := forest.get_noise_2d(x, z)
			var chance := 0.012 + maxf(0.0, f) * maxf(0.0, f) * 0.24
			if rng.randf() > chance:
				continue
			_tree(world, rng, x, top, z)


static func _tree(world: VoxelWorld, rng: RandomNumberGenerator, x: int, top: int, z: int) -> void:
	var th := rng.randi_range(4, 6)
	for y in range(top, top + th):
		world.set_block(x, y, z, BlockIds.WOOD)
	var crown := top + th
	for ly in range(crown - 3, crown + 1):
		var r := 2 if ly < crown - 1 else 1
		for dz in range(-r, r + 1):
			for dx in range(-r, r + 1):
				if absi(dx) == r and absi(dz) == r and rng.randf() < 0.5:
					continue
				if world.get_block(x + dx, ly, z + dz) == BlockIds.AIR:
					world.set_block(x + dx, ly, z + dz, BlockIds.LEAVES)


static func _place_boulders(world: VoxelWorld, rng: RandomNumberGenerator) -> void:
	var placed := 0
	var attempts := 0
	while placed < 26 and attempts < 2000:
		attempts += 1
		var x := rng.randi_range(6, W - 8)
		var z := rng.randi_range(6, W - 8)
		if _in_reserved(x, z):
			continue
		var top := world.surface_height(x, z)
		if top < SEA + 2 or top > 22:
			continue
		var id := BlockIds.STONE if rng.randf() < 0.7 else BlockIds.GRAVEL
		world.fill_box(x, top, z, x + rng.randi_range(0, 1), top + rng.randi_range(0, 1), z + rng.randi_range(0, 1), id)
		placed += 1


static func _pick_spawns(world: VoxelWorld, rng: RandomNumberGenerator, wanted: int, min_gap: float) -> Array:
	var out: Array = []
	var attempts := 0
	while out.size() < wanted and attempts < 20000:
		attempts += 1
		var x := rng.randi_range(8, W - 9)
		var z := rng.randi_range(8, W - 9)
		if Vector2(x, z).distance_to(CENTER) > 44.0:
			continue
		if not _is_valid_spawn(world, x, z):
			continue
		var p := Vector3(x + 0.5, world.surface_height(x, z), z + 0.5)
		var too_close := false
		for other in out:
			if (other as Vector3).distance_to(p) < min_gap:
				too_close = true
				break
		if not too_close:
			out.append(p)
	return out


static func _is_valid_spawn(world: VoxelWorld, x: int, z: int) -> bool:
	var top := world.surface_height(x, z)
	if top < 0:
		return false
	var ground := world.get_block(x, top - 1, z)
	if ground == BlockIds.WATER or ground == BlockIds.AIR or ground == BlockIds.LEAVES:
		return false
	if world.get_block(x, top, z) != BlockIds.AIR or world.get_block(x, top + 1, z) != BlockIds.AIR \
			or world.get_block(x, top + 2, z) != BlockIds.AIR:
		return false
	for dz in range(-2, 3):
		for dx in range(-2, 3):
			var h := world.surface_height(x + dx, z + dz)
			if h < 0 or absi(h - top) > 1:
				return false
	return true


static func _landmarks(world: VoxelWorld) -> Array:
	var defs := [
		["Emerald Village", Vector2i(30, 47)],
		["Signal Outpost", Vector2i(98, 30)],
		["Warehouse Row", Vector2i(78, 95)],
		["Hilltop Tower", Vector2i(34, 30)],
		["River Bridge", Vector2i(48, 66)],
		["Old Ruins", Vector2i(56, 36)],
		["Eastern Bridge", Vector2i(96, 66)],
	]
	var out: Array = []
	for d in defs:
		var p: Vector2i = d[1]
		var y := world.surface_height(p.x, p.y)
		out.append({"name": d[0], "position": Vector3(p.x, maxi(y, 0), p.y)})
	return out
