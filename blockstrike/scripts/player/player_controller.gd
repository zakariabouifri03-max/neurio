class_name PlayerController
extends CharacterBody3D
## Third-person character used by both the human player and AI bots.
##
## Movement is driven only by PlayerInput (plus optional AI "think" step), so the
## same code runs for local, bot and (later) networked characters. Collision uses
## a capsule with a one-block step-up so voxel terraces are climbable without
## tunnelling through walls.

signal jumped
signal landed(impact_speed: float)
signal footstep
signal eliminated(killer: Node, victim: Node)
signal dealt_damage(amount: int, target: Node, headshot: bool)
signal received_damage(amount: int, source: Node, headshot: bool)

const STAND_HEIGHT := 1.8
const CROUCH_HEIGHT := 1.15
const RADIUS := 0.36
const WALK_SPEED := 4.6
const SPRINT_SPEED := 7.2
const CROUCH_SPEED := 2.2
const AIM_SPEED_FACTOR := 0.55
const WATER_SPEED_FACTOR := 0.6
const ACCEL_GROUND := 42.0
const DECEL_GROUND := 52.0
const ACCEL_AIR := 10.0
const JUMP_SPEED := 8.4
const STEP_HEIGHT := 1.05
const HEAD_HEIGHT := 1.5

@export var display_name := "Player"
@export var is_bot := false
@export var team := 0

var input := PlayerInput.new()
var health: HealthComponent
var weapon: Weapon
var camera_rig: ThirdPersonCamera
var world: VoxelWorld
## Optional AI driver. Must implement think(delta) and only write to `input`/look.
var ai: Object = null
var rig: CharacterRig
var look_yaw := 0.0
var look_pitch := 0.0
## Extra spread applied by AI accuracy settings (degrees).
var extra_spread_deg := 0.0
var alive := true
var movement_enabled := true
var is_aiming := false
var is_sprinting := false
var crouch_amount := 0.0
var water_factor := 1.0

var _collision: CollisionShape3D
var _capsule: CapsuleShape3D
var _was_on_floor := true
var _footstep_accum := 0.0


func _ready() -> void:
	collision_layer = GameConstants.LAYER_ACTORS
	collision_mask = GameConstants.LAYER_WORLD
	floor_snap_length = 0.5
	floor_max_angle = deg_to_rad(50.0)
	safe_margin = 0.02
	_capsule = CapsuleShape3D.new()
	_capsule.radius = RADIUS
	_capsule.height = STAND_HEIGHT
	_collision = CollisionShape3D.new()
	_collision.name = "Capsule"
	_collision.shape = _capsule
	_collision.position = Vector3(0, STAND_HEIGHT * 0.5, 0)
	add_child(_collision)
	health = HealthComponent.new()
	health.name = "Health"
	add_child(health)
	health.died.connect(_on_died)
	rig = CharacterRig.new()
	rig.name = "Rig"
	add_child(rig)
	set_outfit(Color("#2f6fd6"), Color("#2b2f3a"), Color("#f2c7a0"), Color("#ffb020"))


func set_outfit(shirt: Color, pants: Color, skin: Color, hat: Color) -> void:
	rig.set_outfit(shirt, pants, skin, hat)


func equip_weapon(data: WeaponData) -> void:
	if weapon != null:
		weapon.queue_free()
	weapon = Weapon.new()
	weapon.name = "Weapon"
	rig.get_gun_socket().add_child(weapon)
	weapon.setup(data, self)
	weapon.fired.connect(_on_weapon_fired)


func get_aim_origin() -> Vector3:
	if camera_rig != null:
		return camera_rig.get_aim_origin()
	return global_position + Vector3(0.0, HEAD_HEIGHT - crouch_amount * 0.35, 0.0)


func get_aim_direction() -> Vector3:
	if camera_rig != null:
		return camera_rig.get_aim_direction()
	var cp := cos(look_pitch)
	return Vector3(-sin(look_yaw) * cp, sin(look_pitch), -cos(look_yaw) * cp)


func receive_hit(damage: int, source: Node, headshot: bool) -> void:
	if not alive:
		return
	var dealt := health.apply_damage(damage, source, headshot)
	rig.trigger_hurt()
	received_damage.emit(dealt, source, headshot)


func reset_for_spawn(position_world: Vector3, yaw: float) -> void:
	global_position = position_world
	velocity = Vector3.ZERO
	look_yaw = yaw
	look_pitch = 0.0
	alive = true
	is_aiming = false
	is_sprinting = false
	crouch_amount = 0.0
	collision_layer = GameConstants.LAYER_ACTORS
	health.reset()
	rig.set_dead(false)
	rig.set_victory(false)
	input.reset()
	if weapon != null:
		weapon.refill()
	_was_on_floor = false
	rig.rotation.y = yaw


func set_victory(value: bool) -> void:
	rig.set_victory(value)


func _physics_process(delta: float) -> void:
	if ai != null:
		ai.think(delta)
	_update_water()
	_update_crouch(delta)

	var on_floor := is_on_floor()
	var move_in := input.move if (alive and movement_enabled) else Vector2.ZERO
	is_aiming = alive and input.aim_held
	is_sprinting = alive and movement_enabled and input.sprint_held and move_in.y > 0.4 \
		and not is_aiming and crouch_amount < 0.3 and move_in.length() > 0.5

	var wish := Vector3(move_in.x, 0.0, -move_in.y).rotated(Vector3.UP, look_yaw)
	var speed := WALK_SPEED
	if crouch_amount > 0.5:
		speed = CROUCH_SPEED
	elif is_sprinting:
		speed = SPRINT_SPEED
	elif is_aiming:
		speed = WALK_SPEED * AIM_SPEED_FACTOR
	speed *= clampf(move_in.length(), 0.0, 1.0) * water_factor
	if weapon != null and weapon.data != null:
		speed *= weapon.data.movement_speed_multiplier

	var target := wish * speed
	var hv := Vector2(velocity.x, velocity.z)
	var tv := Vector2(target.x, target.z)
	var rate := ACCEL_AIR
	if on_floor:
		rate = ACCEL_GROUND if tv.length_squared() > 0.0001 else DECEL_GROUND
	hv = hv.move_toward(tv, rate * delta)
	velocity.x = hv.x
	velocity.z = hv.y

	var jumped_now := false
	if on_floor:
		velocity.y = 0.0
		var wants_jump := input.consume_jump()
		if wants_jump and alive and movement_enabled and crouch_amount < 0.25:
			velocity.y = JUMP_SPEED
			jumped_now = true
			jumped.emit()
			Sfx.play_3d("jump", global_position, -10.0)
	else:
		input.consume_jump()
		velocity.y = maxf(velocity.y - GameConstants.GRAVITY * delta, -GameConstants.MAX_FALL_SPEED)

	if on_floor and not jumped_now:
		_try_step_up(delta)

	var pre_vy := velocity.y
	move_and_slide()

	var now_floor := is_on_floor()
	if now_floor and not _was_on_floor:
		var impact := maxf(-pre_vy, 0.0)
		if impact > 1.5:
			landed.emit(impact)
			rig.trigger_land(impact)
			Sfx.play_3d("land", global_position, -6.0)
	_was_on_floor = now_floor

	var horizontal_speed := Vector2(velocity.x, velocity.z).length()
	if now_floor and horizontal_speed > 1.0:
		_footstep_accum += horizontal_speed * delta
		var stride := 2.9 if is_sprinting else 2.2
		if _footstep_accum >= stride:
			_footstep_accum = 0.0
			footstep.emit()
			Sfx.play_3d("footstep", global_position, -14.0)

	rig.rotation.y = lerp_angle(rig.rotation.y, look_yaw, clampf(delta * 14.0, 0.0, 1.0))
	rig.update_locomotion(horizontal_speed, now_floor, velocity.y, crouch_amount > 0.5,
		is_aiming, look_pitch, is_sprinting)
	_handle_weapon(delta)


func _handle_weapon(delta: float) -> void:
	if weapon == null or weapon.data == null:
		input.consume_reload()
		return
	weapon.tick(delta)
	if not alive:
		input.consume_reload()
		return
	if input.consume_reload():
		weapon.start_reload()
	rig.set_reload_progress(weapon.reload_progress() if weapon.reloading else -1.0)
	if input.fire_held and movement_enabled:
		var moving := clampf(Vector2(velocity.x, velocity.z).length() / SPRINT_SPEED, 0.0, 1.0)
		var shot: Dictionary = weapon.try_fire(get_aim_origin(), get_aim_direction(),
			extra_spread_deg, moving, is_aiming)
		if shot.get("fired", false):
			var kick_pitch := weapon.data.recoil_pitch
			var kick_yaw := randf_range(-1.0, 1.0) * weapon.data.recoil_yaw
			if camera_rig != null:
				camera_rig.apply_recoil(kick_pitch, kick_yaw)
			else:
				look_pitch = clampf(look_pitch + kick_pitch, -1.1, 0.85)
				look_yaw += kick_yaw


func _on_weapon_fired(shot: Dictionary) -> void:
	rig.trigger_shoot()
	if shot.get("hit", false) and shot.get("target") != null:
		dealt_damage.emit(int(shot["damage"]), shot["target"], bool(shot["headshot"]))


func _on_died(killer: Node) -> void:
	alive = false
	is_aiming = false
	is_sprinting = false
	input.reset()
	collision_layer = 0
	rig.set_dead(true)
	eliminated.emit(killer, self)


func _update_water() -> void:
	water_factor = 1.0
	if world == null:
		return
	var by := floori(global_position.y + 0.5)
	if world.get_block(floori(global_position.x), by, floori(global_position.z)) == BlockIds.WATER:
		water_factor = WATER_SPEED_FACTOR


func _update_crouch(delta: float) -> void:
	var want_crouch := input.crouch_held and alive
	if not want_crouch and crouch_amount > 0.001:
		# Only stand up when there is headroom for the full-height capsule.
		if test_move(global_transform, Vector3.UP * (STAND_HEIGHT - CROUCH_HEIGHT)):
			want_crouch = true
	crouch_amount = move_toward(crouch_amount, 1.0 if want_crouch else 0.0, delta * 7.0)
	var h := lerpf(STAND_HEIGHT, CROUCH_HEIGHT, crouch_amount)
	_capsule.height = h
	_collision.position.y = h * 0.5


func _try_step_up(delta: float) -> void:
	## Lifts the body by one block when a horizontal move is blocked by a ledge
	## that is low enough to step over. Floor snapping then settles it on top.
	var motion := Vector3(velocity.x, 0.0, velocity.z) * delta
	if motion.length_squared() < 0.000001:
		return
	var xf := global_transform
	if not test_move(xf, motion):
		return
	var up := Vector3.UP * STEP_HEIGHT
	if test_move(xf, up):
		return
	var raised := Transform3D(xf.basis, xf.origin + up)
	if test_move(raised, motion):
		return
	global_position += up
