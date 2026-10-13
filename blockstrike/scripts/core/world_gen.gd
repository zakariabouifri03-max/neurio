class_name WorldGen
extends RefCounted
## Deterministic map generators. Every peer generates the identical world from the map id,
## so only block edits travel over the network.

const B = preload("res://scripts/core/blocks.gd")
const UNDER := {1: 2, 4: 4, 19: 3, 3: 3, 16: 3, 17: 3, 18: 3, 12: 3, 33: 2, 2: 2, 8: 2, 21: 3, 20: 20, 13: 3, 30: 3, 31: 3, 29: 2}

static func generate(map_id: String) -> VoxelWorld:
	Blocks.setup()
	var info: Dictionary = DB.MAPS.get(map_id, DB.MAPS["cubic_isle"])
	var w := VoxelWorld.new()
	w.map_id = map_id
	w.setup(int(info["size"]), int(info["height"]), int(info["size"]))
	var rng := RandomNumberGenerator.new()
	rng.seed = int(info["seed"])
	match map_id:
		"clash_town":
			_gen_town(w, rng)
		"arena_blocks":
			_gen_arena(w, rng)
		"training_ground":
			_gen_training(w, rng)
		_:
			_gen_island(w, rng)
	return w

# ------------------------------------------------------------------ column allocation
## Builds the voxel array column by column from templates (fast: append_array is native).
static func _alloc(w: VoxelWorld, heights: PackedInt32Array, surf: PackedByteArray) -> void:
	var cache := {}
	var data := PackedByteArray()
	for x in w.sx:
		for z in w.sz:
			var c := x * w.sz + z
			var h := clampi(heights[c], 1, w.sy - 2)
			var s := int(surf[c])
			var key := h * 256 + s
			var col: PackedByteArray = cache.get(key, PackedByteArray())
			if col.is_empty():
				col.resize(w.sy)
				col.fill(B.AIR)
				var under: int = UNDER.get(s, B.STONE)
				for y in h:
					if y == 0:
						col[y] = B.BEDROCK
					elif y == h - 1:
						col[y] = s
					elif y >= h - 4:
						col[y] = under
					else:
						col[y] = B.STONE
				for y in range(h, w.water_level):
					col[y] = B.WATER
				cache[key] = col
			data.append_array(col)
			w.ground[c] = h
			w.top[c] = maxi(h, w.water_level)
	w.data = data

static func _box(w: VoxelWorld, x0: int, y0: int, z0: int, x1: int, y1: int, z1: int, id: int) -> void:
	for x in range(mini(x0, x1), maxi(x0, x1) + 1):
		for z in range(mini(z0, z1), maxi(z0, z1) + 1):
			for y in range(mini(y0, y1), maxi(y0, y1) + 1):
				w.set_b(x, y, z, id)

static func _walls(w: VoxelWorld, x0: int, y0: int, z0: int, x1: int, y1: int, z1: int, id: int) -> void:
	for x in range(x0, x1 + 1):
		for y in range(y0, y1 + 1):
			w.set_b(x, y, z0, id)
			w.set_b(x, y, z1, id)
	for z in range(z0, z1 + 1):
		for y in range(y0, y1 + 1):
			w.set_b(x0, y, z, id)
			w.set_b(x1, y, z, id)

static func _set_ground_block(w: VoxelWorld, x: int, z: int, id: int) -> void:
	var g := w.ground_y(x, z)
	w.set_b(x, g - 1, z, id)

# ------------------------------------------------------------------ props
static func _oak(w: VoxelWorld, x: int, y: int, z: int, rng: RandomNumberGenerator) -> void:
	var th := rng.randi_range(4, 6)
	for i in th:
		w.set_b(x, y + i, z, B.LOG)
	var ty := y + th
	for dy in range(-2, 2):
		var r := 2 if dy < 0 else 1
		for dx in range(-r, r + 1):
			for dz in range(-r, r + 1):
				if absi(dx) == r and absi(dz) == r and (dy == 1 or rng.randf() < 0.45):
					continue
				if w.get_b(x + dx, ty + dy, z + dz) == B.AIR:
					w.set_b(x + dx, ty + dy, z + dz, B.LEAVES)
	w.set_b(x, ty + 1, z, B.LEAVES)

static func _pine(w: VoxelWorld, x: int, y: int, z: int, rng: RandomNumberGenerator) -> void:
	var th := rng.randi_range(6, 9)
	for i in th:
		w.set_b(x, y + i, z, B.LOG)
	var layer := 0
	for yy in range(y + 2, y + th + 2):
		var r := clampi((th + 2 - (yy - y)) / 2, 0, 3)
		if layer % 2 == 1:
			r = maxi(0, r - 1)
		for dx in range(-r, r + 1):
			for dz in range(-r, r + 1):
				if absi(dx) + absi(dz) > r + 1:
					continue
				if w.get_b(x + dx, yy, z + dz) == B.AIR:
					w.set_b(x + dx, yy, z + dz, B.PINE_LEAVES)
		layer += 1
	w.set_b(x, y + th + 1, z, B.PINE_LEAVES)
	w.set_b(x, y + th + 2, z, B.PINE_LEAVES)

static func _boulder(w: VoxelWorld, x: int, y: int, z: int, rng: RandomNumberGenerator) -> void:
	var id := B.MOSSY if rng.randf() < 0.4 else B.STONE
	for dx in range(-1, 2):
		for dz in range(-1, 2):
			for dy in range(0, 2):
				if rng.randf() < 0.7 - dy * 0.3:
					w.set_b(x + dx, y + dy, z + dz, id)

## House with door, windows, hip roof, optional second floor + stairs. Registers loot spots.
static func _house(w: VoxelWorld, x0: int, z0: int, wd: int, dp: int, fy: int, style: int, door: int, rng: RandomNumberGenerator, tier: int) -> void:
	var wall: int = [B.PLANKS, B.BRICK, B.CONCRETE, B.COBBLE, B.SANDSTONE][style % 5]
	var roof: int = [B.ROOF_RED, B.ROOF_BLUE, B.DARK_PLANKS, B.ROOF_RED, B.SANDSTONE][style % 5]
	var x1 := x0 + wd - 1
	var z1 := z0 + dp - 1
	var floors := 2 if (wd >= 9 and dp >= 8 and rng.randf() < 0.45) else 1
	# foundation + floor
	for x in range(x0, x1 + 1):
		for z in range(z0, z1 + 1):
			for y in range(w.ground_y(x, z) - 1, fy):
				w.set_b(x, y, z, B.COBBLE)
			w.set_b(x, fy - 1, z, B.PLANKS)
			for y in range(fy, fy + 4 * floors + 1):
				w.set_b(x, y, z, B.AIR)
	var wh := 4 * floors
	_walls(w, x0, fy, z0, x1, fy + wh - 1, z1, wall)
	for y in range(fy, fy + wh):
		w.set_b(x0, y, z0, B.LOG)
		w.set_b(x1, y, z0, B.LOG)
		w.set_b(x0, y, z1, B.LOG)
		w.set_b(x1, y, z1, B.LOG)
	# windows
	for f in floors:
		var wy := fy + f * 4 + 1
		for x in range(x0 + 2, x1 - 1, 3):
			w.set_b(x, wy, z0, B.GLASS)
			w.set_b(x, wy + 1, z0, B.GLASS)
			w.set_b(x, wy, z1, B.GLASS)
			w.set_b(x, wy + 1, z1, B.GLASS)
		for z in range(z0 + 2, z1 - 1, 3):
			w.set_b(x0, wy, z, B.GLASS)
			w.set_b(x0, wy + 1, z, B.GLASS)
			w.set_b(x1, wy, z, B.GLASS)
			w.set_b(x1, wy + 1, z, B.GLASS)
	# door (2 wide, 3 high) on chosen side: 0=-z 1=+z 2=-x 3=+x
	var mx := (x0 + x1) / 2
	var mz := (z0 + z1) / 2
	for y in range(fy, fy + 3):
		match door:
			0:
				w.set_b(mx, y, z0, B.AIR)
				w.set_b(mx + 1, y, z0, B.AIR)
			1:
				w.set_b(mx, y, z1, B.AIR)
				w.set_b(mx + 1, y, z1, B.AIR)
			2:
				w.set_b(x0, y, mz, B.AIR)
				w.set_b(x0, y, mz + 1, B.AIR)
			_:
				w.set_b(x1, y, mz, B.AIR)
				w.set_b(x1, y, mz + 1, B.AIR)
	# second floor with stair hole along the -z wall
	if floors == 2:
		for x in range(x0 + 1, x1):
			for z in range(z0 + 1, z1):
				w.set_b(x, fy + 4 - 1 + 1, z, B.PLANKS)
		for i in 4:
			var sx := x0 + 2 + i
			w.set_b(sx, fy + 4, z0 + 1, B.AIR)
			w.set_b(sx, fy + 4, z0 + 2, B.AIR)
			for y in range(fy, fy + i + 1):
				w.set_b(sx, y, z0 + 1, B.DARK_PLANKS)
				w.set_b(sx, y, z0 + 2, B.DARK_PLANKS)
		w.set_b(x0 + 6, fy + 4, z0 + 1, B.AIR)
		w.set_b(x0 + 6, fy + 4, z0 + 2, B.AIR)
		w.loot_spots.append([Vector3(x1 - 1.5, fy + 5, z1 - 1.5), tier])
		w.loot_spots.append([Vector3(x0 + 2.5, fy + 5, z1 - 1.5), tier])
	# roof (hip roof stepping inwards)
	var ry := fy + wh
	var k := 0
	while x0 - 1 + k <= x1 + 1 - k and z0 - 1 + k <= z1 + 1 - k:
		for x in range(x0 - 1 + k, x1 + 2 - k):
			for z in range(z0 - 1 + k, z1 + 2 - k):
				var edge := x == x0 - 1 + k or x == x1 + 1 - k or z == z0 - 1 + k or z == z1 + 1 - k
				if edge or k > 0:
					w.set_b(x, ry + k, z, roof)
				elif k == 0:
					w.set_b(x, ry, z, B.PLANKS)
		k += 1
		if k > 6:
			break
	# interior props + loot
	w.set_b(x1 - 1, fy, z0 + 1, B.CRATE)
	w.loot_spots.append([Vector3(mx + 0.5, fy, mz + 0.5), tier])
	w.loot_spots.append([Vector3(x0 + 1.5, fy, z1 - 1.5), tier])
	if rng.randf() < 0.6:
		w.loot_spots.append([Vector3(x1 - 1.5, fy, z1 - 1.5), tier])

static func _tower(w: VoxelWorld, x: int, z: int, gy: int, h: int, mat: int, tier: int) -> void:
	# 3x3 core with platform 5x5, sandbag rail, external stairs on +x side
	for dx in range(-1, 2):
		for dz in range(-1, 2):
			for y in range(gy - 1, gy + h):
				w.set_b(x + dx, y, z + dz, mat)
	for dx in range(-2, 3):
		for dz in range(-2, 3):
			w.set_b(x + dx, gy + h, z + dz, B.PLANKS)
			if absi(dx) == 2 or absi(dz) == 2:
				w.set_b(x + dx, gy + h + 1, z + dz, B.SANDBAG)
	for i in h:
		var sx := x + 3 + (h - 1 - i)
		for y in range(gy - 1, gy + i + 1):
			w.set_b(sx, y, z, B.DARK_PLANKS)
			w.set_b(sx, y, z + 1, B.DARK_PLANKS)
	w.set_b(x + 2, gy + h + 1, z, B.AIR)
	w.set_b(x + 2, gy + h + 1, z + 1, B.AIR)
	for dx in range(-2, 3):
		w.set_b(x + dx, gy + h + 4, z - 2, B.CAMO)
		w.set_b(x + dx, gy + h + 4, z + 2, B.CAMO)
	for c in [Vector2i(-2, -2), Vector2i(2, -2), Vector2i(-2, 2), Vector2i(2, 2)]:
		for y in range(gy + h + 1, gy + h + 4):
			w.set_b(x + c.x, y, z + c.y, B.LOG)
	for dx in range(-2, 3):
		for dz in range(-2, 3):
			w.set_b(x + dx, gy + h + 4, z + dz, B.CAMO)
	w.loot_spots.append([Vector3(x + 0.5, gy + h + 1, z - 0.5), tier])

static func _car(w: VoxelWorld, x: int, y: int, z: int, along_x: bool, col: int) -> void:
	var lx := 4 if along_x else 2
	var lz := 2 if along_x else 4
	_box(w, x, y, z, x + lx - 1, y, z + lz - 1, col)
	if along_x:
		_box(w, x + 1, y + 1, z, x + 2, y + 1, z + 1, B.GLASS)
	else:
		_box(w, x, y + 1, z + 1, x + 1, y + 1, z + 2, B.GLASS)

static func _camo_net(w: VoxelWorld, x: int, z: int, gy: int) -> void:
	for c in [Vector2i(0, 0), Vector2i(4, 0), Vector2i(0, 4), Vector2i(4, 4)]:
		for y in range(gy, gy + 3):
			w.set_b(x + c.x, y, z + c.y, B.LOG)
	_box(w, x, gy + 3, z, x + 4, gy + 3, z + 4, B.CAMO)

static func _sandbags(w: VoxelWorld, x: int, z: int, gy: int, along_x: bool, n: int) -> void:
	for i in n:
		var px := x + (i if along_x else 0)
		var pz := z + (0 if along_x else i)
		w.set_b(px, gy, pz, B.SANDBAG)
		if i % 3 != 1:
			w.set_b(px, gy + 1, pz, B.SANDBAG)

# ------------------------------------------------------------------ helpers for polylines
static func _dist_seg(p: Vector2, a: Vector2, b: Vector2) -> float:
	var ab := b - a
	var t := clampf((p - a).dot(ab) / maxf(ab.length_squared(), 0.0001), 0.0, 1.0)
	return p.distance_to(a + ab * t)

static func _dist_poly(p: Vector2, pts: Array) -> float:
	var best := 1e9
	for i in pts.size() - 1:
		best = minf(best, _dist_seg(p, pts[i], pts[i + 1]))
	return best

# ------------------------------------------------------------------ CUBIC ISLE (battle royale)
static func _gen_island(w: VoxelWorld, rng: RandomNumberGenerator) -> void:
	var S := w.sx
	w.water_level = 12
	var n_coast := FastNoiseLite.new()
	n_coast.seed = 11
	n_coast.frequency = 0.012
	var n_hill := FastNoiseLite.new()
	n_hill.seed = 22
	n_hill.frequency = 0.018
	n_hill.fractal_octaves = 3
	var n_ridge := FastNoiseLite.new()
	n_ridge.seed = 33
	n_ridge.frequency = 0.02
	n_ridge.fractal_type = FastNoiseLite.FRACTAL_RIDGED
	n_ridge.fractal_octaves = 3
	var n_forest := FastNoiseLite.new()
	n_forest.seed = 44
	n_forest.frequency = 0.025
	var sc := float(S) / 256.0
	var river := [Vector2(96, -10), Vector2(104, 40), Vector2(97, 82), Vector2(104, 118), Vector2(99, 152), Vector2(86, 190), Vector2(70, 232), Vector2(62, 270)]
	for i in river.size():
		river[i] *= sc
	var pois := [
		{"name": "Pinewood", "pos": Vector2(58, 62) * sc, "r": 20.0 * sc, "tier": 0, "kind": "village", "style": 0, "houses": 5},
		{"name": "Riverside", "pos": Vector2(132, 128) * sc, "r": 22.0 * sc, "tier": 1, "kind": "village", "style": 1, "houses": 6},
		{"name": "Sandport", "pos": Vector2(60, 198) * sc, "r": 20.0 * sc, "tier": 0, "kind": "village", "style": 4, "houses": 5},
		{"name": "Hilltop", "pos": Vector2(150, 58) * sc, "r": 16.0 * sc, "tier": 1, "kind": "village", "style": 3, "houses": 4},
		{"name": "Fort Cobalt", "pos": Vector2(196, 156) * sc, "r": 27.0 * sc, "tier": 2, "kind": "base"},
		{"name": "Old Farm", "pos": Vector2(146, 206) * sc, "r": 22.0 * sc, "tier": 0, "kind": "farm"},
		{"name": "Peak Lookout", "pos": Vector2(204, 74) * sc, "r": 7.0 * sc, "tier": 1, "kind": "tower"},
	]
	var roads := [[0, 1], [1, 2], [1, 4], [1, 5], [0, 3], [3, 1], [4, 5], [2, 5]]
	var mountain := Vector2(200, 70) * sc
	var desert := Vector2(52, 200) * sc
	var hf := PackedFloat32Array()
	hf.resize(S * S)
	for x in S:
		for z in S:
			var dx := (x - S * 0.5) / (S * 0.5)
			var dz := (z - S * 0.5) / (S * 0.5)
			var r := sqrt(dx * dx + dz * dz) + n_coast.get_noise_2d(x, z) * 0.12
			var island := 1.0 - smoothstep(0.58, 0.93, r)
			var hills := n_hill.get_noise_2d(x, z) * 0.5 + 0.5
			var h := 6.0 + island * (9.0 + hills * 9.0)
			var md := Vector2(x, z).distance_to(mountain) / (S * 0.5)
			var mfac := smoothstep(0.55, 0.05, md) * island
			h += mfac * (8.0 + (1.0 - absf(n_ridge.get_noise_2d(x, z))) * 22.0)
			var rd := _dist_poly(Vector2(x, z), river)
			if rd < 8.0:
				h = lerpf(h, w.water_level - 2.6, smoothstep(8.0, 3.0, rd))
			hf[x * S + z] = h
	# flatten POIs
	for p in pois:
		var c: Vector2 = p["pos"]
		var r: float = p["r"]
		var sum := 0.0
		var cnt := 0
		for x in range(int(c.x - r), int(c.x + r)):
			for z in range(int(c.y - r), int(c.y + r)):
				if x >= 0 and z >= 0 and x < S and z < S:
					sum += hf[x * S + z]
					cnt += 1
		var target := maxf(sum / maxf(cnt, 1), w.water_level + 2.0)
		if p["kind"] == "tower":
			target = maxf(target, w.water_level + 6.0)
		p["y"] = int(round(target))
		for x in range(int(c.x - r * 1.5), int(c.x + r * 1.5)):
			for z in range(int(c.y - r * 1.5), int(c.y + r * 1.5)):
				if x < 0 or z < 0 or x >= S or z >= S:
					continue
				var d := Vector2(x, z).distance_to(c)
				var blend := smoothstep(r * 1.5, r * 0.95, d)
				hf[x * S + z] = lerpf(hf[x * S + z], target, blend)
	# roads (smoothed height corridor) and bridges
	var surf := PackedByteArray()
	surf.resize(S * S)
	var mask := PackedByteArray()
	mask.resize(S * S)
	var bridges := {}
	for rd in roads:
		var a: Vector2 = pois[rd[0]]["pos"]
		var b: Vector2 = pois[rd[1]]["pos"]
		var len := a.distance_to(b)
		var n := int(len * 2.0)
		var samples := []
		for i in n + 1:
			var p := a.lerp(b, float(i) / n)
			p += Vector2(-(b - a).y, (b - a).x).normalized() * sin(float(i) / n * PI) * 6.0
			samples.append(p)
		var heights := []
		for p in samples:
			var px := clampi(int(p.x), 0, S - 1)
			var pz := clampi(int(p.y), 0, S - 1)
			heights.append(hf[px * S + pz])
		for i in samples.size():
			var acc := 0.0
			var cn := 0
			for j in range(maxi(0, i - 14), mini(samples.size(), i + 15)):
				acc += maxf(heights[j], w.water_level + 1.5)
				cn += 1
			var rh := acc / cn
			var p: Vector2 = samples[i]
			for ox in range(-2, 3):
				for oz in range(-2, 3):
					var x := int(p.x) + ox
					var z := int(p.y) + oz
					if x < 1 or z < 1 or x >= S - 1 or z >= S - 1:
						continue
					if Vector2(x + 0.5, z + 0.5).distance_to(p) > 2.1:
						continue
					var ci := x * S + z
					if hf[ci] < w.water_level + 0.5 and _dist_poly(Vector2(x, z), river) < 9.0:
						bridges[ci] = int(round(rh))
						continue
					hf[ci] = rh
					mask[ci] = 1
					surf[ci] = B.ASPHALT
	# surfaces
	var heights_i := PackedInt32Array()
	heights_i.resize(S * S)
	for x in S:
		for z in S:
			var ci := x * S + z
			var h := int(round(hf[ci]))
			heights_i[ci] = h
			if mask[ci] == 1:
				continue
			var s := B.GRASS
			var slope := 0.0
			if x > 0 and z > 0 and x < S - 1 and z < S - 1:
				slope = maxf(absf(hf[ci + S] - hf[ci - S]), absf(hf[ci + 1] - hf[ci - 1]))
			if h <= w.water_level + 1:
				s = B.SAND
			elif Vector2(x, z).distance_to(desert) < 46.0 * sc + n_coast.get_noise_2d(z, x) * 10.0:
				s = B.SAND
			elif h > 33:
				s = B.SNOW
			elif slope > 3.2:
				s = B.STONE
			elif h > 28 and slope > 1.6:
				s = B.GRAVEL
			surf[ci] = s
	_alloc(w, heights_i, surf)
	# bridges
	for ci in bridges:
		var x: int = ci / S
		var z: int = ci % S
		var by := maxi(int(bridges[ci]), w.water_level + 1)
		w.set_b(x, by - 1, z, B.PLANKS)
		for y in range(by, by + 3):
			w.set_b(x, y, z, B.AIR)
		var edge := false
		for d in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
			var nci: int = (x + d.x) * S + (z + d.y)
			if not bridges.has(nci) and mask[nci] == 0 and heights_i[nci] <= w.water_level:
				edge = true
		if edge:
			w.set_b(x, by, z, B.LOG)
		if (x + z) % 5 == 0:
			for y in range(w.ground_y(x, z), by - 1):
				w.set_b(x, y, z, B.LOG)
		mask[ci] = 1
	# POI structures
	for p in pois:
		var prng := RandomNumberGenerator.new()
		prng.seed = hash(p["name"])
		var c: Vector2 = p["pos"]
		var gy: int = p["y"]
		w.pois.append({"name": p["name"], "pos": c, "r": p["r"], "tier": p["tier"]})
		match p["kind"]:
			"village":
				_village(w, c, gy, p, prng, mask)
			"base":
				_military_base(w, c, gy, prng, mask)
			"farm":
				_farm(w, c, gy, prng, mask)
			"tower":
				_tower(w, int(c.x), int(c.y), gy, 7, B.LOG, 1)
				_mark(mask, S, c, 5.0)
	# trees, boulders, scattered loot
	var occupied := {}
	for x in range(3, S - 3):
		for z in range(3, S - 3):
			var ci := x * S + z
			if mask[ci] != 0:
				continue
			var s := w.get_b(x, w.ground_y(x, z) - 1, z)
			var gy := w.ground_y(x, z)
			if w.get_b(x, gy, z) != B.AIR:
				continue
			var forest := n_forest.get_noise_2d(x, z) * 0.5 + 0.5
			var chance := 0.0
			if s == B.GRASS:
				chance = 0.004 + pow(forest, 3.0) * 0.09
			elif s == B.SNOW or s == B.GRAVEL:
				chance = 0.012
			elif s == B.SAND and gy > w.water_level + 2:
				chance = 0.0015
			if chance > 0.0 and rng.randf() < chance:
				var key := Vector2i(x / 3, z / 3)
				if occupied.has(key):
					continue
				occupied[key] = true
				if s == B.SNOW or s == B.GRAVEL or z < 95 * sc or gy > 24:
					_pine(w, x, gy, z, rng)
				else:
					_oak(w, x, gy, z, rng)
			elif (s == B.GRASS or s == B.STONE) and rng.randf() < 0.0018:
				_boulder(w, x, gy, z, rng)
	for i in 70:
		var p := w.random_land_point(rng, Vector2(S * 0.5, S * 0.5), S * 0.4)
		w.loot_spots.append([p, 0])
	w.spawns["center"] = [Vector3(S * 0.5, 40, S * 0.5)]

static func _mark(mask: PackedByteArray, S: int, c: Vector2, r: float) -> void:
	for x in range(int(c.x - r), int(c.x + r) + 1):
		for z in range(int(c.y - r), int(c.y + r) + 1):
			if x >= 0 and z >= 0 and x < S and z < S:
				mask[x * S + z] = 2

static func _village(w: VoxelWorld, c: Vector2, gy: int, p: Dictionary, rng: RandomNumberGenerator, mask: PackedByteArray) -> void:
	var placed: Array[Rect2i] = []
	var n: int = p["houses"]
	var r: float = p["r"]
	var tries := 0
	while placed.size() < n and tries < 120:
		tries += 1
		var a := rng.randf() * TAU
		var d := rng.randf_range(r * 0.25, r * 0.85)
		var wd := rng.randi_range(7, 11)
		var dp := rng.randi_range(6, 9)
		var x0 := int(c.x + cos(a) * d) - wd / 2
		var z0 := int(c.y + sin(a) * d) - dp / 2
		var rect := Rect2i(x0 - 2, z0 - 2, wd + 4, dp + 4)
		var ok := x0 > 3 and z0 > 3 and x0 + wd < w.sx - 3 and z0 + dp < w.sz - 3
		for o in placed:
			if o.intersects(rect):
				ok = false
		if not ok:
			continue
		placed.append(rect)
		var to_c := c - Vector2(x0 + wd * 0.5, z0 + dp * 0.5)
		var door := 0
		if absf(to_c.x) > absf(to_c.y):
			door = 3 if to_c.x > 0 else 2
		else:
			door = 1 if to_c.y > 0 else 0
		_house(w, x0, z0, wd, dp, gy, int(p["style"]) + (placed.size() % 2), door, rng, int(p["tier"]))
		for x in range(rect.position.x, rect.end.x):
			for z in range(rect.position.y, rect.end.y):
				if x >= 0 and z >= 0 and x < w.sx and z < w.sz:
					mask[x * w.sz + z] = 2
	# plaza: well + lamps
	var cx := int(c.x)
	var cz := int(c.y)
	_walls(w, cx - 1, gy, cz - 1, cx + 1, gy, cz + 1, B.COBBLE)
	w.set_b(cx, gy - 1, cz, B.WATER)
	for l in [Vector2i(-4, -4), Vector2i(4, 4)]:
		for y in range(gy, gy + 3):
			w.set_b(cx + l.x, y, cz + l.y, B.LOG)
		w.set_b(cx + l.x, gy + 3, cz + l.y, B.LAMP)
	_mark(mask, w.sx, c, 5.0)
	w.loot_spots.append([Vector3(cx + 2.5, gy, cz + 0.5), int(p["tier"])])

static func _military_base(w: VoxelWorld, c: Vector2, gy: int, rng: RandomNumberGenerator, mask: PackedByteArray) -> void:
	var cx := int(c.x)
	var cz := int(c.y)
	var hs := 21
	_mark(mask, w.sx, c, hs + 3)
	for x in range(cx - hs, cx + hs + 1):
		for z in range(cz - hs, cz + hs + 1):
			w.set_b(x, gy - 1, z, B.GRAVEL)
			for y in range(gy, gy + 8):
				if w.get_b(x, y, z) != B.AIR:
					w.set_b(x, y, z, B.AIR)
	# perimeter wall with gates
	_walls(w, cx - hs, gy, cz - hs, cx + hs, gy + 2, cz + hs, B.CONCRETE)
	for x in range(cx - hs, cx + hs + 1):
		w.set_b(x, gy + 3, cz - hs, B.METAL if x % 2 == 0 else B.AIR)
		w.set_b(x, gy + 3, cz + hs, B.METAL if x % 2 == 0 else B.AIR)
	for y in range(gy, gy + 3):
		for o in range(-2, 3):
			w.set_b(cx - hs, y, cz + o, B.AIR)
			w.set_b(cx + o, y, cz + hs, B.AIR)
			w.set_b(cx + o, y, cz - hs, B.AIR)
	# corner watchtowers
	for t in [Vector2i(-hs + 3, -hs + 3), Vector2i(hs - 6, -hs + 3), Vector2i(-hs + 3, hs - 3), Vector2i(hs - 6, hs - 3)]:
		_tower(w, cx + t.x, cz + t.y, gy, 6, B.METAL, 2)
	# hangar
	var hx := cx + 3
	var hz := cz - 14
	_walls(w, hx, gy, hz, hx + 13, gy + 5, hz + 10, B.METAL)
	_box(w, hx, gy + 6, hz, hx + 13, gy + 6, hz + 10, B.CONCRETE)
	_box(w, hx + 4, gy, hz + 10, hx + 9, gy + 4, hz + 10, B.AIR)
	_box(w, hx + 2, gy, hz + 2, hx + 3, gy + 1, hz + 3, B.CRATE)
	_box(w, hx + 10, gy, hz + 2, hx + 11, gy, hz + 3, B.CRATE)
	for i in 4:
		w.loot_spots.append([Vector3(hx + 3.5 + i * 2.5, gy, hz + 6.5), 2])
	# barracks
	for b in 2:
		var bx := cx - 16 + b * 13
		var bz := cz + 5
		_walls(w, bx, gy, bz, bx + 9, gy + 3, bz + 7, B.CONCRETE)
		_box(w, bx, gy + 4, bz, bx + 9, gy + 4, bz + 7, B.METAL)
		_box(w, bx + 4, gy, bz, bx + 5, gy + 2, bz, B.AIR)
		for x in range(bx + 2, bx + 8, 3):
			w.set_b(x, gy + 1, bz + 7, B.GLASS)
			w.set_b(x, gy + 2, bz + 7, B.GLASS)
		w.loot_spots.append([Vector3(bx + 2.5, gy, bz + 4.5), 2])
		w.loot_spots.append([Vector3(bx + 7.5, gy, bz + 4.5), 2])
		w.loot_spots.append([Vector3(bx + 5.0, gy + 5, bz + 4.0), 1])
	# yard cover: crates, sandbags, camo nets, helipad
	for i in 10:
		var px := cx + rng.randi_range(-hs + 4, hs - 4)
		var pz := cz + rng.randi_range(-4, 3)
		if w.get_b(px, gy, pz) == B.AIR:
			w.set_b(px, gy, pz, B.CRATE)
			if rng.randf() < 0.4:
				w.set_b(px, gy + 1, pz, B.CRATE)
	_sandbags(w, cx - 8, cz - 3, gy, true, 6)
	_sandbags(w, cx + 2, cz + 1, gy, true, 6)
	_camo_net(w, cx - 14, cz - 13, gy)
	_camo_net(w, cx - 6, cz - 13, gy)
	w.loot_spots.append([Vector3(cx - 11.5, gy, cz - 10.5), 2])
	w.loot_spots.append([Vector3(cx - 3.5, gy, cz - 10.5), 2])
	_box(w, cx + 8, gy - 1, cz + 6, cx + 16, gy - 1, cz + 14, B.CONCRETE)
	for l in [Vector2i(8, 6), Vector2i(16, 6), Vector2i(8, 14), Vector2i(16, 14)]:
		w.set_b(cx + l.x, gy - 1, cz + l.y, B.LAMP)
	for y in range(gy, gy + 7):
		w.set_b(cx, y, cz + 2, B.LOG)
	_box(w, cx + 1, gy + 5, cz + 2, cx + 3, gy + 6, cz + 2, B.TEAM_BLUE)

static func _farm(w: VoxelWorld, c: Vector2, gy: int, rng: RandomNumberGenerator, mask: PackedByteArray) -> void:
	var cx := int(c.x)
	var cz := int(c.y)
	_mark(mask, w.sx, c, 22.0)
	# barn
	var bx := cx - 6
	var bz := cz - 14
	_house(w, bx, bz, 11, 9, gy, 2, 1, rng, 0)
	# fields with hay bales and fences
	for fx in range(cx - 18, cx + 18):
		for fz in range(cz - 2, cz + 16):
			var edge := fx == cx - 18 or fx == cx + 17 or fz == cz - 2 or fz == cz + 15
			if edge:
				if (fx + fz) % 2 == 0 and not (fz == cz - 2 and absi(fx - cx) < 2):
					w.set_b(fx, gy, fz, B.LOG)
			else:
				w.set_b(fx, gy - 1, fz, B.FARMLAND if (fz % 4) != 0 else B.WATER)
	for i in 8:
		var hx := cx + rng.randi_range(-15, 14)
		var hz := cz + rng.randi_range(1, 13)
		w.set_b(hx, gy, hz, B.HAY)
		w.set_b(hx + 1, gy, hz, B.HAY)
		if rng.randf() < 0.5:
			w.set_b(hx, gy + 1, hz, B.HAY)
		w.loot_spots.append([Vector3(hx + 0.5, gy, hz + 1.5), 0])
	# silo
	var sx := cx + 10
	var sz := cz - 12
	_walls(w, sx, gy, sz, sx + 3, gy + 9, sz + 3, B.COBBLE)
	_box(w, sx, gy + 10, sz, sx + 3, gy + 10, sz + 3, B.ROOF_RED)
	_box(w, sx + 1, gy, sz, sx + 2, gy + 2, sz, B.AIR)
	w.loot_spots.append([Vector3(sx + 1.5, gy, sz + 1.5), 1])

# ------------------------------------------------------------------ CLASH TOWN (4v4)
static func _gen_town(w: VoxelWorld, rng: RandomNumberGenerator) -> void:
	var S := w.sx
	w.water_level = 0
	w.supply_ok = false
	var gy := 8
	var heights := PackedInt32Array()
	heights.resize(S * S)
	heights.fill(gy)
	var surf := PackedByteArray()
	surf.resize(S * S)
	for x in S:
		for z in S:
			var street := (x % 28) < 5 or (z % 28) < 5
			var ci := x * S + z
			surf[ci] = B.ASPHALT if street else B.GRASS
			if street and ((x % 28) == 2 or (z % 28) == 2) and not ((x % 28) < 5 and (z % 28) < 5):
				surf[ci] = B.ROAD_LINE
	_alloc(w, heights, surf)
	_walls(w, 0, gy, 0, S - 1, gy + 7, S - 1, B.CONCRETE)
	_walls(w, 1, gy, 1, S - 2, gy + 7, S - 2, B.CONCRETE)
	var styles := [1, 2, 0, 3]
	for bxi in 4:
		for bzi in 4:
			var x0 := bxi * 28 + 6
			var z0 := bzi * 28 + 6
			var kind := (bxi * 7 + bzi * 3) % 5
			if (bxi == 0 or bxi == 3) and (bzi == 1 or bzi == 2):
				kind = 4  # spawn plazas stay open
			match kind:
				0, 1, 2:
					var wd := rng.randi_range(9, 12)
					var dp := rng.randi_range(8, 11)
					_house(w, x0 + 1, z0 + 1, wd, dp, gy, styles[(bxi + bzi) % 4], rng.randi_range(0, 3), rng, 1)
					if kind == 2:
						_house(w, x0 + 13, z0 + 11, 8, 8, gy, styles[(bxi + 1) % 4], 2, rng, 1)
					else:
						_car(w, x0 + 15, gy, z0 + 3, false, B.TEAM_RED if kind == 0 else B.TEAM_BLUE)
						_sandbags(w, x0 + 14, z0 + 15, gy, true, 7)
				3:
					for i in 5:
						_oak(w, x0 + 3 + rng.randi_range(0, 16), gy, z0 + 3 + rng.randi_range(0, 16), rng)
					_box(w, x0 + 8, gy, z0 + 8, x0 + 10, gy, z0 + 10, B.CRATE)
				_:
					for i in 4:
						var px := x0 + rng.randi_range(2, 18)
						var pz := z0 + rng.randi_range(2, 18)
						w.set_b(px, gy, pz, B.CRATE)
						w.set_b(px + 1, gy, pz, B.CRATE)
	# team spawn pads
	var red: Array = []
	var blue: Array = []
	for i in 4:
		red.append(Vector3(8.5, gy, S * 0.5 - 3 + i * 2))
		blue.append(Vector3(S - 8.5, gy, S * 0.5 - 3 + i * 2))
	for x in range(3, 13):
		for z in range(int(S * 0.5) - 6, int(S * 0.5) + 6):
			w.set_b(x, gy - 1, z, B.TEAM_RED)
			w.set_b(S - 1 - x, gy - 1, z, B.TEAM_BLUE)
	w.spawns["team0"] = red
	w.spawns["team1"] = blue
	w.pois.append({"name": "Red Base", "pos": Vector2(8, S * 0.5), "r": 6.0, "tier": 0})
	w.pois.append({"name": "Blue Base", "pos": Vector2(S - 8, S * 0.5), "r": 6.0, "tier": 0})
	w.pois.append({"name": "Downtown", "pos": Vector2(S * 0.5, S * 0.5), "r": 20.0, "tier": 1})

# ------------------------------------------------------------------ BLOCK ARENA (2v2)
static func _gen_arena(w: VoxelWorld, rng: RandomNumberGenerator) -> void:
	var S := w.sx
	w.water_level = 0
	w.supply_ok = false
	var gy := 6
	var heights := PackedInt32Array()
	heights.resize(S * S)
	heights.fill(gy)
	var surf := PackedByteArray()
	surf.resize(S * S)
	for x in S:
		for z in S:
			surf[x * S + z] = B.CONCRETE if ((x / 4 + z / 4) % 2 == 0) else B.COBBLE
	_alloc(w, heights, surf)
	_walls(w, 0, gy, 0, S - 1, gy + 9, S - 1, B.METAL)
	for x in S:
		w.set_b(x, gy + 3, 0, B.LAMP if x % 8 == 4 else B.METAL)
		w.set_b(x, gy + 3, S - 1, B.LAMP if x % 8 == 4 else B.METAL)
	var c := S / 2
	# centre tower with ramps (mirrored)
	_box(w, c - 3, gy, c - 3, c + 2, gy + 2, c + 2, B.BRICK)
	_box(w, c - 2, gy + 3, c - 2, c + 1, gy + 3, c + 1, B.PLANKS)
	for i in 3:
		_box(w, c - 6 + i, gy, c - 1, c - 6 + i, gy + i, c, B.DARK_PLANKS)
		_box(w, c + 5 - i, gy, c - 1, c + 5 - i, gy + i, c, B.DARK_PLANKS)
	# mirrored cover pieces
	var pieces := [[8, 8, 3, 1], [8, 20, 1, 4], [14, 14, 2, 2], [6, 27, 4, 1], [16, 4, 1, 3], [20, 22, 3, 1], [11, 30, 2, 1]]
	for p in pieces:
		for mir in 2:
			for mz in 2:
				var px: int = p[0] if mir == 0 else S - 1 - p[0] - p[2] + 1
				var pz: int = p[1] if mz == 0 else S - 1 - p[1] - p[3] + 1
				_box(w, px, gy, pz, px + p[2] - 1, gy + 1, pz + p[3] - 1, B.CRATE if (p[2] * p[3]) % 2 == 0 else B.SANDBAG)
	for x in range(2, 8):
		for z in range(c - 4, c + 4):
			w.set_b(x, gy - 1, z, B.TEAM_RED)
			w.set_b(S - 1 - x, gy - 1, z, B.TEAM_BLUE)
	w.spawns["team0"] = [Vector3(4.5, gy, c - 1.5), Vector3(4.5, gy, c + 1.5)]
	w.spawns["team1"] = [Vector3(S - 4.5, gy, c - 1.5), Vector3(S - 4.5, gy, c + 1.5)]
	w.pois.append({"name": "Arena", "pos": Vector2(c, c), "r": 10.0, "tier": 0})

# ------------------------------------------------------------------ TRAINING GROUND
static func _gen_training(w: VoxelWorld, rng: RandomNumberGenerator) -> void:
	var S := w.sx
	w.water_level = 0
	w.supply_ok = false
	var gy := 8
	var heights := PackedInt32Array()
	heights.resize(S * S)
	heights.fill(gy)
	var surf := PackedByteArray()
	surf.resize(S * S)
	for x in S:
		for z in S:
			var s := B.GRASS
			if absi(x - S / 2) <= 1 or absi(z - 70) <= 1:
				s = B.GRAVEL
			surf[x * S + z] = s
	_alloc(w, heights, surf)
	_walls(w, 0, gy, 0, S - 1, gy + 5, S - 1, B.STONE)
	# weapon racks platform (south, near spawn)
	_box(w, 30, gy - 1, 74, 66, gy - 1, 80, B.PLANKS)
	var rack_items := DB.WEAPONS.keys()
	var i := 0
	for id in rack_items:
		w.loot_spots.append([Vector3(31.5 + (i % 17) * 2.0, gy, 75.5 + (i / 17) * 2.0), -1, id])
		i += 1
	for id in ["med_kit", "med_bandage", "med_drink", "vest_3", "helm_3", "blocks", "ammo_light", "ammo_rifle", "ammo_shells", "ammo_sniper"]:
		w.loot_spots.append([Vector3(31.5 + (i % 17) * 2.0, gy, 75.5 + (i / 17) * 2.0), -1, id])
		i += 1
	# shooting range (north): firing line z=60, targets further north
	for x in range(10, 86):
		w.set_b(x, gy, 60, B.SANDBAG)
	for dist in [12, 25, 40, 55]:
		var tz: int = 60 - dist
		for k in 3:
			var tx := 20 + k * 25
			_box(w, tx - 1, gy, tz, tx + 1, gy + 2, tz, B.TARGET)
		w.dummies.append({"pos": Vector3(32 + dist * 0.4, gy, tz + 1.5), "moving": dist >= 25})
	_box(w, 6, gy, 2, 90, gy + 6, 3, B.MOSSY)
	# building pad (east)
	_box(w, 70, gy - 1, 62, 90, gy - 1, 90, B.CONCRETE)
	# obstacle course (west)
	for k in 6:
		_box(w, 6 + k * 3, gy, 64 + k, 7 + k * 3, gy + k % 3, 65 + k, B.COBBLE)
	_house(w, 8, 80, 10, 9, gy, 1, 3, rng, 0)
	for k in 4:
		_oak(w, 22 + k * 14, gy, 88, rng)
	w.spawns["spawn"] = [Vector3(48.5, gy, 70.5), Vector3(46.5, gy, 72.5), Vector3(50.5, gy, 72.5)]
	w.spawns["bots"] = [Vector3(20, gy, 40), Vector3(76, gy, 40), Vector3(48, gy, 30), Vector3(30, gy, 20), Vector3(66, gy, 20)]
	w.pois.append({"name": "Weapon Racks", "pos": Vector2(48, 77), "r": 6.0, "tier": 0})
	w.pois.append({"name": "Shooting Range", "pos": Vector2(48, 35), "r": 10.0, "tier": 0})
	w.pois.append({"name": "Build Pad", "pos": Vector2(80, 76), "r": 8.0, "tier": 0})

# ------------------------------------------------------------------ minimap
static func minimap_image(w: VoxelWorld) -> Image:
	var img := Image.create_empty(w.sx, w.sz, false, Image.FORMAT_RGBA8)
	for x in w.sx:
		for z in w.sz:
			var t := w.top_y(x, z)
			var b := w.get_b(x, t - 1, z) if t > 0 else B.AIR
			var c := Blocks.map_color(b)
			if b == B.BARRIER or b == B.AIR:
				c = Color(0.1, 0.12, 0.16)
			var shade := 0.82 + clampf(float(t - w.water_level) / 40.0, -0.2, 0.3)
			if b == B.WATER:
				shade = 0.85 + clampf(float(w.ground_y(x, z) - w.water_level) / 12.0, -0.25, 0.1)
			img.set_pixel(x, z, Color(c.r * shade, c.g * shade, c.b * shade, 1.0))
	return img
