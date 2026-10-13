extends "res://scripts/characters/character_base.gd"
## AI opponent / teammate. Roams the map, loots, reacts to visible enemies with a
## reaction delay and inaccuracy, retreats into the safe zone and heals when hurt.

const NAMES := ["Viper", "Rook", "Nova", "Blaze", "Cobalt", "Ember", "Frost", "Kestrel",
	"Mako", "Onyx", "Pike", "Quill", "Raven", "Sable", "Tundra", "Wisp", "Echo", "Jinx"]

var difficulty: float = 0.8
var target = null
var _rng := RandomNumberGenerator.new()
var _waypoint: Vector3 = Vector3.INF
var _retarget_t: float = 0.0
var _seen_t: float = 0.0
var _stuck_t: float = 0.0
var _last_pos: Vector3 = Vector3.ZERO
var _stuck_clock: float = 0.0
var _loot_goal: Vector3 = Vector3.INF
var _loot_kind: String = ""
var _strafe_sign: float = 1.0
var _strafe_t: float = 0.0
var _heal_cd: float = 0.0
var _fire_delay: float = 0.0


func _ready() -> void:
	_rng.randomize()
	super._ready()
	add_to_group("bots")
	_last_pos = global_position


func configure_model(m) -> void:
	var hue: float = fposmod(float(team) * 0.137, 1.0)
	m.outfit_color = Color.from_hsv(hue, 0.55, 0.75)
	m.helmet_color = Color.from_hsv(hue, 0.3, 0.35)
	m.backpack_color = Color(0.3, 0.22, 0.14)
	m.weapon_tint = Color(0, 0, 0, 0)
	m.name_text = display_name
	m.show_name = true


func _physics_process(delta: float) -> void:
	if alive and arena and arena.is_live():
		_think(delta)
	else:
		wish_dir = Vector3.ZERO
		is_aiming = false
	super._physics_process(delta)


func _think(delta: float) -> void:
	_retarget_t -= delta
	_heal_cd -= delta
	if _retarget_t <= 0.0:
		_retarget_t = 0.35
		target = _pick_target()
	var outside: bool = arena.is_outside_zone(global_position)
	is_sprinting = false
	is_crouched = false

	var has_gun: bool = inv.current() != null and weapon_def().get("kind", "") != "melee"
	if target != null and is_instance_valid(target) and target.alive:
		_seen_t += delta
		var eye: Vector3 = global_position + Vector3(0, 1.5, 0)
		var te: Vector3 = target.global_position + Vector3(0, 1.3, 0)
		var to_t: Vector3 = te - eye
		var dist: float = to_t.length()
		var face: float = atan2(-to_t.x, -to_t.z)
		rotation.y = lerp_angle(rotation.y, face, minf(1.0, delta * 9.0))
		var fwd := Vector3(-sin(face), 0, -cos(face))
		var side := Vector3(-fwd.z, 0, fwd.x)
		_strafe_t -= delta
		if _strafe_t <= 0.0:
			_strafe_t = _rng.randf_range(0.6, 1.4)
			_strafe_sign = -_strafe_sign if _rng.randf() < 0.7 else _strafe_sign
		var approach: float = clampf((dist - 14.0) / 10.0, -1.0, 1.0)
		wish_dir = side * _strafe_sign * 0.7 + fwd * approach * 0.5
		if wish_dir.length() > 1.0:
			wish_dir = wish_dir.normalized()
		is_aiming = dist > 10.0 and has_gun
		if _seen_t > 0.35 + (1.0 - difficulty) * 0.6:
			_fire_delay -= delta
			var err: float = (1.1 - difficulty) * (0.4 + dist * 0.03)
			var aim_at: Vector3 = te + Vector3(_rng.randf_range(-err, err), _rng.randf_range(-err * 0.6, err * 0.6), _rng.randf_range(-err, err))
			if has_gun and _fire_delay <= 0.0:
				if inv.current() != null and int(inv.current()["mag"]) <= 0 and reload_t <= 0.0:
					start_reload()
				elif dist < float(weapon_def().get("range", 60.0)) * 0.9:
					try_fire(aim_at)
					_fire_delay = 0.05 if bool(weapon_def().get("auto", false)) else 0.4
			elif not has_gun:
				if dist < 2.0:
					try_fire(aim_at)
	else:
		_seen_t = 0.0
		is_aiming = false
		var goal: Vector3 = _choose_goal(outside, has_gun)
		if goal != Vector3.INF:
			var d: Vector3 = goal - global_position
			d.y = 0.0
			if d.length() > 1.2:
				wish_dir = d.normalized()
				rotation.y = lerp_angle(rotation.y, atan2(-d.x, -d.z), minf(1.0, delta * 6.0))
			else:
				wish_dir = Vector3.ZERO
				_on_reached_goal()
		else:
			wish_dir = Vector3.ZERO

	_stuck_detect(delta)
	if hp < 45.0 and _heal_cd <= 0.0 and not target:
		_heal_cd = 2.0
		use_heal()
	if has_gun and inv.current() != null and int(inv.current()["mag"]) == 0 and reload_t <= 0.0 and target == null:
		start_reload()


func _choose_goal(outside: bool, has_gun: bool) -> Vector3:
	if outside:
		return arena.zone_center_3d()
	if not has_gun or hp < 60.0:
		var loot: Dictionary = arena.nearest_loot_for(global_position, has_gun, 30.0) if arena.has_method("nearest_loot_for") else {}
		if not loot.is_empty():
			_loot_goal = loot["pos"]
			return _loot_goal
		_loot_goal = Vector3.INF
	if _waypoint == Vector3.INF or global_position.distance_to(_waypoint) < 2.0 or _stuck_t > 3.0:
		_waypoint = arena.random_roam_point(global_position)
		_stuck_t = 0.0
	return _waypoint


func _on_reached_goal() -> void:
	if arena and arena.has_method("try_pickup"):
		arena.try_pickup(self)


## Every second, if we tried to move but moved less than 0.6 m, we are stuck:
## jump, pick a new roam point and mark the current loot goal as unreachable.
func _stuck_detect(delta: float) -> void:
	if wish_dir.length() < 0.1:
		_stuck_clock = 0.0
		_last_pos = global_position
		return
	_stuck_clock += delta
	if _stuck_clock < 1.0:
		return
	_stuck_clock = 0.0
	var moved: float = global_position.distance_to(_last_pos)
	_last_pos = global_position
	if moved < 0.6:
		if is_on_floor():
			request_jump()
		_waypoint = Vector3.INF
		if _loot_goal != Vector3.INF and arena and arena.has_method("mark_unreachable"):
			arena.mark_unreachable(_loot_goal)
			_loot_goal = Vector3.INF


func _pick_target():
	if arena == null:
		return null
	var best = null
	var best_d: float = 1e9
	for c in arena.characters_list():
		if c == self or not is_instance_valid(c) or not c.alive or c.team == team:
			continue
		var d: float = global_position.distance_to(c.global_position)
		if d > 70.0:
			continue
		if not _has_line_of_sight(c):
			continue
		if d < best_d:
			best_d = d
			best = c
	return best


func _has_line_of_sight(c) -> bool:
	if world == null:
		return false
	var a: Vector3 = global_position + Vector3(0, 1.5, 0)
	var b: Vector3 = c.global_position + Vector3(0, 1.3, 0)
	var hit: Dictionary = world.raycast(a, b, 1, [self])
	return hit.is_empty()
