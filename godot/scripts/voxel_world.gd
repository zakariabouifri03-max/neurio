extends Node3D
## A compact authored arena: forest, village, river, bridge, mountains and a military base.
## Large surfaces use a few meshes while details remain modular cubic pieces.

signal loot_created(pickup: Node3D)

const WORLD_SIZE := 150.0
const GROUND_COLOR := Color("#4b8b55")
const GRASS_LIGHT := Color("#6cae5d")
const ROAD_COLOR := Color("#3e5260")
const ROAD_LINE := Color("#f4d35e")
const WATER_COLOR := Color("#35b7c9")
const BLOCK_LIMIT := 80

var zone_ring: MeshInstance3D
var zone_radius := 68.0
var loot_nodes: Array[Node3D] = []
var build_nodes: Array[Node3D] = []
var rng := RandomNumberGenerator.new()

func build(seed_value: int = 2407) -> void:
	rng.seed = seed_value
	_build_terrain()
	_build_roads_and_river()
	_build_mountains()
	_build_forest()
	_build_village()
	_build_military_base()
	_build_spawn_pad()
	_build_zone_ring()
	_build_loot()

func _build_terrain() -> void:
	BlockFactory.cube(self, Vector3(0, -2.0, 0), Vector3(WORLD_SIZE, 4.0, WORLD_SIZE), GROUND_COLOR, true, "WorldGround")
	# Chunk seams and small grass tiles sell the voxel scale without hundreds of bodies.
	for x in range(-7, 8):
		for z in range(-7, 8):
			if (x + z) % 3 == 0:
				BlockFactory.cube(self, Vector3(x * 10.0 + 0.4, 0.06, z * 10.0 - 0.25), Vector3(9.6, 0.12, 9.6), GRASS_LIGHT, false, "GrassTile")
	# Shoreline stones at the river edges.
	for x in range(-7, 8):
		BlockFactory.cube(self, Vector3(x * 10.0, 0.35, -28.0), Vector3(8.0, 0.65, 1.8), Color("#a7c49a"), false, "ShoreBlock")
		BlockFactory.cube(self, Vector3(x * 10.0, 0.35, -8.0), Vector3(8.0, 0.65, 1.8), Color("#a7c49a"), false, "ShoreBlock")

func _build_roads_and_river() -> void:
	# Main road grid.
	BlockFactory.cube(self, Vector3(0, 0.17, 22), Vector3(9.5, 0.18, 104), ROAD_COLOR, false, "NorthSouthRoad")
	BlockFactory.cube(self, Vector3(-7, 0.19, 14), Vector3(135, 0.2, 8.0), ROAD_COLOR, false, "EastWestRoad")
	for z in range(-26, 69, 8):
		BlockFactory.cube(self, Vector3(0, 0.3, z), Vector3(0.45, 0.04, 3.5), ROAD_LINE, false, "RoadMarker")
	for x in range(-62, 64, 12):
		BlockFactory.cube(self, Vector3(x, 0.32, 14), Vector3(5.0, 0.04, 0.42), ROAD_LINE, false, "RoadMarker")
	# River runs east/west; water is a flat voxel slab with a glowing edge.
	var water := BlockFactory.cube(self, Vector3(0, 0.16, -18), Vector3(142, 0.16, 19.0), WATER_COLOR, false, "River")
	water.material_override = BlockFactory.transparent_material(WATER_COLOR, 0.78, Color("#185d91"))
	# Chunky bridge deck and two side rails.
	for x in range(-8, 9):
		BlockFactory.cube(self, Vector3(x * 4.2, 0.72, -18), Vector3(3.75, 0.45, 20), Color("#9b6947"), true, "BridgePlank")
	BlockFactory.cube(self, Vector3(0, 2.0, -27.0), Vector3(75, 0.45, 0.45), Color("#d09a59"), true, "BridgeRail")
	BlockFactory.cube(self, Vector3(0, 2.0, -9.0), Vector3(75, 0.45, 0.45), Color("#d09a59"), true, "BridgeRail")

func _build_mountains() -> void:
	_add_mountain(Vector3(-59, 0, -56), 5, Color("#526b76"))
	_add_mountain(Vector3(54, 0, -55), 6, Color("#4d6270"))
	_add_mountain(Vector3(-58, 0, 58), 4, Color("#5d7a69"))
	_add_mountain(Vector3(58, 0, 58), 5, Color("#49665f"))

func _add_mountain(origin: Vector3, levels: int, color: Color) -> void:
	for level in range(levels):
		var width := float((levels - level) * 8 + 8)
		var height := 4.0
		var y := height * 0.5 + level * height
		BlockFactory.cube(self, origin + Vector3(0, y, 0), Vector3(width, height, width), color.lightened(levels * 0.025), true, "MountainBlock")
		if level % 2 == 0:
			BlockFactory.cube(self, origin + Vector3(width * 0.3, y + 0.15, width * 0.12), Vector3(width * 0.35, height + 0.1, width * 0.28), color.darkened(0.06), false, "MountainFace")

func _build_forest() -> void:
	var positions := [
		Vector3(-48, 0, 28), Vector3(-55, 0, 40), Vector3(-43, 0, 50), Vector3(-30, 0, 54),
		Vector3(29, 0, 44), Vector3(42, 0, 53), Vector3(50, 0, 38), Vector3(59, 0, 27),
		Vector3(-48, 0, -39), Vector3(-37, 0, -48), Vector3(29, 0, -43), Vector3(44, 0, -34),
		Vector3(51, 0, -23), Vector3(-28, 0, 37), Vector3(27, 0, 31)
	]
	for i in positions.size():
		_add_tree(positions[i], 2 + (i % 3), i % 2 == 0)

func _add_tree(pos: Vector3, height: int, pine: bool) -> void:
	var trunk_color := Color("#70452f") if not pine else Color("#584738")
	BlockFactory.cube(self, pos + Vector3(0, height * 1.1, 0), Vector3(1.5, height * 2.2, 1.5), trunk_color, true, "TreeTrunk")
	var leaf_color := Color("#2c965b") if not pine else Color("#246b58")
	for level in range(height):
		var width := 5.6 - float(level) * 0.55
		BlockFactory.cube(self, pos + Vector3(0, height * 1.5 + level * 1.2, 0), Vector3(width, 1.7, width), leaf_color.lightened((level % 2) * 0.06), false, "TreeCanopy")
	BlockFactory.cube(self, pos + Vector3(1.4, height * 1.9, 0.3), Vector3(1.0, 1.1, 1.0), leaf_color.lightened(0.12), false, "LeafAccent")

func _build_village() -> void:
	for i in range(4):
		var p := Vector3(-42 + (i % 2) * 13, 0, 20 + (i / 2) * 16)
		_add_house(p, i % 2 == 0)
	BlockFactory.label_billboard(self, Vector3(-42, 7, 11), "CEDAR VILLAGE", Color("#e9fff7"))
	# A little market square.
	BlockFactory.cube(self, Vector3(-41, 0.3, 28), Vector3(17, 0.25, 9), Color("#a9835a"), false, "MarketSquare")
	for x in [-47.0, -42.0, -37.0]:
		BlockFactory.cube(self, Vector3(x, 3.0, 28), Vector3(0.35, 5.5, 0.35), Color("#714936"), false, "MarketPost")
		BlockFactory.cube(self, Vector3(x, 5.7, 28), Vector3(4.4, 0.3, 3.0), Color("#e76f51"), false, "MarketCanopy")

func _add_house(pos: Vector3, blue_roof: bool) -> void:
	var wall := Color("#d8b384") if blue_roof else Color("#c77b5b")
	var roof := Color("#315d83") if blue_roof else Color("#7d3e39")
	BlockFactory.cube(self, pos + Vector3(0, 2.1, 0), Vector3(9.0, 4.2, 7.0), wall, true, "VillageHouse")
	BlockFactory.cube(self, pos + Vector3(0, 4.6, 0), Vector3(10.0, 1.2, 8.0), roof, false, "VillageRoof")
	BlockFactory.cube(self, pos + Vector3(0, 5.5, 0), Vector3(7.0, 0.65, 5.0), roof.lightened(0.08), false, "VillageRoofTop")
	BlockFactory.cube(self, pos + Vector3(0, 1.45, 3.57), Vector3(1.7, 2.6, 0.25), Color("#4f3428"), false, "VillageDoor")
	for x in [-2.5, 2.5]:
		BlockFactory.cube(self, pos + Vector3(x, 2.5, 3.58), Vector3(1.25, 1.1, 0.2), Color("#75cfe0"), false, "VillageWindow")

func _build_military_base() -> void:
	var base := Vector3(39, 0, -42)
	BlockFactory.cube(self, base + Vector3(0, 0.16, 0), Vector3(34, 0.28, 24), Color("#536274"), false, "BasePad")
	for x in [-17.0, 17.0]:
		for z in [-12.0, 12.0]:
			_add_watchtower(base + Vector3(x, 0, z))
	# Fence posts and rails.
	for x in range(-16, 17, 4):
		BlockFactory.cube(self, base + Vector3(x, 1.2, -12), Vector3(0.35, 2.4, 0.35), Color("#263849"), true, "FencePost")
		BlockFactory.cube(self, base + Vector3(x, 1.2, 12), Vector3(0.35, 2.4, 0.35), Color("#263849"), true, "FencePost")
	for z in range(-8, 9, 4):
		BlockFactory.cube(self, base + Vector3(-17, 1.2, z), Vector3(0.35, 2.4, 0.35), Color("#263849"), true, "FencePost")
		BlockFactory.cube(self, base + Vector3(17, 1.2, z), Vector3(0.35, 2.4, 0.35), Color("#263849"), true, "FencePost")
	BlockFactory.cube(self, base + Vector3(0, 1.1, -12), Vector3(34, 0.22, 0.22), Color("#89a1aa"), false, "FenceRail")
	BlockFactory.cube(self, base + Vector3(0, 1.1, 12), Vector3(34, 0.22, 0.22), Color("#89a1aa"), false, "FenceRail")
	BlockFactory.cube(self, base + Vector3(-17, 1.1, 0), Vector3(0.22, 0.22, 24), Color("#89a1aa"), false, "FenceRail")
	BlockFactory.cube(self, base + Vector3(17, 1.1, 0), Vector3(0.22, 0.22, 24), Color("#89a1aa"), false, "FenceRail")
	# Barracks, command block, crates and glowing beacon.
	BlockFactory.cube(self, base + Vector3(0, 2.2, 1), Vector3(14, 4.4, 7), Color("#6e7d84"), true, "Barracks")
	BlockFactory.cube(self, base + Vector3(0, 4.8, 1), Vector3(15, 0.7, 8), Color("#354a55"), false, "BarracksRoof")
	BlockFactory.cube(self, base + Vector3(-8, 1.4, -7), Vector3(3, 2.8, 3), Color("#c28b45"), true, "SupplyCrate")
	BlockFactory.cube(self, base + Vector3(10, 1.4, 7), Vector3(3, 2.8, 3), Color("#c28b45"), true, "SupplyCrate")
	BlockFactory.cylinder(self, base + Vector3(0, 5.2, -7), 1.0, 7.0, Color("#56e0c1"), false, "Beacon")
	BlockFactory.label_billboard(self, base + Vector3(0, 9, 0), "OUTPOST 07", Color("#a9fff1"))

func _add_watchtower(pos: Vector3) -> void:
	BlockFactory.cube(self, pos + Vector3(0, 3.0, 0), Vector3(2.0, 6.0, 2.0), Color("#354a55"), true, "Watchtower")
	BlockFactory.cube(self, pos + Vector3(0, 6.4, 0), Vector3(4.5, 0.6, 4.5), Color("#8a9aa0"), true, "WatchtowerDeck")
	BlockFactory.cube(self, pos + Vector3(0, 8.2, 0), Vector3(4.7, 3.0, 4.7), Color("#526673"), true, "WatchtowerCabin")
	BlockFactory.cube(self, pos + Vector3(0, 10.2, 0), Vector3(5.2, 0.25, 5.2), Color("#263849"), false, "WatchtowerRoof")

func _build_spawn_pad() -> void:
	BlockFactory.cube(self, Vector3(0, 0.25, 37), Vector3(13, 0.35, 13), Color("#263849"), false, "SpawnPad")
	for i in range(4):
		var angle := TAU * float(i) / 4.0
		var p := Vector3(cos(angle) * 5.0, 0.6, 37 + sin(angle) * 5.0)
		BlockFactory.cube(self, p, Vector3(1.8, 0.35, 1.8), Color("#39d6c2"), false, "SpawnLight")
	BlockFactory.label_billboard(self, Vector3(0, 4.2, 37), "DROP ZONE", Color("#d9fff7"))

func _build_zone_ring() -> void:
	zone_ring = MeshInstance3D.new()
	zone_ring.name = "SafeZoneRing"
	var torus := TorusMesh.new()
	torus.inner_radius = 0.96
	torus.outer_radius = 1.0
	torus.rings = 64
	torus.ring_segments = 6
	zone_ring.mesh = torus
	zone_ring.material_override = BlockFactory.transparent_material(Color("#53f5d0"), 0.74, Color("#27d3b2"))
	zone_ring.position = Vector3(0, 0.45, 0)
	zone_ring.scale = Vector3(zone_radius, 1.0, zone_radius)
	add_child(zone_ring)
	BlockFactory.label_billboard(self, Vector3(0, 3.0, -zone_radius), "SAFE ZONE", Color("#b4fff1"))

func _build_loot() -> void:
	var loot_data := [
		[Vector3(-20, 1.0, 22), "ammo", "AMMO"], [Vector3(18, 1.0, 28), "armor", "ARMOR"],
		[Vector3(-14, 1.0, -1), "medkit", "MEDKIT"], [Vector3(27, 1.0, -43), "ammo", "AMMO"],
		[Vector3(-35, 1.0, -34), "medkit", "MEDKIT"], [Vector3(5, 1.0, 55), "armor", "ARMOR"],
	]
	var pickup_script = load("res://scripts/pickup.gd")
	for data in loot_data:
		var pickup = pickup_script.new()
		pickup.setup(data[1], data[2])
		pickup.position = data[0]
		add_child(pickup)
		loot_nodes.append(pickup)
		loot_created.emit(pickup)

func update_zone(radius: float) -> void:
	zone_radius = radius
	if is_instance_valid(zone_ring):
		zone_ring.scale = Vector3(radius, 1.0, radius)

func reset_match_objects() -> void:
	for pickup in loot_nodes:
		if is_instance_valid(pickup):
			pickup.free()
	loot_nodes.clear()
	_build_loot()
	for block in build_nodes:
		if is_instance_valid(block):
			var collision := get_node_or_null("%sCollision" % block.name)
			if is_instance_valid(collision):
				collision.free()
			block.free()
	build_nodes.clear()

func add_build_block(world_position: Vector3, color: Color = Color("#77b7aa")) -> bool:
	if build_nodes.size() >= BLOCK_LIMIT:
		return false
	var snapped := Vector3(round(world_position.x / 2.0) * 2.0, round(world_position.y / 2.0) * 2.0 + 1.0, round(world_position.z / 2.0) * 2.0)
	if snapped.y < 1.0 or abs(snapped.x) > 68 or abs(snapped.z) > 68:
		return false
	for existing in build_nodes:
		if is_instance_valid(existing) and existing.position.distance_to(snapped) < 1.0:
			return false
	var block := BlockFactory.cube(self, snapped, Vector3(2, 2, 2), color, true, "BuildBlock")
	build_nodes.append(block)
	return true
