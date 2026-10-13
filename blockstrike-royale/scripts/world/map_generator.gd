extends RefCounted
## Deterministic procedural map ("Ironridge Valley"). Same seed -> same map.
## Coordinates: x = east, y = up, z = south. Block (x,y,z) fills [x,x+1]x[y,y+1]x[z,z+1].
##
## Contents: rolling terrain, north-east mountains, a meandering river with a
## bridge on the road, a village with 4 houses and a well, a walled military base
## with watchtowers and a barracks, cubic forests and rock outcrops.

const BD := preload("res://scripts/world/block_defs.gd")

const SIZE := Vector3i(112, 40, 112)
const WATER_LEVEL := 9
const RIVER_HALF := 3.0
const ROAD_Z := 58
const VILLAGE_RECT := Rect2i(8, 28, 36, 28)
const VILLAGE_Y := 12
const BASE_RECT := Rect2i(80, 72, 26, 26)
const BASE_Y := 12
const BRIDGE_Y := 12

var size: Vector3i = SIZE
var blocks := PackedByteArray()
var heights := PackedInt32Array()
var surface := PackedInt32Array()
var reserved := PackedByteArray()
var spawn_points := PackedVector3Array()
var loot_points := PackedVector3Array()
var house_points := PackedVector3Array()
var base_center := Vector3(93, 13, 85)
var village_center := Vector3(26, 13, 40)
var bridge_center := Vector3.ZERO
var tree_count := 0

var _noise: FastNoiseLite
var _forest: FastNoiseLite
var _rng := RandomNumberGenerator.new()


func index_of(x: int, y: int, z: int) -> int:
	return (y * size.z + z) * size.x + x


func inside(x: int, y: int, z: int) -> bool:
	return x >= 0 and y >= 0 and z >= 0 and x < size.x and y < size.y and z < size.z


func get_block(x: int, y: int, z: int) -> int:
	if not inside(x, y, z):
		return BD.AIR
	return blocks[index_of(x, y, z)]


func set_block(x: int, y: int, z: int, id: int) -> void:
	if inside(x, y, z):
		blocks[index_of(x, y, z)] = id


func fill(x0: int, y0: int, z0: int, x1: int, y1: int, z1: int, id: int) -> void:
	for y in range(y0, y1 + 1):
		for z in range(z0, z1 + 1):
			for x in range(x0, x1 + 1):
				set_block(x, y, z, id)


func _column(x: int, z: int) -> int:
	return x + z * size.x


func river_center(z: float) -> float:
	return 62.0 + 7.0 * sin(z * 0.07) + 2.5 * sin(z * 0.21 + 1.3)


func generate(seed_value: int) -> void:
	_rng.seed = seed_value
	_noise = FastNoiseLite.new()
	_noise.seed = seed_value
	_noise.frequency = 0.035
	_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_noise.fractal_octaves = 3
	_forest = FastNoiseLite.new()
	_forest.seed = seed_value + 7
	_forest.frequency = 0.045
	_forest.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH

	blocks = PackedByteArray()
	blocks.resize(size.x * size.y * size.z)
	blocks.fill(0)
	heights = PackedInt32Array()
	heights.resize(size.x * size.z)
	reserved = PackedByteArray()
	reserved.resize(size.x * size.z)
	reserved.fill(0)

	for z in size.z:
		for x in size.x:
			heights[_column(x, z)] = _terrain_height(x, z)

	_flatten_rect(VILLAGE_RECT, VILLAGE_Y, 3)
	_flatten_rect(BASE_RECT, BASE_Y, 3)
	_carve_river()
	_fill_columns()
	_lay_road_and_bridge()
	_build_village()
	_build_base()
	_plant_forest()
	_scatter_rocks()
	_compute_surface()
	_compute_points()


func _terrain_height(x: int, z: int) -> int:
	var n: float = _noise.get_noise_2d(float(x), float(z))
	var h: float = 10.0 + n * 4.0
	var md: float = Vector2(x - 92, z - 22).length()
	var m: float = clampf(1.0 - md / 36.0, 0.0, 1.0)
	h += pow(m, 1.5) * 20.0
	return int(round(h))


func _flatten_rect(r: Rect2i, y: int, margin: int) -> void:
	for z in range(r.position.y - margin, r.end.y + margin):
		for x in range(r.position.x - margin, r.end.x + margin):
			if x < 0 or z < 0 or x >= size.x or z >= size.z:
				continue
			var dx: int = maxi(0, maxi(r.position.x - x, x - (r.end.x - 1)))
			var dz: int = maxi(0, maxi(r.position.y - z, z - (r.end.y - 1)))
			var dist: float = Vector2(dx, dz).length()
			var t: float = 1.0 - clampf(dist / float(margin + 1), 0.0, 1.0)
			var c := _column(x, z)
			heights[c] = int(round(lerpf(float(heights[c]), float(y), t)))
			if dist <= 0.0:
				reserved[c] = 1
			elif dist <= 3.0:
				reserved[c] = 1


func _carve_river() -> void:
	for z in size.z:
		var rc: float = river_center(float(z))
		for x in size.x:
			var d: float = absf(float(x) + 0.5 - rc)
			var c := _column(x, z)
			if d < RIVER_HALF:
				heights[c] = WATER_LEVEL - 2
			elif d < RIVER_HALF + 1.6:
				heights[c] = mini(heights[c], WATER_LEVEL)
			if d < RIVER_HALF + 3.0:
				reserved[c] = 1


func _fill_columns() -> void:
	for z in size.z:
		for x in size.x:
			var c := _column(x, z)
			var h: int = clampi(heights[c], 2, size.y - 4)
			heights[c] = h
			var top_block: int = BD.GRASS
			if h <= WATER_LEVEL + 1:
				top_block = BD.SAND
			elif h >= 26:
				top_block = BD.STONE
			for y in range(0, h + 1):
				var id: int = BD.STONE
				if y == h:
					id = top_block
				elif y >= h - 3:
					id = BD.DIRT
				set_block(x, y, z, id)
			for y in range(h + 1, WATER_LEVEL + 1):
				set_block(x, y, z, BD.WATER)


func _lay_road_and_bridge() -> void:
	var rc_bridge: float = river_center(float(ROAD_Z))
	bridge_center = Vector3(rc_bridge, BRIDGE_Y, ROAD_Z)
	var span: float = RIVER_HALF + 2.5
	for x in size.x:
		var dist_span: float = absf(float(x) + 0.5 - rc_bridge)
		var in_span: bool = dist_span <= span
		for z in range(ROAD_Z - 1, ROAD_Z + 2):
			var c := _column(x, z)
			var h_col: int = heights[c]
			var y_road: int = h_col
			if in_span:
				y_road = BRIDGE_Y
			elif dist_span < span + 6.0 and BRIDGE_Y > h_col:
				var t: float = 1.0 - (dist_span - span) / 6.0
				y_road = int(round(lerpf(float(h_col), float(BRIDGE_Y), clampf(t, 0.0, 1.0))))
			for y in range(h_col + 1, y_road):
				set_block(x, y, z, BD.COBBLE)
			set_block(x, y_road, z, BD.ROAD)
			if in_span:
				# clear anything above the deck so the bridge is walkable
				for y in range(y_road + 1, y_road + 4):
					set_block(x, y, z, BD.AIR)
			reserved[c] = 1
		# piers at both edges of the channel
		if absf(dist_span - (RIVER_HALF + 1.0)) < 0.6:
			for y in range(1, BRIDGE_Y):
				set_block(x, y, ROAD_Z, BD.COBBLE)
				set_block(x, y, ROAD_Z - 1, BD.COBBLE)
				set_block(x, y, ROAD_Z + 1, BD.COBBLE)
	# keep the river channel cleared of trees on the bridge approach
	for z in range(ROAD_Z - 4, ROAD_Z + 5):
		for x in range(int(rc_bridge) - 9, int(rc_bridge) + 10):
			if inside(x, BRIDGE_Y + 1, z):
				reserved[_column(x, z)] = 1


func _house(x0: int, z0: int, w: int, d: int) -> void:
	var g: int = VILLAGE_Y
	var floor_y: int = g + 1
	fill(x0, floor_y, z0, x0 + w - 1, floor_y, z0 + d - 1, BD.PLANKS)
	# walls: 3 high
	for y in range(floor_y + 1, floor_y + 4):
		for z in range(z0, z0 + d):
			for x in range(x0, x0 + w):
				var edge: bool = x == x0 or x == x0 + w - 1 or z == z0 or z == z0 + d - 1
				if edge:
					set_block(x, y, z, BD.BRICK)
	# door (south side) and windows
	var door_x: int = x0 + w / 2
	set_block(door_x, floor_y + 1, z0 + d - 1, BD.AIR)
	set_block(door_x, floor_y + 2, z0 + d - 1, BD.AIR)
	var mid_z: int = z0 + d / 2
	for y in [floor_y + 2]:
		set_block(x0, y, mid_z, BD.GLASS)
		set_block(x0 + w - 1, y, mid_z, BD.GLASS)
		set_block(x0 + 2, y, z0, BD.GLASS)
		set_block(x0 + w - 3, y, z0, BD.GLASS)
	# gable roof with ridge along z
	var roof_base: int = floor_y + 4
	for k in range(0, w / 2 + 1):
		var y: int = roof_base + k
		fill(x0 + k, y, z0 - 1, x0 + w - 1 - k, y, z0 + d, BD.ROOF)
	# furniture + interior loot
	set_block(x0 + 1, floor_y + 1, z0 + 1, BD.CRATE)
	house_points.append(Vector3(x0 + w / 2 + 0.5, floor_y + 1.0, mid_z + 0.5))


func _build_village() -> void:
	village_center = Vector3(VILLAGE_RECT.position.x + VILLAGE_RECT.size.x * 0.5, VILLAGE_Y + 1, VILLAGE_RECT.position.y + VILLAGE_RECT.size.y * 0.5)
	_house(10, 32, 9, 7)
	_house(23, 32, 9, 7)
	_house(10, 44, 9, 7)
	_house(23, 44, 9, 7)
	# well: cobble ring with an open centre
	var wx: int = 20
	var wz: int = 39
	fill(wx - 1, VILLAGE_Y + 1, wz - 1, wx + 1, VILLAGE_Y + 1, wz + 1, BD.COBBLE)
	set_block(wx, VILLAGE_Y + 1, wz, BD.WATER)
	# village path linking houses to the main road
	fill(25, VILLAGE_Y, 51, 27, VILLAGE_Y, 56, BD.ROAD)
	# market crates
	for p in [Vector3i(33, 13, 38), Vector3i(34, 13, 38), Vector3i(33, 13, 40), Vector3i(16, 13, 52)]:
		set_block(p.x, p.y, p.z, BD.CRATE)


func _build_base() -> void:
	var x0: int = BASE_RECT.position.x
	var z0: int = BASE_RECT.position.y
	var x1: int = BASE_RECT.end.x - 1
	var z1: int = BASE_RECT.end.y - 1
	var fy: int = BASE_Y + 1
	base_center = Vector3(93, fy, 85)
	# perimeter wall (3 high) with a gate on the west side
	for y in range(fy, fy + 3):
		for x in range(x0, x1 + 1):
			set_block(x, y, z0, BD.CONCRETE)
			set_block(x, y, z1, BD.CONCRETE)
		for z in range(z0, z1 + 1):
			set_block(x0, y, z, BD.CONCRETE)
			set_block(x1, y, z, BD.CONCRETE)
	for y in range(fy, fy + 2):
		for z in range(84, 87):
			set_block(x0, y, z, BD.AIR)
	# courtyard floor
	fill(x0 + 1, BASE_Y, z0 + 1, x1 - 1, BASE_Y, z1 - 1, BD.ROAD)
	# watchtowers in the four inner corners, stairs climb from the inside
	var towers := [Vector2i(82, 74), Vector2i(100, 74), Vector2i(82, 93), Vector2i(100, 93)]
	for t in towers:
		var tx: int = t.x
		var tz: int = t.y
		fill(tx + 1, fy, tz + 1, tx + 2, fy + 5, tz + 2, BD.CONCRETE)
		fill(tx, fy + 6, tz, tx + 3, fy + 6, tz + 3, BD.PLANKS)
		var going_east: bool = tx < 90
		for j in 6:
			var sx: int = tx + 4 + (5 - j) if going_east else tx - 1 - (5 - j)
			fill(sx, fy, tz + 1, sx, fy + j, tz + 2, BD.CRATE if j < 5 else BD.CONCRETE)
	# barracks with a metal roof
	var bx0: int = 86
	var bz0: int = 80
	var bx1: int = 96
	var bz1: int = 88
	for y in range(fy, fy + 4):
		for z in range(bz0, bz1 + 1):
			for x in range(bx0, bx1 + 1):
				if x == bx0 or x == bx1 or z == bz0 or z == bz1:
					set_block(x, y, z, BD.CONCRETE)
	set_block(90, fy, bz1, BD.AIR)
	set_block(90, fy + 1, bz1, BD.AIR)
	set_block(90, fy + 2, bz1, BD.AIR)
	set_block(91, fy, bz1, BD.AIR)
	set_block(91, fy + 1, bz1, BD.AIR)
	set_block(91, fy + 2, bz1, BD.AIR)
	fill(bx0, fy + 4, bz0, bx1, fy + 4, bz1, BD.METAL)
	set_block(bx0 + 2, fy, bz0 + 1, BD.GLASS)
	# sandbag barricades and crate stacks
	for x in range(88, 93):
		set_block(x, fy, 77, BD.SANDBAG)
		set_block(x, fy + 1, 77, BD.SANDBAG)
	for x in range(94, 99):
		set_block(x, fy, 92, BD.SANDBAG)
	for i in 14:
		var px: int = _rng.randi_range(x0 + 2, x1 - 2)
		var pz: int = _rng.randi_range(z0 + 2, z1 - 2)
		if px >= bx0 - 1 and px <= bx1 + 1 and pz >= bz0 - 1 and pz <= bz1 + 1:
			continue
		if px < 84 and pz < 80:
			continue
		var stack: int = _rng.randi_range(1, 3)
		for h in stack:
			set_block(px, fy + h, pz, BD.CRATE)
	# flag pole
	fill(93, fy, 74, 93, fy + 6, 74, BD.METAL)
	base_center = Vector3(93, fy, 85)
	house_points.append(Vector3(92.5, fy + 1.0, 83.5))


func _plant_forest() -> void:
	tree_count = 0
	for z in range(3, size.z - 3, 2):
		for x in range(3, size.x - 3, 2):
			var c := _column(x, z)
			if reserved[c] == 1:
				continue
			var h: int = heights[c]
			if h <= WATER_LEVEL + 1 or h > 24:
				continue
			var f: float = _forest.get_noise_2d(float(x), float(z))
			var p: float = 0.42 if f > -0.05 else 0.035
			if _rng.randf() > p:
				continue
			_tree(x, h + 1, z)
			tree_count += 1


func _tree(x: int, base_y: int, z: int) -> void:
	var trunk: int = _rng.randi_range(4, 6)
	var top: int = base_y + trunk - 1
	for y in range(base_y, top + 1):
		set_block(x, y, z, BD.LOG)
	for ly in range(top - 2, top + 2):
		var r: int = 2 if ly <= top - 1 else 1
		for dz in range(-r, r + 1):
			for dx in range(-r, r + 1):
				if r == 2 and absi(dx) == 2 and absi(dz) == 2:
					continue
				if dx == 0 and dz == 0 and ly <= top:
					continue
				if (dx != 0 or dz != 0) and _rng.randf() < 0.08:
					continue
				if get_block(x + dx, ly, z + dz) == BD.AIR:
					set_block(x + dx, ly, z + dz, BD.LEAVES)


func _scatter_rocks() -> void:
	for i in 26:
		var x: int = _rng.randi_range(4, size.x - 5)
		var z: int = _rng.randi_range(4, size.z - 5)
		var c := _column(x, z)
		if reserved[c] == 1:
			continue
		var h: int = heights[c]
		if h <= WATER_LEVEL + 1:
			continue
		for dz in range(0, 2):
			for dx in range(0, 3):
				var hh: int = 1 + (1 if (dx + dz) % 2 == 0 and _rng.randf() < 0.5 else 0)
				for dy in hh:
					if get_block(x + dx, h + 1 + dy, z + dz) == BD.AIR:
						set_block(x + dx, h + 1 + dy, z + dz, BD.STONE)


func _compute_surface() -> void:
	surface = PackedInt32Array()
	surface.resize(size.x * size.z)
	for z in size.z:
		for x in size.x:
			var top: int = 0
			for y in range(size.y - 1, -1, -1):
				if blocks[index_of(x, y, z)] != BD.AIR:
					top = y
					break
			surface[_column(x, z)] = top


func top_block(x: int, z: int) -> int:
	return get_block(x, surface[_column(x, z)], z)


func _compute_points() -> void:
	spawn_points = PackedVector3Array()
	var tries := 0
	while spawn_points.size() < 16 and tries < 6000:
		tries += 1
		var x: int = _rng.randi_range(4, size.x - 5)
		var z: int = _rng.randi_range(4, size.z - 5)
		var p := _ground_spot(x, z)
		if p == Vector3.INF:
			continue
		var ok := true
		for q in spawn_points:
			if Vector2(q.x - p.x, q.z - p.z).length() < 22.0:
				ok = false
				break
		if ok:
			spawn_points.append(p)
	loot_points = PackedVector3Array()
	tries = 0
	while loot_points.size() < 150 and tries < 9000:
		tries += 1
		var x2: int = _rng.randi_range(3, size.x - 4)
		var z2: int = _rng.randi_range(3, size.z - 4)
		var p2 := _ground_spot(x2, z2)
		if p2 == Vector3.INF:
			continue
		var ok2 := true
		for q in loot_points:
			if Vector2(q.x - p2.x, q.z - p2.z).length() < 6.0:
				ok2 = false
				break
		if ok2:
			loot_points.append(p2)
	for hp in house_points:
		loot_points.append(hp)


## Returns a standing position on dry ground, or Vector3.INF when unsuitable.
func _ground_spot(x: int, z: int) -> Vector3:
	var top: int = surface[_column(x, z)]
	var id: int = get_block(x, top, z)
	if id != BD.GRASS and id != BD.SAND and id != BD.ROAD and id != BD.PLANKS:
		return Vector3.INF
	for dy in range(1, 4):
		if get_block(x, top + dy, z) != BD.AIR:
			return Vector3.INF
	return Vector3(x + 0.5, top + 1.0, z + 0.5)


func build_minimap() -> Image:
	var img := Image.create(size.x, size.z, false, Image.FORMAT_RGB8)
	for z in size.z:
		for x in size.x:
			var top: int = surface[_column(x, z)]
			var id: int = get_block(x, top, z)
			var col: Color = BD.color_of(id)
			var relief: float = 0.75 + 0.25 * float(top) / float(size.y)
			img.set_pixel(x, z, Color(col.r * relief, col.g * relief, col.b * relief))
	return img
