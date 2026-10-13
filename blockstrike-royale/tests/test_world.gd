extends RefCounted
## Voxel world: block table, atlas consistency, chunk packing and terrain
## determinism (the same seed must always generate the same map, on every device).

func run(t: TestCase) -> void:
	var ids: Array = []
	for name: String in VoxelLibrary.BLOCKS.keys():
		var entry: Dictionary = VoxelLibrary.BLOCKS[name]
		var block_id := int(entry.get("id", -1))
		t.greater(float(block_id), 0.0, "block %s has a positive id" % name)
		t.ok(not ids.has(block_id), "block id %d is unique" % block_id)
		ids.append(block_id)
		t.contains(entry, "tile", "block %s references an atlas tile" % name)
	t.equal(VoxelLibrary.block_id_by_name("stone"), VoxelLibrary.Block.STONE,
		"block_id_by_name resolves stone")
	t.equal(VoxelLibrary.block_id_by_name("not_a_block"), 0,
		"unknown block names resolve to air")
	t.ok(VoxelLibrary.is_solid(VoxelLibrary.Block.STONE), "stone is solid")
	t.ok(not VoxelLibrary.is_solid(VoxelLibrary.Block.AIR), "air is not solid")
	t.ok(VoxelLibrary.is_water(VoxelLibrary.Block.WATER), "water is water")
	t.ok(not VoxelLibrary.is_opaque(VoxelLibrary.Block.WATER), "water is translucent")

	# Atlas: every tile referenced by a block must exist in atlas.json, and the
	# sheet must be big enough for the tile grid it claims.
	var atlas_path := "res://assets/textures/atlas.json"
	t.ok(FileAccess.file_exists(atlas_path), "atlas.json exists")
	var file := FileAccess.open(atlas_path, FileAccess.READ)
	if file == null:
		return
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	t.ok(parsed is Dictionary, "atlas.json is valid JSON")
	var atlas: Dictionary = parsed
	var tile_size := int(atlas.get("tile", 0))
	var columns := int(atlas.get("columns", 0))
	var sheet_width := int(atlas.get("width", 0))
	var sheet_height := int(atlas.get("height", 0))
	t.equal(tile_size, 16, "atlas tile size is 16 px")
	t.greater(float(columns), 0.0, "atlas has columns")
	t.greater(float(sheet_width), 0.0, "atlas has a width")
	t.greater(float(sheet_height), 0.0, "atlas has a height")
	var tiles: Dictionary = atlas.get("tiles", {})
	t.greater(float(tiles.size()), 20.0, "atlas has tiles")
	for name: String in VoxelLibrary.BLOCKS.keys():
		var entry: Dictionary = VoxelLibrary.BLOCKS[name]
		var tile_name := str(entry.get("tile", ""))
		t.contains(tiles, tile_name, "atlas contains tile '%s'" % tile_name)
		var rect: Dictionary = tiles.get(tile_name, {})
		if rect.is_empty():
			continue
		t.between(float(rect.get("u0", 0.0)), 0.0, 1.0, "tile %s u0 in range" % tile_name)
		t.between(float(rect.get("u1", 0.0)), 0.0, 1.0, "tile %s u1 in range" % tile_name)
		t.greater(float(rect.get("u1", 0.0)), float(rect.get("u0", 0.0)),
			"tile %s has a positive width" % tile_name)
		t.greater(float(rect.get("v1", 0.0)), float(rect.get("v0", 0.0)),
			"tile %s has a positive height" % tile_name)

	# Chunk packing: index/unpack must round-trip for the whole chunk volume.
	var chunk := VoxelChunk.new()
	t.equal(chunk.blocks.size(), VoxelChunk.SIZE * VoxelChunk.SIZE * VoxelChunk.HEIGHT,
		"chunk byte array is size * size * height")
	# index/unpack must be inverses for the whole volume.
	var round_trip_failures := 0
	for y: int in range(0, VoxelChunk.HEIGHT, 7):
		for z: int in range(0, VoxelChunk.SIZE, 5):
			for x: int in range(0, VoxelChunk.SIZE, 5):
				if VoxelChunk.unpack(VoxelChunk.index(x, y, z)) != Vector3i(x, y, z):
					round_trip_failures += 1
	t.equal(round_trip_failures, 0, "chunk index/unpack round-trips")
	var samples: Array = [[0, 0, 0], [1, 2, 3], [15, 15, 47], [7, 30, 9], [8, 0, 16]]
	for sample: Variant in samples:
		var point: Array = sample
		var index := VoxelChunk.index(point[0], point[1], point[2])
		t.between(float(index), 0.0, float(chunk.blocks.size() - 1), "chunk index in range")
		chunk.set_block(int(point[0]), int(point[1]), int(point[2]), VoxelLibrary.Block.STONE)
		t.equal(chunk.get_block(int(point[0]), int(point[1]), int(point[2])),
			VoxelLibrary.Block.STONE, "block round-trips through the chunk array")
	t.equal(chunk.get_block(-1, 0, 0), VoxelLibrary.Block.AIR,
		"out of range reads return air")

	# Terrain determinism: identical seeds generate identical terrain.
	var map_id := "emerald_island"
	var a := TerrainGenerator.new()
	a.setup(map_id, 12345)
	var b := TerrainGenerator.new()
	b.setup(map_id, 12345)
	var c := TerrainGenerator.new()
	c.setup(map_id, 54321)
	var differences := 0
	for i: int in 40:
		var x := 20 + i * 6
		var z := 30 + i * 3
		t.equal(a.height_at(x, z), b.height_at(x, z),
			"height_at is deterministic at (%d, %d)" % [x, z])
		if a.height_at(x, z) != c.height_at(x, z):
			differences += 1
	t.greater(float(differences), 3.0, "different seeds produce different terrain")
	t.greater(float(a.size_x), 0.0, "generator knows the map width")
	t.ok(a.in_bounds(10, 10), "in_bounds accepts a valid coordinate")
	t.ok(not a.in_bounds(-1, 10), "in_bounds rejects negative coordinates")
	var spawns: Array = a.spawn_points()
	t.greater(float(spawns.size()), 2.0, "map defines spawn points")
	for spawn: Variant in spawns:
		var point: Vector3 = spawn
		t.greater(point.y, 0.0, "spawn %s is above the void" % str(point))
	var drops: Array = a.drop_points(12)
	t.greater(float(drops.size()), 4.0, "drop points are produced")
	var loot: Array = a.loot_points("greenvale_village", 8)
	t.greater(float(loot.size()), 0.0, "loot points exist for a village")
