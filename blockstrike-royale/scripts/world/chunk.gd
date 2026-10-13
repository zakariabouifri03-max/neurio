class_name VoxelChunk
extends Node3D
## One 16x16x48 slab of the world.
##
## Blocks live in a PackedByteArray.  Meshing emits only visible faces (neighbour
## aware, including across chunk borders), applies per-vertex ambient occlusion and
## bakes tint into vertex colours, so a whole chunk is one surface with one
## material and one draw call.  Water is a second, transparent surface.
##
## Winding: Godot uses *clockwise* winding for front faces, so the CCW corner
## tables below are emitted with the triangle order flipped.  The tables are
## verified by tools/validate/test_winding.py so a typo cannot silently produce
## inside-out terrain.

const SIZE := 16
const HEIGHT := 48

## Face order: 0=+Y 1=-Y 2=+X 3=-X 4=+Z 5=-Z
const FACE_NORMALS: Array[Vector3i] = [
	Vector3i(0, 1, 0), Vector3i(0, -1, 0), Vector3i(1, 0, 0),
	Vector3i(-1, 0, 0), Vector3i(0, 0, 1), Vector3i(0, 0, -1),
]

## Corner offsets in counter-clockwise order as seen from outside the block.
const FACE_CORNERS: Array = [
	[[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],   # +Y
	[[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],   # -Y
	[[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],   # +X
	[[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],   # -X
	[[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],   # +Z
	[[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],   # -Z
]

## UV per corner of each face, matching FACE_CORNERS (0,0 = top-left of the tile).
const FACE_UVS: Array = [
	[[0, 0], [0, 1], [1, 1], [1, 0]],   # +Y
	[[0, 0], [1, 0], [1, 1], [0, 1]],   # -Y
	[[0, 0], [1, 0], [1, 1], [0, 1]],   # +X
	[[0, 0], [1, 0], [1, 1], [0, 1]],   # -X
	[[0, 0], [1, 0], [1, 1], [0, 1]],   # +Z
	[[0, 0], [1, 0], [1, 1], [0, 1]],   # -Z
]

## In-plane axes used for ambient occlusion: [u_axis, v_axis] (0=x, 1=y, 2=z),
## mirroring the corner offsets above.
const FACE_AXES: Array[Vector2i] = [
	Vector2i(0, 2), Vector2i(0, 2), Vector2i(2, 1),
	Vector2i(2, 1), Vector2i(0, 1), Vector2i(0, 1),
]

## Brightness per occlusion level: index 0 = no occluders (brightest).
const AO_LEVELS := [1.0, 0.87, 0.74, 0.60]

var coord: Vector2i = Vector2i.ZERO
var blocks: PackedByteArray = PackedByteArray()
var world: VoxelWorld = null

var _mesh_instance: MeshInstance3D
var _water_instance: MeshInstance3D
var _body: StaticBody3D
var _collision_shape: CollisionShape3D
var _dirty: bool = true
var _solid_mesh: ArrayMesh = null
var _water_mesh: ArrayMesh = null
var _vertex_total: int = 0

func _init() -> void:
	blocks.resize(SIZE * SIZE * HEIGHT)
	_mesh_instance = MeshInstance3D.new()
	_mesh_instance.name = "SolidMesh"
	_water_instance = MeshInstance3D.new()
	_water_instance.name = "WaterMesh"
	_water_instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_body = StaticBody3D.new()
	_body.name = "Collision"
	_body.collision_layer = GameConfig.Layer.WORLD
	_body.collision_mask = 0
	_collision_shape = CollisionShape3D.new()
	_collision_shape.name = "Shape"
	_body.add_child(_collision_shape)

func _ready() -> void:
	add_child(_mesh_instance)
	add_child(_water_instance)
	add_child(_body)

# ------------------------------------------------------------------ indexing
static func index(x: int, y: int, z: int) -> int:
	return (y * SIZE + z) * SIZE + x

static func unpack(index_value: int) -> Vector3i:
	var x := index_value % SIZE
	var z := (index_value / SIZE) % SIZE
	var y := index_value / (SIZE * SIZE)
	return Vector3i(x, y, z)

func in_bounds(x: int, y: int, z: int) -> bool:
	return x >= 0 and x < SIZE and y >= 0 and y < HEIGHT and z >= 0 and z < SIZE

## Reads a block, consulting the world for out-of-chunk coordinates so faces on
## borders are culled against the neighbouring chunk.
func get_block(x: int, y: int, z: int) -> int:
	if y < 0 or y >= HEIGHT:
		return VoxelLibrary.Block.AIR
	if x >= 0 and x < SIZE and z >= 0 and z < SIZE:
		return blocks[index(x, y, z)]
	if world != null:
		return world.get_block(coord.x * SIZE + x, y, coord.y * SIZE + z)
	return VoxelLibrary.Block.AIR

func set_block(x: int, y: int, z: int, block_id: int) -> void:
	if not in_bounds(x, y, z):
		return
	blocks[index(x, y, z)] = block_id
	mark_dirty()
	if (x == 0 or x == SIZE - 1 or z == 0 or z == SIZE - 1) and world != null:
		world.mark_neighbours_dirty(coord)

func fill_column(x: int, z: int, from_y: int, to_y: int, block_id: int) -> void:
	for y in range(maxi(0, from_y), mini(HEIGHT, to_y + 1)):
		blocks[index(x, y, z)] = block_id

func mark_dirty() -> void:
	_dirty = true

func is_dirty() -> bool:
	return _dirty

func is_meshed() -> bool:
	return _solid_mesh != null or _water_mesh != null

func vertex_total() -> int:
	return _vertex_total

func collision_body() -> StaticBody3D:
	return _body

# -------------------------------------------------------------------- meshing
## Rebuilds both surfaces and the collision shape.  Called by VoxelWorld at most
## once per frame per chunk.
func rebuild() -> void:
	_dirty = false
	var solid_faces := _count_faces(false)
	var water_faces := _count_faces(true)
	_vertex_total = (solid_faces + water_faces) * 6
	_solid_mesh = _build_mesh(false, solid_faces)
	_water_mesh = _build_mesh(true, water_faces)
	_mesh_instance.mesh = _solid_mesh
	_water_instance.mesh = _water_mesh
	_water_instance.visible = _water_mesh != null
	_update_collision()
	visible = _solid_mesh != null or _water_mesh != null

func _update_collision() -> void:
	if _solid_mesh == null:
		_collision_shape.shape = null
		_body.collision_layer = 0
		return
	_collision_shape.shape = _solid_mesh.create_trimesh_shape()
	_body.collision_layer = GameConfig.Layer.WORLD

func _count_faces(water_pass: bool) -> int:
	var count := 0
	for y: int in HEIGHT:
		for z: int in SIZE:
			for x: int in SIZE:
				var block_id: int = blocks[index(x, y, z)]
				if block_id == VoxelLibrary.Block.AIR:
					continue
				if VoxelLibrary.is_water(block_id) != water_pass:
					continue
				for face: int in 6:
					var normal: Vector3i = FACE_NORMALS[face]
					if _face_visible(block_id, get_block(x + normal.x, y + normal.y, z + normal.z)):
						count += 1
	return count

func _build_mesh(water_pass: bool, face_count: int) -> ArrayMesh:
	if face_count == 0:
		return null
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for y: int in HEIGHT:
		for z: int in SIZE:
			for x: int in SIZE:
				var block_id: int = blocks[index(x, y, z)]
				if block_id == VoxelLibrary.Block.AIR:
					continue
				if VoxelLibrary.is_water(block_id) != water_pass:
					continue
				_emit_block(st, x, y, z, block_id)
	var mesh: ArrayMesh = st.commit()
	mesh.surface_set_material(0, VoxelLibrary.water_material() if water_pass
		else VoxelLibrary.atlas_material())
	return mesh

## Clockwise-from-outside triangle order into the CCW corner tables:
## (0,2,1) and (0,3,2) reverse each triangle's winding.
const TRI_ORDER := [0, 2, 1, 0, 3, 2]

## Emits the six vertices of one visible block face.  Written without temporary
## arrays or dictionaries because this runs for every face of every chunk.
func _emit_block(st: SurfaceTool, x: int, y: int, z: int, block_id: int) -> void:
	var info := VoxelLibrary.info(block_id)
	var tint := _tint(block_id, x, y, z)
	var is_water := VoxelLibrary.is_water(block_id)
	for face: int in 6:
		var normal: Vector3i = FACE_NORMALS[face]
		if not _face_visible(block_id, get_block(x + normal.x, y + normal.y, z + normal.z)):
			continue
		var uv: Array = VoxelLibrary.uv_for(_tile_for_face(info, face))
		var corners: Array = FACE_CORNERS[face]
		var uvs: Array = FACE_UVS[face]
		var axes: Vector2i = FACE_AXES[face]
		var normal_vec := Vector3(normal)
		for k: int in 6:
			var ci: int = TRI_ORDER[k]
			var corner: Array = corners[ci]
			var shade: float = _ao_at(x, y, z, normal, axes, corner)
			st.set_normal(normal_vec)
			st.set_color(Color(tint.r * shade, tint.g * shade, tint.b * shade, 1.0))
			st.set_uv(_face_uv(uv, uvs[ci]))
			st.add_vertex(Vector3(x + float(corner[0]), y + float(corner[1]), z + float(corner[2])))

func _face_uv(tile_uv: Array, local_uv: Array) -> Vector2:
	var u: float = float(local_uv[0])
	var v: float = float(local_uv[1])
	return Vector2(
		lerpf(float(tile_uv[0]), float(tile_uv[2]), u),
		lerpf(float(tile_uv[1]), float(tile_uv[3]), v))

func _face_visible(block_id: int, neighbour: int) -> bool:
	if neighbour == VoxelLibrary.Block.AIR:
		return true
	if VoxelLibrary.is_water(block_id):
		return not VoxelLibrary.is_water(neighbour) and not VoxelLibrary.is_opaque(neighbour)
	if VoxelLibrary.is_water(neighbour):
		return true
	if VoxelLibrary.is_opaque(neighbour):
		return false
	if neighbour == block_id and VoxelLibrary.is_opaque(block_id):
		return false
	return true

func _tile_for_face(info: Dictionary, face: int) -> String:
	if face == 0:
		return str(info.get("top", "stone"))
	if face == 1:
		return str(info.get("bottom", "stone"))
	return str(info.get("side", "stone"))

## Tiny deterministic per-block shade variation keeps large flat areas from
## looking like a single sheet of colour, with no extra draw calls.
func _tint(block_id: int, x: int, y: int, z: int) -> Color:
	if block_id == VoxelLibrary.Block.WATER:
		return Color(0.82, 0.94, 1.0)
	var hash_value := (x * 73856093) ^ (y * 19349663) ^ (z * 83492791)
	var jitter := float((hash_value >> 4) & 7) / 7.0 * 0.06 - 0.03
	return Color(1.0 + jitter, 1.0 + jitter, 1.0 + jitter)

## Classic voxel ambient occlusion for one corner: darker when its two edge
## neighbours and the diagonal (in the plane above the face) are solid.
func _ao_at(x: int, y: int, z: int, normal: Vector3i, axes: Vector2i,
			corner: Array) -> float:
	var base := Vector3i(x, y, z) + normal
	var step_u: int = 1 if int(corner[axes.x]) == 1 else -1
	var step_v: int = 1 if int(corner[axes.y]) == 1 else -1
	var offset_u := _axis_offset(axes.x, step_u)
	var offset_v := _axis_offset(axes.y, step_v)
	var side_a := _is_occluder(base + offset_u)
	var side_b := _is_occluder(base + offset_v)
	var diagonal := _is_occluder(base + offset_u + offset_v)
	var level := 0
	if side_a:
		level += 1
	if side_b:
		level += 1
	if not (side_a and side_b) and diagonal:
		level += 1
	return AO_LEVELS[clampi(level, 0, 3)]

static func _axis_offset(axis: int, step: int) -> Vector3i:
	match axis:
		0:
			return Vector3i(step, 0, 0)
		1:
			return Vector3i(0, step, 0)
	return Vector3i(0, 0, step)

func _is_occluder(position: Vector3i) -> bool:
	return VoxelLibrary.is_opaque(get_block(position.x, position.y, position.z))

## Highest solid block in a local column, or -1 when empty.
func column_height(x: int, z: int) -> int:
	for y in range(HEIGHT - 1, -1, -1):
		if VoxelLibrary.is_solid(blocks[index(x, y, z)]):
			return y
	return -1

## First standable air height above a column (for spawn placement).
func spawn_height(x: int, z: int) -> int:
	var top := column_height(x, z)
	return clampi(top + 1, 1, HEIGHT - 3)
