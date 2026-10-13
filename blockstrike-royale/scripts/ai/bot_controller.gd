class_name BotController
extends Node
## Offline bot brain: perception, navigation, aim, squad behaviour.
##
## Bots drive a normal PlayerController (the same one the player uses), so they
## are subject to the same physics, weapons, damage, falling and zone rules -
## there is no separate "fake" path.  Difficulty changes reaction time, aim error,
## target switching, engagement range and how well they lead a moving target.

signal bot_spotted_enemy(bot: PlayerController, enemy: PlayerController)
signal bot_eliminated(bot: PlayerController, killer_id: String)

enum State { IDLE, LOOT, PATROL, ENGAGE, REPOSITION, FLANK, HEAL, FLEE, DEAD }

const DIFFICULTIES := {
	"easy": {
		"reaction": 0.75, "aim_error_deg": 9.0, "aim_speed": 2.0, "burst_pause": 1.3,
		"engage_range": 28.0, "engage_min": 8.0, "accuracy_hold": 0.25,
		"lead_target": 0.0, "heal_at": 0.35, "loot_time": 6.0, "strafe_chance": 0.2,
		"reload_discipline": 0.3, "sprint": false, "build": 0.0, "headshot_bias": 0.05,
	},
	"normal": {
		"reaction": 0.42, "aim_error_deg": 5.0, "aim_speed": 4.0, "burst_pause": 0.9,
		"engage_range": 38.0, "engage_min": 6.0, "accuracy_hold": 0.5,
		"lead_target": 0.5, "heal_at": 0.45, "loot_time": 4.5, "strafe_chance": 0.5,
		"reload_discipline": 0.6, "sprint": true, "build": 0.15, "headshot_bias": 0.2,
	},
	"hard": {
		"reaction": 0.22, "aim_error_deg": 2.2, "aim_speed": 7.0, "burst_pause": 0.6,
		"engage_range": 55.0, "engage_min": 4.0, "accuracy_hold": 0.85,
		"lead_target": 0.9, "heal_at": 0.55, "loot_time": 3.0, "strafe_chance": 0.85,
		"reload_discipline": 0.9, "sprint": true, "build": 0.5, "headshot_bias": 0.45,
	},
	"expert": {
		"reaction": 0.14, "aim_error_deg": 1.2, "aim_speed": 10.0, "burst_pause": 0.45,
		"engage_range": 70.0, "engage_min": 3.0, "accuracy_hold": 1.0,
		"lead_target": 1.0, "heal_at": 0.6, "loot_time": 2.2, "strafe_chance": 1.0,
		"reload_discipline": 1.0, "sprint": true, "build": 0.8, "headshot_bias": 0.6,
	},
}

var brain: PlayerController = null
var difficulty: String = "normal"
var settings: Dictionary = {}
var state: int = State.IDLE
var target: PlayerController = null
var target_last_seen: float = 0.0
var target_position: Vector3 = Vector3.ZERO
var world: VoxelWorld = null
var nav_goal: Vector3 = Vector3.ZERO
var has_goal: bool = false
var loot_goal: Node = null
var spots_enemy: bool = true
var team: int = 1
var squad_id: int = 0
var personality: Dictionary = {}
var building: BuildingService = null
var zone: ZoneManager = null

var _reaction_timer: float = 0.0
var _fire_timer: float = 0.0
var _burst_timer: float = 0.0
var _bursting: bool = false
var _state_timer: float = 0.0
var _loot_timer: float = 0.0
var _strafe_dir: float = 1.0
var _strafe_timer: float = 0.0
var _path_timer: float = 0.0
var _stuck_timer: float = 0.0
var _last_position: Vector3 = Vector3.ZERO
var _aim_pitch: float = 0.0
var _rng := RandomNumberGenerator.new()
var _last_build_check: float = 0.0

func setup(bot_body: PlayerController, difficulty_id: String, seed_value: int = 0,
		   voxel_world: VoxelWorld = null, zone_manager: ZoneManager = null) -> void:
	brain = bot_body
	difficulty = difficulty_id if DIFFICULTIES.has(difficulty_id) else "normal"
	settings = DIFFICULTIES[difficulty]
	world = voxel_world if voxel_world != null else bot_body.world()
	zone = zone_manager
	_rng.seed = seed_value if seed_value != 0 else int(Time.get_ticks_usec())
	team = bot_body.team
	personality = {
		"aggression": _rng.randf_range(0.35, 1.0),
		"caution": _rng.randf_range(0.2, 0.9),
		"preferred_range": _rng.randf_range(6.0, 22.0),
		"patience": _rng.randf_range(0.6, 1.6),
	}
	if brain.weapons != null:
		brain.weapons.fire_cooldown = _rng.randf_range(0.0, 0.4)
	set_state(State.PATROL)
	set_process(true)

func _process(delta: float) -> void:
	if brain == null or not brain.alive:
		if state != State.DEAD:
			set_state(State.DEAD)
			bot_eliminated.emit(brain, brain.last_damage_source if brain != null else "")
		return
	_state_timer += delta
	_perceive(delta)
	_think(delta)
	_act(delta)

# ------------------------------------------------------------------ perception
func _perceive(delta: float) -> void:
	var enemy := _find_visible_enemy()
	if enemy != null:
		if target != enemy:
			_reaction_timer = float(settings.get("reaction", 0.4))
			target = enemy
			bot_spotted_enemy.emit(brain, enemy)
		target_last_seen = 0.0
		target_position = enemy.global_position
		var to_enemy := enemy.global_position - brain.global_position
		var distance := to_enemy.length()
		if distance <= float(settings.get("engage_range", 35.0)):
			if state != State.ENGAGE and state != State.REPOSITION:
				set_state(State.ENGAGE)
	else:
		target_last_seen += delta
		if target != null and target_last_seen > 3.5:
			target = null
			if state == State.ENGAGE or state == State.REPOSITION:
				set_state(State.PATROL)

func _find_visible_enemy() -> PlayerController:
	var tree := get_tree()
	if tree == null:
		return null
	var eye := brain.global_position + Vector3(0, 1.4, 0)
	var best: PlayerController = null
	var best_distance := INF
	var view_dir := Vector3(sin(brain.camera_yaw), 0, cos(brain.camera_yaw))
	for node: Node in tree.get_nodes_in_group("damageable"):
		var candidate := node as PlayerController
		if candidate == null or candidate == brain or not candidate.alive:
			continue
		if not brain.is_hostile(candidate):
			continue
		var to_candidate := candidate.global_position - brain.global_position
		var distance := to_candidate.length()
		var max_range := float(settings.get("engage_range", 35.0)) * 1.4
		if distance > max_range or distance >= best_distance:
			continue
		if not world.has_line_of_sight(eye, candidate.global_position + Vector3(0, 1.2, 0)):
			continue
		var flat := Vector3(to_candidate.x, 0, to_candidate.z).normalized()
		var facing := view_dir.dot(flat)
		# Bots notice movement in front of them easily and behind them rarely.
		var threshold := 0.1 if distance < 12.0 else 0.45
		if facing < threshold and not spots_enemy:
			continue
		best = candidate
		best_distance = distance
	return best

# ---------------------------------------------------------------------- think
func _think(delta: float) -> void:
	_reaction_timer = maxf(0.0, _reaction_timer - delta)
	_burst_timer = maxf(0.0, _burst_timer - delta)
	_strafe_timer = maxf(0.0, _strafe_timer - delta)
	var health_ratio := brain.health / maxf(1.0, GameConfig.PLAYER["max_health"])
	if zone != null and not zone.is_inside(brain.global_position):
		var rate := zone.damage_rate_for(brain.global_position, zone.current_dps())
		if rate > 3.0 or health_ratio < 0.5:
			set_state(State.FLEE)
	elif health_ratio <= float(settings.get("heal_at", 0.4)) and brain.inventory != null:
		if brain.inventory.count("medkit") > 0 or brain.inventory.count("bandage") > 0:
			set_state(State.HEAL)
	if state == State.HEAL:
		var result := brain.inventory.use_heal()
		if result.succeeded():
			set_state(State.REPOSITION)
	if state == State.FLEE:
		if zone == null or zone.is_inside(brain.global_position):
			set_state(State.PATROL)
	if brain.inventory != null and brain.inventory.ammo_for(brain.weapons.current_weapon_id()) <= 0 \
			and brain.weapons.current_reserve() <= 0:
		set_state(State.LOOT)

func set_state(next: int) -> void:
	if state == next:
		return
	state = next
	_state_timer = 0.0
	has_goal = false
	loot_goal = null
	_loot_timer = 0.0
	if brain != null and brain.weapons != null:
		brain.weapons.trigger_held = false
	match state:
		State.PATROL:
			_pick_patrol_goal()
		State.LOOT:
			_loot_timer = float(settings.get("loot_time", 4.0))
		State.ENGAGE:
			_strafe_dir = 1.0 if _rng.randf() < 0.5 else -1.0
		State.FLEE:
			_pick_flee_goal()
		State.DEAD:
			if brain != null and brain.weapons != null:
				brain.weapons.stop_all()

# ------------------------------------------------------------------------ act
func _act(delta: float) -> void:
	if brain.weapons == null:
		return
	brain.move_input = Vector2.ZERO
	brain.sprint_held = false
	brain.crouch_held = false
	brain.aim_held = false
	brain.jump_queued = false
	match state:
		State.PATROL, State.LOOT:
			_act_navigate(delta, false)
		State.ENGAGE:
			_act_engage(delta)
		State.REPOSITION:
			_act_reposition(delta)
		State.FLEE:
			_act_navigate(delta, true)
		State.HEAL:
			_freeze()
		State.IDLE:
			pass
	_track_stuck(delta)

func _act_navigate(delta: float, urgent: bool) -> void:
	if not has_goal:
		_pick_patrol_goal()
	var to_goal := nav_goal - brain.global_position
	var distance := Vector2(to_goal.x, to_goal.z).length()
	if distance < 2.0 or _state_timer > 26.0:
		if state == State.FLEE:
			_pick_flee_goal()
		else:
			_pick_patrol_goal()
		return
	var direction := _steer_towards(nav_goal)
	_apply_move(direction, urgent or float(settings.get("sprint", true) as bool))
	_face_direction(direction, delta)
	if state == State.LOOT:
		_loot_timer -= delta
		_bot_loot()
		if _loot_timer <= 0.0:
			set_state(State.PATROL)

func _act_engage(delta: float) -> void:
	if target == null or not target.alive:
		set_state(State.PATROL)
		return
	var to_target := target.global_position - brain.global_position
	var flat := Vector3(to_target.x, 0, to_target.z)
	var distance := flat.length()
	var team_mates := _count_visible_allies()
	var style := _engagement_style(distance, team_mates)
	_aim_at(target, delta)
	var engage_min := float(settings.get("engage_min", 6.0))
	var preferred := float(personality.get("preferred_range", 14.0))
	var engaged_range := clampf(preferred, engage_min, float(settings.get("engage_range", 35.0)))
	match style:
		"push":
			_apply_move(flat.normalized(), true)
		"back_off":
			_apply_move(-flat.normalized(), false)
		_:
			if _strafe_timer <= 0.0:
				_strafe_timer = _rng.randf_range(0.7, 1.6)
				_strafe_dir = -_strafe_dir if _rng.randf() < 0.5 else _strafe_dir
				if _rng.randf() < float(settings.get("strafe_chance", 0.5)):
					_strafe_dir = 1.0 if _rng.randf() < 0.5 else -1.0
			var strafe := Vector3(-flat.z, 0, flat.x).normalized() * _strafe_dir
			var approach := 0.0
			if distance > engaged_range * 1.15:
				approach = 1.0
			elif distance < engage_min:
				approach = -0.6
			_apply_move((strafe + flat.normalized() * approach).normalized(), false)
	_handle_shooting(delta, distance)
	_maybe_build_cover(delta)

func _act_reposition(delta: float) -> void:
	if target == null or not target.alive:
		set_state(State.PATROL)
		return
	if not has_goal:
		nav_goal = _cover_position_against(target.global_position)
		has_goal = true
	var to_goal := nav_goal - brain.global_position
	_apply_move(_steer_towards(nav_goal), true)
	_face_direction(to_goal, delta)
	if brain.global_position.distance_to(nav_goal) < 2.0 or _state_timer > 8.0:
		set_state(State.ENGAGE)
	_handle_shooting(delta, brain.global_position.distance_to(target.global_position))

func _freeze() -> void:
	brain.move_input = Vector2.ZERO
	brain.weapons.trigger_held = false

func _apply_move(direction: Vector3, sprint: bool) -> void:
	if direction.length_squared() < 0.01:
		brain.move_input = Vector2.ZERO
		return
	var forward := Vector3(sin(brain.camera_yaw), 0, cos(brain.camera_yaw))
	var right := Vector3(forward.z, 0, -forward.x)
	brain.move_input = Vector2(direction.dot(right), -direction.dot(forward)).limit_length(1.0)
	brain.sprint_held = sprint and brain.inventory != null and brain.inventory.build_blocks >= 0

func _face_direction(direction: Vector3, delta: float) -> void:
	if direction.length_squared() < 0.01:
		return
	var desired := atan2(direction.x, direction.z)
	brain.camera_yaw = _lerp_angle(brain.camera_yaw, desired,
		minf(1.0, delta * float(settings.get("aim_speed", 4.0)) * 0.5))

func _aim_at(enemy: PlayerController, delta: float) -> void:
	var eye := brain.muzzle_origin()
	var aim_point := enemy.global_position + Vector3(0, float(settings.get("headshot_bias", 0.2)) * 1.2 \
		+ 0.6, 0)
	var lead := float(settings.get("lead_target", 0.4))
	if lead > 0.0:
		var distance := eye.distance_to(aim_point)
		var travel := distance / maxf(1.0, float(brain.weapons.current_weapon().get("muzzle_velocity", 300.0)))
		aim_point += enemy.velocity * travel * lead
	var to_aim := aim_point - eye
	var flat := atan2(to_aim.x, to_aim.z)
	var vertical := atan2(to_aim.y, Vector2(to_aim.x, to_aim.z).length())
	var aim_speed := float(settings.get("aim_speed", 4.0)) * minf(1.0, _state_timer + 0.2)
	brain.camera_yaw = _lerp_angle(brain.camera_yaw, flat, minf(1.0, delta * aim_speed))
	_aim_pitch = lerp_angle(_aim_pitch, vertical, minf(1.0, delta * aim_speed))
	brain.camera_pitch = clampf(-_aim_pitch, deg_to_rad(GameConfig.CAMERA["pitch_min_deg"]),
		deg_to_rad(GameConfig.CAMERA["pitch_max_deg"]))
	var error := deg_to_rad(float(settings.get("aim_error_deg", 4.0))) * (1.0 - _accuracy_hold())
	brain.camera_yaw += _rng.randf_range(-error, error)
	brain.camera_pitch += _rng.randf_range(-error, error) * 0.5

func _accuracy_hold() -> float:
	var hold := float(settings.get("accuracy_hold", 0.5))
	var speed := Vector2(brain.velocity.x, brain.velocity.z).length()
	var movement_penalty := clampf(speed / GameConfig.PLAYER["sprint_speed"], 0.0, 1.0) * 0.25
	var time_bonus := clampf(_state_timer / 2.0, 0.0, 1.0) * 0.15
	return clampf(hold - movement_penalty + time_bonus, 0.0, 1.0)

func _handle_shooting(delta: float, distance: float) -> void:
	var weapons := brain.weapons
	if weapons == null:
		return
	var weapon := weapons.current_weapon()
	if weapon.is_empty():
		return
	var magazine := weapons.current_magazine()
	var magazine_size := maxi(1, int(weapon.get("magazine", 1)))
	if magazine <= maxi(0, int(magazine_size * (1.0 - float(settings.get("reload_discipline", 0.5)) * 0.5))) \
			and weapons.current_reserve() > 0 and not weapons.reloading:
		weapons.start_reload()
		weapons.trigger_held = false
		return
	if weapons.reloading:
		weapons.trigger_held = false
		return
	if _reaction_timer > 0.0 or target == null:
		weapons.trigger_held = false
		return
	var max_range := float(weapon.get("effective_range", 40.0))
	if distance > max_range * 2.0 or distance > float(settings.get("engage_range", 35.0)):
		weapons.trigger_held = false
		return
	var aim_dir := brain.aim_direction()
	var to_target := (target.global_position + Vector3(0, 0.8, 0)) - brain.muzzle_origin()
	var angle := rad_to_deg(aim_dir.angle_to(to_target.normalized()))
	# Only pull the trigger when the weapon is roughly on target.
	if angle > float(settings.get("aim_error_deg", 4.0)) * 2.5 + 3.0:
		weapons.trigger_held = false
		return
	if not world.has_line_of_sight(brain.muzzle_origin(),
			target.global_position + Vector3(0, 1.0, 0)):
		weapons.trigger_held = false
		return
	_fire_timer -= delta
	if _bursting:
		weapons.trigger_held = true
		if _burst_timer <= 0.0:
			_bursting = false
			_burst_timer = float(settings.get("burst_pause", 1.0)) / maxf(0.4, float(personality.get("patience", 1.0)))
			weapons.trigger_held = false
	else:
		weapons.trigger_held = false
		if _burst_timer <= 0.0 and _fire_timer <= 0.0:
			_bursting = true
			_burst_timer = _rng.randf_range(0.35, 0.9)
			_fire_timer = 0.0

func _maybe_build_cover(delta: float) -> void:
	if building == null or not building.is_enabled():
		return
	_last_build_check += delta
	if _last_build_check < 0.5:
		return
	_last_build_check = 0.0
	var chance := float(settings.get("build", 0.0))
	if chance <= 0.0 or _rng.randf() > chance * 0.35:
		return
	if building.mode == BuildingService.Mode.LIMITED and building.blocks_available() <= 0:
		return
	building.set_piece(BuildingService.Piece.WALL)
	building.try_place()

func _bot_loot() -> void:
	if world == null or brain == null:
		return
	if loot_goal == null or not is_instance_valid(loot_goal):
		loot_goal = null
		var nearest := world.nearest_loot(brain.global_position, 24.0)
		if nearest != null:
			loot_goal = nearest
	if loot_goal != null and is_instance_valid(loot_goal):
		nav_goal = (loot_goal as Node3D).global_position
		has_goal = true
		if brain.global_position.distance_to(nav_goal) < 2.2 and loot_goal.has_method("interact"):
			loot_goal.call("interact", brain)

# ------------------------------------------------------------------ navigation
func _steer_towards(goal: Vector3) -> Vector3:
	var flat_goal := Vector3(goal.x, brain.global_position.y, goal.z)
	var direct := (flat_goal - brain.global_position)
	direct.y = 0.0
	if direct.length_squared() < 0.01:
		return Vector3.ZERO
	var direction := direct.normalized()
	# Simple avoidance: probe ahead and around; slide along obstacles.
	var probes: Array = [0.0, 22.0, -22.0, 45.0, -45.0, 70.0, -70.0, 100.0, -100.0]
	var step := 1.6
	for offset: float in probes:
		var candidate := direction.rotated(Vector3.UP, deg_to_rad(offset))
		if _probe_clear(candidate, step):
			# Steep terrain: jump when the way ahead is one block up.
			if _probe_needs_jump(candidate, step):
				brain.jump_queued = true
			return candidate
	brain.jump_queued = true
	return direction

func _probe_clear(direction: Vector3, distance: float) -> bool:
	var origin := brain.global_position + Vector3(0, 0.9, 0)
	var target := origin + direction * distance
	if not world.has_line_of_sight(origin, target):
		return false
	# A wall taller than one block at the probe point is a real obstacle.
	var ahead := brain.global_position + direction * distance
	var ground := world.ground_y(ahead.x, ahead.z)
	return ground - brain.global_position.y < 1.35

func _probe_needs_jump(direction: Vector3, distance: float) -> bool:
	var ahead := brain.global_position + direction * distance
	var ground := world.ground_y(ahead.x, ahead.z)
	var rise := ground - brain.global_position.y
	return rise > 0.85 and rise < 2.2

func _pick_patrol_goal() -> void:
	if world == null:
		has_goal = false
		return
	var anchor := brain.global_position
	if zone != null and zone.running:
		# Patrol inside the zone, biased to the next circle so bots rotate early.
		var center := zone.target_center
		var spread := maxf(8.0, zone.target_radius * 0.7)
		nav_goal = Vector3(center.x + _rng.randf_range(-spread, spread), anchor.y,
			center.y + _rng.randf_range(-spread, spread))
	else:
		var loot := world.nearest_loot(anchor, 40.0)
		if loot != null and _rng.randf() < 0.55:
			nav_goal = (loot as Node3D).global_position
		else:
			nav_goal = anchor + Vector3(_rng.randf_range(-24.0, 24.0), 0.0,
				_rng.randf_range(-24.0, 24.0))
	nav_goal.y = world.ground_y(nav_goal.x, nav_goal.z)
	has_goal = true

func _pick_flee_goal() -> void:
	if zone == null or world == null:
		has_goal = false
		return
	var center := zone.center
	var radius := maxf(6.0, zone.radius * 0.6)
	var angle := _rng.randf() * TAU
	nav_goal = Vector3(center.x + cos(angle) * radius, brain.global_position.y,
		center.y + sin(angle) * radius)
	nav_goal.y = world.ground_y(nav_goal.x, nav_goal.z)
	has_goal = true

func _cover_position_against(enemy_position: Vector3) -> Vector3:
	var anchor := brain.global_position
	var away := (anchor - enemy_position)
	away.y = 0.0
	if away.length_squared() < 0.01:
		away = Vector3.FORWARD
	var candidates: Array = [6.0, 10.0, 14.0]
	for distance: float in candidates:
		var spot := anchor + away.normalized() * distance
		spot.y = world.ground_y(spot.x, spot.z)
		if world.has_line_of_sight(spot + Vector3(0, 1.2, 0), enemy_position + Vector3(0, 1.0, 0)):
			continue
		return spot
	var fallback := anchor + away.normalized() * 8.0
	fallback.y = world.ground_y(fallback.x, fallback.z)
	return fallback

func _engagement_style(distance: float, allies: int) -> String:
	var aggression := float(personality.get("aggression", 0.6))
	var caution := float(personality.get("caution", 0.5))
	var health_ratio := brain.health / maxf(1.0, GameConfig.PLAYER["max_health"])
	var numbers := allies - _count_visible_enemies() + 1
	if distance < float(settings.get("engage_min", 6.0)) * 0.8 and (health_ratio < 0.5 or caution > 0.7):
		return "back_off"
	if numbers > 0 and aggression > 0.45 and health_ratio > 0.35:
		return "push"
	if _state_timer > 3.0 and float(settings.get("build", 0.0)) > 0.2:
		return "hold"
	return "hold"

func _count_visible_allies() -> int:
	var count := 0
	var tree := get_tree()
	if tree == null:
		return 0
	for node: Node in tree.get_nodes_in_group("damageable"):
		var ally := node as PlayerController
		if ally == null or ally == brain or not ally.alive or ally.team != brain.team:
			continue
		if brain.global_position.distance_to(ally.global_position) < 25.0:
			count += 1
	return count

func _count_visible_enemies() -> int:
	var count := 0
	var tree := get_tree()
	if tree == null:
		return 0
	for node: Node in tree.get_nodes_in_group("damageable"):
		var enemy := node as PlayerController
		if enemy == null or not enemy.alive or enemy == brain:
			continue
		if not brain.is_hostile(enemy):
			continue
		if brain.global_position.distance_to(enemy.global_position) < 30.0:
			count += 1
	return count

func _track_stuck(delta: float) -> void:
	var moved := brain.global_position.distance_to(_last_position)
	if moved < 0.05:
		_stuck_timer += delta
	else:
		_stuck_timer = 0.0
		_last_position = brain.global_position
	if _stuck_timer > 1.2:
		_stuck_timer = 0.0
		brain.jump_queued = true
		has_goal = false
		nav_goal = brain.global_position + Vector3(_rng.randf_range(-10.0, 10.0), 0.0,
			_rng.randf_range(-10.0, 10.0))
		has_goal = true

static func _lerp_angle(from: float, to: float, weight: float) -> float:
	var difference := wrapf(to - from, -PI, PI)
	return from + difference * clampf(weight, 0.0, 1.0)

## Debug/testing helper: current high-level state name.
func state_name() -> String:
	return State.keys()[state]

func difficulty_settings() -> Dictionary:
	return settings
