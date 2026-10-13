extends Node3D
## Object-pooled visual effects. Nothing is instantiated during combat:
## tracers, muzzle flashes and particle bursts are recycled from fixed pools.

const TRACER_POOL := 24
const FLASH_POOL := 8
const BURST_POOL := 12

var _tracers: Array = []
var _flashes: Array = []
var _bursts: Array = []
var _next_tracer := 0
var _next_flash := 0
var _next_burst := 0
var particle_scale: float = 1.0
var _burst_mesh: BoxMesh
var _burst_mat: StandardMaterial3D
var _tracer_mat: StandardMaterial3D
var _flash_mat: StandardMaterial3D


func _ready() -> void:
	var tm := BoxMesh.new()
	tm.size = Vector3(0.025, 0.025, 1.0)
	_tracer_mat = StandardMaterial3D.new()
	_tracer_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_tracer_mat.albedo_color = Color(1.0, 0.88, 0.5)
	_tracer_mat.emission_enabled = true
	_tracer_mat.emission = Color(1.0, 0.85, 0.4)
	_tracer_mat.emission_energy_multiplier = 2.0
	for i in TRACER_POOL:
		var mi := MeshInstance3D.new()
		mi.mesh = tm
		mi.material_override = _tracer_mat
		mi.visible = false
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)
		_tracers.append({"node": mi, "ttl": 0.0})

	var fm := SphereMesh.new()
	fm.radius = 0.14
	fm.height = 0.28
	_flash_mat = StandardMaterial3D.new()
	_flash_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_flash_mat.albedo_color = Color(1.0, 0.9, 0.5)
	_flash_mat.emission_enabled = true
	_flash_mat.emission = Color(1.0, 0.8, 0.3)
	for i in FLASH_POOL:
		var fl := MeshInstance3D.new()
		fl.mesh = fm
		fl.material_override = _flash_mat
		fl.visible = false
		fl.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(fl)
		_flashes.append({"node": fl, "ttl": 0.0})

	_burst_mesh = BoxMesh.new()
	_burst_mesh.size = Vector3(0.09, 0.09, 0.09)
	_burst_mat = StandardMaterial3D.new()
	_burst_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_burst_mat.vertex_color_use_as_albedo = true
	_burst_mesh.material = _burst_mat
	for i in BURST_POOL:
		var p := CPUParticles3D.new()
		p.one_shot = true
		p.emitting = false
		p.explosiveness = 1.0
		p.amount = 12
		p.lifetime = 0.55
		p.mesh = _burst_mesh
		p.direction = Vector3.UP
		p.spread = 70.0
		p.initial_velocity_min = 2.0
		p.initial_velocity_max = 5.0
		p.gravity = Vector3(0, -9.8, 0)
		p.scale_amount_min = 0.6
		p.scale_amount_max = 1.2
		p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(p)
		_bursts.append(p)


func _process(delta: float) -> void:
	for t in _tracers:
		if t["ttl"] > 0.0:
			t["ttl"] -= delta
			if t["ttl"] <= 0.0:
				(t["node"] as MeshInstance3D).visible = false
	for f in _flashes:
		if f["ttl"] > 0.0:
			f["ttl"] -= delta
			if f["ttl"] <= 0.0:
				(f["node"] as MeshInstance3D).visible = false


## Brief bright streak from the muzzle toward the hit point.
func tracer(from: Vector3, to: Vector3) -> void:
	var length := from.distance_to(to)
	if length < 0.5:
		return
	var t: Dictionary = _tracers[_next_tracer]
	_next_tracer = (_next_tracer + 1) % _tracers.size()
	var mi: MeshInstance3D = t["node"]
	mi.visible = true
	mi.global_position = (from + to) * 0.5
	mi.look_at(to, Vector3.UP if absf((to - from).normalized().y) < 0.99 else Vector3.RIGHT)
	mi.scale = Vector3(1, 1, minf(length, 400.0))
	t["ttl"] = 0.06


func muzzle_flash(pos: Vector3) -> void:
	var f: Dictionary = _flashes[_next_flash]
	_next_flash = (_next_flash + 1) % _flashes.size()
	var mi: MeshInstance3D = f["node"]
	mi.visible = true
	mi.global_position = pos
	mi.scale = Vector3.ONE * randf_range(0.8, 1.3)
	f["ttl"] = 0.05


## kind: "blood", "dust", "spark", "debris", "smoke", "explosion"
func burst(pos: Vector3, normal: Vector3, kind: String, color: Color = Color.WHITE) -> void:
	var p: CPUParticles3D = _bursts[_next_burst]
	_next_burst = (_next_burst + 1) % _bursts.size()
	p.global_position = pos
	p.color = color
	p.amount = maxi(2, int(round(12 * particle_scale)))
	p.direction = normal if normal.length() > 0.1 else Vector3.UP
	match kind:
		"blood":
			p.color = Color(0.7, 0.05, 0.05)
			p.initial_velocity_max = 3.0
		"dust":
			p.color = Color(0.75, 0.7, 0.6)
			p.initial_velocity_max = 2.5
		"spark":
			p.color = Color(1.0, 0.85, 0.3)
			p.initial_velocity_max = 4.0
		"debris":
			p.initial_velocity_max = 4.5
		"smoke":
			p.color = Color(0.55, 0.55, 0.55)
			p.lifetime = 1.4
			p.initial_velocity_max = 1.2
			p.gravity = Vector3(0, 0.6, 0)
		"explosion":
			p.color = Color(1.0, 0.55, 0.15)
			p.amount = maxi(4, int(round(28 * particle_scale)))
			p.lifetime = 0.8
			p.initial_velocity_min = 3.0
			p.initial_velocity_max = 9.0
			p.spread = 180.0
	if kind != "smoke" and kind != "explosion":
		p.lifetime = 0.55
		p.gravity = Vector3(0, -9.8, 0)
		p.spread = 70.0
	p.restart()
	p.emitting = true
