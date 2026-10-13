class_name CharacterBuilder
extends RefCounted
## Builds an original blocky character: one skinned ArrayMesh (8 bones) + procedural 64x64 skin texture.
## Cosmetics (hair, outfit, hat, backpack) are baked in; gameplay armour levels are shown as vest/helmet bands.

const PX := 0.05625                       # 32 px tall = 1.8 m
const BONES := ["root", "hips", "torso", "head", "arm_r", "arm_l", "leg_r", "leg_l"]
const PARENT := [-1, 0, 1, 2, 2, 2, 1, 1]
const GLOBAL_REST := [Vector3(0, 0, 0), Vector3(0, 12, 0), Vector3(0, 12, 0), Vector3(0, 24, 0), Vector3(6, 22, 0),
	Vector3(-6, 22, 0), Vector3(2, 12, 0), Vector3(-2, 12, 0)]
const PALETTE_Y := 32

# ------------------------------------------------------------------ public
## Returns {"root": Node3D, "skel": Skeleton3D, "mi": MeshInstance3D, "hand": BoneAttachment3D, "mat": Material}
static func build(cos: Dictionary, vest := 0, helm := 0, unshaded := false) -> Dictionary:
	var root := Node3D.new()
	root.name = "Character"
	var skel := Skeleton3D.new()
	skel.name = "Skeleton"
	root.add_child(skel)
	for i in BONES.size():
		skel.add_bone(BONES[i])
	for i in BONES.size():
		if PARENT[i] >= 0:
			skel.set_bone_parent(i, PARENT[i])
		var rel: Vector3 = GLOBAL_REST[i] - (GLOBAL_REST[PARENT[i]] if PARENT[i] >= 0 else Vector3.ZERO)
		skel.set_bone_rest(i, Transform3D(Basis(), rel * PX))
	skel.reset_bone_poses()
	var img := paint_skin(cos)
	var tex := ImageTexture.create_from_image(img)
	var mat := StandardMaterial3D.new()
	mat.albedo_texture = tex
	mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	mat.roughness = 0.92
	mat.vertex_color_use_as_albedo = unshaded
	if unshaded:
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	var mi := MeshInstance3D.new()
	mi.name = "Body"
	mi.mesh = build_mesh(cos, vest, helm)
	mi.material_override = mat
	skel.add_child(mi)
	mi.skeleton = NodePath("..")
	mi.skin = skel.create_skin_from_rest_transforms()
	var hand := BoneAttachment3D.new()
	hand.name = "Hand"
	skel.add_child(hand)
	hand.bone_name = "arm_r"
	var grip := Node3D.new()
	grip.name = "Grip"
	hand.add_child(grip)
	grip.position = Vector3(0, -10.5 * PX, -0.5 * PX)
	grip.rotation = Vector3(-PI * 0.5, 0, 0)
	return {"root": root, "skel": skel, "mi": mi, "hand": grip, "mat": mat}

static func rebuild_mesh(parts: Dictionary, cos: Dictionary, vest: int, helm: int) -> void:
	var mi: MeshInstance3D = parts["mi"]
	mi.mesh = build_mesh(cos, vest, helm)

# ------------------------------------------------------------------ mesh
static func _uv_rects(u: int, v: int, w: int, h: int, d: int) -> Dictionary:
	return {
		"top": Rect2(u + d, v, w, d), "bottom": Rect2(u + d + w, v, w, d),
		"right": Rect2(u, v + d, d, h), "front": Rect2(u + d, v + d, w, h),
		"left": Rect2(u + d + w, v + d, d, h), "back": Rect2(u + d + w + d, v + d, w, h)}

static func build_mesh(cos: Dictionary, vest: int, helm: int) -> ArrayMesh:
	var a := _arrays()
	_skin_box(a, Vector3(0, 28, 0), Vector3(8, 8, 8), 3, _uv_rects(0, 0, 8, 8, 8))
	_skin_box(a, Vector3(0, 18, 0), Vector3(8, 12, 4), 2, _uv_rects(16, 16, 8, 12, 4))
	_skin_box(a, Vector3(6, 18, 0), Vector3(4, 12, 4), 4, _uv_rects(40, 16, 4, 12, 4))
	_skin_box(a, Vector3(-6, 18, 0), Vector3(4, 12, 4), 5, _uv_rects(32, 48, 4, 12, 4))
	_skin_box(a, Vector3(2, 6, 0), Vector3(4, 12, 4), 6, _uv_rects(0, 16, 4, 12, 4))
	_skin_box(a, Vector3(-2, 6, 0), Vector3(4, 12, 4), 7, _uv_rects(16, 48, 4, 12, 4))
	var skin: Dictionary = DB.COSMETICS.get(cos.get("skin", "skin_blox"), {})
	var hat: Dictionary = DB.COSMETICS.get(cos.get("helmet", "hat_none"), {})
	var bag: Dictionary = DB.COSMETICS.get(cos.get("backpack", "bag_none"), {})
	# hair volume
	match int(skin.get("hs", 0)):
		2:
			_pal_box(a, Vector3(0, 25.5, 4.6), Vector3(8.2, 7, 1.2), 3, 0)
		3:
			_pal_box(a, Vector3(0, 27, 5), Vector3(2.4, 2.4, 2.4), 3, 0)
			_pal_box(a, Vector3(0, 24.5, 5.6), Vector3(2, 4, 2), 3, 0)
		4:
			for k in 4:
				_pal_box(a, Vector3(-3 + k * 2, 33, -1 + (k % 2) * 2), Vector3(1.6, 2, 1.6), 3, 0)
		5:
			_pal_box(a, Vector3(0, 33.5, 0), Vector3(0.8, 3, 0.8), 3, 1)
			_pal_box(a, Vector3(0, 35.3, 0), Vector3(1.6, 1.6, 1.6), 3, 2)
	# cosmetic hat (visual only)
	match int(hat.get("model", 0)):
		1:
			_pal_box(a, Vector3(0, 32.6, 0), Vector3(8.6, 1.6, 8.6), 3, 3)
			_pal_box(a, Vector3(0, 32.1, -5.6), Vector3(7, 0.6, 3.4), 3, 4)
		2:
			_pal_box(a, Vector3(0, 31.5, 0.2), Vector3(9.2, 3.6, 9.2), 3, 3)
			_pal_box(a, Vector3(0, 32.5, -4.9), Vector3(6, 1, 0.6), 3, 4)
		3:
			_pal_box(a, Vector3(0, 32.4, 0), Vector3(8.8, 2.6, 8.8), 3, 3)
			_pal_box(a, Vector3(0, 30.6, 0), Vector3(9.0, 1.2, 9.0), 3, 4)
			_pal_box(a, Vector3(0, 34.5, 0), Vector3(2, 2, 2), 3, 4)
		4:
			_pal_box(a, Vector3(0, 31.6, 0), Vector3(13, 0.8, 13), 3, 3)
			_pal_box(a, Vector3(0, 33.6, 0), Vector3(8.2, 3.4, 8.2), 3, 3)
			_pal_box(a, Vector3(0, 32.4, 0), Vector3(8.4, 0.8, 8.4), 3, 4)
		5:
			_pal_box(a, Vector3(0, 32.2, 0), Vector3(9, 3, 9), 3, 3)
			_pal_box(a, Vector3(5.2, 34, 0), Vector3(1.6, 4.5, 1.6), 3, 4)
			_pal_box(a, Vector3(-5.2, 34, 0), Vector3(1.6, 4.5, 1.6), 3, 4)
		6:
			_pal_box(a, Vector3(0, 32.6, 0), Vector3(9.6, 1, 1.6), 3, 3)
			_pal_box(a, Vector3(4.6, 28.5, 0), Vector3(1.6, 4, 3.2), 3, 4)
			_pal_box(a, Vector3(-4.6, 28.5, 0), Vector3(1.6, 4, 3.2), 3, 4)
		7:
			_pal_box(a, Vector3(2, 35, 0), Vector3(1.8, 6, 1), 3, 3)
			_pal_box(a, Vector3(-2, 35, 0), Vector3(1.8, 6, 1), 3, 3)
			_pal_box(a, Vector3(2, 35, -0.4), Vector3(1, 4.6, 0.4), 3, 4)
			_pal_box(a, Vector3(-2, 35, -0.4), Vector3(1, 4.6, 0.4), 3, 4)
		8:
			_pal_box(a, Vector3(0, 32.8, 0), Vector3(8.6, 1.6, 8.6), 3, 3)
			for k in 4:
				var off: Vector3 = [Vector3(3.6, 0, 3.6), Vector3(-3.6, 0, 3.6), Vector3(3.6, 0, -3.6), Vector3(-3.6, 0, -3.6)][k]
				_pal_box(a, Vector3(0, 34.4, 0) + off, Vector3(1.4, 1.8, 1.4), 3, 3)
			_pal_box(a, Vector3(0, 33, -4.4), Vector3(1.4, 1.4, 0.4), 3, 4)
	# cosmetic backpack (visual only)
	match int(bag.get("model", 0)):
		1:
			_pal_box(a, Vector3(0, 18, 3.6), Vector3(6, 7, 3.2), 2, 5)
			_pal_box(a, Vector3(0, 15.5, 5.4), Vector3(4.4, 2.4, 0.8), 2, 6)
		2:
			_pal_box(a, Vector3(1.8, 18.5, 3.4), Vector3(2.6, 8, 2.6), 2, 5)
			_pal_box(a, Vector3(-1.8, 18.5, 3.4), Vector3(2.6, 8, 2.6), 2, 5)
			_pal_box(a, Vector3(1.8, 13.8, 3.4), Vector3(1.8, 1.4, 1.8), 2, 6)
			_pal_box(a, Vector3(-1.8, 13.8, 3.4), Vector3(1.8, 1.4, 1.8), 2, 6)
		3:
			_pal_box(a, Vector3(0, 18, 4.2), Vector3(7, 7, 4.4), 2, 5)
			_pal_box(a, Vector3(0, 18, 6.5), Vector3(7.2, 1, 0.3), 2, 6)
		4:
			_pal_box(a, Vector3(4.5, 20, 3.4), Vector3(7, 5, 0.8), 2, 5)
			_pal_box(a, Vector3(-4.5, 20, 3.4), Vector3(7, 5, 0.8), 2, 5)
			_pal_box(a, Vector3(6, 18, 3.4), Vector3(4, 3, 0.9), 2, 6)
			_pal_box(a, Vector3(-6, 18, 3.4), Vector3(4, 3, 0.9), 2, 6)
		5:
			_pal_box(a, Vector3(0, 19, 4.6), Vector3(5, 5, 5), 2, 5)
			_pal_box(a, Vector3(0, 19, 7.15), Vector3(2, 2, 0.2), 2, 6)
	# gameplay armour (same look for everyone - shows level only)
	if vest > 0:
		_pal_box(a, Vector3(0, 18.5, 0), Vector3(8.8, 7.5, 4.8), 2, 7 + vest)
	if helm > 0:
		_pal_box(a, Vector3(0, 30.2, 0), Vector3(8.7, 1.4, 8.7), 3, 7 + helm)
	var mesh := ArrayMesh.new()
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = a["v"]
	arr[Mesh.ARRAY_NORMAL] = a["n"]
	arr[Mesh.ARRAY_TEX_UV] = a["uv"]
	arr[Mesh.ARRAY_COLOR] = a["c"]
	arr[Mesh.ARRAY_BONES] = a["b"]
	arr[Mesh.ARRAY_WEIGHTS] = a["w"]
	arr[Mesh.ARRAY_INDEX] = a["i"]
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return mesh

static func _arrays() -> Dictionary:
	return {"v": PackedVector3Array(), "n": PackedVector3Array(), "uv": PackedVector2Array(), "c": PackedColorArray(),
		"b": PackedInt32Array(), "w": PackedFloat32Array(), "i": PackedInt32Array()}

## face: [normal, 4 corners TL,TR,BR,BL as seen from outside (= clockwise, Godot front faces), uv-rect key, shade]
const FACES := [
	[Vector3(0, 0, -1), [Vector3(0.5, 0.5, -0.5), Vector3(-0.5, 0.5, -0.5), Vector3(-0.5, -0.5, -0.5), Vector3(0.5, -0.5, -0.5)], "front", 0.86],
	[Vector3(0, 0, 1), [Vector3(-0.5, 0.5, 0.5), Vector3(0.5, 0.5, 0.5), Vector3(0.5, -0.5, 0.5), Vector3(-0.5, -0.5, 0.5)], "back", 0.86],
	[Vector3(1, 0, 0), [Vector3(0.5, 0.5, 0.5), Vector3(0.5, 0.5, -0.5), Vector3(0.5, -0.5, -0.5), Vector3(0.5, -0.5, 0.5)], "right", 0.76],
	[Vector3(-1, 0, 0), [Vector3(-0.5, 0.5, -0.5), Vector3(-0.5, 0.5, 0.5), Vector3(-0.5, -0.5, 0.5), Vector3(-0.5, -0.5, -0.5)], "left", 0.76],
	[Vector3(0, 1, 0), [Vector3(0.5, 0.5, 0.5), Vector3(-0.5, 0.5, 0.5), Vector3(-0.5, 0.5, -0.5), Vector3(0.5, 0.5, -0.5)], "top", 1.0],
	[Vector3(0, -1, 0), [Vector3(0.5, -0.5, -0.5), Vector3(-0.5, -0.5, -0.5), Vector3(-0.5, -0.5, 0.5), Vector3(0.5, -0.5, 0.5)], "bottom", 0.6],
]

static func _skin_box(a: Dictionary, c: Vector3, s: Vector3, bone: int, rects: Dictionary) -> void:
	for f in FACES:
		var r: Rect2 = rects[f[2]]
		var uvs := [Vector2(r.position.x, r.position.y), Vector2(r.end.x, r.position.y), Vector2(r.end.x, r.end.y), Vector2(r.position.x, r.end.y)]
		if f[2] == "bottom":
			uvs = [Vector2(r.position.x, r.end.y), Vector2(r.end.x, r.end.y), Vector2(r.end.x, r.position.y), Vector2(r.position.x, r.position.y)]
		_face(a, c, s, bone, f, uvs)

static func _pal_box(a: Dictionary, c: Vector3, s: Vector3, bone: int, pal: int) -> void:
	var u := Vector2((pal % 16) * 4 + 2, PALETTE_Y + (pal / 16) * 4 + 2)
	for f in FACES:
		_face(a, c, s, bone, f, [u, u, u, u])

static func _face(a: Dictionary, c: Vector3, s: Vector3, bone: int, f: Array, uvs: Array) -> void:
	# Packed arrays are values: work on locals and write them back to the dictionary.
	var v: PackedVector3Array = a["v"]
	var n: PackedVector3Array = a["n"]
	var uv: PackedVector2Array = a["uv"]
	var col: PackedColorArray = a["c"]
	var bones: PackedInt32Array = a["b"]
	var weights: PackedFloat32Array = a["w"]
	var idx: PackedInt32Array = a["i"]
	var start := v.size()
	var corners: Array = f[1]
	var shade: float = f[3]
	for k in 4:
		var cp: Vector3 = corners[k]
		v.append((c + cp * s) * PX)
		n.append(f[0])
		uv.append(uvs[k] / 64.0)
		col.append(Color(shade, shade, shade))
		bones.append_array([bone, 0, 0, 0])
		weights.append_array([1.0, 0.0, 0.0, 0.0])
	idx.append_array([start, start + 1, start + 2, start, start + 2, start + 3])
	a["v"] = v
	a["n"] = n
	a["uv"] = uv
	a["c"] = col
	a["b"] = bones
	a["w"] = weights
	a["i"] = idx

# ------------------------------------------------------------------ skin painting
static func paint_skin(cos: Dictionary) -> Image:
	var skin: Dictionary = DB.COSMETICS.get(cos.get("skin", "skin_blox"), DB.COSMETICS["skin_blox"])
	var fit: Dictionary = DB.COSMETICS.get(cos.get("outfit", "fit_scout"), DB.COSMETICS["fit_scout"])
	var hat: Dictionary = DB.COSMETICS.get(cos.get("helmet", "hat_none"), {})
	var bag: Dictionary = DB.COSMETICS.get(cos.get("backpack", "bag_none"), {})
	var img := Image.create_empty(64, 64, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(str(cos.get("skin", "")) + str(cos.get("outfit", "")))
	var tone: Color = skin["tone"]
	var hair: Color = skin["hair"]
	var eye: Color = skin["eye"]
	var shirt: Color = fit["shirt"]
	var pat: Color = fit["pat"]
	var pants: Color = fit["pants"]
	var shoes: Color = fit["shoes"]
	var style: int = fit["style"]
	# head
	var head := _uv_rects(0, 0, 8, 8, 8)
	for k in head:
		_fill_rect(img, head[k], tone, 0.04, rng)
	_fill_rect(img, head["top"], hair, 0.08, rng)
	var hs: int = skin["hs"]
	var hair_rows := 2 if hs != 5 else 0
	for key in ["right", "left", "back", "front"]:
		var r: Rect2 = head[key]
		var rows := hair_rows + (3 if key == "back" else (1 if key != "front" else 0))
		if hs == 2 and key != "front":
			rows = 7
		if hs == 1:
			rows = mini(rows, 1)
		for y in rows:
			for x in int(r.size.x):
				img.set_pixel(int(r.position.x) + x, int(r.position.y) + y, _jit(hair, 0.08, rng))
	var f: Rect2 = head["front"]
	var fx := int(f.position.x)
	var fy := int(f.position.y)
	if hs == 3 or hs == 4:
		for x in 8:
			if x % 3 != 2:
				img.set_pixel(fx + x, fy + 1, _jit(hair, 0.06, rng))
	var face: int = skin["face"]
	if face == 5:
		# robot visor
		for x in range(1, 7):
			img.set_pixel(fx + x, fy + 3, Color(0.1, 0.1, 0.12))
			img.set_pixel(fx + x, fy + 4, eye if x == 2 or x == 5 else Color(0.15, 0.15, 0.18))
	else:
		img.set_pixel(fx + 1, fy + 4, Color.WHITE)
		img.set_pixel(fx + 2, fy + 4, eye)
		img.set_pixel(fx + 5, fy + 4, eye)
		img.set_pixel(fx + 6, fy + 4, Color.WHITE)
		var brow := hair.darkened(0.2)
		img.set_pixel(fx + 1, fy + 3, brow)
		img.set_pixel(fx + 2, fy + 3, brow)
		img.set_pixel(fx + 5, fy + 3, brow)
		img.set_pixel(fx + 6, fy + 3, brow)
		var mouth := tone.darkened(0.45)
		img.set_pixel(fx + 3, fy + 6, mouth)
		img.set_pixel(fx + 4, fy + 6, mouth)
		if face == 1:
			img.set_pixel(fx + 2, fy + 6, mouth)
			img.set_pixel(fx + 5, fy + 6, mouth)
		if face == 2:
			for x in range(1, 7):
				img.set_pixel(fx + x, fy + 7, hair.darkened(0.1))
			img.set_pixel(fx + 2, fy + 6, hair.darkened(0.1))
			img.set_pixel(fx + 5, fy + 6, hair.darkened(0.1))
		if face == 3:
			img.set_pixel(fx + 1, fy + 5, Color(1, 0.55, 0.55))
			img.set_pixel(fx + 6, fy + 5, Color(1, 0.55, 0.55))
		if face == 4:
			img.set_pixel(fx + 2, fy + 2, Color(0.75, 0.2, 0.85))
			img.set_pixel(fx + 5, fy + 2, Color(0.75, 0.2, 0.85))
	# body / shirt
	var body := _uv_rects(16, 16, 8, 12, 4)
	for k in body:
		_fill_rect(img, body[k], shirt, 0.05, rng)
	var front: Rect2 = body["front"]
	var bx := int(front.position.x)
	var by := int(front.position.y)
	match style:
		0, 4:
			for k in body:
				_blotches(img, body[k], pat, rng, 3)
		1:
			for y in range(6, 10):
				for x in range(1, 7):
					img.set_pixel(bx + x, by + y, _jit(shirt.darkened(0.12), 0.03, rng))
			img.set_pixel(bx + 3, by + 1, pat)
			img.set_pixel(bx + 3, by + 2, pat)
			img.set_pixel(bx + 4, by + 1, pat)
			img.set_pixel(bx + 4, by + 2, pat)
		2:
			for y in 12:
				img.set_pixel(bx + 3, by + y, pat)
				img.set_pixel(bx + 4, by + y, Color(0.75, 0.75, 0.78))
			for k in ["right", "left"]:
				var rr: Rect2 = body[k]
				for y in 12:
					img.set_pixel(int(rr.position.x) + 1, int(rr.position.y) + y, pat)
		3:
			for y in range(1, 11, 3):
				img.set_pixel(bx + 4, by + y, pat)
			for x in 8:
				img.set_pixel(bx + x, by + 10, pat.darkened(0.3))
				img.set_pixel(bx + x, by + 11, pat.darkened(0.3))
			for x in range(1, 7):
				img.set_pixel(bx + x, by, pat)
		5:
			for y in 12:
				img.set_pixel(bx + (y % 8), by + y, pat)
			for x in 8:
				img.set_pixel(bx + x, by + 6, pat)
	# arms: sleeves + hands
	for o in [Vector2i(40, 16), Vector2i(32, 48)]:
		var arm := _uv_rects(o.x, o.y, 4, 12, 4)
		for k in arm:
			_fill_rect(img, arm[k], shirt, 0.05, rng)
		if style == 0 or style == 4:
			for k in arm:
				_blotches(img, arm[k], pat, rng, 1)
		for k in ["right", "front", "left", "back"]:
			var rr: Rect2 = arm[k]
			for y in range(9, 12):
				for x in int(rr.size.x):
					img.set_pixel(int(rr.position.x) + x, int(rr.position.y) + y, _jit(tone, 0.04, rng))
			if style == 5:
				for x in int(rr.size.x):
					img.set_pixel(int(rr.position.x) + x, int(rr.position.y) + 8, pat)
		_fill_rect(img, arm["bottom"], tone, 0.04, rng)
	# legs: pants + shoes
	for o in [Vector2i(0, 16), Vector2i(16, 48)]:
		var leg := _uv_rects(o.x, o.y, 4, 12, 4)
		for k in leg:
			_fill_rect(img, leg[k], pants, 0.05, rng)
		if style == 4:
			for k in leg:
				_blotches(img, leg[k], pants.darkened(0.2), rng, 2)
		for k in ["right", "front", "left", "back"]:
			var rr: Rect2 = leg[k]
			for y in range(9, 12):
				for x in int(rr.size.x):
					img.set_pixel(int(rr.position.x) + x, int(rr.position.y) + y, _jit(shoes, 0.05, rng))
		_fill_rect(img, leg["bottom"], shoes.darkened(0.3), 0.03, rng)
	# palette strip (rows 32..47): 0 hair, 1 grey, 2 eye, 3 hat col, 4 hat col2, 5 bag col, 6 bag col2, 8..10 armour
	var pal := [hair, Color(0.4, 0.42, 0.45), eye, hat.get("col", Color.GRAY), hat.get("col2", Color.WHITE), bag.get("col", Color.GRAY),
		bag.get("col2", Color.WHITE), Color.WHITE, Color(0.55, 0.47, 0.33), Color(0.28, 0.33, 0.24), Color(0.12, 0.12, 0.14)]
	for p in pal.size():
		var cx := (p % 16) * 4
		var cy := PALETTE_Y + (p / 16) * 4
		for y in 4:
			for x in 4:
				img.set_pixel(cx + x, cy + y, pal[p])
	return img

static func _jit(c: Color, v: float, rng: RandomNumberGenerator) -> Color:
	var k := 1.0 + rng.randf_range(-v, v)
	return Color(clampf(c.r * k, 0, 1), clampf(c.g * k, 0, 1), clampf(c.b * k, 0, 1), 1.0)

static func _fill_rect(img: Image, r: Rect2, c: Color, v: float, rng: RandomNumberGenerator) -> void:
	for y in int(r.size.y):
		for x in int(r.size.x):
			img.set_pixel(int(r.position.x) + x, int(r.position.y) + y, _jit(c, v, rng))

static func _blotches(img: Image, r: Rect2, c: Color, rng: RandomNumberGenerator, n: int) -> void:
	for i in n:
		var px := int(r.position.x) + rng.randi_range(0, int(r.size.x) - 1)
		var py := int(r.position.y) + rng.randi_range(0, int(r.size.y) - 1)
		for k in 5:
			var qx := clampi(px + rng.randi_range(-1, 1), int(r.position.x), int(r.end.x) - 1)
			var qy := clampi(py + rng.randi_range(-1, 1), int(r.position.y), int(r.end.y) - 1)
			img.set_pixel(qx, qy, _jit(c, 0.05, rng))
