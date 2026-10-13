class_name VoxelWorld
extends RefCounted
## Voxel storage (column-major bytes), collision, raycasts and block edits.
## Used identically by clients, hosts and the headless dedicated server.

const CHUNK := 16
const BUILD_BLOCK_HP := 140
const MAX_BUILD_HEIGHT_ABOVE_GROUND := 14

var sx := 0
var sy := 0
var sz := 0
var data := PackedByteArray()
var ground := PackedInt32Array()   # per column: terrain height (solid below)
var top := PackedInt32Array()      # per column: highest non-air y + 1
var water_level := 0
var map_id := ""
var built_hp := {}                 # voxel index -> remaining hp (player built blocks)
var dirty := {}                    # Vector2i(chunk x, chunk z) -> true
var loot_spots: Array = []         # [Vector3 pos, int tier]
var spawns := {}                   # name -> Array[Vector3]
var pois: Array = []               # {name, pos: Vector2, r, tier}
var dummies: Array = []            # training dummy positions
var supply_ok := true
var solid := PackedByteArray()
var opaque := PackedByteArray()

func setup(x: int, y: int, z: int) -> void:
	sx = x
	sy = y
	sz = z
	data = PackedByteArray()
	ground.resize(sx * sz)
	top.resize(sx * sz)
	ground.fill(0)
	top.fill(0)
	solid = Blocks.solid_table()
	opaque = Blocks.opaque_table()

func chunks_x() -> int:
	return (sx + CHUNK - 1) / CHUNK

func chunks_z() -> int:
	return (sz + CHUNK - 1) / CHUNK

func in_bounds(x: int, y: int, z: int) -> bool:
	return x >= 0 and z >= 0 and y >= 0 and x < sx and z < sz and y < sy

func get_b(x: int, y: int, z: int) -> int:
	if y < 0:
		return Blocks.BEDROCK
	if y >= sy:
		return Blocks.AIR
	if x < 0 or z < 0 or x >= sx or z >= sz:
		return Blocks.BARRIER
	return data[(x * sz + z) * sy + y]

func opq(x: int, y: int, z: int) -> int:
	if y < 0:
		return 1
	if y >= sy:
		return 0
	if x < 0 or z < 0 or x >= sx or z >= sz:
		return 1
	return opaque[data[(x * sz + z) * sy + y]]

func is_solid_at(x: int, y: int, z: int) -> bool:
	return solid[get_b(x, y, z)] == 1

## Raw write used by generators (keeps column metadata roughly up to date).
func set_b(x: int, y: int, z: int, id: int) -> void:
	if x < 0 or z < 0 or y < 0 or x >= sx or z >= sz or y >= sy:
		return
	data[(x * sz + z) * sy + y] = id
	if id != Blocks.AIR:
		var c := x * sz + z
		if y + 1 > top[c]:
			top[c] = y + 1

## Runtime edit: marks chunks for remeshing.
func set_block(x: int, y: int, z: int, id: int) -> void:
	if not in_bounds(x, y, z):
		return
	set_b(x, y, z, id)
	var i := (x * sz + z) * sy + y
	if id == Blocks.BUILD:
		built_hp[i] = BUILD_BLOCK_HP
	else:
		built_hp.erase(i)
	var cx := x >> 4
	var cz := z >> 4
	dirty[Vector2i(cx, cz)] = true
	var lx := x & 15
	var lz := z & 15
	if lx == 0 and cx > 0:
		dirty[Vector2i(cx - 1, cz)] = true
	if lx == 15 and cx < chunks_x() - 1:
		dirty[Vector2i(cx + 1, cz)] = true
	if lz == 0 and cz > 0:
		dirty[Vector2i(cx, cz - 1)] = true
	if lz == 15 and cz < chunks_z() - 1:
		dirty[Vector2i(cx, cz + 1)] = true

func voxel_index(x: int, y: int, z: int) -> int:
	return (x * sz + z) * sy + y

## Damage a player-built block. Returns true when it breaks.
func damage_block(x: int, y: int, z: int, dmg: int) -> bool:
	if get_b(x, y, z) != Blocks.BUILD:
		return false
	var i := voxel_index(x, y, z)
	var hp: int = built_hp.get(i, BUILD_BLOCK_HP) - dmg
	if hp <= 0:
		set_block(x, y, z, Blocks.AIR)
		return true
	built_hp[i] = hp
	return false

func ground_y(x: int, z: int) -> int:
	if x < 0 or z < 0 or x >= sx or z >= sz:
		return 0
	return ground[x * sz + z]

func top_y(x: int, z: int) -> int:
	if x < 0 or z < 0 or x >= sx or z >= sz:
		return 0
	return top[x * sz + z]

## Highest standable surface at or below `from_y` in a column.
func surface_below(x: int, z: int, from_y: int) -> int:
	var y := mini(from_y, sy - 1)
	while y > 0:
		if solid[get_b(x, y - 1, z)] == 1 and solid[get_b(x, y, z)] == 0 and solid[get_b(x, y + 1, z)] == 0:
			return y
		y -= 1
	return ground_y(x, z)

func column_top_solid(x: int, z: int) -> int:
	var y := top_y(x, z) - 1
	while y >= 0:
		var b := get_b(x, y, z)
		if solid[b] == 1:
			return y + 1
		y -= 1
	return 0

# ------------------------------------------------------------------ collision
func box_hits(minx: float, miny: float, minz: float, maxx: float, maxy: float, maxz: float) -> bool:
	var x0 := floori(minx)
	var x1 := floori(maxx - 0.0001)
	var y0 := floori(miny)
	var y1 := floori(maxy - 0.0001)
	var z0 := floori(minz)
	var z1 := floori(maxz - 0.0001)
	for x in range(x0, x1 + 1):
		for z in range(z0, z1 + 1):
			for y in range(y0, y1 + 1):
				if solid[get_b(x, y, z)] == 1:
					return true
	return false

func box_free(p: Vector3, hw: float, h: float) -> bool:
	return not box_hits(p.x - hw, p.y, p.z - hw, p.x + hw, p.y + h, p.z + hw)

## Moves a feet-centred box. Returns [new_pos, hit_flags(Vector3i)].
func move_box(pos: Vector3, hw: float, h: float, motion: Vector3) -> Array:
	var biggest := maxf(absf(motion.x), maxf(absf(motion.y), absf(motion.z)))
	var steps := maxi(1, ceili(biggest / 0.4))
	var st := motion / float(steps)
	var hit := Vector3i.ZERO
	var p := pos
	for i in steps:
		if st.y != 0.0 and hit.y == 0:
			var ny := p.y + st.y
			if box_hits(p.x - hw, ny, p.z - hw, p.x + hw, ny + h, p.z + hw):
				if st.y < 0.0:
					ny = floorf(ny) + 1.0
				else:
					ny = floorf(ny + h) - h - 0.001
				if box_hits(p.x - hw, ny, p.z - hw, p.x + hw, ny + h, p.z + hw):
					ny = p.y
				hit.y = -1 if st.y < 0.0 else 1
			p.y = ny
		if st.x != 0.0 and hit.x == 0:
			var nx := p.x + st.x
			if box_hits(nx - hw, p.y, p.z - hw, nx + hw, p.y + h, p.z + hw):
				if st.x > 0.0:
					nx = floorf(nx + hw) - hw - 0.001
				else:
					nx = floorf(nx - hw) + 1.0 + hw + 0.001
				if box_hits(nx - hw, p.y, p.z - hw, nx + hw, p.y + h, p.z + hw):
					nx = p.x
				hit.x = 1
			p.x = nx
		if st.z != 0.0 and hit.z == 0:
			var nz := p.z + st.z
			if box_hits(p.x - hw, p.y, nz - hw, p.x + hw, p.y + h, nz + hw):
				if st.z > 0.0:
					nz = floorf(nz + hw) - hw - 0.001
				else:
					nz = floorf(nz - hw) + 1.0 + hw + 0.001
				if box_hits(p.x - hw, p.y, nz - hw, p.x + hw, p.y + h, nz + hw):
					nz = p.z
				hit.z = 1
			p.z = nz
	return [p, hit]

func in_water(p: Vector3) -> bool:
	return get_b(floori(p.x), floori(p.y + 0.4), floori(p.z)) == Blocks.WATER

# ------------------------------------------------------------------ raycast (Amanatides & Woo DDA)
## Returns {} when nothing solid is hit, else {pos: Vector3i, normal: Vector3i, dist: float, point: Vector3, block: int}
func raycast(origin: Vector3, dir: Vector3, max_dist: float) -> Dictionary:
	if dir.length_squared() < 1e-8:
		return {}
	dir = dir.normalized()
	var x := floori(origin.x)
	var y := floori(origin.y)
	var z := floori(origin.z)
	var stx := 1 if dir.x > 0.0 else -1
	var sty := 1 if dir.y > 0.0 else -1
	var stz := 1 if dir.z > 0.0 else -1
	var tdx := absf(1.0 / dir.x) if dir.x != 0.0 else INF
	var tdy := absf(1.0 / dir.y) if dir.y != 0.0 else INF
	var tdz := absf(1.0 / dir.z) if dir.z != 0.0 else INF
	var tmx := ((x + 1 - origin.x) if dir.x > 0.0 else (origin.x - x)) * tdx if dir.x != 0.0 else INF
	var tmy := ((y + 1 - origin.y) if dir.y > 0.0 else (origin.y - y)) * tdy if dir.y != 0.0 else INF
	var tmz := ((z + 1 - origin.z) if dir.z > 0.0 else (origin.z - z)) * tdz if dir.z != 0.0 else INF
	var t := 0.0
	var n := Vector3i.ZERO
	var guard := 0
	while t <= max_dist and guard < 2048:
		guard += 1
		if x < 0 or z < 0 or x >= sx or z >= sz:
			return {}
		if y >= sy and sty > 0:
			return {}
		var b := get_b(x, y, z)
		if b != Blocks.AIR and b != Blocks.WATER and b != Blocks.BARRIER and solid[b] == 1:
			return {"pos": Vector3i(x, y, z), "normal": n, "dist": t, "point": origin + dir * t, "block": b}
		if tmx < tmy and tmx < tmz:
			x += stx
			t = tmx
			tmx += tdx
			n = Vector3i(-stx, 0, 0)
		elif tmy < tmz:
			y += sty
			t = tmy
			tmy += tdy
			n = Vector3i(0, -sty, 0)
		else:
			z += stz
			t = tmz
			tmz += tdz
			n = Vector3i(0, 0, -stz)
	return {}

func line_of_sight(a: Vector3, b: Vector3) -> bool:
	var d := b - a
	var dist := d.length()
	if dist < 0.01:
		return true
	var hit := raycast(a, d / dist, dist)
	return hit.is_empty() or float(hit["dist"]) >= dist - 0.15

## Can a build block go at this cell? (caller also checks actors)
func can_build_at(c: Vector3i) -> bool:
	if not in_bounds(c.x, c.y, c.z):
		return false
	if get_b(c.x, c.y, c.z) != Blocks.AIR and get_b(c.x, c.y, c.z) != Blocks.WATER:
		return false
	if c.y > ground_y(c.x, c.z) + MAX_BUILD_HEIGHT_ABOVE_GROUND or c.y >= sy - 2:
		return false
	# must touch something solid
	for d in [Vector3i(1, 0, 0), Vector3i(-1, 0, 0), Vector3i(0, 1, 0), Vector3i(0, -1, 0), Vector3i(0, 0, 1), Vector3i(0, 0, -1)]:
		var q: Vector3i = c + d
		if solid[get_b(q.x, q.y, q.z)] == 1 and get_b(q.x, q.y, q.z) != Blocks.BARRIER:
			return true
	return false

func random_land_point(rng: RandomNumberGenerator, center: Vector2, radius: float) -> Vector3:
	for i in 40:
		var a := rng.randf() * TAU
		var r := sqrt(rng.randf()) * radius
		var x := clampi(int(center.x + cos(a) * r), 2, sx - 3)
		var z := clampi(int(center.y + sin(a) * r), 2, sz - 3)
		var g := ground_y(x, z)
		if g > water_level and get_b(x, g, z) == Blocks.AIR:
			var y := column_top_solid(x, z)
			return Vector3(x + 0.5, y, z + 0.5)
	return Vector3(center.x, ground_y(int(center.x), int(center.y)) + 1, center.y)
