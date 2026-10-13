extends Control
## Lobby / main menu. Every screen is built in code from Game, GameModes and WDB data.
## Features that need an online service (matchmaking, rooms, friends, ranked queue)
## are shown disabled with the reason, never as if they worked.

const GameModes := preload("res://scripts/match/game_modes.gd")
const WDB := preload("res://scripts/weapons/weapon_db.gd")
const MobileControls := preload("res://scripts/ui/mobile_controls.gd")

const NAV := [
	["play", "Play"], ["modes", "Modes"], ["rooms", "Rooms"], ["shop", "Shop"], ["inventory", "Inventory"],
	["missions", "Missions"], ["ranked", "Ranked"], ["friends", "Friends"], ["settings", "Settings"],
]

var _content: VBoxContainer
var _scroll: ScrollContainer
var _nav_box: VBoxContainer
var _screen: String = "play"
var _top_label: Label
var _mobile
var _bg: ColorRect


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	_bg = ColorRect.new()
	_bg.color = Color(0.07, 0.1, 0.14)
	_bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_bg)

	var root := HBoxContainer.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_theme_constant_override("separation", 18)
	add_child(root)

	var side := VBoxContainer.new()
	side.custom_minimum_size = Vector2(190, 0)
	side.add_theme_constant_override("separation", 6)
	root.add_child(side)
	var title := _label("BLOCKSTRIKE\nROYALE", 26, Color(1, 0.85, 0.3))
	side.add_child(title)
	side.add_child(_spacer(8))
	_nav_box = VBoxContainer.new()
	_nav_box.add_theme_constant_override("separation", 6)
	side.add_child(_nav_box)
	side.add_child(_spacer(10))
	side.add_child(_label("Prototype build %s" % Game.VERSION, 12, Color(0.6, 0.66, 0.72)))

	var main := VBoxContainer.new()
	main.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	main.add_theme_constant_override("separation", 10)
	root.add_child(main)
	_top_label = _label("", 16, Color(0.85, 0.9, 1.0))
	main.add_child(_top_label)

	_scroll = ScrollContainer.new()
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	main.add_child(_scroll)
	_content = VBoxContainer.new()
	_content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_content.add_theme_constant_override("separation", 12)
	_scroll.add_child(_content)

	for n in NAV:
		var b := _button(n[1], func() -> void: _show(n[0]), 180)
		b.name = "Nav_" + n[0]
		_nav_box.add_child(b)

	var layer := CanvasLayer.new()
	layer.layer = 6
	add_child(layer)
	_mobile = MobileControls.new()
	_mobile.set_anchors_preset(Control.PRESET_FULL_RECT)
	layer.add_child(_mobile)
	_mobile.edit_finished.connect(func() -> void: _show("settings"))

	_show("play")


# ---------------------------------------------------------------- helpers
func _label(text: String, size_px: int, color: Color = Color.WHITE) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size_px)
	l.add_theme_color_override("font_color", color)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return l


func _spacer(h: float):
	var c := Control.new()
	c.custom_minimum_size = Vector2(0, h)
	return c


func _button(text: String, cb: Callable, w: float = 300.0, enabled: bool = true) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(w, 44)
	b.add_theme_font_size_override("font_size", 18)
	b.disabled = not enabled
	if enabled:
		b.pressed.connect(func() -> void:
			Sfx.play("ui", -6.0)
			cb.call())
	return b


func _row() -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 10)
	return h


func _card(parent, title_text: String, body: String) -> VBoxContainer:
	var pc := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.12, 0.16, 0.22, 0.95)
	sb.set_corner_radius_all(8)
	sb.set_content_margin_all(12)
	pc.add_theme_stylebox_override("panel", sb)
	pc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	parent.add_child(pc)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	pc.add_child(v)
	v.add_child(_label(title_text, 20, Color(1, 0.9, 0.5)))
	if body != "":
		v.add_child(_label(body, 15, Color(0.82, 0.87, 0.93)))
	return v


func _clear() -> void:
	for c in _content.get_children():
		c.queue_free()


func _set_top() -> void:
	var lv := Game.level_info()
	var lg := Game.league_for_points(int(Game.profile["rank_points"]))
	_top_label.text = "%s   |   Level %d   |   Coins %d   Gems %d   |   %s league" % [
		Game.profile["name"], int(lv["level"]), int(Game.profile["coins"]), int(Game.profile["gems"]), lg["name"]]


func _show(screen: String) -> void:
	_screen = screen
	_clear()
	_set_top()
	_scroll.scroll_vertical = 0
	match screen:
		"play": _build_play()
		"modes": _build_modes()
		"rooms": _build_rooms()
		"shop": _build_shop()
		"inventory": _build_inventory()
		"missions": _build_missions()
		"ranked": _build_ranked()
		"friends": _build_friends()
		"settings": _build_settings()
	for n in _nav_box.get_children():
		var is_cur: bool = n.name == "Nav_" + screen
		n.modulate = Color(1, 0.9, 0.4) if is_cur else Color.WHITE


func _start_mode(mode_id: String) -> void:
	Game.current_mode = mode_id
	get_tree().change_scene_to_file("res://scenes/match.tscn")


# ---------------------------------------------------------------- screens
func _build_play() -> void:
	_content.add_child(_label("Play", 30, Color(1, 1, 1)))
	_content.add_child(_label("Offline matches run on this device with AI opponents. Online matchmaking is not configured in this build.", 15, Color(0.8, 0.85, 0.9)))
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 12)
	grid.add_theme_constant_override("v_separation", 12)
	_content.add_child(grid)
	var cards := [
		["br_solo", "Battle Royale - Solo", "16 players. Last one standing wins. Shrinking zone."],
		["br_duo", "Battle Royale - Duo", "Team with an AI partner. Human duo needs online play."],
		["br_squad", "Battle Royale - Squad", "Squad of 4 with AI teammates. Human squads need online play."],
		["training", "Training Ground", "Practice against respawning bots. Unlimited reserve ammo."],
	]
	for c in cards:
		var box := _card(grid, c[1], c[2])
		box.get_parent().custom_minimum_size = Vector2(430, 0)
		var mid: String = c[0]
		box.add_child(_button("Start", func() -> void: _start_mode(mid), 180))
	_content.add_child(_label("Controls: left thumb moves, right side swipes to look. Use the buttons on the right to fire, aim, jump, crouch, reload and more.", 14, Color(0.7, 0.76, 0.84)))


func _build_modes() -> void:
	_content.add_child(_label("Game Modes", 30))
	for id in GameModes.MODES.keys():
		var m: Dictionary = GameModes.MODES[id]
		var status := "Playable" if bool(m["playable"]) else "Planned - not implemented yet"
		var box := _card(_content, "%s   (%s)" % [m["name"], status], str(m["desc"]))
		var mid: String = id
		box.add_child(_button("Play", func() -> void: _start_mode(mid), 180, bool(m["playable"])))


func _build_rooms() -> void:
	_content.add_child(_label("Custom Rooms", 30))
	_content.add_child(_label("Room codes, invites and team configuration need the online room server. It is not configured in this build, so these controls are disabled.", 15, Color(1, 0.8, 0.6)))
	var box := _card(_content, "Create room", "Map: Ironridge Valley  |  Mode: Battle Royale  |  Max players: 32  |  Team size: 1-4")
	box.add_child(_button("Create room (needs room server)", func() -> void: pass, 340, false))
	var join := _card(_content, "Join by code", "Enter a room code shared by a friend.")
	join.add_child(_button("Join room (needs room server)", func() -> void: pass, 340, false))
	var lan := _card(_content, "LAN host / join", "Host on this Wi-Fi or join by IP address. LAN networking is not implemented yet.")
	lan.add_child(_button("Host LAN game (not implemented)", func() -> void: pass, 340, false))
	lan.add_child(_button("Join by IP (not implemented)", func() -> void: pass, 340, false))


func _build_shop() -> void:
	_content.add_child(_label("Shop - cosmetics only", 30))
	_content.add_child(_label("Cosmetics never change stats, damage or range. Coins: %d   Gems: %d" % [int(Game.profile["coins"]), int(Game.profile["gems"])], 16))
	for it in Game.CATALOG:
		var id: String = it["id"]
		var owned: bool = Game.owns(id)
		var eq: bool = Game.profile["equipped"].get(it["cat"], "") == id
		var status := "Equipped" if eq else ("Owned" if owned else "%d %s" % [int(it["price"]), it["currency"]])
		var box := _card(_content, "%s  (%s)" % [it["name"], it["cat"]], "Price: %s" % status)
		if owned:
			box.add_child(_button("Unequip" if eq else "Equip", func() -> void:
				if eq:
					Game.profile["equipped"][it["cat"]] = ""
					Game.save_all()
				else:
					Game.equip_item(id)
				_show("shop"), 180))
		else:
			box.add_child(_button("Buy", func() -> void:
				var err: String = Game.buy_item(id)
				if err != "":
					_top_label.text = err
				_show("shop"), 180))


func _build_inventory() -> void:
	_content.add_child(_label("Inventory", 30))
	var cosmetic := _card(_content, "Equipped cosmetics", "")
	for cat in ["outfit", "helmet", "backpack", "weapon_skin"]:
		var id: String = str(Game.profile["equipped"].get(cat, ""))
		var nm := "None"
		if id != "":
			nm = str(Game.catalog_item(id).get("name", id))
		cosmetic.add_child(_label("%s: %s" % [cat, nm], 15))
	var weapons := _card(_content, "Weapons (3 inventory slots in match)", "Each weapon has its own damage, fire rate, recoil, range, magazine and reload time.")
	for wid in ["ar", "smg", "shotgun", "sniper", "pistol", "knife"]:
		var d: Dictionary = WDB.get_def(wid)
		var txt := "dmg %d  rate %.2fs  mag %d  reload %.1fs  range %dm  ammo %s" % [
			int(d["damage"]), float(d["interval"]), int(d["magazine"]), float(d["reload"]), int(d["range"]), d["ammo"]]
		if int(d["pellets"]) > 1:
			txt += "  pellets %d" % int(d["pellets"])
		weapons.add_child(_label("%s  -  %s" % [d["name"], txt], 14))
	var items := _card(_content, "Match items", "")
	items.add_child(_label("Bandage (+heal), Medkit (+heal), Armor plate (+armor), Build blocks, plus ammo types light / medium / shell / heavy.", 14))


func _build_missions() -> void:
	_content.add_child(_label("Missions", 30))
	_content.add_child(_label("Daily missions reset each day. Weekly missions are planned and not implemented yet.", 15, Color(0.8, 0.85, 0.9)))
	for m in Game.daily_missions():
		var done: bool = m["progress"] >= m["target"]
		var box := _card(_content, "%s  %d / %d" % [m["title"], m["progress"], m["target"]],
			"Reward: %d coins, %d XP%s" % [int(m["coins"]), int(m["xp"]), "  (claimed)" if m["claimed"] else ""])
		var mid: String = m["id"]
		box.add_child(_button("Claim", func() -> void:
			var err: String = Game.claim_mission(mid)
			if err != "":
				_top_label.text = err
			_show("missions"), 180, done and not bool(m["claimed"])))
	var lv := Game.level_info()
	_content.add_child(_label("Level %d  -  %d / %d XP to next level" % [int(lv["level"]), int(lv["into"]), int(lv["need"])], 16))


func _build_ranked() -> void:
	_content.add_child(_label("Ranked Leagues", 30))
	var pts := int(Game.profile["rank_points"])
	var lg := Game.league_for_points(pts)
	_card(_content, "Current league: %s" % lg["name"], "Rank points: %d. Win battle royale matches to climb." % pts)
	var ladder := _card(_content, "League ladder", "")
	for l in Game.LEAGUES:
		ladder.add_child(_label("%s  (from %d points)%s" % [l["name"], int(l["min"]), "   <-- you" if l["name"] == lg["name"] else ""], 15))
	_card(_content, "Seasonal rewards", "Season 1 (prototype). Season rewards are cosmetic and are planned, not implemented.")
	var q := _card(_content, "Ranked queue", "Ranked matchmaking needs the online matchmaking server, which is not configured in this build.")
	q.add_child(_button("Find ranked match (needs server)", func() -> void: pass, 340, false))


func _build_friends() -> void:
	_content.add_child(_label("Friends", 30))
	var f := _card(_content, "Friends list", "Friends, invites and presence need the online account service. Not configured in this build.")
	f.add_child(_button("Add friend (needs service)", func() -> void: pass, 340, false))
	f.add_child(_button("Invite to room (needs service)", func() -> void: pass, 340, false))


func _build_settings() -> void:
	_content.add_child(_label("Settings", 30))
	var q := _card(_content, "Graphics preset", "Low targets 30 FPS on low-end phones: smaller render scale, no shadows, shorter view distance.")
	var r := _row()
	q.add_child(r)
	for p in ["low", "medium", "high"]:
		var pp: String = p
		r.add_child(_button(pp.capitalize(), func() -> void:
			Game.apply_quality_preset(pp)
			_show("settings"), 150))
	_slider_card("Look sensitivity", "look_sensitivity", 0.3, 2.5, 0.05)
	_slider_card("Aim-down-sights sensitivity", "ads_multiplier", 0.2, 1.0, 0.05)
	_slider_card("Joystick size", "joystick_size", 0.6, 1.5, 0.05)
	_slider_card("Button size", "button_scale", 0.7, 1.4, 0.05)
	_slider_card("Master volume", "master_volume", 0.0, 1.0, 0.05)
	var misc := _card(_content, "Options", "")
	var inv := CheckBox.new()
	inv.text = "Invert vertical look"
	inv.button_pressed = bool(Game.settings["invert_y"])
	inv.toggled.connect(func(v: bool) -> void: Game.set_setting("invert_y", v))
	misc.add_child(inv)
	var fps := CheckBox.new()
	fps.text = "Show FPS counter in match"
	fps.button_pressed = bool(Game.settings["show_fps"])
	fps.toggled.connect(func(v: bool) -> void: Game.set_setting("show_fps", v))
	misc.add_child(fps)
	var touch := CheckBox.new()
	touch.text = "Always show touch controls (testing on desktop)"
	touch.button_pressed = bool(Game.settings.get("force_touch_ui", false))
	touch.toggled.connect(func(v: bool) -> void: Game.set_setting("force_touch_ui", v))
	misc.add_child(touch)
	var name_row := _row()
	misc.add_child(name_row)
	name_row.add_child(_label("Player name", 16))
	var le := LineEdit.new()
	le.text = str(Game.profile["name"])
	le.max_length = 16
	le.custom_minimum_size = Vector2(260, 40)
	le.text_submitted.connect(func(t: String) -> void:
		Game.profile["name"] = t.strip_edges() if t.strip_edges() != "" else "Survivor"
		Game.save_all()
		_show("settings"))
	name_row.add_child(le)
	var lay := _card(_content, "Touch layout", "Drag buttons into place on the phone screen. The layout is saved on this device.")
	var lr := _row()
	lay.add_child(lr)
	lr.add_child(_button("Edit layout", func() -> void:
		_mobile.start_edit(), 180))
	lr.add_child(_button("Reset layout", func() -> void:
		Game.set_setting("button_layout", {})
		_show("settings"), 180))


func _slider_card(title_text: String, key: String, lo: float, hi: float, step: float) -> void:
	var box := _card(_content, "%s: %.2f" % [title_text, float(Game.settings[key])], "")
	var s := HSlider.new()
	s.min_value = lo
	s.max_value = hi
	s.step = step
	s.value = float(Game.settings[key])
	s.custom_minimum_size = Vector2(420, 26)
	box.add_child(s)
	var title_label: Label = box.get_child(0)
	s.value_changed.connect(func(v: float) -> void:
		Game.set_setting(key, v)
		title_label.text = "%s: %.2f" % [title_text, v])
