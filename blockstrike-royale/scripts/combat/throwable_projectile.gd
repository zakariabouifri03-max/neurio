class_name ThrowableProjectile
extends RigidBody3D
## Grenade / smoke block: bounces, then detonates after its fuse.
##
## The fuse and blast are simulated locally for feel; in server-authoritative
## matches the server owns the detonation and broadcasts the result.

signal exploded(position: Vector3, weapon_id: String, owner_body: Node)

const GRAVITY_SCALE := 1.0

var weapon: Dictionary = {}
var owner_body: Node = null
var fuse: float = 2.6
var blast_radius: float = 5.0
var smoke_duration: float = 0.0
var _exploded: bool = false
var _spawn_time: float = 0.0

func setup(weapon_data: Dictionary, thrower: Node, origin: Vector3, direction: Vector3) -> void:
	weapon = weapon_data
	owner_body = thrower
	fuse = float(weapon.get("fuse_time", 2.5))
	blast_radius = float(weapon.get("blast_radius", 5.0))
	smoke_duration = float(weapon.get("smoke_duration", 0.0))
	global_position = origin
	gravity_scale = GRAVITY_SCALE
	var speed := float(weapon.get("projectile_speed", 16.0))
	linear_velocity = direction.normalized() * speed
	contact_monitor = true
	max_contacts_reported = 4
	collision_layer = 0
	collision_mask = GameConfig.Layer.WORLD | GameConfig.Layer.PROP
	_spawn_time = float(Time.get_ticks_msec()) / 1000.0
	var shape := SphereShape3D.new()
	shape.radius = 0.16
	var collision := CollisionShape3D.new()
	collision.shape = shape
	add_child(collision)
	var mesh := BoxMesh.new()
	mesh.size = Vector3(0.24, 0.3, 0.24)
	var instance := MeshInstance3D.new()
	instance.mesh = mesh
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(str(weapon.get("rarity", "uncommon")) == "common"
		and Color(0.42, 0.45, 0.48) or Color(0.33, 0.4, 0.28))
	material.roughness = 0.6
	instance.material_override = material
	add_child(instance)
	body_entered.connect(_on_body_entered)

func _physics_process(delta: float) -> void:
	if _exploded:
		return
	fuse -= delta
	# Blink faster as the fuse runs out (readable warning for nearby players).
	var visible_now := fuse > 0.0 and fmod(fuse, 0.25) > 0.12
	var child := get_child(1) as MeshInstance3D
	if child != null:
		child.visible = visible_now
	if fuse <= 0.0:
		_explode()

func _on_body_entered(_body: Node) -> void:
	var elapsed := float(Time.get_ticks_msec()) / 1000.0 - _spawn_time
	if elapsed < 0.15:
		return
	AudioDirector.play_sfx("impact_stone", global_position, -8.0)

func _explode() -> void:
	if _exploded:
		return
	_exploded = true
	exploded.emit(global_position, str(weapon.get("id", "")), owner_body)
	queue_free()

func time_to_detonation() -> float:
	return maxf(0.0, fuse)
