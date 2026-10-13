class_name VoxelMesher
extends RefCounted
## Builds chunk meshes: hidden-face culling, per-vertex ambient occlusion (AO), atlas layers in UV2.
## Thread-safe as long as the world is not written while meshing (initial build runs on worker threads).

# Face order: +X, -X, +Y, -Y, +Z, -Z
const NORMALS := [Vector3i(1, 0, 0), Vector3i(-1, 0, 0), Vector3i(0, 1, 0), Vector3i(0, -1, 0), Vector3i(0, 0, 1), Vector3i(0, 0, -1)]
const AO_LEVELS := [0.5, 0.68, 0.84, 1.0]

static var _corners := []     # [face][4] Vector3i corner offsets (clockwise seen from outside)
static var _uvs := []         # [face][4] Vector2
static var _ao_side1 := []    # [face][4] Vector3i
static var _ao_side2 := []
static var _ao_corner := []
static var _init_done := false

## Must be called on the main thread before meshing from worker threads.
static func prepare() -> void:
	_setup()

static func _setup() -> void:
	if _init_done:
		return
	_init_done = true
	for f in 6:
		var n: Vector3i = NORMALS[f]
		var axis := 0 if n.x != 0 else (1 if n.y != 0 else 2)
		var ta := (axis + 1) % 3
		var tb := (axis + 2) % 3
		if axis == 1:
			ta = 0
			tb = 2
		var plane := 1 if (n.x + n.y + n.z) > 0 else 0
		var quad := []
		for k in 4:
			var a: int = [0, 1, 1, 0][k]
			var b: int = [0, 0, 1, 1][k]
			var c := Vector3i.ZERO
			c[axis] = plane
			c[ta] = a
			c[tb] = b
			quad.append(c)
		# ensure clockwise winding seen from outside (Godot front faces are clockwise)
		var v0 := Vector3(quad[0])
		var cr := (Vector3(quad[1]) - v0).cross(Vector3(quad[2]) - v0)
		if cr.dot(Vector3(n)) > 0.0:
			quad = [quad[0], quad[3], quad[2], quad[1]]
		var uvl := []
		var s1 := []
		var s2 := []
		var sc := []
		for c in quad:
			var cv: Vector3i = c
			var uv := Vector2.ZERO
			if axis == 1:
				uv = Vector2(cv.x, cv.z)
			elif axis == 0:
				uv = Vector2(cv.z if n.x > 0 else 1 - cv.z, 1 - cv.y)
			else:
				uv = Vector2(1 - cv.x if n.z > 0 else cv.x, 1 - cv.y)
			uvl.append(uv)
			var da := Vector3i.ZERO
			var db := Vector3i.ZERO
			da[ta] = 1 if cv[ta] == 1 else -1
			db[tb] = 1 if cv[tb] == 1 else -1
			s1.append(n + da)
			s2.append(n + db)
			sc.append(n + da + db)
		_corners.append(quad)
		_uvs.append(uvl)
		_ao_side1.append(s1)
		_ao_side2.append(s2)
		_ao_corner.append(sc)

## Returns [opaque_arrays_or_null, transparent_arrays_or_null] in chunk-local coordinates.
static func build_chunk(w: VoxelWorld, cx: int, cz: int) -> Array:
	_setup()
	var tex := Blocks.tex_table()
	var emit := Blocks.emit_table()
	var opaque := w.opaque
	var data := w.data
	var sx := w.sx
	var sy := w.sy
	var sz := w.sz
	var ox := cx * VoxelWorld.CHUNK
	var oz := cz * VoxelWorld.CHUNK
	var o := _new_buf()
	var t := _new_buf()
	for lx in VoxelWorld.CHUNK:
		var x := ox + lx
		if x >= sx:
			break
		for lz in VoxelWorld.CHUNK:
			var z := oz + lz
			if z >= sz:
				break
			var ci := x * sz + z
			var ytop: int = w.top[ci]
			if ytop <= 0:
				continue
			var ylo: int = w.ground[ci]
			if x > 0:
				ylo = mini(ylo, w.ground[ci - sz])
			if x < sx - 1:
				ylo = mini(ylo, w.ground[ci + sz])
			if z > 0:
				ylo = mini(ylo, w.ground[ci - 1])
			if z < sz - 1:
				ylo = mini(ylo, w.ground[ci + 1])
			ylo = maxi(0, ylo - 1)
			var base := ci * sy
			for y in range(ylo, mini(ytop, sy)):
				var b: int = data[base + y]
				if b == Blocks.AIR or b == Blocks.BARRIER:
					continue
				var is_op: bool = opaque[b] == 1
				if b == Blocks.WATER:
					var above := data[base + y + 1] if y + 1 < sy else Blocks.AIR
					if above == Blocks.AIR:
						_emit_face(t, w, 2, x, y, z, lx, lz, tex[b * 3], 0.0, false)
					continue
				for f in 6:
					var n: Vector3i = NORMALS[f]
					var nx := x + n.x
					var ny := y + n.y
					var nz := z + n.z
					var nb := 0
					if ny < 0:
						nb = Blocks.BEDROCK
					elif ny >= sy:
						nb = Blocks.AIR
					elif nx < 0 or nz < 0 or nx >= sx or nz >= sz:
						continue
					else:
						nb = data[(nx * sz + nz) * sy + ny]
					if opaque[nb] == 1:
						continue
					if not is_op and nb == b:
						continue
					var layer := tex[b * 3 + (0 if f == 2 else (2 if f == 3 else 1))]
					if is_op:
						_emit_face(o, w, f, x, y, z, lx, lz, layer, float(emit[b]), true)
					else:
						_emit_face(t, w, f, x, y, z, lx, lz, layer, 0.0, false)
	return [_finish(o), _finish(t)]

static func _new_buf() -> Dictionary:
	return {"v": PackedVector3Array(), "n": PackedVector3Array(), "uv": PackedVector2Array(), "uv2": PackedVector2Array(),
		"c": PackedColorArray(), "i": PackedInt32Array()}

static func _emit_face(buf: Dictionary, w: VoxelWorld, f: int, x: int, y: int, z: int, lx: int, lz: int, layer: int, em: float, ao: bool) -> void:
	var verts: PackedVector3Array = buf["v"]
	var start := verts.size()
	var corners: Array = _corners[f]
	var uvs: Array = _uvs[f]
	var nrm := Vector3(NORMALS[f])
	var a := [3, 3, 3, 3]
	if ao:
		var s1: Array = _ao_side1[f]
		var s2: Array = _ao_side2[f]
		var sc: Array = _ao_corner[f]
		for k in 4:
			var o1: Vector3i = s1[k]
			var o2: Vector3i = s2[k]
			var o3: Vector3i = sc[k]
			var b1 := w.opq(x + o1.x, y + o1.y, z + o1.z)
			var b2 := w.opq(x + o2.x, y + o2.y, z + o2.z)
			if b1 == 1 and b2 == 1:
				a[k] = 0
			else:
				a[k] = 3 - (b1 + b2 + w.opq(x + o3.x, y + o3.y, z + o3.z))
	var lp := Vector3(lx, y, lz)
	var cols: PackedColorArray = buf["c"]
	var norms: PackedVector3Array = buf["n"]
	var uv: PackedVector2Array = buf["uv"]
	var uv2: PackedVector2Array = buf["uv2"]
	var l2 := Vector2(layer, em)
	for k in 4:
		verts.append(lp + Vector3(corners[k]))
		norms.append(nrm)
		uv.append(uvs[k])
		uv2.append(l2)
		var g: float = AO_LEVELS[a[k]]
		cols.append(Color(g, g, g, 1.0))
	var idx: PackedInt32Array = buf["i"]
	if a[0] + a[2] < a[1] + a[3]:
		idx.append_array([start + 1, start + 2, start + 3, start + 1, start + 3, start])
	else:
		idx.append_array([start, start + 1, start + 2, start, start + 2, start + 3])
	buf["v"] = verts
	buf["n"] = norms
	buf["uv"] = uv
	buf["uv2"] = uv2
	buf["c"] = cols
	buf["i"] = idx

static func _finish(buf: Dictionary) -> Variant:
	if (buf["v"] as PackedVector3Array).is_empty():
		return null
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = buf["v"]
	arr[Mesh.ARRAY_NORMAL] = buf["n"]
	arr[Mesh.ARRAY_TEX_UV] = buf["uv"]
	arr[Mesh.ARRAY_TEX_UV2] = buf["uv2"]
	arr[Mesh.ARRAY_COLOR] = buf["c"]
	arr[Mesh.ARRAY_INDEX] = buf["i"]
	return arr

static func arrays_to_mesh(res: Array) -> ArrayMesh:
	var mesh := ArrayMesh.new()
	if res[0] != null:
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, res[0])
		mesh.surface_set_material(mesh.get_surface_count() - 1, VoxelArt.terrain_material())
	if res[1] != null:
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, res[1])
		mesh.surface_set_material(mesh.get_surface_count() - 1, VoxelArt.mat_trans)
	return mesh
