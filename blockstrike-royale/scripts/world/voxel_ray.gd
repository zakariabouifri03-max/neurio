class_name VoxelRay
extends RefCounted
## Exact voxel ray casting (Amanatides & Woo 3D DDA).
##
## The world is a uniform grid, so a single cell-by-cell traversal gives the
## precise block that a ray hits *and* which face it entered through - that face
## normal is what placement, mining and bullet decals need.  It is exact (no
## stepping error) and costs one grid lookup per cell crossed, so it is cheaper
## than march-and-sample at any distance.

const MAX_STEPS := 1024

## Casts through the voxel grid.
## Returns {} when nothing is hit, otherwise:
##   coord     - Vector3i cell that was hit
##   normal    - Vector3i face the ray entered through (points out of the block)
##   distance  - metres from origin to the entry point
##   position  - world position of the hit on the block face
##   block     - block id
static func cast(world: VoxelWorld, origin: Vector3, direction: Vector3, max_distance: float,
				 hit_water: bool = false, ignore: Vector3i = Vector3i(9999999, 9999999, 9999999)) -> Dictionary:
	if world == null or direction.length_squared() <= 0.0 or max_distance <= 0.0:
		return {}
	var dir := direction.normalized()
	var cell := Vector3i(floori(origin.x), floori(origin.y), floori(origin.z))
	var first_block := world.get_block(cell.x, cell.y, cell.z)
	if _blocking(first_block, hit_water):
		return {"coord": cell, "normal": Vector3i.ZERO, "distance": 0.0, "position": origin,
				"block": first_block}
	var step := Vector3i(signi(int(sign(dir.x))), signi(int(sign(dir.y))), signi(int(sign(dir.z))))
	var t_delta := Vector3(INF, INF, INF)
	var t_max := Vector3(INF, INF, INF)
	for axis: int in 3:
		var component := dir[axis]
		if absf(component) > 0.000001:
			t_delta[axis] = absf(1.0 / component)
			var boundary := float(cell[axis]) + (1.0 if step[axis] > 0 else 0.0)
			t_max[axis] = (boundary - origin[axis]) / component
	# The sign of the last crossed axis tells us the face we are looking at.
	var normal := Vector3i.ZERO
	var normal_sign := Vector3i.ZERO
	var travelled := 0.0
	var steps := 0
	while steps < MAX_STEPS:
		steps += 1
		var axis := 0
		if t_max.y < t_max.x:
			axis = 1
		if t_max.z < t_max[axis]:
			axis = 2
		travelled = t_max[axis]
		if travelled > max_distance:
			return {}
		t_max[axis] += t_delta[axis]
		cell[axis] += step[axis]
		normal_sign = Vector3i.ZERO
		normal_sign[axis] = -step[axis]
		if cell == ignore:
			continue
		var block := world.get_block(cell.x, cell.y, cell.z)
		if _blocking(block, hit_water):
			return {"coord": cell, "normal": normal_sign, "distance": travelled,
					"position": origin + dir * travelled, "block": block}
		normal = normal_sign
	return {}

## True when the ray from `from` to `to` crosses no solid block.
static func has_line_of_sight(world: VoxelWorld, from: Vector3, to: Vector3) -> bool:
	var delta := to - from
	var distance := delta.length()
	if distance <= 0.001:
		return true
	return cast(world, from, delta, distance).is_empty()

static func _blocking(block: int, hit_water: bool) -> bool:
	if block == VoxelLibrary.Block.AIR:
		return false
	if block == VoxelLibrary.Block.WATER:
		return hit_water
	return VoxelLibrary.is_solid(block)

## Convenience wrapper that snaps an aim direction to the block face hit.
static func aim_cell(world: VoxelWorld, origin: Vector3, direction: Vector3,
					 max_distance: float) -> Vector3i:
	var hit := cast(world, origin, direction, max_distance)
	if hit.is_empty():
		return Vector3i.ZERO
	return hit["coord"]

## The cell a player would build in when aiming at existing terrain.
static func placement_cell(world: VoxelWorld, origin: Vector3, direction: Vector3,
						   max_distance: float) -> Dictionary:
	var hit := cast(world, origin, direction, max_distance, true)
	if hit.is_empty():
		return {}
	if not hit["normal"] == Vector3i.ZERO:
		var coord: Vector3i = hit["coord"]
		var target: Vector3i = coord + (hit["normal"] as Vector3i)
		return {"coord": target, "anchor": coord, "distance": hit["distance"]}
	# Started inside a block: build into the cell just behind the origin.
	var back := origin - direction.normalized() * 1.0
	return {"coord": Vector3i(floori(back.x), floori(back.y), floori(back.z)),
			"anchor": hit["coord"], "distance": 0.0}
