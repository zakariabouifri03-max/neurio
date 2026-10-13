class_name MatchScene
extends Node3D
## The playable match scene: world + players + HUD + touch controls + pause/results.
##
## The scene is a thin shell around MatchManager: it builds the match from the
## lobby's settings, wires the local player to whichever input device is active,
## handles pause/results/leave, and keeps the camera on a live player while
## spectating.  All gameplay rules live in the gameplay classes.

signal finished(summary: Dictionary)

const DOUBLE_TAP_WINDOW := 0.3

var match_ref: MatchManager = null
var hud: GameHud = null
var touch: TouchControls = null
var pause_menu: PauseMenu = null
var results: ResultsScreen = null
var router: InputRouter = null
var settings: Dictionary = {}
var pause_enabled: bool = true
var ui_root: CanvasLayer = null

var _paused: bool = false
var sun: DirectionalLight3D = null
var _summary: Dictionary = {}
var _rewards: Dictionary = {}
var _spectate_active: bool = false
var _leave_on_finish: bool = false

func _ready() -> void:
	_build_ui()
	set_process(true)
	set_process_input(true)

func _build_ui() -> void:
	ui_root = CanvasLayer.new()
	ui_root.name = "UI"
	add_child(ui_root)
	hud = GameHud.new()
	hud.name = "HUD"
	ui_root.add_child(hud)
	touch = TouchControls.new()
	touch.name = "TouchControls"
	ui_root.add_child(touch)
	touch.pause_requested.connect(_toggle_pause)
	if not GameConfig.is_mobile:
		# Desktop keeps the touch layer hidden but usable for testing.
		touch.enabled = true
	pause_menu = PauseMenu.new()
	pause_menu.name = "PauseMenu"
	ui_root.add_child(pause_menu)
	pause_menu.bind(touch, false)
	pause_menu.resume_requested.connect(_resume)
	pause_menu.leave_requested.connect(request_leave)
	results = ResultsScreen.new()
	results.name = "Results"
	ui_root.add_child(results)
	results.rematch_requested.connect(_rematch)
	results.menu_requested.connect(request_leave)
	router = InputRouter.new()
	router.name = "InputRouter"
	add_child(router)

## Starts a match from validated lobby settings.
func start_with(match_settings: Dictionary) -> GameResult:
	settings = match_settings.duplicate(true)
	match_ref = MatchManager.new()
	match_ref.name = "MatchManager"
	add_child(match_ref)
	# Sky, sun and fog come from the map, long before any chunk is streamed in.
	sun = EnvironmentBuilder.build(match_ref, str(settings.get("map", "training_base")),
		Settings.graphics)
	var configured := match_ref.configure(settings)
	if not configured.succeeded() or match_ref.world == null:
		return GameResult.fail(GameResult.Code.INVALID, configured.error_text())
	var networked := bool(settings.get("server_authoritative", false))
	match_ref.is_offline = not networked
	match_ref.is_authoritative = not networked
	var local_id := NetworkManager.local_player_id
	if local_id.is_empty():
		local_id = "local"
	var display_name := str(SaveManager.data.profile.get("display_name", "Player"))
	var local := match_ref.spawn_local_player(local_id, display_name, 1)
	match_ref.populate_from_settings()
	hud.bind(match_ref, local)
	router.bind(local, touch)
	router.mouse_captured = not GameConfig.is_mobile
	if not GameConfig.is_mobile:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	pause_menu.bind(touch, networked)
	local.died.connect(_on_local_died)
	if local.weapons != null:
		local.weapons.hit_confirmed.connect(func(_t: Node, _d: float, _h: bool) -> void:
			if match_ref != null:
				match_ref.record_damage(int(_d)))
	match_ref.match_ended.connect(_on_match_ended)
	if networked:
		NetworkManager.snapshot_received.connect(_on_snapshot_received)
	AudioDirector.play_music("music_match")
	return GameResult.ok()

# ------------------------------------------------------------------- input
func _input(event: InputEvent) -> void:
	if event.is_action_pressed("pause") and pause_enabled and match != null and match_ref.phase != MatchManager.Phase.ENDED:
		_toggle_pause()
		get_viewport().set_input_as_handled()
	elif event.is_action_pressed("scoreboard"):
		pass

func _process(delta: float) -> void:
	if match_ref == null:
		return
	if _paused:
		return
	if _spectate_active:
		match_ref.spectate_update(delta)

func _toggle_pause() -> void:
	if _paused:
		_resume()
	else:
		_pause()

func _pause() -> void:
	_paused = true
	get_tree().paused = true
	pause_menu.open()
	if router != null:
		router.mouse_captured = false
	if not GameConfig.is_mobile:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

func _resume() -> void:
	_paused = false
	get_tree().paused = false
	pause_menu.close()
	if router != null:
		router.mouse_captured = not GameConfig.is_mobile
	if not GameConfig.is_mobile:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _on_snapshot_received(payload: Dictionary) -> void:
	if match_ref != null:
		match_ref.apply_snapshot(payload)

# ------------------------------------------------------------------- results
func _on_local_died(_killer_id: String, _weapon_id: String) -> void:
	_spectate_active = bool(match_ref.mode_data.get("spectate", true))
	hud.set_dead(_spectate_active)
	if not _spectate_active:
		# Modes without spectating (for example Training Ground) respawn instead.
		var delay := float(match_ref.mode_data.get("respawn_delay_s", 3.0))
		if bool(match_ref.mode_data.get("respawn", false)):
			match_ref.request_respawn(match_ref.local_player, delay)

func _on_match_ended(summary: Dictionary) -> void:
	_summary = summary
	_rewards = _compute_rewards(summary)
	get_tree().paused = false
	_paused = false
	_spectate_active = false
	pause_enabled = false
	results.show_result(summary, _rewards)
	if router != null:
		router.mouse_captured = false
	if not GameConfig.is_mobile:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	finished.emit(summary)

## Rewards are computed from the same economy rules used when saving progress.
func _compute_rewards(summary: Dictionary) -> Dictionary:
	if not match_ref.is_offline:
		return {}
	return Economy.compute_match_reward(summary)

func _rematch() -> void:
	results.hide_result()
	request_leave(true)

func request_leave(rematch: bool = false) -> void:
	_leave_on_finish = rematch
	get_tree().paused = false
	if router != null:
		router.mouse_captured = false
	if not GameConfig.is_mobile:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	if match_ref != null:
		match_ref.shutdown()
	if rematch:
		GameRouter.goto_match(settings.duplicate(true))
	else:
		GameRouter.goto_menu()

## Networked play is not part of this build; the match is always local.
func is_networked() -> bool:
	return bool(settings.get("server_authoritative", false))
