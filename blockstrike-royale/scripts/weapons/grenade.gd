extends Node3D
## Thrown fragmentation grenade. Simulated by hand: gravity, bounces off the voxel
## world, and detonates when the fuse runs out. The match applies the damage
## (see MatchManager.explode_at) so that teams and kill credit are handled in one place.

signal exploded(pos: Vector3)

const GRAVITY := 16.0
const FUSE := 2.2
const RADIUS := 5.5
const MAX_DAMAGE := 110.0
const BOUNCE := 0.35

var velocity: Vector3 = Vector3.ZERO
var world = null
var _thrower = null
var _t: float = 0.0
var _done: bool = false


func _ready() -> void:
	var body := MeshInstance3D.new()
	var mesh := SphereMesh.new()
	mesh.radius = 0.12
	mesh.height = 0.24
	body.mesh = mesh
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.22, 0.3, 0.18)
	mat.roughness = 0.9
	body.material_override = mat
	add_child(body)


## Call after add_child. `vel` is the launch velocity in world space.
func setup(world_ref, vel: Vector3, thrower) -> void:
	world = world_ref
	velocity = vel
	_thrower = thrower


func _physics_process(delta: float) -> void:
	if _done:
		return
	_t += delta
	if _t >= FUSE:
		_detonate()
		return
	velocity.y -= GRAVITY * delta
	var from: Vector3 = global_position
	var to: Vector3 = from + velocity * delta
	if world != null:
		var hit: Dictionary = world.raycast(from, to, 1, [])
		if not hit.is_empty():
			var n: Vector3 = hit["normal"]
			global_position = hit["position"] + n * 0.05
			velocity = velocity.bounce(n) * BOUNCE
			if velocity.length() < 0.6:
				velocity = Vector3.ZERO
			return
	global_position = to


func _detonate() -> void:
	_done = true
	exploded.emit(global_position)
	queue_free()
