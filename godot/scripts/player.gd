extends CharacterBody3D
## Third-person mobile-ready player controller.
## Keyboard/mouse input and the touch HUD both feed the same action methods.

signal stats_changed(health: float, armor: float, ammo: int, reserve: int)
signal weapon_changed(weapon_name: String, category: String)
signal eliminated

const WALK_SPEED := 5.4
const SPRINT_SPEED := 7.6
const CROUCH_SPEED := 3.1
const JUMP_SPEED := 7.2
const GRAVITY := 18.0

var main
var mobile_move := Vector2.ZERO
var mobile_look := Vector2.ZERO
var mobile_fire := false
var mobile_aim := false
var mobile_crouch := false
var mobile_build_pressed := false
var camera_yaw := 0.0
var camera_pitch := -0.10
var sensitivity := 1.0
var health := 100.0
var armor := 50.0
var ammo := 30
var reserve_ammo := 120
var weapon_slots := ["pulse_rifle", "sidekick"]
var current_weapon_index := 0
var fire_cooldown := 0.0
var reload_timer := 0.0
var is_reloading := false
var is_dead := false
var walk_time := 0.0
var crouching := false
var visuals: Node3D
var weapon_root: Node3D
var muzzle: Marker3D
var camera_rig: Node3D
var camera: Camera3D
var left_leg: Node3D
var right_leg: Node3D
var body_mesh: MeshInstance3D

func _ready() -> void:
	collision_layer = 2
	collision_mask = 1 | 2
	floor_snap_length = 0.45
	_build_body()
	_build_camera()
	_emit_stats()

func initialize(main_ref: Node, spawn_position: Vector3) -> void:
	main = main_ref
	global_position = spawn_position
	var settings: Dictionary = GameState.profile.get("settings", {})
	sensitivity = float(settings.get("sensitivity", 1.0))
	var starter := GameState.get_weapon(weapon_slots[current_weapon_index])
	ammo = int(starter.magazine)
	weapon_changed.emit(starter.name, starter.category)

func _build_body() -> void:
	var collision := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.46
	capsule.height = 1.9
	collision.shape = capsule
	collision.position.y = 1.05
	add_child(collision)
	visuals = Node3D.new()
	visuals.name = "ScoutAvatar"
	add_child(visuals)
	body_mesh = BlockFactory.cube(visuals, Vector3(0, 1.18, 0), Vector3(0.92, 1.18, 0.58), Color("#36cdb8"), false, "Torso")
	BlockFactory.cube(visuals, Vector3(0, 2.05, 0), Vector3(0.72, 0.72, 0.72), Color("#f0bd91"), false, "Head")
	BlockFactory.cube(visuals, Vector3(0, 2.45, 0), Vector3(0.86, 0.18, 0.86), Color("#17233e"), false, "Helmet")
	BlockFactory.cube(visuals, Vector3(0.38, 1.45, 0), Vector3(0.18, 0.75, 0.2), Color("#f0bd91"), false, "RightArm")
	BlockFactory.cube(visuals, Vector3(-0.38, 1.45, 0), Vector3(0.18, 0.75, 0.2), Color("#f0bd91"), false, "LeftArm")
	left_leg = BlockFactory.cube(visuals, Vector3(-0.22, 0.35, 0), Vector3(0.28, 0.72, 0.32), Color("#253452"), false, "LeftLeg")
	right_leg = BlockFactory.cube(visuals, Vector3(0.22, 0.35, 0), Vector3(0.28, 0.72, 0.32), Color("#253452"), false, "RightLeg")
	weapon_root = Node3D.new()
	weapon_root.name = "PulseWeapon"
	weapon_root.position = Vector3(0.48, 1.28, -0.42)
	add_child(weapon_root)
	BlockFactory.cube(weapon_root, Vector3(0, 0, -0.5), Vector3(0.18, 0.18, 1.25), Color("#263849"), false, "WeaponBody")
	BlockFactory.cube(weapon_root, Vector3(0, 0.12, -0.12), Vector3(0.36, 0.28, 0.5), Color("#39d6c2"), false, "WeaponReceiver")
	BlockFactory.cube(weapon_root, Vector3(0, -0.18, 0.1), Vector3(0.22, 0.38, 0.28), Color("#121c31"), false, "WeaponGrip")
	muzzle = Marker3D.new()
	muzzle.position = Vector3(0, 0, -1.2)
	weapon_root.add_child(muzzle)

func _build_camera() -> void:
	camera_rig = Node3D.new()
	camera_rig.name = "ThirdPersonCameraRig"
	add_child(camera_rig)
	camera = Camera3D.new()
	camera.name = "Camera3D"
	camera.position = Vector3(0, 3.2, 6.8)
	camera.fov = 62.0
	camera.current = true
	camera_rig.add_child(camera)

func _physics_process(delta: float) -> void:
	if is_dead or (is_instance_valid(main) and main.match_paused):
		return
	_update_look(delta)
	_update_movement(delta)
	_update_weapon(delta)
	if Input.is_action_just_pressed("interact"):
		request_mobile_interact()
	_update_animation(delta)
	_update_camera()
	if mobile_build_pressed or Input.is_action_just_pressed("build"):
		mobile_build_pressed = false
		place_build_block()

func _update_look(_delta: float) -> void:
	var look := mobile_look
	mobile_look = Vector2.ZERO
	if look.length() > 0.0:
		camera_yaw -= look.x * 0.0045 * sensitivity
		camera_pitch = clamp(camera_pitch - look.y * 0.0025 * sensitivity, -0.38, 0.24)
	# Desktop fallback: arrow keys keep the prototype playable without a touch screen.
	if Input.is_key_pressed(KEY_LEFT):
		camera_yaw += 0.035
	if Input.is_key_pressed(KEY_RIGHT):
		camera_yaw -= 0.035
	camera_rig.rotation.y = camera_yaw

func _update_movement(delta: float) -> void:
	var move_input := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	if mobile_move.length() > 0.05:
		move_input = mobile_move
	var basis := Basis(Vector3.UP, camera_yaw)
	var direction := basis * Vector3(move_input.x, 0.0, move_input.y)
	if direction.length() > 1.0:
		direction = direction.normalized()
	crouching = mobile_crouch or Input.is_action_pressed("crouch")
	var speed := CROUCH_SPEED if crouching else (SPRINT_SPEED if move_input.length() > 0.8 else WALK_SPEED)
	if direction.length() > 0.05:
		velocity.x = move_toward(velocity.x, direction.x * speed, delta * 24.0)
		velocity.z = move_toward(velocity.z, direction.z * speed, delta * 24.0)
		var target_yaw := atan2(-direction.x, -direction.z)
		rotation.y = lerp_angle(rotation.y, target_yaw, delta * 10.0)
		walk_time += delta * (10.0 if speed > WALK_SPEED else 7.0)
	else:
		velocity.x = move_toward(velocity.x, 0.0, delta * 28.0)
		velocity.z = move_toward(velocity.z, 0.0, delta * 28.0)
	if is_on_floor():
		if Input.is_action_just_pressed("jump"):
			velocity.y = JUMP_SPEED
	else:
		velocity.y -= GRAVITY * delta
	move_and_slide()
	global_position.x = clamp(global_position.x, -71.0, 71.0)
	global_position.z = clamp(global_position.z, -71.0, 71.0)

func _update_weapon(delta: float) -> void:
	fire_cooldown = maxf(0.0, fire_cooldown - delta)
	if is_reloading:
		reload_timer -= delta
		if reload_timer <= 0.0:
			_finish_reload()
		return
	if Input.is_action_just_pressed("reload"):
		reload()
	if Input.is_action_just_pressed("swap_weapon"):
		switch_weapon()
	var wants_aim := mobile_aim or Input.is_action_pressed("aim")
	camera.fov = lerpf(camera.fov, 43.0 if wants_aim else 62.0, delta * 12.0)
	if mobile_fire or Input.is_action_pressed("fire"):
		shoot()
	_emit_stats()

func _update_animation(delta: float) -> void:
	if not is_instance_valid(left_leg):
		return
	var moving := Vector2(velocity.x, velocity.z).length() > 0.8
	if moving:
		left_leg.rotation.x = sin(walk_time) * 0.28
		right_leg.rotation.x = -sin(walk_time) * 0.28
	else:
		left_leg.rotation.x = lerpf(left_leg.rotation.x, 0.0, delta * 10.0)
		right_leg.rotation.x = lerpf(right_leg.rotation.x, 0.0, delta * 10.0)
	visuals.scale.y = lerpf(visuals.scale.y, 0.86 if crouching else 1.0, delta * 12.0)

func _update_camera() -> void:
	if not is_instance_valid(camera):
		return
	camera.position.x = lerpf(camera.position.x, 1.3 if (mobile_aim or Input.is_action_pressed("aim")) else 0.0, 0.12)
	camera.position.z = lerpf(camera.position.z, 4.2 if (mobile_aim or Input.is_action_pressed("aim")) else 6.8, 0.12)
	var target := global_position + Vector3.UP * (1.25 + camera_pitch * 2.0)
	camera.look_at(target, Vector3.UP)

func current_weapon() -> Dictionary:
	return GameState.get_weapon(weapon_slots[current_weapon_index])

func shoot() -> void:
	if is_reloading or fire_cooldown > 0.0:
		return
	if ammo <= 0:
		reload()
		return
	var weapon := current_weapon()
	ammo -= 1
	fire_cooldown = float(weapon.fire_rate)
	AudioManager.play_shot()
	if is_instance_valid(main) and main.has_method("spawn_muzzle_flash"):
		main.spawn_muzzle_flash(muzzle.global_position)
	var pellets := int(weapon.get("pellets", 1))
	for _pellet in range(pellets):
		_fire_hitscan(weapon)
	_emit_stats()

func _fire_hitscan(weapon: Dictionary) -> void:
	var origin := camera.global_position
	var forward := -camera.global_transform.basis.z
	var spread := float(weapon.spread)
	var direction := (forward + Vector3(randf_range(-spread, spread), randf_range(-spread, spread), randf_range(-spread, spread))).normalized()
	var target := origin + direction * float(weapon.range)
	var query := PhysicsRayQueryParameters3D.create(origin, target, 1 | 2 | 4 | 8)
	query.exclude = [self]
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty():
		if is_instance_valid(main) and main.has_method("spawn_tracer"):
			main.spawn_tracer(origin, target, weapon.color)
		return
	var hit_position: Vector3 = hit.position
	if is_instance_valid(main) and main.has_method("spawn_tracer"):
		main.spawn_tracer(origin, hit_position, weapon.color)
	var collider = hit.get("collider")
	if collider != null and collider.has_method("receive_damage"):
		collider.receive_damage(float(weapon.damage), self)
	if is_instance_valid(main) and main.has_method("spawn_hit_effect"):
		main.spawn_hit_effect(hit_position, weapon.color)

func reload() -> void:
	if is_reloading or ammo >= int(current_weapon().magazine) or reserve_ammo <= 0:
		return
	is_reloading = true
	reload_timer = float(current_weapon().reload)
	AudioManager.play_reload()
	if is_instance_valid(main) and main.has_method("show_toast"):
		main.show_toast("RELOADING...", false)

func _finish_reload() -> void:
	var needed := int(current_weapon().magazine) - ammo
	var loaded := mini(needed, reserve_ammo)
	ammo += loaded
	reserve_ammo -= loaded
	is_reloading = false
	_emit_stats()

func switch_weapon() -> void:
	if is_reloading:
		return
	current_weapon_index = (current_weapon_index + 1) % weapon_slots.size()
	var weapon := current_weapon()
	ammo = mini(ammo, int(weapon.magazine))
	weapon_changed.emit(weapon.name, weapon.category)
	_emit_stats()

func receive_damage(amount: float, _attacker: Node = null) -> void:
	if is_dead:
		return
	var armor_absorb := minf(armor, amount * 0.42)
	armor -= armor_absorb
	health -= amount - armor_absorb
	_emit_stats()
	if health <= 0.0:
		die()

func die() -> void:
	if is_dead:
		return
	is_dead = true
	velocity = Vector3.ZERO
	collision_layer = 0
	visuals.modulate = Color("#5e6572")
	eliminated.emit()

func collect_pickup(kind: String) -> void:
	if is_dead:
		return
	if kind == "ammo":
		reserve_ammo += 60
		if is_instance_valid(main):
			main.show_toast("AMMO +60", true)
	elif kind == "armor":
		armor = minf(100.0, armor + 40.0)
		if is_instance_valid(main):
			main.show_toast("ARMOR REPAIRED", true)
	elif kind == "medkit":
		health = minf(100.0, health + 40.0)
		if is_instance_valid(main):
			main.show_toast("MEDKIT +40", true)
	_emit_stats()

func place_build_block() -> void:
	if not is_instance_valid(main) or not main.has_method("place_build_block_from_player"):
		return
	var origin := camera.global_position
	var target := origin + (-camera.global_transform.basis.z) * 9.0
	var query := PhysicsRayQueryParameters3D.create(origin, target, 1 | 2 | 4 | 8)
	query.exclude = [self]
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	var position := target
	if not hit.is_empty():
		position = hit.position + hit.normal * 1.05
	main.place_build_block_from_player(position)

func _emit_stats() -> void:
	stats_changed.emit(health, armor, ammo, reserve_ammo)

func set_mobile_move(value: Vector2) -> void:
	mobile_move = value

func set_mobile_look(value: Vector2) -> void:
	mobile_look += value

func set_mobile_fire(value: bool) -> void:
	mobile_fire = value

func set_mobile_aim(value: bool) -> void:
	mobile_aim = value

func set_mobile_crouch(value: bool) -> void:
	mobile_crouch = value

func request_mobile_reload() -> void:
	reload()

func request_mobile_jump() -> void:
	if is_on_floor():
		velocity.y = JUMP_SPEED

func request_mobile_swap() -> void:
	switch_weapon()

func request_mobile_interact() -> void:
	if not is_instance_valid(main) or not is_instance_valid(main.world):
		return
	for pickup in main.world.loot_nodes:
		if is_instance_valid(pickup) and global_position.distance_to(pickup.global_position) < 3.2 and not pickup.collected:
			collect_pickup(pickup.pickup_type)
			pickup.collected = true
			pickup.queue_free()
			return
	if is_instance_valid(main):
		main.show_toast("NOTHING IN RANGE", false)

func request_mobile_build() -> void:
	mobile_build_pressed = true
