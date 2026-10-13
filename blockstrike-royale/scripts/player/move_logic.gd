class_name MoveLogic
extends RefCounted
## The single implementation of character movement.
##
## Local players, remote players predicting their own motion, and bots all call
## `MoveLogic.apply`, so movement rules (speeds, acceleration, gravity, water,
## stair stepping) can never diverge between them - which is what makes client
## prediction and server validation agree.

const P := GameConfig.PLAYER

static func apply(body: CharacterBody3D, delta: float, input: Vector2, sprint: bool,
				  crouch: bool, jump_pressed: bool, on_floor: bool,
				  world: VoxelWorld) -> void:
	var wish_direction := _wish_direction(body, input)
	var in_water := world != null and world.is_water_at(body.global_position)
	var speed := _target_speed(sprint, crouch, in_water)
	var velocity := body.velocity
	var horizontal := Vector3(velocity.x, 0.0, velocity.z)
	var target := wish_direction * speed
	var rate := float(P["acceleration"]) if on_floor else float(P["air_acceleration"])
	if wish_direction.length_squared() < 0.01:
		rate = float(P["deceleration"]) if on_floor else float(P["air_acceleration"]) * 0.5
	horizontal = horizontal.lerp(target, clampf(rate * delta / maxf(0.1, speed), 0.0, 1.0))
	# Stop small residual drift so the character does not slide on release.
	if wish_direction.length_squared() < 0.01 and horizontal.length() < 0.15:
		horizontal = Vector3.ZERO
	velocity.x = horizontal.x
	velocity.z = horizontal.z
	if in_water:
		velocity.y = lerpf(velocity.y, 0.6, clampf(delta * float(GameConfig.WORLD["water_drag"]), 0.0, 1.0))
		if jump_pressed:
			velocity.y = 3.4
	else:
		velocity.y -= float(P["gravity"]) * delta
		velocity.y = maxf(velocity.y, -float(P["max_fall_speed"]))
		if jump_pressed and on_floor:
			velocity.y = float(P["jump_velocity"])
	body.velocity = velocity
	body.move_and_slide()
	_apply_step_assist(body, on_floor)

## Camera-relative input direction.
static func _wish_direction(body: CharacterBody3D, input: Vector2) -> Vector3:
	if input.length_squared() < 0.0001:
		return Vector3.ZERO
	var basis := body.global_transform.basis
	var forward := Vector3(basis.z.x, 0.0, basis.z.z).normalized()
	var right := Vector3(basis.x.x, 0.0, basis.x.z).normalized()
	var direction := (right * input.x - forward * input.y)
	if direction.length_squared() > 1.0:
		direction = direction.normalized()
	return direction

static func _target_speed(sprint: bool, crouch: bool, in_water: bool) -> float:
	var speed := float(P["walk_speed"])
	if crouch:
		speed = float(P["crouch_speed"])
	elif sprint:
		speed = float(P["sprint_speed"])
	if in_water:
		speed *= 0.6
	return speed

## Small ledge assist: when the body is blocked by a single-block step while
## moving into it, nudge it upward instead of stalling (stairs feel smooth).
static func _apply_step_assist(body: CharacterBody3D, on_floor: bool) -> void:
	if not on_floor:
		return
	for i: int in body.get_slide_collision_count():
		var collision := body.get_slide_collision(i)
		var normal := collision.get_normal()
		if normal.y > 0.7 or normal.y < 0.2:
			continue
		var horizontal_normal := Vector3(normal.x, 0.0, normal.z)
		if horizontal_normal.length_squared() < 0.01:
			continue
		if body.velocity.length() < 0.5:
			continue
		var wanted := -horizontal_normal.normalized()
		if wanted.dot(Vector3(body.velocity.x, 0.0, body.velocity.z).normalized()) < 0.5:
			continue
		var low_ray := PhysicsRayQueryParameters3D.create(
			body.global_position + wanted * 0.4 + Vector3(0, float(P["step_height"]) * 0.5, 0),
			body.global_position + wanted * 0.7 - Vector3(0, float(P["step_height"]) * 0.5, 0))
		var space := body.get_world_3d().direct_space_state
		var hit := space.intersect_ray(low_ray)
		if not hit.is_empty():
			continue
		body.global_position.y += 0.22
		return
