class_name VoxelArt
extends RefCounted
## Procedurally paints every block texture (16x16 pixel art) into a Texture2DArray and owns the
## shared voxel materials. All art is generated at runtime - no external image assets needed.

static var atlas: Texture2DArray
static var mat_lit: ShaderMaterial
static var mat_unlit: ShaderMaterial
static var mat_trans: ShaderMaterial
static var mat_vcolor: StandardMaterial3D        # vertex-coloured props (weapons, loot, plane...)
static var mat_vcolor_unshaded: StandardMaterial3D
static var mat_glow: StandardMaterial3D          # additive effects
static var unlit_mode := false
static var _built := false

const LIT_SHADER := """
shader_type spatial;
render_mode diffuse_lambert, specular_disabled;
uniform sampler2DArray atlas : source_color, filter_nearest_mipmap, repeat_enable;
varying flat float v_layer;
varying flat float v_emit;
void vertex() {
	v_layer = UV2.x;
	v_emit = UV2.y;
}
void fragment() {
	vec4 t = texture(atlas, vec3(UV, v_layer));
	ALBEDO = t.rgb * COLOR.rgb;
	ROUGHNESS = 1.0;
	EMISSION = t.rgb * v_emit * 1.4;
}
"""

const UNLIT_SHADER := """
shader_type spatial;
render_mode unshaded;
uniform sampler2DArray atlas : source_color, filter_nearest_mipmap, repeat_enable;
uniform vec3 light_tint = vec3(1.0, 1.0, 1.0);
varying flat float v_layer;
varying float v_shade;
void vertex() {
	v_layer = UV2.x;
	vec3 n = NORMAL;
	v_shade = n.y > 0.5 ? 1.0 : (n.y < -0.5 ? 0.55 : (abs(n.x) > 0.5 ? 0.82 : 0.7));
	v_shade = max(v_shade, UV2.y);
}
void fragment() {
	vec4 t = texture(atlas, vec3(UV, v_layer));
	ALBEDO = t.rgb * COLOR.rgb * v_shade * light_tint;
}
"""

const TRANS_SHADER := """
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_disabled, diffuse_lambert;
uniform sampler2DArray atlas : source_color, filter_nearest_mipmap, repeat_enable;
uniform float water_layer = 5.0;
varying flat float v_layer;
void vertex() {
	v_layer = UV2.x;
}
void fragment() {
	float is_water = 1.0 - step(0.25, abs(v_layer - water_layer));
	vec2 uv = UV + is_water * vec2(TIME * 0.06, TIME * 0.035);
	vec4 t = texture(atlas, vec3(uv, v_layer));
	ALBEDO = t.rgb * COLOR.rgb;
	ALPHA = t.a;
	ROUGHNESS = mix(0.9, 0.12, is_water);
	SPECULAR = mix(0.2, 0.6, is_water);
}
"""

static func build() -> void:
	if _built:
		return
	_built = true
	Blocks.setup()
	var imgs: Array[Image] = []
	for i in Blocks.TILES.size():
		var img := Image.create_empty(16, 16, false, Image.FORMAT_RGBA8)
		var rng := RandomNumberGenerator.new()
		rng.seed = 9001 + i * 7919
		_paint(Blocks.TILES[i], img, rng)
		img.generate_mipmaps()
		imgs.append(img)
	atlas = Texture2DArray.new()
	atlas.create_from_images(imgs)
	mat_lit = _shader_mat(LIT_SHADER)
	mat_unlit = _shader_mat(UNLIT_SHADER)
	mat_trans = _shader_mat(TRANS_SHADER)
	mat_trans.set_shader_parameter("water_layer", float(Blocks.TILES.find("water")))
	mat_trans.render_priority = 1
	mat_vcolor = StandardMaterial3D.new()
	mat_vcolor.vertex_color_use_as_albedo = true
	mat_vcolor.roughness = 0.75
	mat_vcolor.metallic = 0.15
	mat_vcolor_unshaded = StandardMaterial3D.new()
	mat_vcolor_unshaded.vertex_color_use_as_albedo = true
	mat_vcolor_unshaded.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat_glow = StandardMaterial3D.new()
	mat_glow.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat_glow.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat_glow.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	mat_glow.vertex_color_use_as_albedo = true
	mat_glow.cull_mode = BaseMaterial3D.CULL_DISABLED
	mat_glow.no_depth_test = false

static func _shader_mat(code: String) -> ShaderMaterial:
	var sh := Shader.new()
	sh.code = code
	var m := ShaderMaterial.new()
	m.shader = sh
	m.set_shader_parameter("atlas", atlas)
	return m

static func terrain_material() -> Material:
	return mat_unlit if unlit_mode else mat_lit

static func prop_material() -> Material:
	return mat_vcolor_unshaded if unlit_mode else mat_vcolor

# ------------------------------------------------------------------ painting helpers
static func _px(img: Image, x: int, y: int, c: Color) -> void:
	img.set_pixel(x & 15, y & 15, c)

static func _fill(img: Image, base: Color, variance: float, rng: RandomNumberGenerator) -> void:
	for y in 16:
		for x in 16:
			var f := 1.0 + rng.randf_range(-variance, variance)
			img.set_pixel(x, y, Color(clampf(base.r * f, 0, 1), clampf(base.g * f, 0, 1), clampf(base.b * f, 0, 1), base.a))

static func _speckle(img: Image, c: Color, count: int, rng: RandomNumberGenerator) -> void:
	for i in count:
		_px(img, rng.randi() % 16, rng.randi() % 16, c)

static func _rect(img: Image, x0: int, y0: int, w: int, h: int, c: Color) -> void:
	for y in range(y0, y0 + h):
		for x in range(x0, x0 + w):
			_px(img, x, y, c)

static func _shade(c: Color, f: float) -> Color:
	return Color(clampf(c.r * f, 0, 1), clampf(c.g * f, 0, 1), clampf(c.b * f, 0, 1), c.a)

static func _planks(img: Image, base: Color, rng: RandomNumberGenerator) -> void:
	_fill(img, base, 0.06, rng)
	for row in 4:
		var off := (row * 5) % 16
		var tone := 1.0 + rng.randf_range(-0.08, 0.08)
		for y in range(row * 4, row * 4 + 4):
			for x in 16:
				var c := img.get_pixel(x, y)
				img.set_pixel(x, y, _shade(c, tone))
		for x in 16:
			_px(img, x, row * 4 + 3, _shade(base, 0.62))
		_px(img, off, row * 4, _shade(base, 0.7))
		_px(img, off, row * 4 + 1, _shade(base, 0.7))
		_px(img, off, row * 4 + 2, _shade(base, 0.7))
		_px(img, off + 2, row * 4 + 1, _shade(base, 0.55))

static func _jagged_top(img: Image, c: Color, depth: int, rng: RandomNumberGenerator) -> void:
	for x in 16:
		var d := depth + rng.randi_range(-1, 1)
		for y in d:
			var f := 1.0 + rng.randf_range(-0.1, 0.1)
			img.set_pixel(x, y, _shade(c, f))

static func _cells(img: Image, base: Color, n: int, rng: RandomNumberGenerator, mortar: Color) -> void:
	var pts := []
	for i in n:
		pts.append([Vector2(rng.randf() * 16, rng.randf() * 16), 1.0 + rng.randf_range(-0.15, 0.15)])
	for y in 16:
		for x in 16:
			var best := 1e9
			var second := 1e9
			var tone := 1.0
			for p in pts:
				for ox in [-16, 0, 16]:
					for oy in [-16, 0, 16]:
						var d := Vector2(x + 0.5 - (p[0].x + ox), y + 0.5 - (p[0].y + oy)).length()
						if d < best:
							second = best
							best = d
							tone = p[1]
						elif d < second:
							second = d
			if second - best < 1.1:
				img.set_pixel(x, y, mortar)
			else:
				img.set_pixel(x, y, _shade(base, tone * (1.0 + rng.randf_range(-0.05, 0.05))))

static func _paint(name: String, img: Image, rng: RandomNumberGenerator) -> void:
	match name:
		"grass_top":
			_fill(img, Color(0.36, 0.62, 0.27), 0.1, rng)
			_speckle(img, Color(0.46, 0.73, 0.33), 22, rng)
			_speckle(img, Color(0.27, 0.5, 0.2), 22, rng)
		"grass_side":
			_fill(img, Color(0.52, 0.37, 0.24), 0.1, rng)
			_speckle(img, Color(0.4, 0.28, 0.18), 14, rng)
			_jagged_top(img, Color(0.36, 0.62, 0.27), 4, rng)
		"dirt":
			_fill(img, Color(0.52, 0.37, 0.24), 0.1, rng)
			_speckle(img, Color(0.4, 0.28, 0.18), 20, rng)
			_speckle(img, Color(0.63, 0.5, 0.36), 9, rng)
		"stone":
			_fill(img, Color(0.53, 0.53, 0.55), 0.07, rng)
			for i in 6:
				var x := rng.randi() % 16
				var y := rng.randi() % 16
				for k in rng.randi_range(2, 4):
					_px(img, x + k, y + (k % 2), Color(0.42, 0.42, 0.44))
			_speckle(img, Color(0.62, 0.62, 0.64), 12, rng)
		"sand":
			_fill(img, Color(0.87, 0.81, 0.57), 0.05, rng)
			_speckle(img, Color(0.78, 0.71, 0.48), 18, rng)
			_speckle(img, Color(0.95, 0.9, 0.7), 10, rng)
		"water":
			_fill(img, Color(0.2, 0.45, 0.78, 0.78), 0.05, rng)
			for i in 5:
				var y := rng.randi() % 16
				var x := rng.randi() % 16
				for k in rng.randi_range(3, 6):
					_px(img, x + k, y, Color(0.45, 0.68, 0.92, 0.82))
		"log_side":
			for y in 16:
				for x in 16:
					var dark := (x % 4 == 0) or (x % 4 == 3 and rng.randf() < 0.4)
					var c := Color(0.34, 0.24, 0.14) if dark else Color(0.43, 0.31, 0.18)
					img.set_pixel(x, y, _shade(c, 1.0 + rng.randf_range(-0.08, 0.08)))
		"log_top":
			for y in 16:
				for x in 16:
					var d := maxi(absi(x * 2 - 15), absi(y * 2 - 15)) / 2
					var c := Color(0.36, 0.25, 0.14)
					if d < 7:
						c = Color(0.72, 0.56, 0.35) if d % 2 == 0 else Color(0.62, 0.47, 0.28)
					img.set_pixel(x, y, _shade(c, 1.0 + rng.randf_range(-0.05, 0.05)))
		"leaves":
			_fill(img, Color(0.22, 0.5, 0.2), 0.18, rng)
			_speckle(img, Color(0.13, 0.33, 0.12), 26, rng)
			_speckle(img, Color(0.35, 0.65, 0.3), 14, rng)
		"pine_leaves":
			_fill(img, Color(0.15, 0.35, 0.23), 0.16, rng)
			_speckle(img, Color(0.09, 0.22, 0.15), 26, rng)
			_speckle(img, Color(0.24, 0.48, 0.32), 12, rng)
		"planks":
			_planks(img, Color(0.72, 0.55, 0.33), rng)
		"dark_planks":
			_planks(img, Color(0.42, 0.29, 0.17), rng)
		"brick":
			_fill(img, Color(0.74, 0.71, 0.65), 0.04, rng)
			for row in 4:
				var off := 0 if row % 2 == 0 else 4
				for b in 3:
					var tone := 1.0 + rng.randf_range(-0.12, 0.1)
					var bx := off + b * 8
					for y in range(row * 4, row * 4 + 3):
						for x in range(bx, bx + 7):
							_px(img, x, y, _shade(Color(0.67, 0.31, 0.24), tone * (1.0 + rng.randf_range(-0.05, 0.05))))
		"roof_red", "roof_blue":
			var base := Color(0.72, 0.26, 0.2) if name == "roof_red" else Color(0.26, 0.4, 0.68)
			_fill(img, base, 0.05, rng)
			for row in 4:
				for x in 16:
					_px(img, x, row * 4 + 3, _shade(base, 0.6))
					if (x + row * 2) % 4 == 0:
						_px(img, x, row * 4 + 2, _shade(base, 0.75))
				for x in 16:
					_px(img, x, row * 4, _shade(base, 1.15))
		"concrete":
			_fill(img, Color(0.7, 0.7, 0.68), 0.035, rng)
			_speckle(img, Color(0.62, 0.62, 0.6), 10, rng)
		"metal":
			_fill(img, Color(0.37, 0.41, 0.35), 0.04, rng)
			for i in 16:
				_px(img, i, 0, Color(0.27, 0.3, 0.26))
				_px(img, 0, i, Color(0.27, 0.3, 0.26))
				_px(img, i, 8, Color(0.3, 0.34, 0.29))
				_px(img, i, 15, Color(0.45, 0.5, 0.43))
			for p in [Vector2i(2, 2), Vector2i(13, 2), Vector2i(2, 11), Vector2i(13, 11)]:
				_px(img, p.x, p.y, Color(0.58, 0.62, 0.55))
		"crate":
			_planks(img, Color(0.66, 0.48, 0.27), rng)
			var dark := Color(0.4, 0.27, 0.13)
			for i in 16:
				_px(img, i, 0, dark)
				_px(img, i, 1, dark)
				_px(img, i, 14, dark)
				_px(img, i, 15, dark)
				_px(img, 0, i, dark)
				_px(img, 1, i, dark)
				_px(img, 14, i, dark)
				_px(img, 15, i, dark)
				_px(img, i, i, dark)
				_px(img, i, 15 - i, dark)
		"glass":
			for y in 16:
				for x in 16:
					img.set_pixel(x, y, Color(0.75, 0.9, 0.97, 0.22))
			for i in 16:
				_px(img, i, 0, Color(0.85, 0.92, 0.96, 0.95))
				_px(img, i, 15, Color(0.85, 0.92, 0.96, 0.95))
				_px(img, 0, i, Color(0.85, 0.92, 0.96, 0.95))
				_px(img, 15, i, Color(0.85, 0.92, 0.96, 0.95))
			for k in 4:
				_px(img, 3 + k, 7 - k, Color(1, 1, 1, 0.6))
				_px(img, 6 + k, 11 - k, Color(1, 1, 1, 0.45))
		"gravel":
			_fill(img, Color(0.53, 0.51, 0.49), 0.12, rng)
			_speckle(img, Color(0.38, 0.37, 0.36), 24, rng)
			_speckle(img, Color(0.68, 0.66, 0.63), 18, rng)
		"asphalt":
			_fill(img, Color(0.23, 0.23, 0.25), 0.09, rng)
			_speckle(img, Color(0.32, 0.32, 0.33), 10, rng)
		"road_line":
			_fill(img, Color(0.23, 0.23, 0.25), 0.09, rng)
			for y in 16:
				if y % 8 < 5:
					_px(img, 7, y, Color(0.95, 0.82, 0.2))
					_px(img, 8, y, Color(0.95, 0.82, 0.2))
		"snow":
			_fill(img, Color(0.95, 0.96, 0.98), 0.03, rng)
			_speckle(img, Color(0.82, 0.88, 0.96), 12, rng)
		"snow_side":
			_fill(img, Color(0.52, 0.37, 0.24), 0.1, rng)
			_speckle(img, Color(0.4, 0.28, 0.18), 14, rng)
			_jagged_top(img, Color(0.95, 0.96, 0.98), 5, rng)
		"sandstone":
			_fill(img, Color(0.83, 0.73, 0.5), 0.04, rng)
			for x in 16:
				_px(img, x, 0, Color(0.9, 0.82, 0.6))
				_px(img, x, 5, Color(0.74, 0.64, 0.43))
				_px(img, x, 10, Color(0.74, 0.64, 0.43))
				_px(img, x, 15, Color(0.7, 0.6, 0.4))
		"cobble":
			_cells(img, Color(0.5, 0.5, 0.51), 7, rng, Color(0.3, 0.3, 0.31))
		"mossy":
			_cells(img, Color(0.5, 0.5, 0.51), 7, rng, Color(0.3, 0.3, 0.31))
			_speckle(img, Color(0.33, 0.52, 0.27), 30, rng)
			_speckle(img, Color(0.25, 0.42, 0.2), 16, rng)
		"hay":
			for y in 16:
				for x in 16:
					var c := Color(0.86, 0.72, 0.26) if (x + rng.randi() % 2) % 3 != 0 else Color(0.74, 0.58, 0.18)
					img.set_pixel(x, y, c)
			for x in 16:
				_px(img, x, 3, Color(0.55, 0.4, 0.12))
				_px(img, x, 12, Color(0.55, 0.4, 0.12))
		"hay_top":
			_fill(img, Color(0.84, 0.7, 0.25), 0.15, rng)
			_speckle(img, Color(0.7, 0.55, 0.16), 30, rng)
		"sandbag":
			_fill(img, Color(0.72, 0.64, 0.46), 0.05, rng)
			for row in 3:
				var y0 := row * 5 + 1
				var off := 0 if row % 2 == 0 else 4
				for x in 16:
					_px(img, x, y0 + 4, Color(0.48, 0.42, 0.3))
				_px(img, off, y0 + 1, Color(0.52, 0.45, 0.32))
				_px(img, off, y0 + 2, Color(0.52, 0.45, 0.32))
				_px(img, off + 8, y0 + 1, Color(0.52, 0.45, 0.32))
				_px(img, off + 8, y0 + 2, Color(0.52, 0.45, 0.32))
		"camo":
			_fill(img, Color(0.32, 0.4, 0.24), 0.05, rng)
			for i in 7:
				var cx := rng.randi() % 16
				var cy := rng.randi() % 16
				var c: Color = [Color(0.45, 0.36, 0.22), Color(0.2, 0.27, 0.16), Color(0.5, 0.52, 0.32)][i % 3]
				for k in rng.randi_range(6, 12):
					_px(img, cx + rng.randi_range(-2, 2), cy + rng.randi_range(-2, 2), c)
		"lamp":
			_fill(img, Color(1.0, 0.92, 0.6), 0.05, rng)
			for i in 16:
				_px(img, i, 0, Color(0.3, 0.27, 0.2))
				_px(img, i, 15, Color(0.3, 0.27, 0.2))
				_px(img, 0, i, Color(0.3, 0.27, 0.2))
				_px(img, 15, i, Color(0.3, 0.27, 0.2))
			_rect(img, 5, 5, 6, 6, Color(1, 1, 0.9))
		"build":
			_fill(img, Color(0.25, 0.68, 0.95), 0.04, rng)
			for i in 16:
				_px(img, i, 0, Color(0.9, 0.97, 1.0))
				_px(img, 0, i, Color(0.9, 0.97, 1.0))
				_px(img, i, 15, Color(0.12, 0.42, 0.7))
				_px(img, 15, i, Color(0.12, 0.42, 0.7))
				_px(img, i, 8, Color(0.4, 0.8, 1.0))
				_px(img, 8, i, Color(0.4, 0.8, 1.0))
		"bedrock":
			_fill(img, Color(0.18, 0.18, 0.19), 0.3, rng)
		"team_red", "team_blue":
			var tc := Color(0.82, 0.2, 0.2) if name == "team_red" else Color(0.2, 0.4, 0.88)
			_fill(img, tc, 0.08, rng)
			for i in 16:
				_px(img, i, (i * 3) % 16, _shade(tc, 0.85))
		"target":
			for y in 16:
				for x in 16:
					var d := Vector2(x - 7.5, y - 7.5).length()
					var ring := int(d / 2.0)
					img.set_pixel(x, y, Color(0.9, 0.12, 0.12) if ring % 2 == 0 else Color(0.97, 0.97, 0.97))
		"farmland":
			_fill(img, Color(0.4, 0.27, 0.16), 0.1, rng)
			for y in 16:
				if y % 4 == 0:
					for x in 16:
						_px(img, x, y, Color(0.3, 0.2, 0.12))
				elif y % 4 == 2:
					for x in 16:
						if rng.randf() < 0.3:
							_px(img, x, y, Color(0.35, 0.62, 0.25))
		_:
			_fill(img, Color(1, 0, 1), 0.0, rng)
