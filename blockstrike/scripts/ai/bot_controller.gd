class_name BotController
extends RefCounted
## Simple state-machine AI that drives a PlayerController through its PlayerInput.
##
## States:
##   PATROL  – walk between map waypoints, avoid ledges and stuck situations.
##   ENGAGE  – once an enemy is visible: wait out a reaction delay, track the target
##             with limited turn speed, fire when roughly aligned, strafe.
##   SEARCH  – briefly walk to where the target was last seen.
##
## Accuracy is modelled with per-target aim noise and extra spread. Bots only treat
## actors on another team as valid targets and never see through world geometry.

enum Mode { PATROL, ENGAGE, SEARCH }

const CONFIG_PATH := "res://data/bots.json"
const CHEST_OFFSET := Vector3(0, 1.1, 0)
const SEARCH_DURATION := 4.0

static var _configs: Dictionary = {}

var body: PlayerController
var difficulty := "normal"
var mode: int = Mode.PATROL
var target: PlayerController = null
## Set by the match: candidate patrol points and the list of all characters.
var waypoints: Array = []
var targets: Array = []

var _config: Dictionary = {}
var _rng := RandomNumberGenerator.new()
var _waypoint := Vector3.ZERO
var _has_waypoint := false
var _reaction_left := 0.0
var _last_seen := Vector3.ZERO
var _search_left := 0.0
var _strafe_dir := 1.0
var _strafe_timer := 0.0
var _noise := Vector2.ZERO
var _noise_timer := 0.0
var _scan_timer := 0.0
var _stuck_check_pos := Vector3.ZERO
var _stuck_check_time := 0.0
var _stuck_timer := 0.0
var _hop_cooldown := 0.0


func _init(actor: PlayerController, difficulty_id: String, rng_seed: int = 0) -> void:
	body = actor
	difficulty = difficulty_id
	_config = _load_config(difficulty_id)
	_rng.seed = rng_seed if rng_seed != 0 else int(Time.get_ticks_usec()) & 0x7fffffff


static func _load_config(id: String) -> Dictionary:
	if _configs.is_empty():
		var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(CONFIG_PATH))
		if typeof(parsed) == TYPE_DICTIONARY and parsed.has("difficulties"):
			_configs = parsed["difficulties"]
	var cfg: Dictionary = _configs.get(id, _configs.get("normal", {}))
	return cfg


func cfg_float(key: String, fallback: float) -> float:
	return float(_config.get(key, fallback))


func reset() -> void:
	mode = Mode.PATROL
	target = null
	_has_waypoint = false
	_reaction_left = 0.0
	_stuck_timer = 0.0
	body.extra_spread_deg = 0.0


func think(delta: float) -> void:
	if body == null or not body.alive:
		body.input.reset()
		target = null
		mode = Mode.PATROL
		return
	_scan_timer -= delta
	if _scan_timer <= 0.0:
		_scan_timer = 0.25
		_find_target()
	if target != null and not target.alive:
		target = null
		mode = Mode.PATROL
	if target != null:
		_engage(delta)
	elif mode == Mode.SEARCH:
		_search(delta)
	else:
		_patrol(delta)


func _find_target() -> void:
	var eye := body.get_aim_origin()
	var vision := cfg_float("vision_range", 50.0)
	var best: PlayerController = null
	var best_d := INF
	for t in targets:
		var other := t as PlayerController
		if other == null or other == body or not other.alive or other.team == body.team:
			continue
		var d := eye.distance_to(other.global_position)
		if d > vision or d >= best_d:
			continue
		if not ShotResolver.line_of_sight(body.get_world_3d(), eye, other.global_position + CHEST_OFFSET, []):
			continue
		best = other
		best_d = d
	if best != null:
		if target == null:
			_reaction_left = cfg_float("reaction_time", 0.6)
		target = best
		_last_seen = best.global_position
		mode = Mode.ENGAGE
	elif target != null:
		_last_seen = target.global_position
		target = null
		mode = Mode.SEARCH
		_search_left = SEARCH_DURATION


func _engage(delta: float) -> void:
	var eye := body.get_aim_origin()
	var aim_point := target.global_position + CHEST_OFFSET
	var to := aim_point - eye
	var dist := to.length()
	_last_seen = target.global_position

	_noise_timer -= delta
	if _noise_timer <= 0.0:
		_noise_timer = 0.5
		var accuracy := cfg_float("accuracy", 0.6)
		var error_deg := (1.0 - accuracy) * 6.0
		_noise = Vector2(_rng.randf_range(-error_deg, error_deg), _rng.randf_range(-error_deg, error_deg))

	var desired_yaw := atan2(-to.x, -to.z) + deg_to_rad(_noise.x)
	var horizontal := Vector2(to.x, to.z).length()
	var desired_pitch := atan2(to.y, horizontal) + deg_to_rad(_noise.y)
	var max_step := deg_to_rad(cfg_float("aim_speed_deg", 170.0)) * delta
	body.look_yaw += clampf(angle_difference(body.look_yaw, desired_yaw), -max_step, max_step)
	body.look_pitch = move_toward(body.look_pitch, desired_pitch, max_step)

	var yaw_err := absf(angle_difference(body.look_yaw, desired_yaw))
	var pitch_err := absf(body.look_pitch - desired_pitch)
	var aligned := yaw_err < deg_to_rad(6.0) and pitch_err < deg_to_rad(5.0)
	_reaction_left -= delta
	var in_range := body.weapon != null and body.weapon.data != null and dist <= body.weapon.data.max_range * 0.85
	body.input.fire_held = aligned and _reaction_left <= 0.0 and in_range
	body.extra_spread_deg = (1.0 - cfg_float("accuracy", 0.6)) * 2.5
	body.input.aim_held = dist < 30.0
	body.input.crouch_held = false

	_strafe_timer -= delta
	if _strafe_timer <= 0.0:
		_strafe_timer = _rng.randf_range(0.6, 1.6)
		if _rng.randf() < cfg_float("strafe_chance", 0.4):
			_strafe_dir = -_strafe_dir
	var forward := 0.0
	if dist > 22.0:
		forward = 1.0
	elif dist < 9.0:
		forward = -0.8
	var side := _strafe_dir * (0.9 if _strafe_timer > 0.3 else 0.0)
	body.input.move = Vector2(side, forward).limit_length(1.0)
	body.input.sprint_held = false


func _search(delta: float) -> void:
	body.input.fire_held = false
	body.input.aim_held = false
	body.extra_spread_deg = 0.0
	_search_left -= delta
	if _search_left <= 0.0:
		mode = Mode.PATROL
		return
	var to := _last_seen - body.global_position
	to.y = 0.0
	if to.length() < 1.5:
		body.input.move = Vector2.ZERO
		return
	_steer_toward(to.normalized(), delta, 1.0)


func _patrol(delta: float) -> void:
	body.input.fire_held = false
	body.input.aim_held = false
	body.extra_spread_deg = 0.0
	body.input.sprint_held = false
	if not _has_waypoint or body.global_position.distance_to(_waypoint) < 2.0 or _stuck_timer > 0.0:
		_pick_waypoint()
	var to := _waypoint - body.global_position
	to.y = 0.0
	if to.length() < 0.2:
		body.input.move = Vector2.ZERO
		return
	_steer_toward(to.normalized(), delta, 0.75)
	_update_stuck(delta)


func _steer_toward(dir: Vector3, delta: float, speed_scale: float) -> void:
	var desired_yaw := atan2(-dir.x, -dir.z)
	var turn := deg_to_rad(240.0) * delta
	body.look_yaw += clampf(angle_difference(body.look_yaw, desired_yaw), -turn, turn)
	var forward := Vector3(-sin(body.look_yaw), 0.0, -cos(body.look_yaw))
	var right := Vector3(cos(body.look_yaw), 0.0, -sin(body.look_yaw))
	var local := Vector2(dir.dot(right), dir.dot(forward)) * speed_scale
	body.input.move = local.limit_length(1.0)
	# Hop small obstacles that the step-up cannot clear (e.g. crate corners).
	_hop_cooldown = maxf(_hop_cooldown - delta, 0.0)
	if _hop_cooldown <= 0.0 and body.is_on_floor() and _wall_ahead(dir):
		body.input.request_jump()
		_hop_cooldown = 0.9


func _wall_ahead(dir: Vector3) -> bool:
	var origin := body.global_position + Vector3(0, 0.45, 0)
	var to := origin + dir * 0.9
	return not ShotResolver.line_of_sight(body.get_world_3d(), origin, to, [body])


func _pick_waypoint() -> void:
	_stuck_timer = 0.0
	_has_waypoint = false
	if waypoints.is_empty():
		return
	var candidates: Array = []
	for p in waypoints:
		if (p as Vector3).distance_to(body.global_position) > 18.0:
			candidates.append(p)
	if candidates.is_empty():
		candidates = waypoints
	_waypoint = candidates[_rng.randi_range(0, candidates.size() - 1)]
	_has_waypoint = true


func _update_stuck(delta: float) -> void:
	_stuck_check_time += delta
	if _stuck_check_time < 1.2:
		return
	if body.global_position.distance_to(_stuck_check_pos) < 0.5:
		_stuck_timer = 1.0
	_stuck_check_pos = body.global_position
	_stuck_check_time = 0.0
