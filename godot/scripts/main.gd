extends Node3D
## BlockStrike Royale runtime coordinator.
## The prototype intentionally keeps all offline simulation local and visible. Online combat is
## not advertised as live until a dedicated authoritative service is deployed and tested.

const WorldScript = preload("res://scripts/voxel_world.gd")
const PlayerScene = preload("res://scenes/player.tscn")
const BotScene = preload("res://scenes/bot.tscn")
const SafeZoneScript = preload("res://scripts/safe_zone.gd")
const HUDScript = preload("res://scripts/hud.gd")

var world
var player
var bots: Array = []
var safe_zone
var hud
var current_mode := "battle_royale"
var match_active := false
var match_paused := false
var match_elapsed := 0.0
var match_duration := 240.0
var elimination_count := 0
var outside_warning_timer := 0.0
var hud_update_timer := 0.0
var world_environment: WorldEnvironment
var sun: DirectionalLight3D
var spawn_points := [
	Vector3(-42, 2, 30), Vector3(-25, 2, 48), Vector3(28, 2, 35), Vector3(52, 2, 24),
	Vector3(-42, 2, -2), Vector3(30, 2, -4), Vector3(-35, 2, -36), Vector3(31, 2, -39)
]

func _ready() -> void:
	_setup_rendering()
	world = WorldScript.new()
	world.name = "VoxelWorld"
	add_child(world)
	world.build(2407)
	safe_zone = SafeZoneScript.new()
	safe_zone.name = "BattleRoyaleSafeZone"
	add_child(safe_zone)
	safe_zone.zone_changed.connect(_on_zone_changed)
	hud = HUDScript.new()
	hud.name = "MobileHUD"
	hud.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(hud)
	hud.setup(self)
	apply_quality(str(GameState.profile.settings.quality))
	# The menu opens first; players can drop into training or Battle Royale immediately.
	show_toast("Choose an operation to deploy", true)

func _setup_rendering() -> void:
	world_environment = WorldEnvironment.new()
	world_environment.name = "WorldEnvironment"
	var environment := Environment.new()
	environment.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sky_material := ProceduralSkyMaterial.new()
	sky_material.sky_top_color = Color("#10264d")
	sky_material.sky_horizon_color = Color("#69b6c4")
	sky_material.ground_bottom_color = Color("#152432")
	sky_material.ground_horizon_color = Color("#8cc8b1")
	sky_material.sun_angle_max = 18.0
	sky_material.sun_curve = 0.08
	sky.sky_material = sky_material
	environment.sky = sky
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	environment.ambient_light_energy = 0.72
	environment.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	environment.tonemap_exposure = 1.15
	environment.glow_enabled = false
	environment.fog_enabled = true
	environment.fog_light_color = Color("#82b4b6")
	environment.fog_density = 0.0022
	world_environment.environment = environment
	add_child(world_environment)
	sun = DirectionalLight3D.new()
	sun.name = "Sun"
	sun.rotation_degrees = Vector3(-52, -34, 0)
	sun.light_color = Color("#fff0c2")
	sun.light_energy = 1.25
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 110.0
	add_child(sun)
	var fill := DirectionalLight3D.new()
	fill.name = "CoolFill"
	fill.rotation_degrees = Vector3(-35, 145, 0)
	fill.light_color = Color("#8fc5ff")
	fill.light_energy = 0.28
	fill.shadow_enabled = false
	add_child(fill)

func apply_quality(quality: String) -> void:
	if not is_instance_valid(sun) or not is_instance_valid(world_environment):
		return
	var viewport := get_viewport()
	if quality == "Low":
		sun.shadow_enabled = false
		sun.directional_shadow_max_distance = 55.0
		world_environment.environment.fog_density = 0.0032
		viewport.scaling_3d_scale = 0.78
	elif quality == "High":
		sun.shadow_enabled = true
		sun.directional_shadow_max_distance = 145.0
		world_environment.environment.fog_density = 0.0018
		viewport.scaling_3d_scale = 1.0
	else:
		sun.shadow_enabled = true
		sun.directional_shadow_max_distance = 100.0
		world_environment.environment.fog_density = 0.0022
		viewport.scaling_3d_scale = 0.88

func start_match(mode_id: String = "battle_royale") -> void:
	_cleanup_match()
	if is_instance_valid(world) and world.has_method("reset_match_objects"):
		world.reset_match_objects()
	current_mode = mode_id
	match_active = true
	match_paused = false
	match_elapsed = 0.0
	elimination_count = 0
	outside_warning_timer = 0.0
	hud_update_timer = 0.0
	match_duration = 300.0 if mode_id == "training" else (210.0 if mode_id == "battle_royale" else 180.0)
	if is_instance_valid(safe_zone):
		safe_zone.start()
		world.update_zone(safe_zone.radius)
	player = PlayerScene.instantiate()
	player.name = "PlayerScout"
	add_child(player)
	player.stats_changed.connect(hud.update_stats)
	player.weapon_changed.connect(hud.update_weapon)
	player.eliminated.connect(player_eliminated)
	player.initialize(self, Vector3(0, 2.2, 37))
	var bot_count := 8
	if mode_id == "arena_2v2":
		bot_count = 3
	elif mode_id == "clash_squad":
		bot_count = 7
	for i in range(bot_count):
		var bot = BotScene.instantiate()
		bot.name = "Bot_%02d" % (i + 1)
		add_child(bot)
		bot.setup(self, i, spawn_points[i % spawn_points.size()])
		bots.append(bot)
	hud.show_match(mode_id)
	hud.update_stats(player.health, player.armor, player.ammo, player.reserve_ammo)
	show_toast("DROP COMPLETE  •  ELIMINATE THE BOTS", true)

func _unhandled_input(event: InputEvent) -> void:
	if match_active and event.is_action_pressed("pause"):
		pause_match()

func _process(delta: float) -> void:
	if not match_active or match_paused:
		return
	match_elapsed += delta
	hud_update_timer -= delta
	outside_warning_timer -= delta
	if is_instance_valid(safe_zone):
		world.update_zone(safe_zone.radius)
		var zone_damage := safe_zone.tick_damage(delta)
		if safe_zone.is_outside(player.global_position):
			if outside_warning_timer <= 0.0:
				show_toast("RETURN TO THE SAFE ZONE", false)
				outside_warning_timer = 3.0
			if zone_damage and is_instance_valid(player) and not player.is_dead:
				player.receive_damage(9.0, self)
			for bot in bots:
				if zone_damage and is_instance_valid(bot) and not bot.is_dead and safe_zone.is_outside(bot.global_position):
					bot.receive_damage(12.0, self)
	if hud_update_timer <= 0.0:
		hud_update_timer = 0.1
		var alive := 1
		var bot_positions: Array = []
		for bot in bots:
			if is_instance_valid(bot) and not bot.is_dead:
				alive += 1
				bot_positions.append(bot.global_position)
		hud.update_match_info(match_duration - match_elapsed, alive, maxf(0.0, safe_zone.shrink_duration - (safe_zone.elapsed - safe_zone.grace_period)))
		hud.update_minimap(player.global_position, bot_positions, safe_zone.radius)
	if match_elapsed >= match_duration:
		finish_match(is_instance_valid(player) and not player.is_dead)
	elif _living_bots() == 0 and is_instance_valid(player) and not player.is_dead:
		finish_match(true)

func _living_bots() -> int:
	var alive := 0
	for bot in bots:
		if is_instance_valid(bot) and not bot.is_dead:
			alive += 1
	return alive

func player_eliminated() -> void:
	if not match_active:
		return
	match_active = false
	if is_instance_valid(safe_zone):
		safe_zone.active = false
	hud.add_feed("YOU WERE ELIMINATED")
	finish_match(false)

func bot_eliminated(bot: Node) -> void:
	elimination_count += 1
	hud.add_feed("BOT %02d ELIMINATED   +%d XP" % [bot.bot_index + 1, 75])
	spawn_hit_effect(bot.global_position + Vector3.UP * 1.2, Color("#ffd166"))
	if _living_bots() == 0 and is_instance_valid(player) and not player.is_dead:
		finish_match(true)

func bot_health_changed(_bot: Node, _health: float) -> void:
	# Hook reserved for a future squad health panel; keeping it here makes the signal boundary explicit.
	pass

func finish_match(won: bool) -> void:
	if not match_active and not won:
		# player_eliminated already stopped simulation, but the result should still show once.
		if is_instance_valid(hud) and not hud.result_panel.visible:
			match_active = false
		else:
			return
	match_active = false
	match_paused = false
	if is_instance_valid(safe_zone):
		safe_zone.active = false
	var reward := GameState.grant_match_rewards(won, elimination_count, current_mode)
	if won:
		AudioManager.play_victory()
	if is_instance_valid(hud):
		hud.show_result(won, elimination_count, match_elapsed)
		hud.show_toast("+%d COINS  +%d XP" % [reward.coins, reward.xp], true)

func pause_match() -> void:
	if not match_active:
		return
	match_paused = not match_paused
	if is_instance_valid(hud) and hud.has_method("set_paused"):
		hud.set_paused(match_paused)
	show_toast("MATCH PAUSED" if match_paused else "RESUMED", false)

func return_to_menu() -> void:
	match_active = false
	match_paused = false
	_cleanup_match()
	if is_instance_valid(hud):
		hud.show_menu()

func _cleanup_match() -> void:
	if is_instance_valid(player):
		player.queue_free()
	player = null
	for bot in bots:
		if is_instance_valid(bot):
			bot.queue_free()
	bots.clear()
	if is_instance_valid(safe_zone):
		safe_zone.active = false
	if is_instance_valid(hud) and is_instance_valid(hud.result_panel):
		hud.result_panel.visible = false

func place_build_block_from_player(position: Vector3) -> void:
	if is_instance_valid(world) and world.add_build_block(position):
		show_toast("COVER PLACED", true)
	else:
		show_toast("BUILD LIMIT OR INVALID POSITION", false)

func show_toast(message: String, good: bool = false) -> void:
	if is_instance_valid(hud):
		hud.show_toast(message, good)

func spawn_muzzle_flash(position: Vector3) -> void:
	var flash := MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = 0.18
	sphere.height = 0.36
	flash.mesh = sphere
	flash.material_override = BlockFactory.material(Color("#ffe6a0"), 0.2, Color("#ff8c42"))
	flash.position = position
	add_child(flash)
	var tween := create_tween()
	tween.tween_property(flash, "scale", Vector3(0.15, 0.15, 0.15), 0.08)
	tween.tween_callback(flash.queue_free)

func spawn_tracer(from: Vector3, to: Vector3, color: Color) -> void:
	var tracer := MeshInstance3D.new()
	var beam := BoxMesh.new()
	var length := maxf(from.distance_to(to), 0.05)
	beam.size = Vector3(0.025, 0.025, length)
	tracer.mesh = beam
	tracer.material_override = BlockFactory.material(color, 0.22, color)
	tracer.global_position = (from + to) * 0.5
	add_child(tracer)
	tracer.look_at(to, Vector3.UP)
	var tween := create_tween()
	tween.tween_property(tracer, "scale", Vector3(0.15, 0.15, 1.0), 0.09)
	tween.tween_callback(tracer.queue_free)

func spawn_hit_effect(position: Vector3, color: Color) -> void:
	AudioManager.play_hit()
	var particles := CPUParticles3D.new()
	particles.amount = 14
	particles.lifetime = 0.34
	particles.one_shot = true
	particles.explosiveness = 0.95
	var particle_material := ParticleProcessMaterial.new()
	particle_material.direction = Vector3.UP
	particle_material.spread = 180.0
	particle_material.initial_velocity_min = 2.0
	particle_material.initial_velocity_max = 5.0
	particle_material.gravity = Vector3(0, -8, 0)
	particles.process_material = particle_material
	var spark := SphereMesh.new()
	spark.radius = 0.055
	spark.height = 0.11
	particles.draw_pass_1 = spark
	particles.material_override = BlockFactory.material(color, 0.25, color)
	particles.position = position
	add_child(particles)
	particles.finished.connect(particles.queue_free)
	particles.emitting = true
	var burst := MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = 0.16
	sphere.height = 0.32
	burst.mesh = sphere
	burst.material_override = BlockFactory.material(color, 0.3, color)
	burst.position = position
	add_child(burst)
	var tween := create_tween()
	tween.tween_property(burst, "scale", Vector3(2.7, 2.7, 2.7), 0.16)
	tween.tween_property(burst, "scale", Vector3.ZERO, 0.16)
	tween.tween_callback(burst.queue_free)

func _on_zone_changed(radius: float, _remaining: float) -> void:
	if is_instance_valid(world):
		world.update_zone(radius)
