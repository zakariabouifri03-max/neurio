class_name CharacterRig
extends Node3D
## Blocky voxel humanoid with articulated limbs and a procedural animation
## state machine.
##
## Every pose parameter (locomotion, crouch, aim, sprint, jump/fall, landing,
## reload, recoil, hurt, death, victory) is blended toward its target each frame,
## so transitions never snap. Gameplay code only reports state through
## update_locomotion() and the trigger_*() methods; it never edits joints directly.
##
## Pivot hierarchy (metres, before the 1.12 display scale):
##   Rig
##    ├ Body (hip height 0.5, lowers when crouched)
##    │  ├ Torso, Backpack, Head (pivot at neck) with hat and eyes
##    │  ├ ArmL / ArmR (shoulder pivots)
##    │  ├ GunSocket (weapons attach here, barrel along -Z)
##    │  └ LegL / LegR (hip pivots)

const RIG_SCALE := 1.12
const WALK_REFERENCE_SPEED := 4.6

enum State { IDLE, WALK, SPRINT, JUMP, FALL, LAND, CROUCH, AIM, RELOAD, DEAD, VICTORY }

var state: int = State.IDLE

var _body: Node3D
var _head: Node3D
var _arm_l: Node3D
var _arm_r: Node3D
var _leg_l: Node3D
var _leg_r: Node3D
var _gun_socket: Node3D
var _torso_mat: StandardMaterial3D
var _pants_mat: StandardMaterial3D
var _skin_mat: StandardMaterial3D
var _hat_mat: StandardMaterial3D
var _flash_mats: Array[StandardMaterial3D] = []

# Targets reported by the owning controller.
var _speed := 0.0
var _on_floor := true
var _vertical := 0.0
var _crouch_target := 0.0
var _aim_target := 0.0
var _aim_pitch_target := 0.0
var _sprint_target := 0.0
var _dead_target := false
var _victory_target := 0.0

# Blended values.
var _crouch := 0.0
var _aim := 0.0
var _aim_pitch := 0.0
var _sprint := 0.0
var _dead := 0.0
var _landing := 0.0
var _phase := 0.0
var _shoot_kick := 0.0
var _hurt := 0.0
var _reload_progress := -1.0
var _victory := 0.0
var _wave := 0.0
var _time := 0.0


func _ready() -> void:
	scale = Vector3.ONE * RIG_SCALE
	_build()


func set_outfit(shirt: Color, pants: Color, skin: Color, hat: Color) -> void:
	_torso_mat.albedo_color = shirt
	_pants_mat.albedo_color = pants
	_skin_mat.albedo_color = skin
	_hat_mat.albedo_color = hat


func get_gun_socket() -> Node3D:
	return _gun_socket


func update_locomotion(speed: float, on_floor: bool, vertical_velocity: float,
		crouch: bool, aiming: bool, aim_pitch: float, sprinting: bool) -> void:
	_speed = speed
	_on_floor = on_floor
	_vertical = vertical_velocity
	_crouch_target = 1.0 if crouch else 0.0
	_aim_target = 1.0 if aiming else 0.0
	_aim_pitch_target = clampf(aim_pitch, -1.0, 1.0)
	_sprint_target = 1.0 if sprinting else 0.0


func trigger_shoot() -> void:
	_shoot_kick = 1.0


func trigger_hurt() -> void:
	_hurt = 0.22


func trigger_land(impact_speed: float) -> void:
	_landing = clampf(impact_speed / 12.0, 0.25, 1.0)


func set_reload_progress(progress: float) -> void:
	## Pass a value in [0,1] while reloading and -1 when not reloading.
	_reload_progress = progress


func set_dead(value: bool) -> void:
	_dead_target = value


func set_victory(value: bool) -> void:
	_victory_target = 1.0 if value else 0.0


func wave() -> void:
	_wave = 2.4


func _process(delta: float) -> void:
	_time += delta
	var t := clampf(delta * 14.0, 0.0, 1.0)
	_crouch = lerpf(_crouch, _crouch_target, t)
	_aim = lerpf(_aim, _aim_target, t)
	_aim_pitch = lerpf(_aim_pitch, _aim_pitch_target, t)
	_sprint = lerpf(_sprint, _sprint_target, t)
	_dead = move_toward(_dead, 1.0 if _dead_target else 0.0, delta * 2.5)
	_landing = move_toward(_landing, 0.0, delta * 4.0)
	_shoot_kick = move_toward(_shoot_kick, 0.0, delta * 10.0)
	_hurt = maxf(_hurt - delta, 0.0)
	_wave = maxf(_wave - delta, 0.0)
	_victory = move_toward(_victory, _victory_target, delta * 4.0)

	var walk_amount := clampf(_speed / WALK_REFERENCE_SPEED, 0.0, 1.6) * (1.0 if _on_floor else 0.0)
	_phase += _speed * delta * 2.4
	var swing := sin(_phase) * 0.75 * clampf(walk_amount, 0.0, 1.0)
	var airborne := not _on_floor
	var jump_pose := 1.0 if airborne else 0.0
	var fall_pose := 1.0 if (airborne and _vertical < -1.0) else 0.0

	# Body: hip height, crouch lowering, walk bob and landing squash.
	var bob := absf(sin(_phase)) * 0.035 * clampf(walk_amount, 0.0, 1.0)
	_body.position.y = lerpf(0.5, 0.26, _crouch) + bob - _landing * 0.05
	_body.scale.y = 1.0 - _landing * 0.08
	_body.position.y = lerpf(_body.position.y, 0.08, _dead)
	_body.rotation.x = -0.05 * clampf(_sprint, 0.0, 1.0)

	# Legs: stride, crouch bend, mid-air tuck.
	var bend := 0.95 * _crouch
	var tuck := 0.9 * jump_pose
	# Falling keeps the legs slightly extended (fall_pose reserved for FSM state).
	_leg_l.rotation.x = lerpf(swing - bend, -tuck, jump_pose)
	_leg_r.rotation.x = lerpf(-swing - bend, -tuck * 0.6, jump_pose)

	# Left arm: counter-swing, arms-up when jumping or celebrating.
	var idle_sway := sin(_time * 1.8) * 0.04
	var l_target := -swing * 0.8 + idle_sway + 0.1
	l_target = lerpf(l_target, -2.4, jump_pose)
	l_target = lerpf(l_target, PI * 0.5 + _aim_pitch * 0.8, _aim)
	l_target = lerpf(l_target, -2.9 + sin(_time * 9.0) * 0.25, _victory)
	_arm_l.rotation.x = l_target
	_arm_l.rotation.z = lerpf(0.08, -0.45, _aim)

	var r_target := swing * 0.8 - idle_sway + 0.1
	r_target = lerpf(r_target, -2.4, jump_pose)
	r_target = lerpf(r_target, PI * 0.5 + _aim_pitch, _aim)
	r_target = lerpf(r_target, -2.9 + sin(_time * 9.0 + PI) * 0.25, _victory)
	if _reload_progress >= 0.0:
		r_target = lerpf(r_target, 0.9 + sin(_reload_progress * PI) * 0.6, 0.8)
	_arm_r.rotation.x = r_target
	_arm_r.rotation.z = lerpf(-0.08, -0.12, _aim)

	# Head follows aim pitch slightly.
	_head.rotation.x = clampf(-_aim_pitch * 0.6, -0.6, 0.6)
	_head.rotation.y = sin(_time * 0.7) * 0.05 * (1.0 - _aim)

	# Gun socket: rest pose when idle, aligned with aim when aiming.
	var rest := Vector3(0.2, 0.52, -0.12)
	var aimed := Vector3(0.22, 0.62, -0.22)
	_gun_socket.position = rest.lerp(aimed, _aim) + Vector3(0, 0, _shoot_kick * 0.03)
	var rest_rot := 0.35
	_gun_socket.rotation.x = lerpf(rest_rot, _aim_pitch, _aim)
	_gun_socket.rotation.z = 0.0
	if _reload_progress >= 0.0:
		_gun_socket.rotation.z = sin(_reload_progress * PI) * 0.55

	# Death fall and victory emote.
	rotation.x = lerpf(0.0, -PI * 0.5, _dead)
	if _wave > 0.0:
		_arm_r.rotation.x = lerpf(_arm_r.rotation.x, -2.3 + sin(_time * 14.0) * 0.3, clampf(_wave, 0.0, 1.0))

	# Hurt flash via emission on body materials.
	var flash := clampf(_hurt / 0.22, 0.0, 1.0) * 0.9
	for m in _flash_mats:
		m.emission_enabled = flash > 0.01
		m.emission = Color(1.0, 0.15, 0.1)
		m.emission_energy_multiplier = flash

	state = _resolve_state(airborne, fall_pose)


func _resolve_state(airborne: bool, falling: float) -> int:
	if _dead > 0.5:
		return State.DEAD
	if _victory > 0.5:
		return State.VICTORY
	if _reload_progress >= 0.0:
		return State.RELOAD
	if airborne:
		return State.FALL if falling > 0.5 else State.JUMP
	if _landing > 0.2:
		return State.LAND
	if _crouch > 0.5:
		return State.CROUCH
	if _aim > 0.5:
		return State.AIM
	if _speed > 6.0:
		return State.SPRINT
	if _speed > 0.3:
		return State.WALK
	return State.IDLE


func state_name() -> String:
	return ["IDLE", "WALK", "SPRINT", "JUMP", "FALL", "LAND", "CROUCH", "AIM", "RELOAD", "DEAD", "VICTORY"][state]


func _build() -> void:
	_torso_mat = _mat(Color("#2f6fd6"))
	_pants_mat = _mat(Color("#2b2f3a"))
	_skin_mat = _mat(Color("#f2c7a0"))
	_hat_mat = _mat(Color("#ffb020"))
	var dark := _mat(Color("#1b1f27"))
	var eye := _mat(Color("#ffffff"), true)
	_flash_mats = [_torso_mat, _pants_mat, _skin_mat, _hat_mat]

	_body = Node3D.new()
	_body.name = "Body"
	_body.position = Vector3(0, 0.5, 0)
	add_child(_body)

	_box(Vector3(0.42, 0.5, 0.24), _torso_mat, Vector3(0, 0.25, 0), _body)
	_box(Vector3(0.3, 0.34, 0.14), dark, Vector3(0, 0.3, 0.2), _body)

	_head = Node3D.new()
	_head.name = "Head"
	_head.position = Vector3(0, 0.5, 0)
	_body.add_child(_head)
	_box(Vector3(0.4, 0.4, 0.4), _skin_mat, Vector3(0, 0.2, 0), _head)
	_box(Vector3(0.44, 0.1, 0.44), _hat_mat, Vector3(0, 0.43, 0), _head)
	_box(Vector3(0.44, 0.04, 0.12), _hat_mat, Vector3(0, 0.37, -0.22), _head)
	_box(Vector3(0.08, 0.07, 0.02), eye, Vector3(-0.1, 0.22, -0.205), _head)
	_box(Vector3(0.08, 0.07, 0.02), eye, Vector3(0.1, 0.22, -0.205), _head)

	_arm_l = _pivot(Vector3(-0.29, 0.46, 0), _body)
	_arm_l.name = "ArmL"
	_box(Vector3(0.14, 0.46, 0.14), _torso_mat, Vector3(0, -0.23, 0), _arm_l)
	_arm_r = _pivot(Vector3(0.29, 0.46, 0), _body)
	_arm_r.name = "ArmR"
	_box(Vector3(0.14, 0.46, 0.14), _torso_mat, Vector3(0, -0.23, 0), _arm_r)

	_gun_socket = Node3D.new()
	_gun_socket.name = "GunSocket"
	_gun_socket.position = Vector3(0.2, 0.52, -0.12)
	_gun_socket.rotation.x = 0.35
	_body.add_child(_gun_socket)

	_leg_l = _pivot(Vector3(-0.11, 0, 0), _body)
	_leg_l.name = "LegL"
	_box(Vector3(0.17, 0.5, 0.18), _pants_mat, Vector3(0, -0.25, 0), _leg_l)
	_box(Vector3(0.18, 0.08, 0.24), dark, Vector3(0, -0.46, -0.03), _leg_l)
	_leg_r = _pivot(Vector3(0.11, 0, 0), _body)
	_leg_r.name = "LegR"
	_box(Vector3(0.17, 0.5, 0.18), _pants_mat, Vector3(0, -0.25, 0), _leg_r)
	_box(Vector3(0.18, 0.08, 0.24), dark, Vector3(0, -0.46, -0.03), _leg_r)


static func _pivot(pos: Vector3, parent: Node3D) -> Node3D:
	var n := Node3D.new()
	n.position = pos
	parent.add_child(n)
	return n


static func _mat(color: Color, emissive: bool = false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = 0.75
	if emissive:
		m.emission_enabled = true
		m.emission = color
		m.emission_energy_multiplier = 1.5
	return m


static func _box(size: Vector3, mat: Material, pos: Vector3, parent: Node3D) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = size
	mi.mesh = b
	mi.material_override = mat
	mi.position = pos
	parent.add_child(mi)
	return mi
