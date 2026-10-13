extends Node
## Lobby - mode selection, matchmaking flow and scene launching.
##
## Offline play always works (bots fill the lobby), LAN play uses NetworkManager,
## and internet play only proceeds when a server has actually been configured.

signal mode_changed(mode_id: String, variant_id: String)
signal map_changed(map_id: String)
signal match_launching(settings: Dictionary)
signal room_changed(room: Dictionary)
signal matchmaking_status(text: String, progress: float)
signal error(message: String)

const MATCH_SCENE := "res://scenes/match.tscn"
const MENU_SCENE := "res://scenes/menus/main_menu.tscn"

var selected_mode: String = "br"
var selected_variant: String = "squad"
var selected_map: String = "emerald_island"
var pending_settings: Dictionary = {}
var searching: bool = false
var search_elapsed: float = 0.0

var _router: Node = null

func _ready() -> void:
	selected_mode = str(SaveManager.data.flags.get("selected_mode", "br"))
	selected_variant = str(SaveManager.data.flags.get("selected_variant", "squad"))
	selected_map = str(SaveManager.data.flags.get("selected_map",
		ContentDB.default_map_for_mode(selected_mode)))
	NetworkManager.room_updated.connect(_on_room_updated)

func set_router(router: Node) -> void:
	_router = router

func set_mode(mode_id: String, variant_id: String = "") -> void:
	if ContentDB.mode(mode_id).is_empty():
		return
	selected_mode = mode_id
	var variants: Array = ContentDB.mode_variants(mode_id)
	var resolved_variant := variant_id
	if resolved_variant.is_empty() and not variants.is_empty():
		resolved_variant = str((variants[0] as Dictionary).get("id", ""))
	var valid := false
	for entry: Variant in variants:
		if str((entry as Dictionary).get("id", "")) == resolved_variant:
			valid = true
	selected_variant = resolved_variant if valid else ""
	if ContentDB.map_data(selected_map).is_empty() \
			or not selected_mode in ContentDB.map_data(selected_map).get("mode_tags", []):
		selected_map = ContentDB.default_map_for_mode(mode_id)
	SaveManager.data.flags["selected_mode"] = selected_mode
	SaveManager.data.flags["selected_variant"] = selected_variant
	SaveManager.data.flags["selected_map"] = selected_map
	SaveManager.mark_dirty()
	mode_changed.emit(selected_mode, selected_variant)

func set_map(map_id: String) -> void:
	if ContentDB.map_data(map_id).is_empty():
		return
	selected_map = map_id
	SaveManager.data.flags["selected_map"] = map_id
	SaveManager.mark_dirty()
	map_changed.emit(map_id)

## Settings for the currently selected mode (offline).
func current_settings(extra: Dictionary = {}) -> Dictionary:
	var options: Dictionary = {"bots_allowed": true, "server_authoritative": false}
	options.merge(extra, true)
	return MatchConfig.build(selected_mode, selected_variant, selected_map, 1, options)

func mode_display_name() -> String:
	var mode: Dictionary = ContentDB.mode(selected_mode)
	var name := str(mode.get("name", selected_mode))
	for entry: Variant in mode.get("variants", []):
		if str((entry as Dictionary).get("id", "")) == selected_variant:
			name += " - " + str((entry as Dictionary).get("name", selected_variant))
	return name

# ---------------------------------------------------------------- offline play
## Starts a match right now with bots filling the remaining slots.
func start_offline_match(human_players: int = 1, bot_count: int = -1) -> GameResult:
	var settings := current_settings()
	var slots: int = MatchConfig.slot_count(settings)
	if settings.get("mode", "") == "br":
		slots = int(settings.get("max_players", 32))
	var bots := bot_count
	if bots < 0:
		bots = _default_bot_count(settings, human_players, slots)
	settings["player_count"] = human_players + bots
	settings["bot_count"] = bots
	settings["human_players"] = human_players
	settings["server_authoritative"] = false
	var check := MatchConfig.validate(settings)
	if not check.succeeded():
		error.emit(check.error_text())
		return check
	searching = false
	launch(settings)
	return GameResult.ok(settings)

func _default_bot_count(settings: Dictionary, humans: int, slots: int) -> int:
	match str(settings.get("mode", "br")):
		"br":
			return clampi(slots - humans, 0, 31)
		"clash":
			return maxi(0, 8 - humans)
		"arena":
			return maxi(0, 4 - humans)
		"training":
			return 3
	return 0

func start_training(bot_count: int = 3, difficulty: String = "normal") -> GameResult:
	var previous := selected_mode
	selected_mode = "training"
	var result := start_offline_match(1, bot_count) if difficulty.is_empty() \
		else _start_training_with(difficulty, bot_count)
	selected_mode = previous
	return result

func _start_training_with(difficulty: String, bot_count: int) -> GameResult:
	var settings := MatchConfig.build("training", "", "training_base", 1 + bot_count,
		{"bot_difficulty": difficulty, "bots_allowed": true})
	settings["bot_count"] = bot_count
	settings["human_players"] = 1
	var check := MatchConfig.validate(settings)
	if not check.succeeded():
		error.emit(check.error_text())
		return check
	launch(settings)
	return GameResult.ok(settings)

## Simulated quick-match search for offline play, used by the "Find Match" button.
func find_match_offline() -> void:
	searching = true
	search_elapsed = 0.0
	matchmaking_status.emit("Searching for players", 0.0)
	var tween := create_tween()
	tween.tween_method(_report_search_progress, 0.0, 1.0, 2.2)
	tween.tween_callback(_finish_search)

func _report_search_progress(value: float) -> void:
	if not searching:
		return
	search_elapsed = value * 2.2
	matchmaking_status.emit("Searching for players (%d bots available)" % _default_bot_count(
		current_settings(), 1, 8), value)

func _finish_search() -> void:
	if not searching:
		return
	searching = false
	matchmaking_status.emit("Found a match", 1.0)
	start_offline_match()

func cancel_search() -> void:
	searching = false
	matchmaking_status.emit("", 0.0)

# --------------------------------------------------------------- rooms / LAN
func create_room(options: Dictionary) -> GameResult:
	var settings := current_settings(options)
	settings["name"] = str(options.get("name", "%s's Room" % SaveManager.data.profile.get("display_name", "Player")))
	settings["private"] = bool(options.get("private", false))
	settings["password"] = str(options.get("password", ""))
	settings["max_players"] = int(options.get("max_players", MatchConfig.slot_count(settings)))
	settings["bot_difficulty"] = str(options.get("bot_difficulty", "normal"))
	if bool(options.get("internet", false)):
		var hosted := NetworkManager.host_internet(GameConfig.NET["default_port"], settings)
		if not hosted.succeeded():
			error.emit(hosted.error_text())
			return hosted
		return GameResult.ok(hosted.data)
	var hosted_lan := NetworkManager.host_lan(GameConfig.NET["default_port"], settings)
	if not hosted_lan.succeeded():
		error.emit(hosted_lan.error_text())
		return hosted_lan
	return GameResult.ok(hosted_lan.data)

func join_lan(ip: String, port: int) -> GameResult:
	var joined := NetworkManager.join_lan(ip, port)
	if not joined.succeeded():
		error.emit(joined.error_text())
	return joined

func join_room_code(code: String, password: String = "") -> GameResult:
	var info := NetworkManager.find_room_by_code(code)
	if info.is_empty():
		var message := "No room found with code %s on this network" % code.to_upper()
		error.emit(message)
		return GameResult.fail(GameResult.Code.INVALID, message)
	if bool(info.get("private", false)) and password.is_empty():
		var locked := "Room %s is private - enter its password" % code.to_upper()
		error.emit(locked)
		return GameResult.fail(GameResult.Code.WRONG_PASSWORD, locked)
	return join_lan(str(info.get("ip", "")), GameConfig.NET["default_port"])

## Host starts the match for everyone in the room.
func start_room_match() -> GameResult:
	if not NetworkManager.is_server():
		var waiting := "Only the host can start this match"
		error.emit(waiting)
		return GameResult.fail(GameResult.Code.UNAUTHORIZED, waiting)
	var settings := current_settings()
	var room: Dictionary = NetworkManager.room
	settings["mode"] = str(room.get("mode", settings.get("mode", "br")))
	settings["variant"] = str(room.get("variant", settings.get("variant", "")))
	settings["map"] = str(room.get("map", settings.get("map", "emerald_island")))
	settings["room_code"] = str(room.get("code", ""))
	var humans: int = (room.get("players", {}) as Dictionary).size()
	var slots: int = MatchConfig.slot_count(settings)
	var bots: int = int(room.get("bot_fill", 0))
	if bots > 0:
		settings["bot_count"] = mini(bots, maxi(0, slots - humans))
	settings["player_count"] = humans + int(settings.get("bot_count", 0))
	var started := NetworkManager.start_match_as_host(settings)
	if not started.succeeded():
		error.emit(started.error_text())
		return started
	launch(settings)
	return GameResult.ok(settings)

## Called by NetworkManager when the host broadcasts a match start.
func begin_networked_match(settings: Dictionary) -> void:
	launch(settings)

func leave_room() -> void:
	NetworkManager.leave_session()
	room_changed.emit({})

func _on_room_updated(room: Dictionary) -> void:
	room_changed.emit(room)

func room_is_ready() -> bool:
	var room: Dictionary = NetworkManager.room
	var players: Dictionary = room.get("players", {})
	if players.is_empty():
		return false
	for id: Variant in players.keys():
		if not bool((players[id] as Dictionary).get("ready", false)):
			return false
	return true

# ---------------------------------------------------------------- navigation
func launch(settings: Dictionary) -> void:
	pending_settings = settings
	match_launching.emit(settings)
	if _router != null and _router.has_method("goto_match"):
		_router.call("goto_match", settings)
	else:
		push_warning("Lobby: no scene router registered; falling back to change_scene_to_file")
		get_tree().change_scene_to_file(MATCH_SCENE)

func go_to_menu() -> void:
	if _router != null and _router.has_method("goto_menu"):
		_router.call("goto_menu")
	else:
		get_tree().change_scene_to_file(MENU_SCENE)

func go_to(scene_path: String) -> void:
	if _router != null and _router.has_method("goto"):
		_router.call("goto", scene_path)
