class_name MainMenu
extends Control
## Title screen: play, modes, loadout, shop, settings, profile and quit.
##
## Buttons only exist for things that work in this build.  Features from later
## phases are listed in a clearly labelled "coming next" panel instead of being
## fake buttons, which keeps the promise that nothing in the UI lies.

var _content: HBoxContainer
var _status: Label
var _profile_panel: VBoxContainer
var _mode_list: VBoxContainer

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	UiKit.apply_theme(self)
	_build()
	Settings.settings_changed.connect(_refresh)
	Economy.balance_changed.connect(_refresh)
	Progression.rank_changed.connect(_refresh)

func _build() -> void:
	add_child(_background())
	var root := UiKit.hbox(20)
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.offset_left = 48
	root.offset_top = 48
	root.offset_right = -48
	root.offset_bottom = -48
	add_child(root)

	var left := UiKit.vbox(16)
	left.custom_minimum_size = Vector2(560, 0)
	root.add_child(left)
	left.add_child(UiKit.title("BLOCKSTRIKE ROYALE", UiKit.FONT_HUGE))
	left.add_child(UiKit.text("Voxel battle royale - built for Android touch",
		UiKit.FONT_BODY, UiKit.TEXT_DIM))
	left.add_child(UiKit.spacer(10, true))

	var play_row := UiKit.hbox(12)
	play_row.add_child(UiKit.button("Find Match", _on_find_match, true, 280.0))
	play_row.add_child(UiKit.button("Training Ground", _on_training, false, 280.0))
	left.add_child(play_row)

	left.add_child(UiKit.button("Battle Royale (vs bots)", func() -> void: _play("br"), false, 380.0))
	left.add_child(UiKit.button("Clash Squad 4v4 (vs bots)", func() -> void: _play("clash"), false, 380.0))
	left.add_child(UiKit.button("2v2 Arena (vs bots)", func() -> void: _play("arena"), false, 380.0))

	var second_row := UiKit.hbox(12)
	second_row.add_child(UiKit.button("Loadout", _on_loadout, false, 180.0))
	second_row.add_child(UiKit.button("Shop", _on_shop, false, 180.0))
	second_row.add_child(UiKit.button("Settings", _on_settings, false, 180.0))
	left.add_child(second_row)
	left.add_child(UiKit.button("Quit", _on_quit, false, 180.0))

	left.add_child(UiKit.spacer(6, true))
	_status = UiKit.text("", UiKit.FONT_SMALL, UiKit.TEXT_DIM)
	left.add_child(_status)
	Lobby.matchmaking_status.connect(_on_matchmaking_status)
	Lobby.error.connect(_on_lobby_error)

	var right := UiKit.vbox(14)
	right.custom_minimum_size = Vector2(460, 0)
	root.add_child(right)
	var profile := UiKit.panel()
	right.add_child(profile)
	_profile_panel = UiKit.vbox(8)
	profile.add_child(_profile_panel)

	var phase_panel := UiKit.panel(UiKit.BG_PANEL_SOFT)
	right.add_child(phase_panel)
	_mode_list = UiKit.vbox(6)
	phase_panel.add_child(_mode_list)

	_refresh()

func _background() -> ColorRect:
	var rect := ColorRect.new()
	rect.color = UiKit.BG_DEEP
	rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return rect

func _refresh() -> void:
	if _profile_panel == null:
		return
	for child: Node in _profile_panel.get_children():
		child.queue_free()
	var profile: Dictionary = SaveManager.data.profile
	var rank: Dictionary = Progression.current_rank()
	_profile_panel.add_child(UiKit.title(str(profile.get("display_name", "Player")),
		UiKit.FONT_TITLE))
	_profile_panel.add_child(UiKit.text("Level %d - %s" % [Progression.level(),
		str(rank.get("name", "Unranked"))], UiKit.FONT_BODY, UiKit.ACCENT))
	var coins := UiKit.hbox(10)
	coins.add_child(UiKit.currency_label(Economy.coins(), "coins"))
	coins.add_child(UiKit.currency_label(Economy.gems(), "gems"))
	_profile_panel.add_child(coins)
	var stats: Dictionary = Progression.stats()
	_profile_panel.add_child(UiKit.text("Matches %d - Wins %d - Elims %d" % [
		int(stats.get("matches", 0)), int(stats.get("wins", 0)),
		int(stats.get("eliminations", 0))], UiKit.FONT_SMALL, UiKit.TEXT_DIM))
	_profile_panel.add_child(UiKit.text("Graphics: %s - %d FPS target" % [
		str(Settings.graphics.get("preset", "medium")).capitalize(),
		int(Settings.graphics_value("fps_target", 60))], UiKit.FONT_SMALL, UiKit.TEXT_DIM))

	for child: Node in _mode_list.get_children():
		child.queue_free()
	_mode_list.add_child(UiKit.title("Modes", UiKit.FONT_TITLE))
	for mode_id: String in ContentDB.mode_ids():
		var mode := ContentDB.mode(mode_id)
		var button := UiKit.button("%s - %s" % [str(mode.get("name", mode_id)),
			str(mode.get("description", ""))], func() -> void: _play(mode_id), false, 420.0)
		_mode_list.add_child(button)
	_mode_list.add_child(UiKit.title("Coming next", UiKit.FONT_BODY))
	_mode_list.add_child(UiKit.text("LAN + internet matches, custom rooms, missions, " \
		+ "ranked and the shop screens arrive in the multiplayer and meta phases.",
		UiKit.FONT_SMALL, UiKit.TEXT_DIM))

func _play(mode_id: String) -> void:
	Lobby.set_mode(mode_id)
	var result := Lobby.start_offline_match()
	if not result.succeeded():
		_set_status(result.error_text())

func _on_find_match() -> void:
	Lobby.start_offline_match()

func _on_training() -> void:
	var difficulty := str(Settings.controls.get("bot_difficulty", "normal"))
	var result := Lobby.start_training(3, difficulty)
	if not result.succeeded():
		_set_status(result.error_text())

func _on_loadout() -> void:
	GameRouter.goto("res://scenes/menus/loadout.tscn")

func _on_shop() -> void:
	GameRouter.goto("res://scenes/menus/shop.tscn")

func _on_settings() -> void:
	GameRouter.goto("res://scenes/menus/settings.tscn")

func _on_quit() -> void:
	Settings.persist()
	get_tree().quit()

func _on_matchmaking_status(text: String, progress: float) -> void:
	if text.is_empty():
		_set_status("")
		return
	_set_status("%s  %d%%" % [text, int(progress * 100.0)])

func _on_lobby_error(message: String) -> void:
	_set_status(message)

func _set_status(text: String) -> void:
	if _status != null:
		_status.text = text
