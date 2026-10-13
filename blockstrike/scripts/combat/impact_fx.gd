class_name ImpactFX
extends RefCounted
## Lightweight, capped visual effects for shots: tracers, impact sparks and
## muzzle flashes. Effects free themselves on a timer. A global cap keeps the
## particle count bounded on low-end phones.

const MAX_ACTIVE := 48

static var _active := 0


static func tracer(parent: Node, from: Vector3, to: Vector3, color: Color) -> void:
	if parent == null or not parent.is_inside_tree() or _active >= MAX_ACTIVE:
		return
	var span := to - from
	var length := span.length()
	if length < 0.2:
		return
	var mi := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(0.03, 0.03, length)
	mi.mesh = box
	mi.material_override = _unshaded(color, 2.0)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	mi.global_transform = Transform3D(Basis.looking_at(span.normalized()), (from + to) * 0.5)
	_free_later(mi, 0.07)


static func impact(parent: Node, position: Vector3, normal: Vector3, color: Color) -> void:
	if parent == null or not parent.is_inside_tree() or _active >= MAX_ACTIVE:
		return
	var p := CPUParticles3D.new()
	p.one_shot = true
	p.explosiveness = 1.0
	p.amount = 12
	p.lifetime = 0.45
	p.direction = normal
	p.spread = 65.0
	p.initial_velocity_min = 1.5
	p.initial_velocity_max = 3.8
	p.gravity = Vector3(0.0, -9.8, 0.0)
	p.scale_amount_min = 0.05
	p.scale_amount_max = 0.09
	var box := BoxMesh.new()
	box.size = Vector3(1.0, 1.0, 1.0)
	box.material = _unshaded(color, 1.0)
	box.material.set("vertex_color_use_as_albedo", true)
	p.mesh = box
	p.color = color
	p.emitting = true
	parent.add_child(p)
	p.global_position = position + normal * 0.03
	_free_later(p, 1.0)


static func muzzle_flash(anchor: Node3D, color: Color) -> void:
	if anchor == null or not anchor.is_inside_tree() or _active >= MAX_ACTIVE:
		return
	var mi := MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = 0.11
	sphere.height = 0.22
	sphere.radial_segments = 6
	sphere.rings = 3
	mi.mesh = sphere
	mi.material_override = _unshaded(color, 3.0)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	anchor.add_child(mi)
	mi.position = Vector3.ZERO
	_free_later(mi, 0.05)


static func _unshaded(color: Color, energy: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = color
	m.emission_enabled = true
	m.emission = color
	m.emission_energy_multiplier = energy
	return m


static func _free_later(node: Node, seconds: float) -> void:
	## Holds a weak reference: the parent may already be freed when the timer fires.
	_active += 1
	var ref: WeakRef = weakref(node)
	var timer := node.get_tree().create_timer(seconds)
	timer.timeout.connect(func() -> void:
		_active = maxi(_active - 1, 0)
		var live: Node = ref.get_ref() as Node
		if live != null:
			live.queue_free())
