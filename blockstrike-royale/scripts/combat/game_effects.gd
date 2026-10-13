class_name GameEffects
extends RefCounted
## Pooled, budget-aware visual effects.
##
## Effects are plain meshes/materials created on demand and removed on a timer, with
## a global particle budget scaled by the graphics preset so a firefight on a
## low-end phone cannot spawn hundreds of nodes.

const MAX_LIVE_EFFECTS := 60

static var _live: int = 0

static func _budget() -> float:
	return clampf(float(Settings.graphics_value("particle_density", 0.6)), 0.15, 1.0)

static func _spawn(parent: Node, node: Node3D, lifetime: float) -> void:
	if parent == null or not parent.is_inside_tree():
		if node != null:
			node.queue_free()
		return
	if _live >= MAX_LIVE_EFFECTS:
		node.queue_free()
		return
	parent.add_child(node)
	_live += 1
	var timer := parent.get_tree().create_timer(lifetime)
	timer.timeout.connect(func() -> void:
		_live = maxi(0, _live - 1)
		if is_instance_valid(node):
			node.queue_free()
		)

static func _unshaded_mesh(size: Vector3, color: Color) -> MeshInstance3D:
	var mesh := BoxMesh.new()
	mesh.size = size
	var instance := MeshInstance3D.new()
	instance.mesh = mesh
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	instance.material_override = material
	instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return instance

static func muzzle_flash(parent: Node, position: Vector3, direction: Vector3) -> void:
	if _budget() < 0.3:
		return
	var flash := _unshaded_mesh(Vector3(0.26, 0.26, 0.4), Color(1.0, 0.85, 0.45, 0.9))
	flash.position = position + direction * 0.25
	_spawn(parent, flash, 0.06)
	if _budget() > 0.6:
		var light := OmniLight3D.new()
		light.light_color = Color(1.0, 0.85, 0.55)
		light.light_energy = 2.2
		light.omni_range = 6.0
		light.position = position + direction * 0.3
		_spawn(parent, light, 0.07)

static func impact(parent: Node, position: Vector3, sound: String, normal: Vector3) -> void:
	var count := 3 + int(_budget() * 5.0)
	for i: int in count:
		var chip := _unshaded_mesh(Vector3(0.09, 0.09, 0.09),
			Color(0.85, 0.85, 0.8, 0.95) if sound != "impact_metal" else Color(0.95, 0.9, 0.6, 0.95))
		chip.position = position + normal * 0.05
		var spread := 1.6
		_spawn(parent, chip, 0.25)
		var tween := chip.create_tween()
		tween.tween_property(chip, "position",
			chip.position + normal * 0.4 + Vector3(randf_range(-spread, spread) * 0.1,
				randf_range(0.1, 0.5), randf_range(-spread, spread) * 0.1), 0.22)
		tween.parallel().tween_property(chip, "scale", Vector3.ONE * 0.2, 0.22)

static func blood_hit(parent: Node, position: Vector3) -> void:
	if _budget() < 0.25:
		return
	for i: int in 3:
		var puff := _unshaded_mesh(Vector3(0.12, 0.12, 0.12), Color(0.85, 0.25, 0.25, 0.8))
		puff.position = position
		_spawn(parent, puff, 0.18)
		var tween := puff.create_tween()
		tween.tween_property(puff, "position", position + Vector3(randf_range(-0.4, 0.4),
			randf_range(0.1, 0.5), randf_range(-0.4, 0.4)), 0.18)
		tween.parallel().tween_property(puff, "scale", Vector3.ONE * 0.2, 0.18)

static func explosion(parent: Node, position: Vector3, radius: float) -> void:
	var scale_factor := maxf(0.6, radius * 0.25)
	var ball := _unshaded_mesh(Vector3.ONE * scale_factor, Color(1.0, 0.65, 0.2, 0.95))
	ball.position = position
	_spawn(parent, ball, 0.45)
	var tween := ball.create_tween()
	tween.tween_property(ball, "scale", Vector3.ONE * 3.0, 0.4)
	tween.parallel().tween_property(ball, "transparency", 1.0, 0.4)
	var light := OmniLight3D.new()
	light.light_color = Color(1.0, 0.7, 0.3)
	light.light_energy = 6.0
	light.omni_range = radius * 2.0
	light.position = position
	_spawn(parent, light, 0.35)
	var scorch := _unshaded_mesh(Vector3(radius * 0.5, 0.05, radius * 0.5), Color(0.1, 0.1, 0.1, 0.8))
	scorch.position = position - Vector3(0, 0.5, 0)
	_spawn(parent, scorch, 6.0)

static func smoke_puff(parent: Node, position: Vector3, radius: float) -> void:
	var puffs := 5 + int(_budget() * 8.0)
	for i: int in puffs:
		var puff := _unshaded_mesh(Vector3.ONE * randf_range(0.8, 1.6),
			Color(0.82, 0.84, 0.86, 0.55))
		puff.position = position + Vector3(randf_range(-radius * 0.4, radius * 0.4),
			randf_range(0.0, 1.2), randf_range(-radius * 0.4, radius * 0.4))
		_spawn(parent, puff, 3.2)
		var tween := puff.create_tween()
		tween.tween_property(puff, "scale", Vector3.ONE * 2.4, 3.0)

static func pickup_burst(parent: Node, position: Vector3, color: Color) -> void:
	for i: int in 4:
		var spark := _unshaded_mesh(Vector3(0.1, 0.1, 0.1), color)
		spark.position = position + Vector3(0, 0.6, 0)
		_spawn(parent, spark, 0.35)
		var tween := spark.create_tween()
		tween.tween_property(spark, "position", spark.position + Vector3(randf_range(-0.3, 0.3),
			0.8, randf_range(-0.3, 0.3)), 0.35)

static func live_effect_count() -> int:
	return _live
