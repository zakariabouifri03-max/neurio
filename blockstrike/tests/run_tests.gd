extends Node
## Headless test runner for Phase 1 systems.
##
## Run from the blockstrike/ directory:
##   godot --headless --path . --scene res://tests/run_tests.tscn
## It runs as a scene so autoloads (AppSettings, GameState, Sfx) are registered before
## any game script compiles. Exit code 0 means every test passed.
##
## These tests cover logic, data, physics hit detection and a smoke run of the
## training match. Visual quality and touch feel are NOT covered here; they need a
## device or a rendering build.

const SETTINGS_TEST_PATH := "user://test_settings_tmp.json"
const TRAINING_SCENE := "res://scenes/match/training_ground.tscn"

var _passed := 0
var _failed := 0
var _lines: PackedStringArray = []


func _ready() -> void:
	_run_all()


func _run_all() -> void:
	await get_tree().process_frame
	_test_block_database()
	_test_weapon_data()
	_test_health_component()
	_test_settings_store()
	_test_save_file()
	_test_voxel_world()
	_test_map_generation()
	_test_bot_configs()
	_test_player_input()
	_test_touch_layout()
	await _test_multitouch()
	await _test_menus_have_no_fake_controls()
	await _test_hit_detection()
	await _test_training_match_smoke()

	print("")
	for line in _lines:
		print(line)
	print("")
	print("RESULT: %d passed, %d failed" % [_passed, _failed])
	get_tree().quit(0 if _failed == 0 else 1)


func _check(name: String, condition: bool, detail: String = "") -> void:
	if condition:
		_passed += 1
		_lines.append("PASS  %s" % name)
	else:
		_failed += 1
		_lines.append("FAIL  %s %s" % [name, detail])


# --- data and pure logic ----------------------------------------------------

func _test_block_database() -> void:
	BlockDB.ensure_loaded()
	var raw: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://data/blocks.json"))
	var ok: bool = typeof(raw) == TYPE_DICTIONARY and raw.has("blocks")
	_check("blocks.json parses", ok)
	if not ok:
		return
	var blocks: Array = raw["blocks"]
	_check("blocks.json has 14 blocks", blocks.size() == 14, "count=%d" % blocks.size())
	var ids := {}
	for b in blocks:
		ids[int(b["id"])] = true
	_check("block ids are unique and 0..13", ids.size() == 14 and ids.has(0) and ids.has(13))
	_check("air is not solid", not BlockDB.is_solid(BlockIds.AIR))
	_check("stone is solid", BlockDB.is_solid(BlockIds.STONE))
	_check("water is not solid", not BlockDB.is_solid(BlockIds.WATER))


func _test_weapon_data() -> void:
	var w := WeaponData.get_by_id("pulse_carbine")
	_check("pulse_carbine loads from weapons.json", w != null)
	if w == null:
		return
	_check("pulse_carbine validates", w.validate() == "", w.validate())
	_check("full damage inside effective range", is_equal_approx(w.damage_at_distance(0.0), float(w.damage)))
	var at_max := w.damage_at_distance(w.max_range)
	_check("damage falls to minimum factor at max range",
		is_equal_approx(at_max, float(w.damage) * w.min_damage_factor_at_max_range),
		"got %f" % at_max)
	var prev := INF
	var monotonic := true
	for i in range(0, 101):
		var d := w.damage_at_distance(w.max_range * float(i) / 100.0)
		if d > prev + 0.0001:
			monotonic = false
		prev = d
	_check("damage never increases with distance", monotonic)
	_check("unknown weapon id returns null", WeaponData.get_by_id("does_not_exist") == null)


func _test_health_component() -> void:
	var h := HealthComponent.new()
	var died_with: Array = []
	h.died.connect(func(killer: Node) -> void: died_with.append(killer))
	var dealt := h.apply_damage(30, null)
	_check("damage reduces health", h.current == 70 and dealt == 30, "hp=%d dealt=%d" % [h.current, dealt])
	h.add_armor(50)
	var dealt_armor := h.apply_damage(20, null)
	_check("armour absorbs half of damage", dealt_armor == 10 and h.armor == 40,
		"dealt=%d armor=%d" % [dealt_armor, h.armor])
	h.heal(500)
	_check("heal is capped at max health", h.current == h.max_health)
	h.apply_damage(9999, null)
	_check("lethal damage kills", not h.alive and h.current == 0)
	h.apply_damage(50, null)
	_check("dead component takes no further damage", h.current == 0 and died_with.size() == 1,
		"died_signals=%d" % died_with.size())
	h.reset()
	_check("reset restores life", h.alive and h.current == h.max_health)
	h.free()


func _test_settings_store() -> void:
	var store: Node = load("res://scripts/save/settings_store.gd").new()
	store.set_value("fov", 200.0, false)
	_check("fov is clamped to 95", is_equal_approx(float(store.get_value("fov")), 95.0))
	store.set_value("button_scale", 0.01, false)
	_check("button scale is clamped to 0.7", is_equal_approx(float(store.get_value("button_scale")), 0.7))
	store.set_value("no_such_key", 1, false)
	_check("unknown settings keys are rejected", store.get_value("no_such_key") == null)
	store.set_value("touch_positions", {"fire": [0.5, 0.5]}, false)
	_check("touch_positions round-trips as a dictionary",
		typeof(store.get_value("touch_positions")) == TYPE_DICTIONARY)
	store.free()


func _test_save_file() -> void:
	var err := SaveFile.write_json(SETTINGS_TEST_PATH, {"answer": 42, "version": 1})
	_check("save file writes", err == OK, "error=%d" % err)
	var result := SaveFile.read_json(SETTINGS_TEST_PATH)
	_check("save file reads back", result["status"] == SaveFile.ReadStatus.OK
		and int(result["data"].get("answer", 0)) == 42)
	var f := FileAccess.open(SETTINGS_TEST_PATH, FileAccess.WRITE)
	f.store_string("{ this is not json")
	f.close()
	var bad := SaveFile.read_json(SETTINGS_TEST_PATH)
	_check("corrupt save is detected, not trusted",
		bad["status"] != SaveFile.ReadStatus.OK, "status=%s" % str(bad["status"]))
	var dir := DirAccess.open("user://")
	if dir != null:
		for name in ["test_settings_tmp.json", "test_settings_tmp.json.bak", "test_settings_tmp.json.corrupt"]:
			if dir.file_exists(name):
				dir.remove(name)


func _test_voxel_world() -> void:
	BlockDB.ensure_loaded()
	var world := VoxelWorld.new()
	world.setup(16, 8, 16)
	_check("voxel world bounds", world.in_bounds(0, 0, 0) and not world.in_bounds(16, 0, 0))
	world.set_block(3, 2, 3, BlockIds.STONE)
	_check("set_block/get_block round-trip", world.get_block(3, 2, 3) == BlockIds.STONE)
	_check("surface height is first air above the top solid block",
		world.surface_height(3, 3) == 3, "got %d" % world.surface_height(3, 3))
	_check("empty column has no surface", world.surface_height(0, 0) == -1)
	world.set_block(3, 2, 3, BlockIds.AIR)
	_check("removing a block clears it", world.get_block(3, 2, 3) == BlockIds.AIR)
	world.free()


func _test_map_generation() -> void:
	var world := VoxelWorld.new()
	world.setup(MapGenerator.W, MapGenerator.H, MapGenerator.W)
	var info := MapGenerator.generate(world, 20261013)
	var spawns: Array = info.get("spawns", [])
	_check("map generates at least 6 spawn points", spawns.size() >= 6, "count=%d" % spawns.size())
	var all_standable := true
	for p in spawns:
		var v: Vector3 = p
		var top := world.surface_height(int(v.x), int(v.z))
		if top <= 0 or int(v.y) != top:
			all_standable = false
	_check("every spawn stands on solid ground", all_standable)
	var min_gap := INF
	for i in range(spawns.size()):
		for j in range(i + 1, spawns.size()):
			min_gap = minf(min_gap, (spawns[i] as Vector3).distance_to(spawns[j] as Vector3))
	_check("spawn points are spaced at least 24 blocks apart", spawns.size() < 2 or min_gap >= 24.0,
		"min gap=%f" % min_gap)
	_check("map has named landmarks", info.get("landmarks", []).size() >= 5)
	var world2 := VoxelWorld.new()
	world2.setup(MapGenerator.W, MapGenerator.H, MapGenerator.W)
	var again := MapGenerator.generate(world2, 20261013)
	_check("map generation is deterministic for a seed",
		str(again.get("spawns")) == str(spawns))
	world2.free()
	world.free()


func _test_bot_configs() -> void:
	var beginner: Dictionary = BotController._load_config("beginner")
	var advanced: Dictionary = BotController._load_config("advanced")
	_check("bot config has the three difficulties",
		BotController._load_config("normal").has("reaction_time") and not beginner.is_empty() and not advanced.is_empty())
	_check("advanced bots react faster than beginners",
		float(advanced["reaction_time"]) < float(beginner["reaction_time"]))
	_check("advanced bots are more accurate than beginners",
		float(advanced["accuracy"]) > float(beginner["accuracy"]))


func _test_player_input() -> void:
	var input := PlayerInput.new()
	input.request_jump()
	_check("jump request is consumed once", input.consume_jump() and not input.consume_jump())
	input.request_reload()
	_check("reload request is consumed once", input.consume_reload() and not input.consume_reload())
	input.look_delta = Vector2(0.1, -0.2)
	var look := input.consume_look()
	_check("look delta is consumed and cleared", is_equal_approx(look.x, 0.1) and input.look_delta == Vector2.ZERO)


func _test_touch_layout() -> void:
	AppSettings.set_value("touch_layout", "standard", false)
	AppSettings.set_value("touch_positions", {}, false)
	var standard := TouchControls.new()
	var fire_standard: Vector2 = standard._resolve_layout()["fire"]
	_check("standard layout puts fire on the right", fire_standard.x > 0.5)
	AppSettings.set_value("touch_layout", "left_handed", false)
	var left := TouchControls.new()
	var fire_left: Vector2 = left._resolve_layout()["fire"]
	_check("left-handed layout mirrors fire to the left", is_equal_approx(fire_left.x, 1.0 - fire_standard.x))
	_check("left-handed layout keeps the pause button on the right",
		is_equal_approx(left._resolve_layout()["pause"].x, TouchControls.STANDARD_LAYOUT["pause"].x))
	AppSettings.set_value("touch_positions", {"jump": [0.3, 0.3]}, false)
	_check("custom touch position overrides the preset",
		left._resolve_layout()["jump"] == Vector2(0.3, 0.3))
	AppSettings.set_value("touch_layout", "standard", false)
	AppSettings.set_value("touch_positions", {}, false)
	standard.free()
	left.free()


# --- physics and gameplay -----------------------------------------------------

func _test_hit_detection() -> void:
	var root := get_tree().root
	var floor_body := StaticBody3D.new()
	floor_body.collision_layer = GameConstants.LAYER_WORLD
	var floor_shape := CollisionShape3D.new()
	var floor_box := BoxShape3D.new()
	floor_box.size = Vector3(200, 1, 200)
	floor_shape.shape = floor_box
	floor_body.add_child(floor_shape)
	floor_body.position = Vector3(0, -0.5, 0)
	root.add_child(floor_body)

	var wall := StaticBody3D.new()
	wall.collision_layer = GameConstants.LAYER_WORLD
	var wall_shape := CollisionShape3D.new()
	var wall_box := BoxShape3D.new()
	wall_box.size = Vector3(4, 4, 1)
	wall_shape.shape = wall_box
	wall.add_child(wall_shape)
	wall.position = Vector3(0, 2, -20)
	root.add_child(wall)

	var target := load("res://scenes/characters/player.tscn").instantiate() as PlayerController
	target.display_name = "Dummy"
	target.position = Vector3(0, 0, -8)
	root.add_child(target)
	target.movement_enabled = false
	var shooter := load("res://scenes/characters/player.tscn").instantiate() as PlayerController
	shooter.display_name = "Shooter"
	shooter.position = Vector3(0, 0, 0)
	root.add_child(shooter)
	shooter.movement_enabled = false
	await get_tree().physics_frame
	await get_tree().physics_frame

	var space := root.get_world_3d()
	var hit := ShotResolver.cast(space, Vector3(0, 1.5, 0), Vector3(0, 1.5, -40), [shooter, target])
	_check("ray hits the wall in front", not hit.is_empty() and hit["collider"] == wall,
		"hit=%s" % str(hit.keys()))
	_check("wall hit distance is correct", not hit.is_empty() and absf(float(hit["distance"]) - 19.5) < 0.1)
	_check("line of sight is blocked by the wall", not ShotResolver.line_of_sight(space,
		Vector3(0, 1.5, 0), Vector3(0, 1.5, -30), []))
	_check("line of sight is clear to a target in the open", ShotResolver.line_of_sight(space,
		Vector3(0, 1.5, 0), Vector3(0, 1.5, -6), []))

	var weapon_data := WeaponData.get_by_id("pulse_carbine")
	weapon_data.spread_deg = 0.0
	weapon_data.moving_spread_penalty_deg = 0.0
	var weapon := Weapon.new()
	shooter.add_child(weapon)
	weapon.setup(weapon_data, shooter)
	var aim_origin := Vector3(0, 1.1, 0)
	var aim_dir := (Vector3(0, 1.1, -8) - aim_origin).normalized()
	var shot := weapon.try_fire(aim_origin, aim_dir, 0.0, 0.0, false)
	_check("weapon fires when ready", bool(shot.get("fired", false)))
	_check("aimed shot damages the target", target.health.current < target.health.max_health,
		"hp=%d" % target.health.current)
	_check("damage equals the weapon's full damage inside effective range",
		target.health.current == target.health.max_health - weapon_data.damage,
		"hp=%d expected=%d" % [target.health.current, target.health.max_health - weapon_data.damage])

	var second := weapon.try_fire(aim_origin, Vector3(0, 0, -1), 0.0, 0.0, false)
	_check("cooldown prevents a second shot in the same frame", not bool(second.get("fired", true)))

	target.receive_hit(9999, shooter, false)
	_check("lethal hit eliminates the target", not target.alive and target.health.current == 0)

	target.queue_free()
	shooter.queue_free()
	wall.queue_free()
	floor_body.queue_free()
	await get_tree().process_frame


func _test_training_match_smoke() -> void:
	var packed := load(TRAINING_SCENE) as PackedScene
	_check("training scene loads", packed != null)
	if packed == null:
		return
	GameState.match_config = {"mode": "training", "map": "emerald_island", "bot_difficulty": "beginner", "bot_count": 1}
	var match_root := packed.instantiate() as TrainingMatch
	get_tree().root.add_child(match_root)
	var waited := 0
	while not match_root._running and waited < 3600:
		await get_tree().process_frame
		waited += 1
	_check("training match finishes loading", match_root._running, "waited %d frames" % waited)
	if not match_root._running:
		match_root.queue_free()
		return
	_check("player is spawned", match_root._player != null and match_root._player.alive)
	_check("one training bot is spawned", match_root._bots.size() == 1)
	_check("bot has a brain attached", match_root._bots[0].ai != null)
	_check("player has a working weapon", match_root._player.weapon != null and match_root._player.weapon.data != null)
	_check("HUD is created", match_root._hud != null)
	_check_terrain_collision(match_root._map.world)
	var player_start: Vector3 = match_root._player.global_position
	for i in range(60):
		await get_tree().physics_frame
	_check("player stays above the map after settling", match_root._player.global_position.y > -1.0,
		"y=%f start=%s" % [match_root._player.global_position.y, str(player_start)])
	var bot: PlayerController = match_root._bots[0]
	var player: PlayerController = match_root._player
	var duel := _find_duel_spots(match_root._map.world)
	_check("finds a flat, unobstructed duel area on the island", duel.size() == 2)
	if duel.size() != 2:
		match_root.queue_free()
		return
	player.reset_for_spawn(duel[0], 0.0)
	bot.reset_for_spawn(duel[1], 0.0)
	var brain := bot.ai as BotController
	var saw_player := false
	var waited_frames := 0
	while waited_frames < 300 and not saw_player:
		await get_tree().physics_frame
		waited_frames += 1
		if brain.target == player:
			saw_player = true
	_check("bot acquires the player within 5 s when close and in view", saw_player,
		"frames=%d" % waited_frames)
	var start_mag: int = bot.weapon.magazine
	var fired_frames := 0
	while fired_frames < 600 and bot.weapon.magazine == start_mag:
		await get_tree().physics_frame
		fired_frames += 1
	_check("bot opens fire on the player within 10 s of engaging", bot.weapon.magazine < start_mag,
		"frames=%d" % fired_frames)
	_check_controls_wired("Training pause menu", match_root._pause)
	match_root._pause_game()
	_check("pause freezes the tree", get_tree().paused)
	match_root._resume_game()
	_check("resume unfreezes the tree", not get_tree().paused)
	match_root._running = false
	match_root.queue_free()
	await get_tree().process_frame


# --- input and UI wiring -----------------------------------------------------

func _touch_event(pressed: bool, index: int, pos: Vector2) -> InputEventScreenTouch:
	var ev := InputEventScreenTouch.new()
	ev.index = index
	ev.position = pos
	ev.pressed = pressed
	return ev


func _drag_event(index: int, pos: Vector2, relative: Vector2) -> InputEventScreenDrag:
	var ev := InputEventScreenDrag.new()
	ev.index = index
	ev.position = pos
	ev.relative = relative
	return ev


func _test_multitouch() -> void:
	var tc := TouchControls.new()
	tc.input = PlayerInput.new()
	get_tree().root.add_child(tc)
	await get_tree().process_frame
	tc.set_active(true)
	var input: PlayerInput = tc.input
	var vp := get_tree().root.get_visible_rect().size
	var fire_pos := tc.button_center("fire")
	var jump_pos := tc.button_center("jump")
	var stick_pos := Vector2(vp.x * 0.14, vp.y * 0.72)
	var look_start := Vector2(vp.x * 0.55, vp.y * 0.3)

	tc._input(_touch_event(true, 0, fire_pos))
	_check("touch on FIRE holds fire", input.fire_held)
	tc._input(_touch_event(true, 1, jump_pos))
	_check("second finger on JUMP queues a jump while firing", input.consume_jump() and input.fire_held)
	tc._input(_touch_event(true, 2, stick_pos))
	tc._input(_touch_event(true, 3, look_start))
	tc._input(_drag_event(2, stick_pos + Vector2(0, -tc.stick_radius() * 0.8), Vector2(0, -10)))
	_check("dragging the stick forward moves the player forward", input.move.y > 0.5 and absf(input.move.x) < 0.1,
		"move=%s" % str(input.move))
	tc._input(_drag_event(3, look_start + Vector2(40, 0), Vector2(40, 0)))
	var look := input.consume_look()
	_check("dragging on the look half turns the camera", look.x != 0.0, "look=%s" % str(look))
	_check("look finger does not stop the stick", input.move.y > 0.5)

	tc._input(_touch_event(false, 0, fire_pos))
	_check("releasing FIRE stops firing", not input.fire_held)
	_check("releasing FIRE keeps the stick held", input.move.y > 0.5)

	tc._input(_touch_event(false, 2, stick_pos))
	_check("releasing the stick stops movement", input.move == Vector2.ZERO)
	tc._input(_touch_event(false, 1, jump_pos))
	tc._input(_touch_event(false, 3, look_start))
	tc.set_active(false)
	_check("hidden touch layer ignores touches", not tc.visible)
	tc.queue_free()
	await get_tree().process_frame


func _all_controls(node: Node, out: Array) -> void:
	if node is BaseButton or node is Range or node is OptionButton:
		out.append(node)
	for child in node.get_children():
		_all_controls(child, out)


func _has_handler(control: Node) -> bool:
	if control is OptionButton:
		return not control.get_signal_connection_list("item_selected").is_empty()
	if control is Range:
		return not control.get_signal_connection_list("value_changed").is_empty()
	if control is CheckBox:
		return not control.get_signal_connection_list("toggled").is_empty()
	if control is BaseButton:
		return not control.get_signal_connection_list("pressed").is_empty()
	return false


func _check_controls_wired(scene_name: String, root: Node) -> void:
	var controls: Array = []
	_all_controls(root, controls)
	var unwired: PackedStringArray = []
	var enabled_count := 0
	for c in controls:
		var ctrl := c as Control
		if ctrl.get("disabled") == true:
			continue
		enabled_count += 1
		if not _has_handler(c):
			unwired.append(ctrl.name)
	_check("%s: every enabled control has a handler (%d checked)" % [scene_name, enabled_count],
		unwired.is_empty(), "unwired=%s" % str(unwired))


func _test_menus_have_no_fake_controls() -> void:
	var menu := (load("res://scenes/menus/main_menu.tscn") as PackedScene).instantiate()
	get_tree().root.add_child(menu)
	await get_tree().process_frame
	_check_controls_wired("Main menu", menu)
	var disabled_names: PackedStringArray = []
	var all: Array = []
	_all_controls(menu, all)
	for c in all:
		if (c as Control).get("disabled") == true:
			disabled_names.append((c as Button).text if c is Button else "")
	_check("main menu shows unbuilt modes as disabled, not hidden",
		disabled_names.size() >= 6, "disabled=%d" % disabled_names.size())
	menu.queue_free()

	var pause := (load("res://scenes/menus/pause_menu.tscn") as PackedScene).instantiate()
	get_tree().root.add_child(pause)
	await get_tree().process_frame
	_check_controls_wired("Pause menu", pause)
	pause.queue_free()
	await get_tree().process_frame


func _check_terrain_collision(world: VoxelWorld) -> void:
	## Regression test: physics must see the ground exactly where the voxel data says it is.
	## Before the chunk-local fix, most chunks were offset by their own origin.
	var space := get_tree().root.get_world_3d().direct_space_state
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	var checked := 0
	var mismatches := 0
	var worst := 0.0
	for i in range(40):
		var x := rng.randi_range(2, world.size_x - 3)
		var z := rng.randi_range(2, world.size_z - 3)
		var top := world.surface_height(x, z)
		if top <= 0:
			continue
		var q := PhysicsRayQueryParameters3D.create(Vector3(x + 0.5, 60.0, z + 0.5),
			Vector3(x + 0.5, -2.0, z + 0.5), GameConstants.LAYER_WORLD)
		var hit := space.intersect_ray(q)
		checked += 1
		if hit.is_empty():
			mismatches += 1
			worst = maxf(worst, float(top))
			continue
		var err := absf(float(hit["position"].y) - float(top))
		worst = maxf(worst, err)
		if err > 0.05:
			mismatches += 1
	_check("terrain collision matches voxel data in %d sampled columns" % checked,
		checked >= 20 and mismatches == 0, "mismatches=%d worst=%f" % [mismatches, worst])


func _find_duel_spots(world: VoxelWorld) -> Array:
	## Deterministic search for two points 7 blocks apart on flat ground with nothing
	## (trees, walls, houses) in between, so line-of-sight tests are meaningful.
	for x in range(16, world.size_x - 16, 2):
		for z in range(16, world.size_z - 16):
			var top := world.surface_height(x, z)
			if top <= 0:
				continue
			var flat := true
			for zz in range(z - 7, z + 1):
				if world.surface_height(x, zz) != top or world.surface_height(x + 1, zz) != top:
					flat = false
					break
			if flat:
				return [Vector3(x + 0.5, top, z + 0.5), Vector3(x + 0.5, top, z - 6.5)]
	return []
