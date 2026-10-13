class_name Effects
extends Node3D
## Pooled visual effects. All particles are CPUParticles3D (works on every GLES3 device).

var _tracers: Array[MeshInstance3D] = []
var _bursts: Array[CPUParticles3D] = []
var _numbers: Array[Label3D] = []
var _lights: Array[OmniLight3D] = []
var _smokes: Array[CPUParticles3D] = []
var _ti := 0
var _bi := 0
var _ni := 0
var _li := 0
var _active: Array = []        # [node, kind, t0, life, data]
var particle_scale := 1.0
var cube_mat: StandardMaterial3D
var zone_wall: MeshInstance3D
var zone_mat: ShaderMaterial

const ZONE_SHADER := """
shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, blend_mix;
uniform vec4 col : source_color = vec4(0.25, 0.55, 1.0, 0.4);
void fragment() {
	float stripes = step(0.5, fract(UV.x * 160.0 + TIME * 0.6));
	float fade = smoothstep(0.0, 0.05, UV.y) * smoothstep(1.0, 0.6, UV.y);
	ALBEDO = col.rgb * (0.8 + stripes * 0.4);
	ALPHA = col.a * (0.55 + stripes * 0.45) * (0.4 + fade * 0.6);
}
"""

func _ready() -> void:
	cube_mat = StandardMaterial3D.new()
	cube_mat.vertex_color_use_as_albedo = true
	cube_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	var tracer_mesh := Models.boxes_mesh([[Vector3(0, 0, -0.5), Vector3(0.035, 0.035, 1.0), Color(1.0, 0.9, 0.55, 0.85)]], false)
	for i in 28:
		var t := MeshInstance3D.new()
		t.mesh = tracer_mesh
		t.material_override = VoxelArt.mat_glow
		t.visible = false
		t.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(t)
		_tracers.append(t)
	var cube := BoxMesh.new()
	cube.size = Vector3(0.09, 0.09, 0.09)
	cube.material = cube_mat
	for i in 18:
		var p := CPUParticles3D.new()
		p.mesh = cube
		p.one_shot = true
		p.emitting = false
		p.explosiveness = 0.95
		p.amount = 10
		p.lifetime = 0.5
		p.direction = Vector3(0, 1, 0)
		p.spread = 55.0
		p.initial_velocity_min = 2.0
		p.initial_velocity_max = 4.5
		p.gravity = Vector3(0, -14, 0)
		p.scale_amount_min = 0.6
		p.scale_amount_max = 1.3
		p.local_coords = false
		p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(p)
		_bursts.append(p)
	var smoke_cube := BoxMesh.new()
	smoke_cube.size = Vector3(1.0, 1.0, 1.0)
	smoke_cube.material = cube_mat
	for i in 4:
		var s := CPUParticles3D.new()
		s.mesh = smoke_cube
		s.emitting = false
		s.amount = 46
		s.lifetime = 3.2
		s.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
		s.emission_sphere_radius = 3.2
		s.direction = Vector3(0, 1, 0)
		s.spread = 180.0
		s.initial_velocity_min = 0.2
		s.initial_velocity_max = 0.8
		s.gravity = Vector3(0, 0.25, 0)
		s.scale_amount_min = 1.4
		s.scale_amount_max = 2.6
		s.color = Color(0.82, 0.84, 0.86)
		s.local_coords = false
		s.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(s)
		_smokes.append(s)
	for i in 14:
		var l := Label3D.new()
		l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		l.no_depth_test = true
		l.font_size = 64
		l.outline_size = 14
		l.pixel_size = 0.004
		l.fixed_size = false
		l.visible = false
		add_child(l)
		_numbers.append(l)
	for i in 3:
		var o := OmniLight3D.new()
		o.light_color = Color(1.0, 0.65, 0.3)
		o.visible = false
		o.shadow_enabled = false
		add_child(o)
		_lights.append(o)
	# zone wall cylinder (UV.x around, UV.y height)
	var cyl := CylinderMesh.new()
	cyl.top_radius = 1.0
	cyl.bottom_radius = 1.0
	cyl.height = 160.0
	cyl.radial_segments = 72
	cyl.rings = 1
	cyl.cap_top = false
	cyl.cap_bottom = false
	zone_mat = ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = ZONE_SHADER
	zone_mat.shader = sh
	zone_wall = MeshInstance3D.new()
	zone_wall.mesh = cyl
	zone_wall.material_override = zone_mat
	zone_wall.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	zone_wall.visible = false
	add_child(zone_wall)

func set_zone(center: Vector2, radius: float, visible_: bool) -> void:
	zone_wall.visible = visible_ and radius > 0.5
	zone_wall.position = Vector3(center.x, 50.0, center.y)
	zone_wall.scale = Vector3(maxf(radius, 0.5), 1.0, maxf(radius, 0.5))

func tracer(from: Vector3, to: Vector3) -> void:
	var d := from.distance_to(to)
	if d < 0.5:
		return
	var t := _tracers[_ti]
	_ti = (_ti + 1) % _tracers.size()
	t.visible = true
	t.global_position = from
	t.look_at_from_position(from, to, Vector3.UP if absf((to - from).normalized().y) < 0.99 else Vector3.RIGHT)
	t.scale = Vector3(1, 1, d)
	_active.append([t, 0, Time.get_ticks_msec(), 60, null])

func burst(pos: Vector3, normal: Vector3, col: Color, amount := 10, speed := 1.0) -> void:
	var p := _bursts[_bi]
	_bi = (_bi + 1) % _bursts.size()
	p.global_position = pos
	p.direction = normal if normal.length() > 0.1 else Vector3.UP
	p.color = col
	p.amount = maxi(3, int(amount * particle_scale))
	p.initial_velocity_min = 2.0 * speed
	p.initial_velocity_max = 4.5 * speed
	p.restart()
	p.emitting = true

func impact(pos: Vector3, normal: Vector3, block: int) -> void:
	burst(pos, Vector3(normal), Blocks.map_color(block), 7)

func blood(pos: Vector3) -> void:
	burst(pos, Vector3.UP, Color(0.85, 0.12, 0.1), 8, 0.8)

func explosion(pos: Vector3, radius: float) -> void:
	burst(pos, Vector3.UP, Color(1.0, 0.6, 0.15), 26, 2.2)
	burst(pos + Vector3(0, 0.3, 0), Vector3.UP, Color(0.35, 0.33, 0.3), 18, 1.4)
	burst(pos, Vector3.UP, Color(1.0, 0.9, 0.4), 12, 3.0)
	var l := _lights[_li]
	_li = (_li + 1) % _lights.size()
	l.global_position = pos + Vector3(0, 1, 0)
	l.omni_range = radius * 2.5
	l.light_energy = 5.0
	l.visible = true
	_active.append([l, 1, Time.get_ticks_msec(), 350, null])

func smoke(pos: Vector3, duration: float) -> void:
	for s in _smokes:
		if not s.emitting:
			s.global_position = pos + Vector3(0, 1.5, 0)
			s.amount = maxi(16, int(46 * particle_scale))
			s.emitting = true
			_active.append([s, 2, Time.get_ticks_msec(), int(duration * 1000.0), null])
			return

func number(pos: Vector3, amount: int, head: bool, armor: bool) -> void:
	var l := _numbers[_ni]
	_ni = (_ni + 1) % _numbers.size()
	l.text = str(amount)
	l.modulate = Color(1.0, 0.85, 0.2) if head else (Color(0.55, 0.8, 1.0) if armor else Color.WHITE)
	l.outline_modulate = Color(0.1, 0.05, 0.0, 0.9)
	l.font_size = 76 if head else 60
	l.global_position = pos + Vector3(randf_range(-0.3, 0.3), 0, randf_range(-0.3, 0.3))
	l.visible = true
	_active.append([l, 3, Time.get_ticks_msec(), 750, l.global_position])

func _process(_dt: float) -> void:
	var now := Time.get_ticks_msec()
	var i := 0
	while i < _active.size():
		var e: Array = _active[i]
		var k := float(now - int(e[2])) / float(e[3])
		if k >= 1.0:
			match int(e[1]):
				2:
					(e[0] as CPUParticles3D).emitting = false
				_:
					(e[0] as Node3D).visible = false
			_active.remove_at(i)
			continue
		match int(e[1]):
			1:
				(e[0] as OmniLight3D).light_energy = 5.0 * (1.0 - k)
			3:
				var l: Label3D = e[0]
				l.global_position = (e[4] as Vector3) + Vector3(0, 0.4 + k * 1.1, 0)
				l.modulate.a = 1.0 - k * k
				l.outline_modulate.a = l.modulate.a
		i += 1
