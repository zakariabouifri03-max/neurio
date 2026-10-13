extends Node
## Battle Royale circle controller. The visual ring is owned by VoxelWorld; this node keeps
## timing and damage rules independent so Clash Squad can opt out later.

signal zone_changed(radius: float, remaining: float)
signal zone_finished

var radius := 68.0
var start_radius := 68.0
var final_radius := 13.0
var grace_period := 25.0
var shrink_duration := 185.0
var elapsed := 0.0
var active := false
var damage_tick := 0.0

func start() -> void:
	elapsed = 0.0
	radius = start_radius
	active = true
	damage_tick = 0.0

func _process(delta: float) -> void:
	if not active:
		return
	elapsed += delta
	if elapsed > grace_period:
		var amount := clampf((elapsed - grace_period) / shrink_duration, 0.0, 1.0)
		radius = lerpf(start_radius, final_radius, amount)
		zone_changed.emit(radius, maxf(0.0, shrink_duration - (elapsed - grace_period)))
		if amount >= 1.0:
			zone_finished.emit()

func is_outside(point: Vector3) -> bool:
	return Vector2(point.x, point.z).length() > radius

func tick_damage(delta: float) -> bool:
	if not active:
		return false
	damage_tick -= delta
	if damage_tick <= 0.0:
		damage_tick = 1.0
		return true
	return false
