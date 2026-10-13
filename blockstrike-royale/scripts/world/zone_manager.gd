class_name ZoneManager
extends Node3D
## Battle Royale safe zone: shrinking circle, tick damage, warnings and a minimap shape.
##
## The zone is defined in map coordinates with a deterministic phase table; it is
## deterministic for a given seed so a server and its clients agree, and each
## client can display the next circle on the map without further traffic.

signal phase_changed(phase: int, total_phases: int)
signal warning(warning_kind: String, seconds: float)
signal zone_damage_tick(player: PlayerController, damage: float)
signal zone_finished()
signal circle_updated(center: Vector2, radius: float, next_center: Vector2, next_radius: float)

const PHASES: Array = [
	{"wait": 40.0, "shrink": 35.0, "radius_mult": 0.62, "dps": 1.0},
	{"wait": 32.0, "shrink": 30.0, "radius_mult": 0.60, "dps": 2.0},
	{"wait": 26.0, "shrink": 26.0, "radius_mult": 0.58, "dps": 4.0},
	{"wait": 20.0, "shrink": 22.0, "radius_mult": 0.55, "dps": 7.0},
	{"wait": 16.0, "shrink": 18.0, "radius_mult": 0.50, "dps": 10.0},
	{"wait": 12.0, "shrink": 14.0, "radius_mult": 0.35, "dps": 14.0},
	{"wait": 10.0, "shrink": 0.0, "radius_mult": 0.0, "dps": 20.0},
]

var center: Vector2 = Vector2.ZERO
var radius: float = 120.0
var target_center: Vector2 = Vector2.ZERO
var target_radius: float = 120.0
var phase: int = 0
var phase_time: float = 0.0
var running: bool = false
var finished: bool = false
var damage_multiplier: float = 1.0

var _shrink_start_center: Vector2 = Vector2.ZERO
var _shrink_start_radius: float = 0.0
var _shrink_elapsed: float = 0.0
var _tick_accumulator: Dictionary = {}   ## player_id -> accumulated damage
var _warned: Array = []
## Playable area in the X/Z plane (maps are generated from (0,0) to (size_x, size_z)).
var bounds: Rect2 = Rect2(0.0, 0.0, 320.0, 320.0)

## Starts the zone.  `map_center` and `initial_radius` come from the map data.
func start(map_center: Vector2, initial_radius: float, seed_value: int = 0,
		   phases_enabled: bool = true) -> void:
	center = map_center
	radius = initial_radius
	phase = 0
	phase_time = 0.0
	running = phases_enabled
	finished = false
	_warned.clear()
	_tick_accumulator.clear()
	_plan_next_circle(seed_value)
	circle_updated.emit(center, radius, target_center, target_radius)
	set_process(phases_enabled)

## Sets the playable rectangle the zone must stay inside (map coordinates).
func set_bounds(rect: Rect2) -> void:
	bounds = rect

func stop() -> void:
	running = false
	set_process(false)

func _process(delta: float) -> void:
	if not running or finished:
		return
	var index := mini(phase, PHASES.size() - 1)
	var entry: Dictionary = PHASES[index]
	phase_time += delta
	var wait_time := float(entry.get("wait", 30.0))
	var shrink_time := float(entry.get("shrink", 20.0))
	if phase_time <= wait_time:
		_emit_warnings(wait_time - phase_time)
	elif shrink_time > 0.0:
		var t := clampf((phase_time - wait_time) / shrink_time, 0.0, 1.0)
		center = _shrink_start_center.lerp(target_center, t)
		radius = lerpf(_shrink_start_radius, target_radius, t)
		_warned.clear()
		circle_updated.emit(center, radius, target_center, target_radius)
		if t >= 1.0:
			_advance_phase()
	elif phase_time > wait_time:
		# A phase with a zero shrink time (the final one) holds its circle and
		# then hands over to the next phase as soon as the wait elapses.
		_advance_phase()
	_apply_damage(delta, float(entry.get("dps", 1.0)))

func _advance_phase() -> void:
	phase += 1
	phase_time = 0.0
	_warned.clear()
	phase_changed.emit(phase, PHASES.size())
	if phase >= PHASES.size():
		radius = 0.0
		finished = true
		running = false
		zone_finished.emit()
		return
	_plan_next_circle(0)
	AudioDirector.play_ui("zone_warning", -4.0)

func _plan_next_circle(seed_value: int) -> void:
	var entry: Dictionary = PHASES[mini(phase, PHASES.size() - 1)]
	_shrink_start_center = center
	_shrink_start_radius = radius
	_shrink_elapsed = 0.0
	var next_radius := radius * float(entry.get("radius_mult", 0.7))
	if next_radius < 8.0:
		next_radius = 8.0
	target_radius = next_radius
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value if seed_value != 0 else int(Time.get_ticks_usec())
	# The new circle always fits inside the old one and stays on the map.
	var max_offset := maxf(0.0, radius - next_radius) * 0.8
	var angle := rng.randf() * TAU
	var offset := Vector2(cos(angle), sin(angle)) * rng.randf_range(0.0, max_offset)
	var proposed := center + offset
	var inner := bounds.grow(-next_radius)
	proposed.x = clampf(proposed.x, inner.position.x, inner.end.x)
	proposed.y = clampf(proposed.y, inner.position.y, inner.end.y)
	target_center = proposed
	_emit_warnings(float(entry.get("wait", 30.0)))
	circle_updated.emit(center, radius, target_center, target_radius)

func _emit_warnings(seconds_left: float) -> void:
	for mark: int in [30, 10, 5]:
		var key := "%d_%d" % [phase, mark]
		if seconds_left <= float(mark) and not _warned.has(key):
			_warned.append(key)
			warning.emit("zone_closing", float(mark))
			if mark <= 5:
				AudioDirector.play_ui("zone_warning", -2.0)
			return

## Damage per second inside the zone, scaled by how deep the player is.
func damage_rate_for(position: Vector3, base_dps: float) -> float:
	var flat := Vector2(position.x, position.z)
	var distance := flat.distance_to(center)
	if distance <= radius:
		return 0.0
	var depth := clampf((distance - radius) / maxf(4.0, radius * 0.25), 0.0, 4.0)
	return base_dps * (1.0 + depth) * damage_multiplier

func _apply_damage(delta: float, base_dps: float) -> void:
	var tree := get_tree()
	if tree == null:
		return
	for node: Node in tree.get_nodes_in_group("damageable"):
		var player := node as PlayerController
		if player == null or not player.alive:
			continue
		var rate := damage_rate_for(player.global_position, base_dps)
		if rate <= 0.0:
			_tick_accumulator.erase(player.player_id)
			continue
		var accumulated := float(_tick_accumulator.get(player.player_id, 0.0)) + rate * delta
		if accumulated >= 1.0:
			var whole := floorf(accumulated)
			accumulated -= whole
			player.apply_damage(whole, "", "zone", Vector3.ZERO)
			zone_damage_tick.emit(player, whole)
		_tick_accumulator[player.player_id] = accumulated

func is_inside(position: Vector3) -> bool:
	return Vector2(position.x, position.z).distance_to(center) <= radius

func inside_next(position: Vector3) -> bool:
	return Vector2(position.x, position.z).distance_to(target_center) <= target_radius

## Normalised 0..1 minimap coordinates for the HUD.
func minimap_state() -> Dictionary:
	return {"center": center, "radius": radius, "next_center": target_center,
			"next_radius": target_radius, "phase": phase, "total": PHASES.size(),
			"time_left": maxf(0.0, _phase_time_left())}

func _phase_time_left() -> float:
	var entry: Dictionary = PHASES[mini(phase, PHASES.size() - 1)]
	return float(entry.get("wait", 30.0)) - phase_time

func time_until_shrink() -> float:
	return maxf(0.0, _phase_time_left())

func total_phases() -> int:
	return PHASES.size()

func current_dps() -> float:
	return float((PHASES[mini(phase, PHASES.size() - 1)] as Dictionary).get("dps", 1.0))

## Deterministic snapshot for networking / HUD.
func snapshot() -> Dictionary:
	return {"center": [center.x, center.y], "radius": radius, "phase": phase,
			"phase_time": phase_time, "target_center": [target_center.x, target_center.y],
			"target_radius": target_radius, "running": running}

func apply_snapshot(data: Dictionary) -> void:
	var c: Array = data.get("center", [center.x, center.y])
	var tc: Array = data.get("target_center", [target_center.x, target_center.y])
	center = Vector2(float(c[0]), float(c[1]))
	target_center = Vector2(float(tc[0]), float(tc[1]))
	radius = float(data.get("radius", radius))
	target_radius = float(data.get("target_radius", target_radius))
	phase = int(data.get("phase", phase))
	phase_time = float(data.get("phase_time", phase_time))
	running = bool(data.get("running", running))
	circle_updated.emit(center, radius, target_center, target_radius)
