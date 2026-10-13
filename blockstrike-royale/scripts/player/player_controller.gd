class_name PlayerController
extends CharacterBody3D
## Local player character: movement, camera rig, inventory hooks and combat.
##
## Movement uses a damped acceleration model with distinct ground/air handling so
## touch input feels responsive without the character sliding or sticking to
## walls.  Everything the match manager needs (damage, elimination, healing,
## resupply) goes through explicit methods with signals, and the same class is
## reused for remote players (with `is_local` false) and for bots.

signal died(killer_id: String, weapon_id: String)
signal damaged(amount: float, attacker_id: String, direction: Vector3)
signal health_changed(health: float, armor: float)
signal weapon_changed(weapon_id: String)
signal ammo_changed(magazine: int, reserve: int)
signal reload_started(duration: float)
signal loot_interacted(container: Node)
signal spawned(body: Node3D)

const EYE_HEIGHT := 1.42
const HEAD_RADIUS := 0.32

var is_local: bool = true
var is_bot: bool = false
var player_id: String = ""
var display_name: String = "Player"
var team: int = 1

var health: float = 100.0
var armor: float = 0.0
var armor_tier: int = 0
var alive: bool = true
var downed: bool = false
var respawn_enabled: bool = false

var move_input: Vector2 = Vector2.ZERO
var sprint_held: bool = false
var crouch_held: bool = false
var jump_queued: bool = false
var look_delta: Vector2 = Vector2.ZERO
var aim_held: bool = false
var infinite_ammo: bool = false

var camera_pitch: float = -0.2
var camera_yaw: float = 0.0
var camera_distance: float = 4.4

var animator: CharacterAnimator
var inventory: PlayerInventory
var weapons: WeaponController
var camera: Camera3D
var camera_pivot: Node3D
var collision: CollisionShape3D
var interaction: InteractionComponent
var building: BuildingService

var _stand_shape: CapsuleShape3D
var _crouch_shape: CapsuleShape3D
var last_damage_source: String = ""
var last_damage_time: float = 99.0
var _fall_start_y: float = 0.0
var _was_on_floor: bool = true
var _footstep_accum: float = 0.0
var _world: VoxelWorld = null
var _jump_buffer: float = 0.0
var _camera_collision: ShapeCast3D
var _last_ground_material: String = "grass"

func _ready() -> void:
	collision_layer = GameConfig.Layer.PLAYER
	collision_mask = GameConfig.Layer.WORLD | GameConfig.Layer.PROP
	_build_body()
	_stand_shape.height = GameConfig.PLAYER["stand_height"]
	_stand_shape.radius = GameConfig.PLAYER["radius"]
	_crouch_shape.height = GameConfig.PLAYER["crouch_height"]
	_crouch_shape.radius = GameConfig.PLAYER["radius"]
	if is_local:
		_build_camera()

func setup(world: VoxelWorld, local: bool, colors: Dictionary = {}) -> void:
	_world = world
	is_local = local
	animator.apply_cosmetics(colors)
	animator.set_name_tag_visible(not local)

func _build_body() -> void:
	collision = CollisionShape3D.new()
	collision.name = "Collision"
	_stand_shape = CapsuleShape3D.new()
	_stand_shape.height = GameConfig.PLAYER["stand_height"]
	_stand_shape.radius = GameConfig.PLAYER["radius"]
	collision.shape = _stand_shape
	collision.position = Vector3(0, GameConfig.PLAYER["stand_height"] * 0.5, 0)
	add_child(collision)

	animator = CharacterAnimator.new()
	animator.name = "Animator"
	add_child(animator)

	inventory = PlayerInventory.new()
	inventory.name = "Inventory"
	add_child(inventory)

	weapons = WeaponController.new()
	weapons.name = "Weapons"
	add_child(weapons)

	interaction = InteractionComponent.new()
	interaction.name = "Interaction"
	add_child(interaction)

func _build_camera() -> void:
	camera_pivot = Node3D.new()
	camera_pivot.name = "CameraPivot"
	camera_pivot.position = Vector3(0, GameConfig.CAMERA["height_offset"], 0)
	add_child(camera_pivot)
	camera = Camera3D.new()
	camera.name = "Camera"
	camera.fov = GameConfig.CAMERA["fov_default"]
	camera.far = 400.0
	camera_pivot.add_child(camera)
	_camera_collision = ShapeCast3D.new()
	_camera_collision.name = "CameraCast"
	_camera_collision.shape = SphereShape3D.new()
	(_camera_collision.shape as SphereShape3D).radius = 0.25
	_camera_collision.target_position = Vector3(0, 0, GameConfig.CAMERA["distance"])
	_camera_collision.collision_mask = int(GameConfig.CAMERA["collision_mask"])
	_camera_collision.enabled = true
	camera_pivot.add_child(_camera_collision)

func world() -> VoxelWorld:
	return _world

func set_world(world: VoxelWorld) -> void:
	_world = world

# ------------------------------------------------------------------ gameplay
func attach_weapons(weapon_ids: Dictionary, team_color: Color) -> void:
	weapons.setup(self, animator)
	weapons.equip_from_loadout(weapon_ids)
	animator.set_team_color(team_color)
	inventory.armor_changed.connect(_on_armor_changed)

func spawn_at(position: Vector3, yaw: float = 0.0) -> void:
	global_position = position
	rotation.y = yaw
	camera_yaw = yaw
	velocity = Vector3.ZERO
	alive = true
	downed = false
	health = GameConfig.PLAYER["max_health"]
	armor = 0.0
	armor_tier = 0
	animator.set_downed(false)
	animator.set_health_ratio(1.0)
	if weapons != null:
		weapons.refill_all()
	health_changed.emit(health, armor)
	spawned.emit(self)

func _physics_process(delta: float) -> void:
	last_damage_time += delta
	if not alive:
		velocity = Vector3.ZERO
		return
	_jump_buffer = maxf(0.0, _jump_buffer - delta)
	if jump_queued:
		jump_queued = false
		_jump_buffer = 0.12
	var on_floor := is_on_floor()
	MoveLogic.apply(self, delta, move_input, sprint_held, crouch_held, _jump_buffer > 0.0,
		on_floor, _world)
	_update_animation_state(on_floor, delta)
	_handle_fall_damage(on_floor)
	_update_camera(delta)
	_handle_footsteps(delta, on_floor)
	_was_on_floor = on_floor

## Physics/behaviour shared with bots and remote prediction lives in MoveLogic so
## there is exactly one movement implementation.
func _update_animation_state(on_floor: bool, delta: float) -> void:
	var speed := Vector2(velocity.x, velocity.z).length()
	animator.move_speed_ratio = clampf(speed / GameConfig.PLAYER["sprint_speed"], 0.0, 1.0)
	animator.is_aiming = aim_held
	animator.aim_pitch = camera_pitch
	if not on_floor:
		animator.set_state(CharacterAnimator.State.FALL if velocity.y < 0.0
			else CharacterAnimator.State.JUMP)
		return
	if animator.state == CharacterAnimator.State.LAND or animator.state == CharacterAnimator.State.RELOAD \
			or animator.state == CharacterAnimator.State.MELEE or animator.state == CharacterAnimator.State.EMOTE:
		return
	if crouch_held:
		animator.set_state(CharacterAnimator.State.CROUCH_WALK if speed > 0.4
			else CharacterAnimator.State.CROUCH_IDLE)
	elif speed > 0.4:
		animator.set_state(CharacterAnimator.State.RUN if speed > GameConfig.PLAYER["walk_speed"]
			else CharacterAnimator.State.WALK)
	elif aim_held:
		animator.set_state(CharacterAnimator.State.SHOOT)
	else:
		animator.set_state(CharacterAnimator.State.IDLE)

func _handle_fall_damage(on_floor: bool) -> void:
	if on_floor:
		if not _was_on_floor:
			var fall_distance := _fall_start_y - global_position.y
			animator.trigger_land()
			AudioDirector.play_sfx("land", global_position, -6.0)
			if fall_distance > 4.5:
				var excess := fall_distance - 4.5
				apply_damage(excess * 6.0, "", "fall")
		return
	if _was_on_floor:
		_fall_start_y = global_position.y
	elif global_position.y > _fall_start_y:
		_fall_start_y = global_position.y

func _handle_footsteps(delta: float, on_floor: bool) -> void:
	if not on_floor or not is_local:
		return
	var speed := Vector2(velocity.x, velocity.z).length()
	if speed < 0.6:
		_footstep_accum = 0.0
		return
	_footstep_accum += delta * speed
	var stride := 2.6 if not crouch_held else 3.4
	if _footstep_accum >= stride:
		_footstep_accum = 0.0
		var material := _world.footstep_sound_at(global_position) if _world != null else "footstep_grass"
		if material != _last_ground_material:
			_last_ground_material = material
		AudioDirector.play_sfx(material, global_position, -12.0)

# ------------------------------------------------------------------- camera
func _update_camera(delta: float) -> void:
	# Look input, pitch clamping and body yaw are device independent: bots and
	# (later) remote players drive the same fields, they simply have no camera rig.
	var sensitivity := float(Settings.control_value("sensitivity", GameConfig.CAMERA["default_sensitivity"]))
	var aim_sensitivity := float(Settings.control_value("aim_sensitivity",
		GameConfig.CAMERA["default_aim_sensitivity"]))
	var applied := aim_sensitivity if aim_held else sensitivity
	var invert := -1.0 if bool(Settings.control_value("invert_y", false)) else 1.0
	if look_delta != Vector2.ZERO:
		camera_yaw -= look_delta.x * applied
		camera_pitch -= look_delta.y * applied * invert
		look_delta = Vector2.ZERO
	camera_pitch = clampf(camera_pitch, deg_to_rad(GameConfig.CAMERA["pitch_min_deg"]),
		deg_to_rad(GameConfig.CAMERA["pitch_max_deg"]))
	rotation.y = camera_yaw
	if camera_pivot == null or camera == null:
		return
	camera_pivot.rotation.y = camera_yaw
	camera_pivot.rotation.x = camera_pitch
	var target_distance := float(GameConfig.CAMERA["ads_distance"] if aim_held
		else GameConfig.CAMERA["distance"])
	if crouch_held:
		target_distance *= 0.85
	camera_distance = move_toward(camera_distance, target_distance, delta * 6.0)
	camera.position = Vector3(0, 0, _resolve_camera_distance(camera_distance))
	camera.fov = move_toward(camera.fov, float(GameConfig.CAMERA["fov_ads"] if aim_held
		else GameConfig.CAMERA["fov_default"]), delta * 90.0)
	# Keep the camera inside the room in front of it.
	if animator != null:
		animator.set_state(animator.state)

## Shortens the camera boom when geometry is behind the player so the view never
## ends up inside a wall.
func _resolve_camera_distance(desired: float) -> float:
	if _camera_collision == null:
		return desired
	var forward := -camera_pivot.global_transform.basis.z
	var origin := camera_pivot.global_position
	var space := get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(origin, origin + forward * desired)
	query.collision_mask = int(GameConfig.CAMERA["collision_mask"])
	query.exclude = [get_rid()]
	var hit := space.intersect_ray(query)
	if hit.is_empty():
		return desired
	var distance: float = origin.distance_to(hit["position"]) - 0.25
	return clampf(distance, GameConfig.CAMERA["min_distance"], desired)

## Direction the player is aiming.  With a camera rig the camera's forward vector
## is authoritative; without one (bots, remote proxies) the pitch/yaw angles are
## converted directly, which keeps their shots pointing where they look.
func aim_direction() -> Vector3:
	if camera != null:
		return -camera.global_transform.basis.z
	var aim_basis := Basis.from_euler(Vector3(camera_pitch, camera_yaw, 0.0))
	return (-aim_basis.z).normalized()

func muzzle_origin() -> Vector3:
	return animator.muzzle_position()

# -------------------------------------------------------------- damage/health
func apply_damage(amount: float, attacker_id: String, weapon_id: String,
				  direction: Vector3 = Vector3.ZERO) -> void:
	if not alive or amount <= 0.0:
		return
	if not attacker_id.is_empty():
		last_damage_source = attacker_id
		last_damage_time = 0.0
	var remaining := amount
	var reduction := float(ContentDB.armor_tier(armor_tier).get("reduction", 0.0))
	if armor > 0.0:
		var absorbed := minf(armor, remaining * reduction)
		armor = maxf(0.0, armor - absorbed)
		remaining -= absorbed
		if armor <= 0.0:
			armor_tier = maxi(0, armor_tier - 1)
	health = maxf(0.0, health - remaining)
	animator.set_health_ratio(health / GameConfig.PLAYER["max_health"])
	health_changed.emit(health, armor)
	damaged.emit(amount, attacker_id, direction)
	if is_local:
		AudioDirector.play_ui("damage_taken", -6.0)
	if health <= 0.0:
		_die(attacker_id, weapon_id)

## True when `other` is a valid enemy of this player (team rules + friendly fire).
func is_hostile(other: PlayerController) -> bool:
	if other == null or other == self or not other.alive:
		return false
	if team <= 0 or other.team <= 0:
		return true
	if team != other.team:
		return true
	return MatchState.friendly_fire_enabled()

func _die(killer_id: String, weapon_id: String) -> void:
	alive = false
	downed = true
	animator.set_downed(true)
	if weapons != null:
		weapons.stop_all()
	died.emit(killer_id, weapon_id)

func revive() -> void:
	health = GameConfig.PLAYER["max_health"] * 0.5
	alive = true
	downed = false
	animator.set_downed(false)
	animator.set_health_ratio(health / GameConfig.PLAYER["max_health"])
	health_changed.emit(health, armor)

func heal(amount: float) -> float:
	if not alive:
		return 0.0
	var previous := health
	health = minf(GameConfig.PLAYER["max_health"], health + amount)
	var healed := health - previous
	if healed > 0.0:
		animator.set_health_ratio(health / GameConfig.PLAYER["max_health"])
		health_changed.emit(health, armor)
	return healed

func add_armor(amount: float, tier: int) -> void:
	var max_armor := float(ContentDB.armor_tier(tier).get("max", 50))
	armor = clampf(max(armor, 0.0) + amount, 0.0, max_armor)
	armor_tier = maxi(armor_tier, tier)
	health_changed.emit(health, armor)

## Restocks ammunition and equipment (training ground, respawn, buy phase).
func resupply(loadout: Dictionary = {}) -> void:
	if weapons != null:
		weapons.refill_all()
	if not loadout.is_empty():
		weapons.equip_from_loadout(loadout)
	if infinite_ammo and weapons != null:
		weapons.set_infinite_ammo(true)

func _on_armor_changed(current: float, tier: int) -> void:
	armor = current
	armor_tier = tier
	health_changed.emit(health, armor)

# ---------------------------------------------------------------- interaction
func interact() -> void:
	if interaction == null or not interaction.has_target():
		loot_interacted.emit(null)
		return
	var target := interaction.current_target()
	if target != null and target.has_method("interact"):
		target.call("interact", self)
	loot_interacted.emit(target)

func set_process_input_sensitivity(value: float) -> void:
	Settings.controls["sensitivity"] = value
	Settings.persist()

## Snapshot for network replication / bots / debugging.
func state_snapshot() -> Dictionary:
	return {
		"player_id": player_id,
		"position": global_position,
		"yaw": rotation.y,
		"pitch": camera_pitch,
		"health": health,
		"armor": armor,
		"alive": alive,
		"weapon": weapons.current_weapon_id() if weapons != null else "",
		"team": team,
	}

func apply_snapshot(snapshot: Dictionary, delta: float) -> void:
	var target: Vector3 = snapshot.get("position", global_position)
	if is_local:
		return
	global_position = global_position.lerp(target, minf(1.0, delta * GameConfig.NET["interp_back_time"] * 10.0 + 0.15))
	rotation.y = float(snapshot.get("yaw", rotation.y))
	camera_pitch = float(snapshot.get("pitch", camera_pitch))
	if animator != null:
		animator.aim_pitch = camera_pitch
	var snapshot_alive: bool = bool(snapshot.get("alive", alive))
	if snapshot_alive != alive:
		alive = snapshot_alive
		animator.set_downed(not alive)
func set_visibility_for_local_view(visible_value: bool) -> void:
	# A first-person-ish option would hide the body mesh; third person keeps it.
	animator.visible = visible_value
