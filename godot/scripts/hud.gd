extends CanvasLayer
## Professional landscape HUD and menu shell. All controls are generated with native Godot
## controls so Android can theme and scale them without external UI dependencies.

const VirtualJoystickControl = preload("res://scripts/virtual_joystick.gd")
const LookPadControl = preload("res://scripts/look_pad.gd")
const MinimapControl = preload("res://scripts/minimap.gd")

var main
var root: Control
var menu_layer: Control
var match_layer: Control
var modal_layer: Control
var toast_label: Label
var mode_buttons: Dictionary = {}
var selected_mode := "battle_royale"
var minimap
var joystick
var look_pad
var health_bar: ProgressBar
var armor_bar: ProgressBar
var health_label: Label
var armor_label: Label
var ammo_label: Label
var weapon_label: Label
var alive_label: Label
var timer_label: Label
var zone_label: Label
var feed_label: Label
var result_panel: PanelContainer
var result_title: Label
var result_body: Label
var pause_panel: PanelContainer
var crouch_active := false
var menu_status: Label

func _ready() -> void:
	# Main calls setup after adding this CanvasLayer. Keeping _ready light avoids a race with autoloads.
	pass

func setup(main_ref: Node) -> void:
	main = main_ref
	_build_root()
	_build_menu()
	_build_match_hud()
	GameState.toast_requested.connect(_on_game_toast)
	NetworkManager.status_changed.connect(_on_network_status)
	show_menu()

func _build_root() -> void:
	root = Control.new()
	root.name = "HUDRoot"
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_PASS
	add_child(root)
	menu_layer = Control.new()
	menu_layer.name = "MenuLayer"
	menu_layer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.add_child(menu_layer)
	match_layer = Control.new()
	match_layer.name = "MatchLayer"
	match_layer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	match_layer.visible = false
	root.add_child(match_layer)
	modal_layer = Control.new()
	modal_layer.name = "ModalLayer"
	modal_layer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	modal_layer.visible = false
	root.add_child(modal_layer)
	toast_label = _label(root, "", 18, Color("#e8fff9"))
	toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	toast_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	toast_label.position = Vector2(-210, 78)
	toast_label.size = Vector2(420, 46)
	toast_label.visible = false
	toast_label.add_theme_stylebox_override("normal", _panel_style(Color(0.03, 0.09, 0.14, 0.94), Color("#39d6c2"), 14, 2))

func _build_menu() -> void:
	var background := ColorRect.new()
	background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	background.color = Color("#07101f")
	menu_layer.add_child(background)
	# Decorative voxel skyline.
	for i in range(12):
		var block := ColorRect.new()
		block.color = Color(0.08 + float(i % 3) * 0.025, 0.17 + float(i % 2) * 0.02, 0.24, 0.72)
		block.position = Vector2(30 + i * 110, 400 + (i % 4) * 18)
		block.size = Vector2(76, 260 - (i % 4) * 22)
		block.mouse_filter = Control.MOUSE_FILTER_IGNORE
		menu_layer.add_child(block)
	var glow := ColorRect.new()
	glow.color = Color(0.1, 0.7, 0.62, 0.06)
	glow.set_anchors_preset(Control.PRESET_FULL_RECT)
	glow.mouse_filter = Control.MOUSE_FILTER_IGNORE
	menu_layer.add_child(glow)
	var panel := PanelContainer.new()
	panel.name = "MainMenuPanel"
	panel.set_anchors_preset(Control.PRESET_CENTER)
	panel.position = Vector2(-500, -275)
	panel.size = Vector2(1000, 550)
	panel.add_theme_stylebox_override("panel", _panel_style(Color(0.025, 0.07, 0.12, 0.96), Color("#20495a"), 24, 2))
	menu_layer.add_child(panel)
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 36)
	margin.add_theme_constant_override("margin_right", 36)
	margin.add_theme_constant_override("margin_top", 28)
	margin.add_theme_constant_override("margin_bottom", 28)
	panel.add_child(margin)
	var columns := HBoxContainer.new()
	columns.add_theme_constant_override("separation", 42)
	margin.add_child(columns)
	var left := VBoxContainer.new()
	left.custom_minimum_size = Vector2(390, 0)
	left.add_theme_constant_override("separation", 10)
	columns.add_child(left)
	var logo := _label(left, "BLOCKSTRIKE", 42, Color("#e9fff8"))
	logo.add_theme_color_override("font_shadow_color", Color("#1fb79e"))
	logo.add_theme_constant_override("shadow_offset_x", 3)
	logo.add_theme_constant_override("shadow_offset_y", 3)
	var royale := _label(left, "ROYALE", 23, Color("#ffd166"))
	royale.add_theme_constant_override("outline_size", 8)
	royale.add_theme_color_override("font_outline_color", Color("#101d38"))
	var subtitle := _label(left, "DROP IN. BUILD UP. STAND OUT.", 13, Color("#8ca8b2"))
	subtitle.add_theme_constant_override("outline_size", 2)
	var gap := Control.new()
	gap.custom_minimum_size.y = 17
	left.add_child(gap)
	var selected := _label(left, "SELECT OPERATION", 12, Color("#70a6a5"))
	selected.add_theme_constant_override("letter_spacing", 2)
	var mode_row := HBoxContainer.new()
	mode_row.add_theme_constant_override("separation", 7)
	left.add_child(mode_row)
	for mode_id in ["battle_royale", "clash_squad", "arena_2v2", "training"]:
		var mode: Dictionary = GameState.get_mode(mode_id)
		var b := _button(mode_row, mode.label, Callable(self, "_select_mode").bind(mode_id), Vector2(0, 52), 12)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		mode_buttons[mode_id] = b
	var play := _button(left, "DROP IN  ▶", func(): _play_selected(), Vector2(0, 64), 23)
	play.add_theme_stylebox_override("normal", _panel_style(Color("#1f9f88"), Color("#72ffe2"), 14, 2))
	play.add_theme_stylebox_override("hover", _panel_style(Color("#2bc8aa"), Color("#d8fff8"), 14, 2))
	var quick := _label(left, "OFFLINE PROTOTYPE  •  8 BOTS  •  1 AUTHORED MAP", 11, Color("#8ca8b2"))
	quick.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	menu_status = quick
	var right := VBoxContainer.new()
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.add_theme_constant_override("separation", 10)
	columns.add_child(right)
	var header := _label(right, "OPERATIONS CONSOLE", 18, Color("#b8fff0"))
	var desc := _label(right, "A playable voxel combat sandbox built for\nlandscape Android controls.", 14, Color("#9bb6bd"))
	desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var info := PanelContainer.new()
	info.custom_minimum_size.y = 92
	info.add_theme_stylebox_override("panel", _panel_style(Color(0.08, 0.18, 0.23, 0.84), Color("#245866"), 14, 1))
	right.add_child(info)
	var info_margin := MarginContainer.new()
	info_margin.add_theme_constant_override("margin_left", 16)
	info_margin.add_theme_constant_override("margin_top", 10)
	info_margin.add_theme_constant_override("margin_right", 16)
	info_margin.add_theme_constant_override("margin_bottom", 10)
	info.add_child(info_margin)
	var info_text := _label(info_margin, "32-player Battle Royale rules are authored for\noffline bot practice. LAN transport is available\nfrom Rooms; internet matchmaking needs a server.", 13, Color("#c1d9d9"))
	info_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var nav_grid := GridContainer.new()
	nav_grid.columns = 3
	nav_grid.add_theme_constant_override("h_separation", 8)
	nav_grid.add_theme_constant_override("v_separation", 8)
	right.add_child(nav_grid)
	_add_nav_button(nav_grid, "ROOMS", "rooms")
	_add_nav_button(nav_grid, "SHOP", "shop")
	_add_nav_button(nav_grid, "INVENTORY", "inventory")
	_add_nav_button(nav_grid, "MISSIONS", "missions")
	_add_nav_button(nav_grid, "RANKED", "ranked")
	_add_nav_button(nav_grid, "FRIENDS", "friends")
	_add_nav_button(nav_grid, "SETTINGS", "settings")
	var footer := _label(right, "v0.1  •  ANDROID / DESKTOP  •  ORIGINAL PROCEDURAL ART", 10, Color("#59767e"))
	footer.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	footer.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_update_mode_buttons()

func _add_nav_button(parent: Container, label_text: String, panel_id: String) -> void:
	var b := _button(parent, label_text, func(): open_menu_panel(panel_id), Vector2(0, 45), 12)
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL

func _build_match_hud() -> void:
	# A transparent touch pad sits behind action controls.
	look_pad = LookPadControl.new()
	look_pad.name = "CameraLookPad"
	look_pad.set_anchors_preset(Control.PRESET_CENTER_RIGHT)
	look_pad.position = Vector2(-640, 0)
	look_pad.size = Vector2(640, 720)
	look_pad.mouse_filter = Control.MOUSE_FILTER_STOP
	match_layer.add_child(look_pad)
	look_pad.look_changed.connect(_on_look_changed)
	# Header
	var header := PanelContainer.new()
	header.set_anchors_preset(Control.PRESET_TOP_WIDE)
	header.offset_bottom = 72
	header.add_theme_stylebox_override("panel", _panel_style(Color(0.02, 0.06, 0.1, 0.78), Color(0.12, 0.32, 0.36, 0.5), 0, 0))
	match_layer.add_child(header)
	var hm := MarginContainer.new()
	hm.add_theme_constant_override("margin_left", 22)
	hm.add_theme_constant_override("margin_right", 22)
	hm.add_theme_constant_override("margin_top", 10)
	hm.add_theme_constant_override("margin_bottom", 10)
	header.add_child(hm)
	var hrow := HBoxContainer.new()
	hrow.add_theme_constant_override("separation", 18)
	hm.add_child(hrow)
	var mode_label := _label(hrow, "BATTLE ROYALE", 17, Color("#d9fff7"))
	mode_label.name = "ModeLabel"
	alive_label = _label(hrow, "ALIVE  09", 15, Color("#ffd166"))
	timer_label = _label(hrow, "02:59", 15, Color("#f2f7f5"))
	zone_label = _label(hrow, "ZONE  1:45", 14, Color("#7dffe1"))
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hrow.add_child(spacer)
	weapon_label = _label(hrow, "AR-7 PULSE", 14, Color("#a8c5ff"))
	ammo_label = _label(hrow, "30 / 120", 22, Color("#ffffff"))
	var pause := _button(hrow, "Ⅱ", func(): main.pause_match(), Vector2(50, 42), 18)
	pause.tooltip_text = "Pause"
	# minimap
	minimap = MinimapControl.new()
	minimap.name = "Minimap"
	minimap.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	minimap.position = Vector2(-190, 82)
	minimap.size = Vector2(170, 170)
	match_layer.add_child(minimap)
	# Crosshair
	var crosshair := _label(match_layer, "＋", 29, Color(0.86, 1.0, 0.94, 0.9))
	crosshair.set_anchors_preset(Control.PRESET_CENTER)
	crosshair.position = Vector2(-18, -30)
	crosshair.size = Vector2(36, 36)
	crosshair.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	crosshair.mouse_filter = Control.MOUSE_FILTER_IGNORE
	# Left stick
	joystick = VirtualJoystickControl.new()
	joystick.name = "MoveJoystick"
	joystick.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	joystick.position = Vector2(28, -224)
	joystick.size = Vector2(190, 190)
	match_layer.add_child(joystick)
	joystick.value_changed.connect(_on_move_changed)
	# status bars
	var status := PanelContainer.new()
	status.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	status.position = Vector2(-180, -88)
	status.size = Vector2(360, 70)
	status.add_theme_stylebox_override("panel", _panel_style(Color(0.02, 0.06, 0.1, 0.84), Color("#285260"), 15, 1))
	match_layer.add_child(status)
	var sm := MarginContainer.new()
	sm.add_theme_constant_override("margin_left", 15)
	sm.add_theme_constant_override("margin_right", 15)
	sm.add_theme_constant_override("margin_top", 9)
	sm.add_theme_constant_override("margin_bottom", 9)
	status.add_child(sm)
	var sv := VBoxContainer.new()
	sv.add_theme_constant_override("separation", 4)
	sm.add_child(sv)
	health_label = _label(sv, "HP 100", 12, Color("#ff938b"))
	health_bar = _bar(sv, Color("#ff5f63"))
	armor_label = _label(sv, "ARMOR 50", 11, Color("#84c8ff"))
	armor_bar = _bar(sv, Color("#3987ff"))
	# Actions. Buttons are intentionally large and spaced for thumbs.
	var fire := _action_button("FIRE", Vector2(-190, -230), Vector2(125, 125), Color("#df5f63"))
	_hold(fire, func(): _set_fire(true), func(): _set_fire(false))
	var aim := _action_button("AIM", Vector2(-330, -170), Vector2(82, 70), Color("#4f75b4"))
	_hold(aim, func(): _set_aim(true), func(): _set_aim(false))
	var jump := _action_button("JUMP", Vector2(-320, -87), Vector2(82, 64), Color("#4d9b83"))
	jump.pressed.connect(func(): _call_player("request_mobile_jump"))
	var crouch := _action_button("CROUCH", Vector2(-232, -87), Vector2(82, 64), Color("#596e8d"))
	crouch.pressed.connect(_toggle_crouch)
	var reload := _action_button("RELOAD", Vector2(-205, -150), Vector2(94, 55), Color("#536b7a"))
	reload.pressed.connect(func(): _call_player("request_mobile_reload"))
	var interact := _action_button("INTERACT", Vector2(-100, -150), Vector2(94, 55), Color("#b07a4e"))
	interact.pressed.connect(func(): _call_player("request_mobile_interact"))
	var swap := _action_button("SWAP", Vector2(-100, -88), Vector2(94, 55), Color("#735f96"))
	swap.pressed.connect(func(): _call_player("request_mobile_swap"))
	var build := _action_button("BUILD", Vector2(-205, -88), Vector2(94, 55), Color("#6b8d6c"))
	build.pressed.connect(func(): _call_player("request_mobile_build"))
	feed_label = _label(match_layer, "", 13, Color("#ffd8a3"))
	feed_label.set_anchors_preset(Control.PRESET_TOP_LEFT)
	feed_label.position = Vector2(22, 94)
	feed_label.size = Vector2(300, 120)
	feed_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	feed_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	# Result card is above gameplay and hidden until the match ends.
	result_panel = PanelContainer.new()
	result_panel.set_anchors_preset(Control.PRESET_CENTER)
	result_panel.position = Vector2(-250, -180)
	result_panel.size = Vector2(500, 360)
	result_panel.add_theme_stylebox_override("panel", _panel_style(Color(0.025, 0.08, 0.12, 0.98), Color("#45d9c1"), 22, 2))
	result_panel.visible = false
	match_layer.add_child(result_panel)
	var rm := MarginContainer.new()
	rm.add_theme_constant_override("margin_left", 30)
	rm.add_theme_constant_override("margin_right", 30)
	rm.add_theme_constant_override("margin_top", 26)
	rm.add_theme_constant_override("margin_bottom", 24)
	result_panel.add_child(rm)
	var rv := VBoxContainer.new()
	rv.alignment = BoxContainer.ALIGNMENT_CENTER
	rv.add_theme_constant_override("separation", 12)
	rm.add_child(rv)
	result_title = _label(rv, "MATCH COMPLETE", 30, Color("#e9fff8"))
	result_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	result_body = _label(rv, "", 15, Color("#bcd7d5"))
	result_body.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	result_body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var again := _button(rv, "PLAY AGAIN", func(): main.start_match(selected_mode), Vector2(0, 56), 17)
	again.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var back := _button(rv, "RETURN TO OPERATIONS", func(): main.return_to_menu(), Vector2(0, 48), 13)
	back.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	# Pause card stays in the match layer and works while the scene tree is paused.
	pause_panel = PanelContainer.new()
	pause_panel.set_anchors_preset(Control.PRESET_CENTER)
	pause_panel.position = Vector2(-210, -135)
	pause_panel.size = Vector2(420, 270)
	pause_panel.add_theme_stylebox_override("panel", _panel_style(Color(0.025, 0.08, 0.12, 0.98), Color("#63859a"), 20, 2))
	pause_panel.visible = false
	match_layer.add_child(pause_panel)
	var pm := MarginContainer.new()
	pm.add_theme_constant_override("margin_left", 28)
	pm.add_theme_constant_override("margin_right", 28)
	pm.add_theme_constant_override("margin_top", 25)
	pm.add_theme_constant_override("margin_bottom", 24)
	pause_panel.add_child(pm)
	var pv := VBoxContainer.new()
	pv.alignment = BoxContainer.ALIGNMENT_CENTER
	pv.add_theme_constant_override("separation", 12)
	pm.add_child(pv)
	var pause_title := _label(pv, "MATCH PAUSED", 25, Color("#e9fff8"))
	pause_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var resume := _button(pv, "RESUME", func(): main.pause_match(), Vector2(0, 50), 15)
	resume.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var quit := _button(pv, "QUIT TO OPERATIONS", func(): main.return_to_menu(), Vector2(0, 44), 12)
	quit.size_flags_horizontal = Control.SIZE_EXPAND_FILL

func show_menu() -> void:
	menu_layer.visible = true
	match_layer.visible = false
	modal_layer.visible = false
	if is_instance_valid(result_panel):
		result_panel.visible = false
	if is_instance_valid(pause_panel):
		pause_panel.visible = false
	_update_mode_buttons()

func set_paused(value: bool) -> void:
	if is_instance_valid(pause_panel):
		pause_panel.visible = value

func show_match(mode_id: String) -> void:
	selected_mode = mode_id
	menu_layer.visible = false
	modal_layer.visible = false
	match_layer.visible = true
	result_panel.visible = false
	var mode: Dictionary = GameState.get_mode(mode_id)
	var top_bar = match_layer.get_child(1)
	if top_bar != null:
		var mode_label = top_bar.get_node_or_null("MarginContainer/HBoxContainer/ModeLabel")
		if mode_label:
			mode_label.text = mode.label.to_upper()
	feed_label.text = "DROP COMPLETE\nStay inside the mint ring. Build cover with B."

func show_result(won: bool, eliminations: int, duration: float) -> void:
	result_panel.visible = true
	result_title.text = "VICTORY ROYALE" if won else "SQUAD ELIMINATED"
	result_title.add_theme_color_override("font_color", Color("#ffd166") if won else Color("#ff8b85"))
	result_body.text = "%s\nELIMINATIONS  %02d\nMATCH TIME  %s\n\nRewards are saved locally." % ["TOP OF THE DROP" if won else "THE ZONE MOVES ON", eliminations, _format_time(duration)]

func update_match_info(seconds_left: float, alive: int, zone_seconds: float) -> void:
	if not is_instance_valid(timer_label):
		return
	timer_label.text = _format_time(seconds_left)
	alive_label.text = "ALIVE  %02d" % alive
	zone_label.text = "ZONE  %s" % _format_time(zone_seconds)

func update_stats(health: float, armor: float, ammo: int, reserve: int) -> void:
	if not is_instance_valid(health_bar):
		return
	health_bar.value = health
	armor_bar.value = armor
	health_label.text = "HP  %03d" % int(maxf(health, 0.0))
	armor_label.text = "ARMOR  %02d" % int(maxf(armor, 0.0))
	ammo_label.text = "%02d / %03d" % [ammo, reserve]

func update_weapon(name_text: String, category: String) -> void:
	if is_instance_valid(weapon_label):
		weapon_label.text = "%s  •  %s" % [name_text.to_upper(), category.to_upper()]

func update_minimap(player_position: Vector3, bot_positions: Array, zone_radius: float) -> void:
	if is_instance_valid(minimap):
		minimap.set_state(player_position, bot_positions, zone_radius)

func add_feed(message: String) -> void:
	if not is_instance_valid(feed_label):
		return
	feed_label.text = message + "\n" + feed_label.text
	var lines := feed_label.text.split("\n")
	if lines.size() > 7:
		feed_label.text = "\n".join(lines.slice(0, 7))

func show_toast(message: String, good: bool = false) -> void:
	if not is_instance_valid(toast_label):
		return
	toast_label.text = message
	toast_label.add_theme_color_override("font_color", Color("#baffed") if good else Color("#ffd4a1"))
	toast_label.visible = true
	var timer := get_tree().create_timer(2.1)
	timer.timeout.connect(func():
		if is_instance_valid(toast_label):
			toast_label.visible = false
	)

func open_menu_panel(panel_id: String) -> void:
	modal_layer.visible = true
	for child in modal_layer.get_children():
		child.queue_free()
	var backdrop := ColorRect.new()
	backdrop.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	backdrop.color = Color(0.01, 0.03, 0.06, 0.82)
	modal_layer.add_child(backdrop)
	var card := PanelContainer.new()
	card.set_anchors_preset(Control.PRESET_CENTER)
	card.position = Vector2(-370, -245)
	card.size = Vector2(740, 490)
	card.add_theme_stylebox_override("panel", _panel_style(Color("#0b1c2a"), Color("#2c7880"), 20, 2))
	modal_layer.add_child(card)
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 28)
	margin.add_theme_constant_override("margin_right", 28)
	margin.add_theme_constant_override("margin_top", 24)
	margin.add_theme_constant_override("margin_bottom", 24)
	card.add_child(margin)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 12)
	margin.add_child(col)
	var heading := HBoxContainer.new()
	col.add_child(heading)
	var title := _label(heading, panel_id.to_upper(), 27, Color("#eafff8"))
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var close := _button(heading, "CLOSE", func(): modal_layer.visible = false, Vector2(88, 40), 12)
	var body := _label(col, "", 14, Color("#b9d0d0"))
	body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_build_panel_content(panel_id, col, body)

func _build_panel_content(panel_id: String, parent: VBoxContainer, body: Label) -> void:
	if panel_id == "shop":
		body.text = "COSMETICS ONLY  •  OUTFITS, HELMETS, BACKPACKS, WEAPON FINISHES\nCombat stats are never changed by cosmetics."
		for item in GameState.COSMETICS:
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 10)
			parent.add_child(row)
			var text := _label(row, "%s   [%s]" % [item.name, item.rarity], 14, Color("#e0eeee"))
			text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			var action_text := "EQUIPPED" if item.id in GameState.profile.equipped_cosmetics else ("OWNED" if item.id in GameState.profile.owned_cosmetics else "%d %s" % [item.price, item.currency.to_upper()])
			var action := _button(row, action_text, Callable(self, "_shop_action").bind(item.id), Vector2(135, 38), 11)
	elif panel_id == "inventory":
		body.text = "LOADOUT\nTwo weapon slots, reserve ammunition, armor and medkits are functional in the prototype."
		for weapon_id in GameState.profile.owned_weapons:
			var weapon := GameState.get_weapon(weapon_id)
			var row := _label(parent, "▣  %s  •  %s  •  %d dmg  •  %d mag" % [weapon.name, weapon.category, weapon.damage, weapon.magazine], 15, weapon.color)
			row.custom_minimum_size.y = 30
	elif panel_id == "missions":
		body.text = "DAILY OPERATIONS  •  reset is local for this prototype"
		var progress: Dictionary = GameState.profile.missions
		_label(parent, "▸ Drop In  %d / 3 matches     +250 COINS" % int(progress.matches), 16, Color("#e2f7f0"))
		_label(parent, "▸ Target Practice  %d / 10 eliminations     +400 COINS" % int(progress.eliminations), 16, Color("#e2f7f0"))
		_label(parent, "▸ Zone Runner  0 / 600 seconds     +150 XP", 16, Color("#e2f7f0"))
	elif panel_id == "ranked":
		body.text = "RANKED LEAGUES\nCompetitive matchmaking is intentionally locked until an authoritative server is configured."
		var rank := _label(parent, "UNRANKED  •  Prototype Division", 25, Color("#ffd166"))
		rank.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_label(parent, "Your offline matches still grant XP, coins and achievements.\nLAN transport is experimental and does not grant ranked rating.", 14, Color("#aec8c7"))
	elif panel_id == "friends":
		body.text = "FRIENDS\nOnline accounts and invites need the production backend. Use Rooms for a local Wi-Fi experiment."
		var add := _button(parent, "COPY INVITE CODE (LOCAL ONLY)", func(): show_toast("Invite service not configured", false), Vector2(0, 48), 13)
		add.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	elif panel_id == "rooms":
		body.text = "LOCAL ROOMS\nHost or join on the same Wi-Fi network. Enter the host device's local IPv4 address.\nInternet matchmaking is not enabled in this build."
		var host := _button(parent, "HOST LAN ROOM", func(): _host_lan(), Vector2(0, 48), 14)
		host.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var ip_row := HBoxContainer.new()
		parent.add_child(ip_row)
		var ip := LineEdit.new()
		ip.name = "AddressInput"
		ip.placeholder_text = "Host IP e.g. 192.168.1.20"
		ip.custom_minimum_size = Vector2(0, 45)
		ip.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		ip_row.add_child(ip)
		var join := _button(ip_row, "JOIN", func(): _join_lan(ip.text), Vector2(110, 45), 12)
		var room_status := _label(parent, "Status: offline", 13, Color("#7dffe1"))
		room_status.name = "RoomStatus"
	elif panel_id == "settings":
		body.text = "PERFORMANCE & CONTROLS"
		var qrow := HBoxContainer.new()
		parent.add_child(qrow)
		_label(qrow, "QUALITY", 14, Color("#d9fff7"))
		for quality in ["Low", "Medium", "High"]:
			var q := _button(qrow, quality, Callable(self, "_set_quality").bind(quality), Vector2(110, 40), 12)
			q.tooltip_text = "Low: fewer effects  •  High: richer lighting"
		var sensitivity_label := _label(parent, "TOUCH SENSITIVITY  %.1f" % float(GameState.profile.settings.sensitivity), 14, Color("#b9d0d0"))
		var sensitivity_slider := HSlider.new()
		sensitivity_slider.min_value = 0.5
		sensitivity_slider.max_value = 2.0
		sensitivity_slider.step = 0.1
		sensitivity_slider.value = float(GameState.profile.settings.sensitivity)
		sensitivity_slider.custom_minimum_size.y = 30
		parent.add_child(sensitivity_slider)
		sensitivity_slider.value_changed.connect(func(value: float):
			GameState.profile.settings.sensitivity = value
			GameState.save_profile()
			sensitivity_label.text = "TOUCH SENSITIVITY  %.1f" % value
			if is_instance_valid(main) and is_instance_valid(main.player):
				main.player.sensitivity = value
		)
		var note := _label(parent, "Graphics presets change effects in the runtime. Test on your Android target;\n2–4 GB devices should use Low or Medium.", 13, Color("#8da8ad"))
	else:
		body.text = "This panel is ready for the next content drop."

func _shop_action(item_id: String) -> void:
	if item_id in GameState.profile.owned_cosmetics:
		GameState.equip_cosmetic(item_id)
		show_toast("Equipped cosmetic", true)
	else:
		GameState.buy_cosmetic(item_id)

func _host_lan() -> void:
	if NetworkManager.host_lan():
		show_toast("LAN room %s is hosting" % NetworkManager.room_code, true)

func _join_lan(address: String) -> void:
	NetworkManager.join_lan(address)

func _set_quality(quality: String) -> void:
	GameState.set_quality(quality)
	if is_instance_valid(main) and main.has_method("apply_quality"):
		main.apply_quality(quality)
	show_toast("Quality set to %s" % quality, true)

func _on_network_status(message: String, _connected: bool) -> void:
	show_toast(message, _connected)
	if is_instance_valid(menu_status):
		menu_status.text = message.to_upper()

func _on_game_toast(message: String, good: bool) -> void:
	show_toast(message, good)

func _select_mode(mode_id: String) -> void:
	selected_mode = mode_id
	_update_mode_buttons()

func _update_mode_buttons() -> void:
	for mode_id in mode_buttons:
		var button: Button = mode_buttons[mode_id]
			var selected: bool = mode_id == selected_mode
		button.add_theme_stylebox_override("normal", _panel_style(Color("#1b796d") if selected else Color("#122b39"), Color("#62e5cf") if selected else Color("#285260"), 10, 2 if selected else 1))
		button.add_theme_color_override("font_color", Color("#e9fff8") if selected else Color("#96b7ba"))

func _play_selected() -> void:
	if is_instance_valid(main):
		main.start_match(selected_mode)

func _on_move_changed(value: Vector2) -> void:
	_call_player_with_value("set_mobile_move", value)

func _on_look_changed(value: Vector2) -> void:
	_call_player_with_value("set_mobile_look", value)

func _set_fire(active: bool) -> void:
	_call_player_with_value("set_mobile_fire", active)

func _set_aim(active: bool) -> void:
	_call_player_with_value("set_mobile_aim", active)

func _toggle_crouch() -> void:
	crouch_active = not crouch_active
	_call_player_with_value("set_mobile_crouch", crouch_active)

func _call_player(method: String) -> void:
	if is_instance_valid(main) and is_instance_valid(main.player) and main.player.has_method(method):
		main.player.call(method)

func _call_player_with_value(method: String, value) -> void:
	if is_instance_valid(main) and is_instance_valid(main.player) and main.player.has_method(method):
		main.player.call(method, value)

func _hold(button: Button, pressed: Callable, released: Callable) -> void:
	button.button_down.connect(pressed)
	button.button_up.connect(released)

func _action_button(text: String, position_value: Vector2, size_value: Vector2, color: Color) -> Button:
	var button := _button(match_layer, text, func(): pass, size_value, 13)
	button.position = position_value
	button.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	button.position = Vector2(position_value.x, position_value.y)
	button.add_theme_stylebox_override("normal", _panel_style(Color(color, 0.82), color.lightened(0.22), 18, 2))
	button.add_theme_stylebox_override("hover", _panel_style(Color(color, 0.98), Color("#effffb"), 18, 2))
	return button

func _bar(parent: Node, color: Color) -> ProgressBar:
	var bar := ProgressBar.new()
	bar.min_value = 0.0
	bar.max_value = 100.0
	bar.value = 100.0
	bar.show_percentage = false
	bar.custom_minimum_size.y = 8
	bar.add_theme_stylebox_override("background", _panel_style(Color(0.1, 0.14, 0.18, 0.8), Color(0.2, 0.3, 0.35, 0.5), 4, 1))
	bar.add_theme_stylebox_override("fill", _panel_style(color, color.lightened(0.1), 4, 0))
	parent.add_child(bar)
	return bar

func _label(parent: Node, text_value: String, font_size: int, color: Color) -> Label:
	var label := Label.new()
	label.text = text_value
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	parent.add_child(label)
	return label

func _button(parent: Node, text_value: String, callback: Callable, min_size: Vector2, font_size: int = 14) -> Button:
	var button := Button.new()
	button.text = text_value
	button.custom_minimum_size = min_size
	button.add_theme_font_size_override("font_size", font_size)
	button.add_theme_color_override("font_color", Color("#d7efea"))
	button.add_theme_color_override("font_hover_color", Color("#ffffff"))
	button.add_theme_stylebox_override("normal", _panel_style(Color("#122b39"), Color("#285260"), 10, 1))
	button.add_theme_stylebox_override("hover", _panel_style(Color("#1b4a52"), Color("#52cdb9"), 10, 2))
	button.add_theme_stylebox_override("pressed", _panel_style(Color("#236e67"), Color("#a8fff0"), 10, 2))
	button.pressed.connect(callback)
	button.focus_mode = Control.FOCUS_NONE
	parent.add_child(button)
	return button

func _panel_style(bg: Color, border: Color, radius: int, border_width: int) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = bg
	style.border_color = border
	style.set_border_width_all(border_width)
	style.set_corner_radius_all(radius)
	style.content_margin_left = 8
	style.content_margin_right = 8
	style.content_margin_top = 5
	style.content_margin_bottom = 5
	return style

func _format_time(seconds: float) -> String:
	var total := maxi(0, int(seconds))
	return "%02d:%02d" % [total / 60, total % 60]
