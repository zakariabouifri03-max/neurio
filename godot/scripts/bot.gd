extends CharacterBody3D
## Simple offline opponent. Bots use the same damage/health contract as the player,
## making it straightforward to replace this brain with server-authoritative replication.

var main
var bot_index := 0
var health := 100.0
var armor := 15.0
var is_dead := false
var think_timer := 0.0
var shot_timer := 0.0
var wander_angle := 0.0
var velocity_target := Vector3.ZERO
var avatar: Node3D
var left_leg: Node3D
var right_leg: Node3D
var anim_time := 0.0
var nameplate: Label3D

func setup(main_ref: Node, index: int, spawn_position: Vector3) -> void:
	main = main_ref
	bot_index = index
	global_position = spawn_position
	wander_angle = float(index) * 1.71

func _ready() -> void:
	collision_layer = 2
	collision_mask = 1
	var collision := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.44
	capsule.height = 1.8
	collision.shape = capsule
	collision.position.y = 0.98
	add_child(collision)
	_build_body()

func _build_body() -> void:
	avatar = Node3D.new()
	avatar.name = "BotAvatar"
	add_child(avatar)
	var colors := [Color("#ff8066"), Color("#8e7dff"), Color("#f4b942"), Color("#e75b9b"), Color("#55b6a4"), Color("#d4e157"), Color("#ef8354"), Color("#76c893")]
	var accent: Color = colors[bot_index % colors.size()]
	BlockFactory.cube(avatar, Vector3(0, 1.12, 0), Vector3(0.9, 1.08, 0.58), accent, false, "BotTorso")
	BlockFactory.cube(avatar, Vector3(0, 2.0, 0), Vector3(0.7, 0.7, 0.7), Color("#d9a47f"), false, "BotHead")
	BlockFactory.cube(avatar, Vector3(0, 2.39, 0), Vector3(0.83, 0.18, 0.83), Color("#28354e"), false, "BotHelmet")
	BlockFactory.cube(avatar, Vector3(0.36, 1.42, 0), Vector3(0.17, 0.7, 0.18), Color("#d9a47f"), false, "BotArmR")
	BlockFactory.cube(avatar, Vector3(-0.36, 1.42, 0), Vector3(0.17, 0.7, 0.18), Color("#d9a47f"), false, "BotArmL")
	left_leg = BlockFactory.cube(avatar, Vector3(-0.21, 0.34, 0), Vector3(0.27, 0.7, 0.3), Color("#26364e"), false, "BotLegL")
	right_leg = BlockFactory.cube(avatar, Vector3(0.21, 0.34, 0), Vector3(0.27, 0.7, 0.3), Color("#26364e"), false, "BotLegR")
	nameplate = BlockFactory.label_billboard(self, Vector3(0, 3.15, 0), "BOT %02d" % (bot_index + 1), Color("#ffd0ca"))

func _physics_process(delta: float) -> void:
	if is_dead or not is_instance_valid(main) or main.match_paused or not is_instance_valid(main.player):
		return
	think_timer -= delta
	shot_timer = maxf(shot_timer - delta, 0.0)
	if think_timer <= 0.0:
		think_timer = 0.25 + float(bot_index % 3) * 0.1
		_choose_target()
	if velocity_target.length() > 0.05:
		velocity.x = move_toward(velocity.x, velocity_target.x * (3.0 + bot_index % 3), delta * 12.0)
		velocity.z = move_toward(velocity.z, velocity_target.z * (3.0 + bot_index % 3), delta * 12.0)
		rotation.y = lerp_angle(rotation.y, atan2(-velocity_target.x, -velocity_target.z), delta * 7.0)
		anim_time += delta * 8.0
	else:
		velocity.x = move_toward(velocity.x, 0.0, delta * 12.0)
		velocity.z = move_toward(velocity.z, 0.0, delta * 12.0)
	if is_on_floor():
		velocity.y = 0.0
	else:
		velocity.y -= 18.0 * delta
	move_and_slide()
	_update_animation()

func _choose_target() -> void:
	var target: CharacterBody3D = main.player
	var to_player := target.global_position - global_position
	to_player.y = 0.0
	var distance := to_player.length()
	if distance < 34.0:
		velocity_target = to_player.normalized() if distance > 7.5 else Vector3.ZERO
		if distance < 29.0 and shot_timer <= 0.0:
			_shoot_at(target)
	else:
		wander_angle += 0.6
		velocity_target = Vector3(cos(wander_angle), 0.0, sin(wander_angle)).normalized() * 0.45

func _shoot_at(target: Node3D) -> void:
	shot_timer = 1.05 + float(bot_index % 4) * 0.12
	var origin := global_position + Vector3.UP * 1.5
	var aim := target.global_position + Vector3.UP * 1.0
	var direction := (aim - origin).normalized()
	var query := PhysicsRayQueryParameters3D.create(origin, origin + direction * 42.0, 1 | 2 | 4 | 8)
	query.exclude = [self]
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	if not hit.is_empty() and hit.collider == target:
		target.receive_damage(7.0 + float(bot_index % 3) * 1.5, self)
		if main.has_method("spawn_tracer"):
			main.spawn_tracer(origin, hit.position, Color("#ff8066"))

func _update_animation() -> void:
	if not is_instance_valid(left_leg):
		return
	if Vector2(velocity.x, velocity.z).length() > 0.7:
		left_leg.rotation.x = sin(anim_time) * 0.24
		right_leg.rotation.x = -sin(anim_time) * 0.24

func receive_damage(amount: float, _attacker: Node = null) -> void:
	if is_dead:
		return
	var absorbed := minf(armor, amount * 0.3)
	armor -= absorbed
	health -= amount - absorbed
	if main.has_method("bot_health_changed"):
		main.bot_health_changed(self, health)
	if health <= 0.0:
		die()

func die() -> void:
	if is_dead:
		return
	is_dead = true
	collision_layer = 0
	velocity = Vector3.ZERO
	avatar.modulate = Color("#576071")
	if is_instance_valid(nameplate):
		nameplate.text = "ELIMINATED"
		nameplate.modulate = Color("#9ba6b4")
	if is_instance_valid(main) and main.has_method("bot_eliminated"):
		main.bot_eliminated(self)
