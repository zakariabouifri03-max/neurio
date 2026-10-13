class_name TrainingMatch
extends Node3D
## Offline Phase 1 match: one human player against training bots on Emerald Island.
##
## Owns the match rules (kills, deaths, respawn, out-of-bounds). Presentation lives
## in HUD / TouchControls / PauseMenu, which this script only wires together.

const PLAYER_SCENE := preload("res://scenes/characters/player.tscn")
const MAP_SCENE := preload("res://scenes/maps/emerald_island.tscn")
const HUD_SCENE := preload("res://scenes/ui/hud.tscn")
const TOUCH_SCENE := preload("res://scenes/ui/touch_controls.tscn")
const PAUSE_SCENE := preload("res://scenes/menus/pause_menu.tscn")

const RESPAWN_DELAY := 3.0
const FALL_LIMIT_Y := -6.0
const WEAPON_ID := "pulse_carbine"

var _config: Dictionary = {}
var _map: MapLevel
var _player: PlayerController
var _bots: Array = []
var _actors: Array = []
var _camera: ThirdPersonCamera
var _desktop: DesktopInputAdapter
var _hud: HUD
var _touch: TouchControls
var _pause: PauseMenu
var _edit_done: Button
var _loading_layer: CanvasLayer
var _loading_label: Label
var _loading_bar: ProgressBar
var _kills := 0
var _deaths := 0
var _respawn_left: Dictionary = {}
var _running := false
var _paused := false
var _touch_mode := false
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	_config = GameState.match_config.duplicate()
	_rng.randomize()
	_touch_mode = DisplayServer.is_touchscreen_available() or OS.has_feature("android")
	_build_loading()
	_map = MAP_SCENE.instantiate() as MapLevel
	add_child(_map)
	_map.progress.connect(_on_map_progress)
	await _map.build_map()
	GraphicsPresets.apply(get_viewport(), _map.sun, _map.environment, _map.world)
	_spawn_actors()
	_build_ui()
	_loading_layer.visible = false
	_running = true
	_hud.show_message("Eliminate the training bot. Stay alive and keep moving.", 4.0)
	_apply_mouse_mode()


func _notification(what: int) -> void:
	## Android back button toggles the pause menu; backgrounding the app pauses the match.
	if what == NOTIFICATION_WM_GO_BACK_REQUEST:
		if _paused:
			_resume_game()
		else:
			_pause_game()
	elif what == NOTIFICATION_APPLICATION_PAUSED or what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		if _running and not _paused:
			_pause_game()


func _unhandled_input(event: InputEvent) -> void:
	if _running and not _paused and event.is_action_pressed("ui_cancel"):
		_pause_game()


func _physics_process(_delta: float) -> void:
	if not _running or _paused:
		return
	if _desktop != null:
		_desktop.poll()
	for actor in _actors:
		var a := actor as PlayerController
		if a.alive and a.global_position.y < FALL_LIMIT_Y:
			a.health.apply_damage(9999, null)


func _process(delta: float) -> void:
	if not _running or _paused:
		return
	_update_respawns(delta)
	_update_camera()
	_update_hud()


# --- setup ----------------------------------------------------------------

func _build_loading() -> void:
	_loading_layer = CanvasLayer.new()
	_loading_layer.layer = 30
	add_child(_loading_layer)
	var bg := ColorRect.new()
	bg.color = Color("#10202e")
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	_loading_layer.add_child(bg)
	var box := VBoxContainer.new()
	box.set_anchors_preset(Control.PRESET_CENTER)
	box.position = Vector2(-260, -40)
	box.custom_minimum_size = Vector2(520, 0)
	_loading_layer.add_child(box)
	_loading_label = Label.new()
	_loading_label.text = "Loading"
	_loading_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(_loading_label)
	_loading_bar = ProgressBar.new()
	_loading_bar.max_value = 100.0
	_loading_bar.custom_minimum_size = Vector2(520, 22)
	_loading_bar.show_percentage = false
	box.add_child(_loading_bar)


func _on_map_progress(fraction: float, label: String) -> void:
	_loading_bar.value = fraction * 100.0
	_loading_label.text = label


func _spawn_actors() -> void:
	_player = PLAYER_SCENE.instantiate() as PlayerController
	_player.display_name = "You"
	_player.team = 0
	add_child(_player)
	_player.world = _map.world
	_player.equip_weapon(WeaponData.get_by_id(WEAPON_ID))
	_player.eliminated.connect(_on_eliminated)
	_player.dealt_damage.connect(_on_player_dealt_damage)
	_player.received_damage.connect(_on_player_received_damage)

	_camera = ThirdPersonCamera.new()
	_camera.name = "Camera"
	add_child(_camera)
	_camera.follow(_player)
	_player.camera_rig = _camera
	_apply_camera_settings()
	AppSettings.changed.connect(_on_setting_changed)

	_desktop = DesktopInputAdapter.new()
	_desktop.name = "DesktopInput"
	_desktop.input = _player.input
	_desktop.enabled = not _touch_mode
	add_child(_desktop)

	var difficulty := str(_config.get("bot_difficulty", "normal"))
	var count := int(_config.get("bot_count", 1))
	for i in range(count):
		var bot := PLAYER_SCENE.instantiate() as PlayerController
		bot.display_name = "Training Bot %d" % (i + 1)
		bot.is_bot = true
		bot.team = 1
		add_child(bot)
		bot.world = _map.world
		bot.equip_weapon(WeaponData.get_by_id(WEAPON_ID))
		bot.set_outfit(Color("#c0392b"), Color("#3a2d2d"), Color("#e3b98f"), Color("#2b2b2b"))
		bot.eliminated.connect(_on_eliminated)
		var brain := BotController.new(bot, difficulty, _rng.randi())
		bot.ai = brain
		_bots.append(bot)

	_actors = [_player] + _bots
	for bot in _bots:
		var brain := (bot as PlayerController).ai as BotController
		brain.targets = _actors
		brain.waypoints = _map.get_spawn_points()
	for actor in _actors:
		_place_actor(actor as PlayerController, true)


func _build_ui() -> void:
	var hud_layer := CanvasLayer.new()
	hud_layer.layer = 5
	add_child(hud_layer)
	_hud = HUD_SCENE.instantiate() as HUD
	hud_layer.add_child(_hud)
	_hud.set_match_text("Training Ground")

	var touch_layer := CanvasLayer.new()
	touch_layer.layer = 6
	add_child(touch_layer)
	_touch = TOUCH_SCENE.instantiate() as TouchControls
	_touch.input = _player.input
	_touch.pause_pressed.connect(_pause_game)
	touch_layer.add_child(_touch)
	_touch.set_active(_touch_mode)

	var edit_layer := CanvasLayer.new()
	edit_layer.layer = 8
	add_child(edit_layer)
	_edit_done = Button.new()
	_edit_done.text = "DONE - save layout"
	_edit_done.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_edit_done.position = Vector2(-140, 110)
	_edit_done.custom_minimum_size = Vector2(280, 52)
	_edit_done.visible = false
	_edit_done.pressed.connect(_finish_layout_edit)
	edit_layer.add_child(_edit_done)

	var pause_layer := CanvasLayer.new()
	pause_layer.layer = 20
	add_child(pause_layer)
	_pause = PAUSE_SCENE.instantiate() as PauseMenu
	_pause.resume_requested.connect(_resume_game)
	_pause.edit_layout_requested.connect(_begin_layout_edit)
	_pause.return_to_menu_requested.connect(_return_to_menu)
	pause_layer.add_child(_pause)


# --- placement and respawn -------------------------------------------------

func _place_actor(actor: PlayerController, initial: bool) -> void:
	var spawns: Array = _map.get_spawn_points()
	if spawns.is_empty():
		push_error("TrainingMatch: map has no spawn points.")
		return
	var best: Vector3 = spawns[0]
	var best_score := -INF
	for i in range(6):
		var p: Vector3 = spawns[_rng.randi() % spawns.size()]
		var nearest := INF
		for other in _actors:
			var o := other as PlayerController
			if o == actor or not o.alive:
				continue
			nearest = minf(nearest, o.global_position.distance_to(p))
		var score := 1000.0 if nearest == INF else nearest
		if initial:
			score = _rng.randf()
		if score > best_score:
			best_score = score
			best = p
	actor.reset_for_spawn(best, _rng.randf() * TAU)


func _update_respawns(delta: float) -> void:
	for actor in _respawn_left.keys():
		_respawn_left[actor] = float(_respawn_left[actor]) - delta
		if float(_respawn_left[actor]) <= 0.0:
			_respawn_left.erase(actor)
			_place_actor(actor as PlayerController, false)
			if actor == _player:
				_hud.hide_eliminated()
				_hud.show_message("Back in the fight", 2.0)


func _on_eliminated(killer: Node, victim: Node) -> void:
	var v := victim as PlayerController
	var k := killer as PlayerController
	if v == null:
		return
	var killer_name := k.display_name if (k != null and k != v) else "the map"
	if v == _player:
		_deaths += 1
		_hud.show_eliminated("ELIMINATED by %s\nRespawning shortly..." % killer_name)
		Sfx.play_ui("eliminated")
	elif k == _player:
		_kills += 1
		_hud.show_message("Eliminated %s" % v.display_name, 2.5)
		Sfx.play_ui("victory")
	_respawn_left[v] = RESPAWN_DELAY


func _on_player_dealt_damage(_amount: int, _target: Node, headshot: bool) -> void:
	_hud.flash_hit(headshot)
	Sfx.play_ui("hit", -4.0)


func _on_player_received_damage(_amount: int, source: Node, _headshot: bool) -> void:
	_hud.flash_damage()
	var who := "an unknown source"
	if source is PlayerController:
		who = (source as PlayerController).display_name
	_hud.show_message("Hit by %s" % who, 1.2)


# --- per-frame presentation ------------------------------------------------

func _update_camera() -> void:
	var look := _player.input.consume_look()
	_camera.aiming = _player.alive and _player.input.aim_held
	if _player.alive:
		_camera.apply_look(look)
		_camera.assist_factor = _aim_assist_factor()


func _aim_assist_factor() -> float:
	## Slightly slows look speed when the crosshair is already close to a bot.
	if not bool(AppSettings.get_value("aim_assist")) or not _camera.aiming:
		return 1.0
	var origin := _camera.get_aim_origin()
	var dir := _camera.get_aim_direction()
	for bot in _bots:
		var b := bot as PlayerController
		if not b.alive:
			continue
		var to := (b.global_position + Vector3(0, 1.1, 0) - origin).normalized()
		if dir.angle_to(to) < deg_to_rad(4.0):
			return 0.6
	return 1.0


func _update_hud() -> void:
	_hud.set_health(_player.health.current, _player.health.max_health)
	_hud.set_armor(_player.health.armor)
	var weapon := _player.weapon
	if weapon != null and weapon.data != null:
		_hud.set_weapon_name(weapon.data.display_name)
		_hud.set_ammo(weapon.magazine, weapon.reserve)
		_hud.set_reload_progress(weapon.reload_progress() if weapon.reloading else 0.0)
	var speed := Vector2(_player.velocity.x, _player.velocity.z).length()
	var spread := 12.0 + minf(speed, 8.0) * 2.0 + _player.extra_spread_deg * 6.0
	_hud.set_crosshair(spread, _player.is_aiming)
	_hud.set_location(_map.landmark_name_at(_player.global_position))
	_update_match_text()


func _update_match_text() -> void:
	_hud.set_match_text("Training Ground   K %d   D %d   Bots %d" % [_kills, _deaths, _alive_bot_count()])


func _alive_bot_count() -> int:
	var n := 0
	for bot in _bots:
		if (bot as PlayerController).alive:
			n += 1
	return n


func _on_setting_changed(_key: String, _value: Variant) -> void:
	_apply_camera_settings()


func _apply_camera_settings() -> void:
	_camera.look_sensitivity = float(AppSettings.get_value("look_sensitivity"))
	_camera.aim_sensitivity = float(AppSettings.get_value("aim_sensitivity"))
	_camera.invert_y = bool(AppSettings.get_value("invert_y"))
	_camera.apply_settings(float(AppSettings.get_value("camera_distance")), float(AppSettings.get_value("fov")))


# --- pause, layout editing, navigation -------------------------------------

func _apply_mouse_mode() -> void:
	if _touch_mode or _paused:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	else:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _pause_game() -> void:
	if not _running or _paused:
		return
	_paused = true
	_touch.set_active(false)
	get_tree().paused = true
	_pause.open()
	_apply_mouse_mode()


func _resume_game() -> void:
	if not _paused:
		return
	_paused = false
	get_tree().paused = false
	_pause.close()
	_touch.set_active(_touch_mode)
	_apply_mouse_mode()


func _begin_layout_edit() -> void:
	## Layout editing runs live: the match keeps going so the layout is tested under play.
	_paused = false
	get_tree().paused = false
	_pause.close()
	_touch.set_active(true)
	_touch.set_edit_mode(true)
	_edit_done.visible = true
	_hud.show_message("Drag buttons to new spots, then tap DONE.", 4.0)


func _finish_layout_edit() -> void:
	_touch.set_edit_mode(false)
	_edit_done.visible = false
	_touch.set_active(_touch_mode)
	_hud.show_message("Button layout saved.", 2.0)


func _return_to_menu() -> void:
	_running = false
	_paused = false
	get_tree().paused = false
	GameState.goto_main_menu()
