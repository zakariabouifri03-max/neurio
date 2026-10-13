extends Node3D
## Falling supply crate with a parachute. Emits `landed` when it reaches the ground.

signal landed(pos: Vector3)

var _ground_y: float = 0.0
var _fall_speed: float = 7.0
var _done: bool = false
var _chute: MeshInstance3D


func setup(ground_pos: Vector3, start_height: float) -> void:
	_ground_y = ground_pos.y
	global_position = Vector3(ground_pos.x, ground_pos.y + start_height, ground_pos.z)
	var crate := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(1.4, 1.1, 1.4)
	crate.mesh = bm
	var cm := StandardMaterial3D.new()
	cm.albedo_color = Color(0.85, 0.2, 0.15)
	cm.emission_enabled = true
	cm.emission = Color(0.4, 0.05, 0.02)
	crate.material_override = cm
	crate.position = Vector3(0, 0.55, 0)
	add_child(crate)
	_chute = MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 1.8
	cyl.bottom_radius = 0.2
	cyl.height = 1.0
	_chute.mesh = cyl
	var chm := StandardMaterial3D.new()
	chm.albedo_color = Color(0.95, 0.95, 0.9)
	_chute.material_override = chm
	_chute.position = Vector3(0, 3.0, 0)
	add_child(_chute)


func _process(delta: float) -> void:
	if _done:
		return
	global_position.y -= _fall_speed * delta
	rotation.y += delta * 0.6
	if global_position.y <= _ground_y + 0.6:
		_done = true
		landed.emit(Vector3(global_position.x, _ground_y, global_position.z))
		queue_free()
