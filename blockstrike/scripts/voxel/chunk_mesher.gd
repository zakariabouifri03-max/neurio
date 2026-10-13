class_name ChunkMesher
extends RefCounted
## Builds render + collision geometry for one chunk column.
##
## Only faces that border air/water are emitted (hidden-face culling).
## Output is indexed (4 vertices per quad) and uses vertex colours, so the whole
## map shares a single material per chunk surface (cheap draw calls).

const SHADE_TOP := 1.0
const SHADE_BOTTOM := 0.5
const SHADE_X := 0.82
const SHADE_Z := 0.7

## Quad corners per face, listed counter-clockwise when viewed from outside
## (right-hand rule). Godot front faces are clockwise, so indices are emitted
## in reversed order below.
const _FACE_CORNERS := [
	# +X
	[Vector3(1, 0, 0), Vector3(1, 1, 0), Vector3(1, 1, 1), Vector3(1, 0, 1)],
	# -X
	[Vector3(0, 0, 1), Vector3(0, 1, 1), Vector3(0, 1, 0), Vector3(0, 0, 0)],
	# +Y
	[Vector3(0, 1, 0), Vector3(0, 1, 1), Vector3(1, 1, 1), Vector3(1, 1, 0)],
	# -Y
	[Vector3(0, 0, 0), Vector3(1, 0, 0), Vector3(1, 0, 1), Vector3(0, 0, 1)],
	# +Z
	[Vector3(0, 0, 1), Vector3(1, 0, 1), Vector3(1, 1, 1), Vector3(0, 1, 1)],
	# -Z
	[Vector3(1, 0, 0), Vector3(0, 0, 0), Vector3(0, 1, 0), Vector3(1, 1, 0)],
]
const _FACE_NORMALS := [
	Vector3(1, 0, 0), Vector3(-1, 0, 0), Vector3(0, 1, 0),
	Vector3(0, -1, 0), Vector3(0, 0, 1), Vector3(0, 0, -1),
]


class MeshData:
	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	var colors := PackedColorArray()
	var indices := PackedInt32Array()

	func is_empty() -> bool:
		return verts.is_empty()

	func add_quad(corners: Array, normal: Vector3, color: Color, origin: Vector3) -> void:
		var base := verts.size()
		for c in corners:
			verts.append(origin + (c as Vector3))
			normals.append(normal)
			colors.append(color)
		# Reversed winding for Godot's clockwise front faces.
		indices.append_array(PackedInt32Array([base, base + 2, base + 1, base, base + 3, base + 2]))


## Returns { "opaque": MeshData, "water": MeshData, "collision": PackedVector3Array }.
static func build(world: VoxelWorld, cx: int, cz: int) -> Dictionary:
	var opaque := MeshData.new()
	var water := MeshData.new()
	var collision := PackedVector3Array()
	var ox := cx * VoxelWorld.CHUNK
	var oz := cz * VoxelWorld.CHUNK
	var sx := world.size_x
	var sz := world.size_z
	var sy := world.size_y
	var plane := sx * sz
	var data := world.data
	var palette := BlockDB.color_table()
	var faces_out := 0

	for y in range(sy):
		for lz in range(VoxelWorld.CHUNK):
			var z := oz + lz
			if z >= sz:
				break
			for lx in range(VoxelWorld.CHUNK):
				var x := ox + lx
				if x >= sx:
					break
				var idx := x + z * sx + y * plane
				var id := data[idx]
				if id == BlockIds.AIR:
					continue
				## Geometry is chunk-local: the chunk node already sits at (ox, 0, oz).
				var origin := Vector3(lx, y, lz)
				if id == BlockIds.WATER:
					# Only the water surface is rendered (translucent top face).
					if y + 1 < sy and data[idx + plane] == BlockIds.AIR:
						water.add_quad(_FACE_CORNERS[2], _FACE_NORMALS[2],
							palette[id] * SHADE_TOP, origin)
					continue

				var jitter := _jitter(x, y, z)
				var base_color: Color = palette[id]
				for face in range(6):
					var n: Vector3 = _FACE_NORMALS[face]
					var nx := x + int(n.x)
					var ny := y + int(n.y)
					var nz := z + int(n.z)
					if not _is_open(world, nx, ny, nz):
						continue
					var shade := SHADE_X
					if face == 2:
						shade = SHADE_TOP
					elif face == 3:
						shade = SHADE_BOTTOM
					elif face >= 4:
						shade = SHADE_Z
					var col := Color(base_color.r * shade * jitter, base_color.g * shade * jitter,
						base_color.b * shade * jitter, 1.0)
					opaque.add_quad(_FACE_CORNERS[face], n, col, origin)
					faces_out += 1
					var c: Array = _FACE_CORNERS[face]
					collision.append(origin + c[0]); collision.append(origin + c[2]); collision.append(origin + c[1])
					collision.append(origin + c[0]); collision.append(origin + c[3]); collision.append(origin + c[2])

	return {"opaque": opaque, "water": water, "collision": collision, "faces": faces_out}


static func _is_open(world: VoxelWorld, x: int, y: int, z: int) -> bool:
	if x < 0 or y < 0 or z < 0 or x >= world.size_x or y >= world.size_y or z >= world.size_z:
		return true
	return not BlockDB.is_solid(world.data[x + z * world.size_x + y * world.size_x * world.size_z])


static func _jitter(x: int, y: int, z: int) -> float:
	var h := (x * 73856093) ^ (y * 19349663) ^ (z * 83492791)
	h = (h ^ (h >> 13)) & 0xFFFF
	return 0.955 + float(h) / 65535.0 * 0.075
