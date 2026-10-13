class_name HUD
extends CanvasLayer
## In-match interface for phones (touch) and desktop (keyboard/mouse).

var m: Match
var pc: PlayerController
var touch: TouchControls
var root: Control
var overlay: Control
var minimap: Minimap
var top_label: Label
var top_sub: Label
var feed: VBoxContainer
var net_label: Label
var banner: Label
var banner_sub: Label
var toast_label: Label
var team_box: VBoxContainer
var loading: Control
var loading_bar: ProgressBar
var modal: Control
var spectate_bar: Control
var spectate_label: Label
var dmg_dirs: Array = []
var hit_t := -10.0
var hit_head := false
var kill_t := -10.0
var hurt_t := -10.0
var end_shown := false
var dead_shown := false
var _banner_tw: Tween
var _toast_tw: Tween
var _last_phase := ""
var _fps_t := 0.0
var _frames := 0
var _fps := 0

func setup(match_node: Match, controller: PlayerController) -> void:
	m = match_node
	pc = controller
	layer = 5
	root = Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = UI.build_theme()
	add_child(root)
	overlay = Control.new()
	overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.draw.connect(_draw_overlay)
	root.add_child(overlay)
	minimap = Minimap.new()
	minimap.setup(m, false)
	minimap.position = Vector2(16, 16)
	minimap.size = Vector2(200, 200)
	root.add_child(minimap)
	var top := UI.vbox(0)
	top.set_anchors_preset(Control.PRESET_CENTER_TOP)
	top.position = Vector2(-260, 10)
	top.size = Vector2(520, 70)
	top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	top_label = UI.label("", 30, UI.TEXT, 8)
	top_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	top_sub = UI.label("", 20, UI.GOLD, 6)
	top_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	top.add_child(top_label)
	top.add_child(top_sub)
	root.add_child(top)
	net_label = UI.label("", 16, UI.DIM, 4)
	net_label.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	net_label.position = Vector2(-300, 8)
	net_label.size = Vector2(230, 24)
	net_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	root.add_child(net_label)
	feed = UI.vbox(4)
	feed.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	feed.position = Vector2(-470, 40)
	feed.size = Vector2(450, 200)
	feed.alignment = BoxContainer.ALIGNMENT_BEGIN
	feed.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(feed)
	team_box = UI.vbox(6)
	team_box.position = Vector2(16, 228)
	team_box.size = Vector2(200, 200)
	team_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(team_box)
	banner = UI.label("", 52, UI.ACCENT, 12)
	banner.set_anchors_preset(Control.PRESET_CENTER)
	banner.position = Vector2(-500, -200)
	banner.size = Vector2(1000, 70)
	banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner.modulate.a = 0.0
	root.add_child(banner)
	banner_sub = UI.label("", 26, UI.TEXT, 8)
	banner_sub.set_anchors_preset(Control.PRESET_CENTER)
	banner_sub.position = Vector2(-500, -135)
	banner_sub.size = Vector2(1000, 40)
	banner_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner_sub.modulate.a = 0.0
	root.add_child(banner_sub)
	toast_label = UI.label("", 22, UI.TEXT, 6)
	toast_label.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	toast_label.position = Vector2(-400, -190)
	toast_label.size = Vector2(800, 30)
	toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast_label.modulate.a = 0.0
	root.add_child(toast_label)
	touch = TouchControls.new()
	root.add_child(touch)
	touch.action.connect(_on_touch_action)
	touch.slot_tapped.connect(func(i): m.local_action({"t": "slot", "i": i}))
	touch.row_tapped.connect(func(id): m.local_action({"t": "pick", "id": id}))
	pc.touch = touch
	spectate_bar = _make_spectate_bar()
	root.add_child(spectate_bar)
	modal = Control.new()
	modal.set_anchors_preset(Control.PRESET_FULL_RECT)
	modal.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(modal)
	_make_loading()
	m.hud_event.connect(_on_event)
	if m.terrain:
		m.terrain.build_progress.connect(func(f): loading_bar.value = f * 100.0)

# ------------------------------------------------------------------ helpers
func _make_loading() -> void:
	loading = ColorRect.new()
	(loading as ColorRect).color = Color(0.04, 0.05, 0.09)
	loading.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(loading)
	var v := UI.vbox(18)
	v.set_anchors_preset(Control.PRESET_CENTER)
	v.position = Vector2(-320, -120)
	v.size = Vector2(640, 240)
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	var t := UI.label("BLOCKSTRIKE ROYALE", 54, UI.ACCENT, 10)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(t)
	var mi := UI.label("%s  -  %s" % [m.mode.get("name", ""), DB.MAPS.get(m.map_id, {}).get("name", "")], 26, UI.TEXT, 4)
	mi.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(mi)
	loading_bar = UI.progress(0, 100, UI.ACCENT, 18)
	loading_bar.custom_minimum_size = Vector2(560, 18)
	v.add_child(loading_bar)
	var tips := ["Tip: drag on the FIRE button to aim while shooting.", "Tip: place blocks with the cube button to build instant cover.",
		"Tip: stay inside the white circle - the zone hurts more every phase.", "Tip: headshots deal much more damage.",
		"Tip: supply drops contain the best weapons and armour.", "Tip: push the joystick all the way to sprint."]
	var tip := UI.label(tips[randi() % tips.size()], 20, UI.DIM, 0)
	tip.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(tip)
	loading.add_child(v)

func _make_spectate_bar() -> Control:
	var p := UI.panel(Color(0.05, 0.07, 0.12, 0.85), 12)
	p.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	p.position = Vector2(-300, -170)
	p.size = Vector2(600, 64)
	var h := UI.hbox(12)
	spectate_label = UI.label("Spectating", 22)
	spectate_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(spectate_label)
	h.add_child(UI.button("Next", func(): pc.next_spectate(), "blue", Vector2(110, 46), 20))
	h.add_child(UI.button("Leave", func(): _leave(), "danger", Vector2(110, 46), 20))
	p.add_child(h)
	p.visible = false
	return p

func show_banner(text: String, sub := "", col := UI.ACCENT, dur := 2.2) -> void:
	banner.text = text
	banner.add_theme_color_override("font_color", col)
	banner_sub.text = sub
	if _banner_tw:
		_banner_tw.kill()
	banner.modulate.a = 1.0
	banner_sub.modulate.a = 1.0 if sub != "" else 0.0
	banner.scale = Vector2(1.15, 1.15)
	banner.pivot_offset = banner.size * 0.5
	_banner_tw = create_tween()
	_banner_tw.tween_property(banner, "scale", Vector2.ONE, 0.18)
	_banner_tw.tween_interval(dur)
	_banner_tw.tween_property(banner, "modulate:a", 0.0, 0.4)
	_banner_tw.parallel().tween_property(banner_sub, "modulate:a", 0.0, 0.4)

func toast(text: String) -> void:
	toast_label.text = text
	if _toast_tw:
		_toast_tw.kill()
	toast_label.modulate.a = 1.0
	_toast_tw = create_tween()
	_toast_tw.tween_interval(1.6)
	_toast_tw.tween_property(toast_label, "modulate:a", 0.0, 0.5)

func _feed(text: String, col: Color) -> void:
	var l := UI.label(text, 19, col, 5)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	feed.add_child(l)
	if feed.get_child_count() > 5:
		feed.get_child(0).queue_free()
	var tw := create_tween()
	tw.tween_interval(5.0)
	tw.tween_property(l, "modulate:a", 0.0, 0.6)
	tw.tween_callback(l.queue_free)

func _name_of(id: int) -> String:
	var a: Actor = m.actors.get(id)
	return a.name if a else "?"

# ------------------------------------------------------------------ events
func _on_event(type: String, d: Dictionary) -> void:
	match type:
		"loaded":
			if m.net_role == "host":
				Net.host_match_ready(m)
			var tw := create_tween()
			tw.tween_property(loading, "modulate:a", 0.0, 0.5)
			tw.tween_callback(func(): loading.visible = false)
			Audio.music("")
			if m.kind == "br":
				show_banner("BATTLE ROYALE", "Jump from the plane - press JUMP", UI.ACCENT, 3.0)
				Audio.loop("plane", -14.0)
			elif m.kind == "training":
				show_banner("TRAINING GROUND", "Weapons on the racks respawn. Targets on the range.", UI.ACCENT2, 3.0)
		"hit":
			var me := m.local_actor()
			if me and int(d["v"]) == m.local_id and int(d["a"]) >= 0:
				var att: Actor = m.actors.get(int(d["a"]))
				if att:
					var to := att.pos - me.pos
					dmg_dirs.append([atan2(-to.x, -to.z), m.time])
				hurt_t = m.time
				Audio.vibrate(30)
			elif int(d["v"]) == m.local_id:
				hurt_t = m.time
			if int(d["a"]) == m.local_id and int(d["v"]) != m.local_id:
				hit_t = m.time
				hit_head = d["h"]
		"kill":
			var killer := int(d["a"])
			var victim := int(d["v"])
			var knock := int(d.get("k", 0)) == 1
			var wname := DB.item_name(str(d.get("w", "")))
			match str(d.get("w", "")):
				"zone":
					wname = "the zone"
				"fall":
					wname = "a long fall"
				"bleed":
					wname = "bleeding out"
				"gr_frag":
					wname = "Frag Cube"
			var me2 := m.local_actor()
			var col := UI.TEXT
			if killer == m.local_id:
				col = UI.GOLD
			elif victim == m.local_id or (me2 and m.actors.has(victim) and (m.actors[victim] as Actor).team == me2.team):
				col = UI.BAD
			var verb := " knocked " if knock else " eliminated "
			if killer >= 0 and killer != victim:
				_feed(_name_of(killer) + verb + _name_of(victim) + ("  [HS]" if d.get("hs", false) else "") + "  (" + wname + ")", col)
			else:
				_feed(_name_of(victim) + (" was knocked by " if knock else " was eliminated by ") + wname, col)
			if killer == m.local_id and victim != m.local_id:
				kill_t = m.time
				show_banner("KNOCKED " + _name_of(victim) if knock else "ELIMINATED " + _name_of(victim), "", UI.GOLD if not knock else UI.ACCENT, 1.4)
			if victim == m.local_id and not knock:
				_on_local_death(killer)
			if victim == m.local_id and knock:
				show_banner("YOU ARE KNOCKED", "Crawl to a teammate to be revived", UI.BAD, 2.0)
		"revive":
			if int(d["v"]) == m.local_id:
				show_banner("REVIVED!", "", UI.GOOD, 1.2)
			_feed(_name_of(int(d["a"])) + " revived " + _name_of(int(d["v"])), UI.GOOD)
		"announce":
			show_banner(str(d["t"]), "", UI.ACCENT2, 1.8)
			if str(d["t"]).contains("zone") or str(d["t"]).contains("Zone"):
				Audio.play_ui("zone", -4.0)
		"round":
			var me3 := m.local_actor()
			var w: int = int(d["w"])
			var sc: Array = d["s"]
			if me3:
				var mine: int = sc[clampi(me3.team, 0, 1)]
				var theirs: int = sc[1 - clampi(me3.team, 0, 1)]
				if w < 0:
					show_banner("ROUND DRAW", "%d - %d" % [mine, theirs], UI.TEXT, 2.5)
				elif w == me3.team:
					show_banner("ROUND WON", "%d - %d" % [mine, theirs], UI.GOOD, 2.5)
					Audio.play_ui("levelup", -4.0)
				else:
					show_banner("ROUND LOST", "%d - %d" % [mine, theirs], UI.BAD, 2.5)
		"pick":
			toast("+ %s%s" % [DB.item_name(str(d["i"])), (" x%d" % int(d["n"])) if int(d["n"]) > 1 else ""])
		"toast":
			toast(str(d["t"]))
		"end":
			_on_end(d)

func _on_local_death(killer: int) -> void:
	if m.kind == "training":
		show_banner("ELIMINATED", "Respawning...", UI.BAD, 2.0)
		return
	var me := m.local_actor()
	var mates_alive := false
	for id in m.actors:
		var o: Actor = m.actors[id]
		if me and o != me and o.team == me.team and o.is_alive():
			mates_alive = true
	if m.kind == "br" and not mates_alive:
		show_banner("ELIMINATED", "by " + (_name_of(killer) if killer >= 0 else "the zone"), UI.BAD, 2.5)
		get_tree().create_timer(2.0).timeout.connect(_show_dead_panel)
	else:
		show_banner("ELIMINATED", "Spectating your team", UI.BAD, 2.0)

func _show_dead_panel() -> void:
	if end_shown or dead_shown:
		return
	dead_shown = true
	var me := m.local_actor()
	var pl: int = int(m.local_result().get("placement", 0))
	var p := _modal_panel("YOU PLACED #%d" % int(pl), Vector2(560, 360))
	var v: VBoxContainer = p.get_meta("body")
	if me:
		v.add_child(UI.label("Eliminations: %d    Damage: %d" % [me.kills, int(me.damage_dealt)], 24))
		v.add_child(UI.label("Survived: %s" % UI.fmt_time(me.died_at - me.alive_since), 22, UI.DIM))
	var h := UI.hbox(14)
	h.alignment = BoxContainer.ALIGNMENT_CENTER
	h.add_child(UI.button("Spectate", func(): _close_modal(), "blue", Vector2(180, 56)))
	h.add_child(UI.button("Back to Lobby", func(): _leave(), "primary", Vector2(220, 56)))
	v.add_child(h)

func _on_end(d: Dictionary) -> void:
	if end_shown:
		return
	end_shown = true
	_close_modal()
	Audio.loop("")
	var res := m.local_result()
	var won: bool = res.get("won", false)
	var title := "VICTORY!" if won else ("DEFEAT" if m.kind != "br" else "#%d PLACE" % int(res.get("placement", 0)))
	if m.kind == "br" and won:
		title = "BLOCK ROYALE CHAMPION!"
	Audio.play_ui("victory" if won else "defeat", 0.0)
	show_banner(title, "", UI.GOLD if won else UI.BAD, 3.0)
	if won and m.local_actor():
		# victory dance: play the emote animation that matches the equipped victory cosmetic + confetti
		var a := m.local_actor()
		var vic: Dictionary = DB.COSMETICS.get(Profile.equip_dict().get("victory", "vic_confetti"), {})
		for id in DB.COSMETICS:
			if DB.COSMETICS[id]["type"] == "emote" and int(DB.COSMETICS[id]["anim"]) == int(vic.get("anim", 1)):
				m.local_action({"t": "emote", "id": id})
				break
		for k in 8:
			get_tree().create_timer(0.3 * k).timeout.connect(func():
				if is_instance_valid(m) and m.effects:
					m.effects.burst(a.pos + Vector3(randf_range(-2, 2), 2.5 + randf() * 2.0, randf_range(-2, 2)), Vector3.UP,
						Color.from_hsv(randf(), 0.8, 1.0), 24, 1.6))
	get_tree().create_timer(3.2).timeout.connect(func():
		var p := _modal_panel(title, Vector2(600, 400))
		var v: VBoxContainer = p.get_meta("body")
		v.add_child(UI.label("Placement: #%d   Eliminations: %d" % [int(res.get("placement", 0)), int(res.get("kills", 0))], 26))
		v.add_child(UI.label("Damage: %d   Headshots: %d   Healed: %d" % [int(res.get("damage", 0)), int(res.get("headshots", 0)), int(res.get("healed", 0))], 22, UI.DIM))
		if m.kind in ["cs", "arena"]:
			var sc: Array = res.get("score", [0, 0])
			var team: int = clampi(int(res.get("team", 0)), 0, 1)
			v.add_child(UI.label("Final score  %d - %d" % [sc[team], sc[1 - team]], 24, UI.GOLD))
		v.add_child(UI.button("Continue", func(): _leave(), "primary", Vector2(240, 60)))
	)

# ------------------------------------------------------------------ modal panels
func _modal_panel(title: String, sz: Vector2) -> PanelContainer:
	_close_modal()
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.55)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	modal.add_child(dim)
	var p := UI.panel()
	p.set_anchors_preset(Control.PRESET_CENTER)
	p.position = -sz * 0.5
	p.size = sz
	var v := UI.vbox(14)
	var t := UI.label(title, 34, UI.ACCENT, 6)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(t)
	p.add_child(v)
	p.set_meta("body", v)
	modal.add_child(p)
	modal.mouse_filter = Control.MOUSE_FILTER_STOP
	touch.release_all()
	touch.visible = false
	pc.ui_blocking = true
	if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	return p

func _close_modal() -> void:
	for c in modal.get_children():
		c.queue_free()
	modal.mouse_filter = Control.MOUSE_FILTER_IGNORE
	touch.visible = true
	pc.ui_blocking = false

func modal_open() -> bool:
	return modal.get_child_count() > 0

func _leave() -> void:
	Audio.loop("")
	Game.finish_match(m)

func _on_touch_action(name: String) -> void:
	match name:
		"fire_r", "fire_l":
			if pc.build_mode:
				pc.do_action("place")
		"pause":
			_pause_menu()
		"map":
			_map_panel()
		"bag":
			_inventory_panel()
		"emote":
			_emote_panel()
		_:
			pc.do_action(name)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.is_action("pause"):
			if modal_open():
				_close_modal()
			else:
				_pause_menu()
		elif event.is_action("map"):
			if modal_open():
				_close_modal()
			else:
				_map_panel()
		elif event.is_action("inventory"):
			if modal_open():
				_close_modal()
			else:
				_inventory_panel()

func _pause_menu() -> void:
	var p := _modal_panel("PAUSED", Vector2(560, 560))
	var v: VBoxContainer = p.get_meta("body")
	if m.net_role == "offline":
		v.add_child(UI.label("Offline match keeps running in the background", 18, UI.DIM))
	v.add_child(UI.button("Resume", func(): _close_modal(), "primary", Vector2(0, 58)))
	var sens := UI.hbox()
	sens.add_child(UI.label("Look sensitivity", 20))
	sens.add_child(UI.slider(0.2, 3.0, 0.05, float(Settings.get_v("sens_look")), func(x): Settings.set_v("sens_look", x)))
	v.add_child(sens)
	var sens2 := UI.hbox()
	sens2.add_child(UI.label("Aim sensitivity", 20))
	sens2.add_child(UI.slider(0.2, 2.0, 0.05, float(Settings.get_v("sens_aim")), func(x): Settings.set_v("sens_aim", x)))
	v.add_child(sens2)
	var q := UI.hbox()
	q.add_child(UI.label("Graphics", 20))
	q.add_child(UI.options(["Auto", "Low", "Medium", "High"], int(Settings.get_v("quality")) + 1, func(i):
		Settings.set_v("quality", i - 1)
		m.apply_quality()))
	v.add_child(q)
	v.add_child(UI.button("Edit button layout", func(): _edit_layout(), "blue", Vector2(0, 52)))
	if m.kind == "training":
		v.add_child(UI.button("Training options", func(): _training_panel(), "blue", Vector2(0, 52)))
	v.add_child(UI.button("Leave match", func(): _confirm_leave(), "danger", Vector2(0, 52)))

func _confirm_leave() -> void:
	var p := _modal_panel("Leave the match?", Vector2(520, 260))
	var v: VBoxContainer = p.get_meta("body")
	v.add_child(UI.label("Your progress so far is kept." if m.kind != "br" else "You will be counted as eliminated.", 20, UI.DIM))
	var h := UI.hbox(14)
	h.alignment = BoxContainer.ALIGNMENT_CENTER
	h.add_child(UI.button("Stay", func(): _close_modal(), "blue", Vector2(160, 54)))
	h.add_child(UI.button("Leave", func(): _leave(), "danger", Vector2(160, 54)))
	v.add_child(h)

func _edit_layout() -> void:
	_close_modal()
	touch.edit_mode = true
	pc.ui_blocking = true
	var bar := UI.hbox(10)
	bar.set_anchors_preset(Control.PRESET_CENTER_TOP)
	bar.position = Vector2(-330, 90)
	bar.size = Vector2(660, 60)
	var sl := UI.slider(0.6, 1.6, 0.05, 1.0, func(x):
		if touch.edit_sel != "":
			touch.buttons[touch.edit_sel]["scale"] = x)
	bar.add_child(UI.label("Size", 20))
	bar.add_child(sl)
	bar.add_child(UI.button("Reset", func():
		Settings.reset_layout()
		touch.load_layout(), "ghost", Vector2(100, 50), 20))
	bar.add_child(UI.button("Save", func():
		touch.save_layout()
		touch.edit_mode = false
		pc.ui_blocking = false
		bar.queue_free(), "good", Vector2(100, 50), 20))
	root.add_child(bar)

func _map_panel() -> void:
	var p := _modal_panel(DB.MAPS.get(m.map_id, {}).get("name", "Map"), Vector2(660, 700))
	var v: VBoxContainer = p.get_meta("body")
	var big := Minimap.new()
	big.setup(m, true)
	big.custom_minimum_size = Vector2(560, 560)
	big.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	v.add_child(big)
	v.add_child(UI.button("Close", func(): _close_modal(), "ghost", Vector2(0, 46)))

func _inventory_panel() -> void:
	var a := m.local_actor()
	if a == null:
		return
	var p := _modal_panel("INVENTORY", Vector2(760, 600))
	var v: VBoxContainer = p.get_meta("body")
	var names := ["Primary 1", "Primary 2", "Pistol", "Melee"]
	for s in 4:
		var h := UI.hbox()
		var id: String = a.slots[s]
		var w := DB.weapon(id)
		var txt := "%s: %s" % [names[s], DB.item_name(id) if id != "" else "-"]
		if id != "" and w.get("ammo", "") != "":
			txt += "   %d / %d" % [a.mag[s], a.ammo[w["ammo"]]]
		var l := UI.label(txt, 22, DB.RARITY_COLORS[DB.item_rarity(id)] if id != "" else UI.DIM)
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		h.add_child(l)
		if id != "" and s < 3:
			h.add_child(UI.button("Drop", func():
				m.local_action({"t": "drop", "item": id})
				_close_modal(), "ghost", Vector2(90, 40), 18))
		v.add_child(h)
	var meds := UI.hbox(12)
	for md in DB.MED_ORDER:
		meds.add_child(UI.button("%s x%d" % [DB.item_name(md), int(a.meds[md])], func():
			m.local_action({"t": "use", "item": md})
			_close_modal(), "good" if int(a.meds[md]) > 0 else "ghost", Vector2(0, 48), 18))
	v.add_child(meds)
	var th := UI.hbox(12)
	for g in ["gr_frag", "gr_smoke", "gr_wall"]:
		th.add_child(UI.label("%s x%d" % [DB.item_name(g), int(a.throws[g])], 20, UI.ACCENT if a.slots[4] == g else UI.TEXT))
	th.add_child(UI.button("Switch", func(): m.local_action({"t": "throw_sel"}), "ghost", Vector2(100, 40), 18))
	v.add_child(th)
	var ammo_txt := "Ammo  "
	for at in DB.AMMO_TYPES:
		ammo_txt += "%s %d   " % [at.capitalize(), int(a.ammo[at])]
	v.add_child(UI.label(ammo_txt, 20, UI.DIM))
	v.add_child(UI.label("Vest Lv.%d (%d)   Helmet Lv.%d (%d)   Blocks %d" % [a.vest_lvl, int(a.vest_dur), a.helm_lvl, int(a.helm_dur), a.blocks], 20))
	v.add_child(UI.button("Close", func(): _close_modal(), "primary", Vector2(0, 50)))

func _emote_panel() -> void:
	var p := _modal_panel("EMOTES", Vector2(620, 380))
	var v: VBoxContainer = p.get_meta("body")
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	for c in DB.cosmetics_of("emote"):
		if Profile.owns(c["id"]):
			var id: String = c["id"]
			grid.add_child(UI.button(c["name"], func():
				m.local_action({"t": "emote", "id": id})
				_close_modal(), "blue", Vector2(180, 52), 20))
	v.add_child(grid)
	v.add_child(UI.button("Close", func(): _close_modal(), "ghost", Vector2(0, 46)))

func _buy_panel() -> void:
	var a := m.local_actor()
	if a == null:
		return
	var p := _modal_panel("BUY PHASE  -  $%d" % a.money, Vector2(900, 600))
	var v: VBoxContainer = p.get_meta("body")
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	for item in DB.CS_SHOP:
		var price := DB.item_price(item)
		var it: String = item
		var b := UI.button("%s  $%d" % [DB.item_name(item), price], func():
			m.local_action({"t": "buy", "item": it})
			Audio.play_ui("buy", -4.0)
			get_tree().create_timer(0.25).timeout.connect(_buy_panel), "blue" if a.money >= price else "ghost", Vector2(270, 50), 18)
		b.disabled = a.money < price
		grid.add_child(b)
	var sc := ScrollContainer.new()
	sc.custom_minimum_size = Vector2(860, 400)
	sc.add_child(grid)
	v.add_child(sc)
	v.add_child(UI.button("Done", func(): _close_modal(), "primary", Vector2(0, 50)))

func _training_panel() -> void:
	var p := _modal_panel("TRAINING OPTIONS", Vector2(560, 470))
	var v: VBoxContainer = p.get_meta("body")
	v.add_child(UI.button("Add easy bot", func(): m.local_action({"t": "train", "op": "add", "skill": 0.2}), "good", Vector2(0, 50)))
	v.add_child(UI.button("Add normal bot", func(): m.local_action({"t": "train", "op": "add", "skill": 0.5}), "blue", Vector2(0, 50)))
	v.add_child(UI.button("Add hard bot", func(): m.local_action({"t": "train", "op": "add", "skill": 0.85}), "danger", Vector2(0, 50)))
	v.add_child(UI.button("Remove all bots", func(): m.local_action({"t": "train", "op": "clear"}), "ghost", Vector2(0, 50)))
	var a := m.local_actor()
	if a:
		v.add_child(UI.check("Infinite reserve ammo", a.infinite_ammo, func(x): a.infinite_ammo = x))
	v.add_child(UI.button("Close", func(): _close_modal(), "primary", Vector2(0, 50)))

# ------------------------------------------------------------------ per-frame update
func _process(dt: float) -> void:
	if m == null:
		return
	_frames += 1
	_fps_t += dt
	if _fps_t >= 0.5:
		_fps = int(_frames / _fps_t)
		_frames = 0
		_fps_t = 0.0
	var a := m.local_actor()
	var sm := m.hud_summary()
	var ph: String = sm.get("ph", "")
	# top info
	match m.kind:
		"br":
			top_label.text = "ALIVE %d    KILLS %d" % [int(sm.get("alive", 0)), a.kills if a else 0]
			var z := m.zone_view_dict()
			if ph == "plane":
				top_sub.text = "Plane departs - jump when ready"
			elif not z.is_empty() and int(z.get("i", -1)) >= 0:
				var left := float(z.get("t1", 0)) - m.time
				top_sub.text = ("Zone shrinking  " if str(z.get("st", "")) == "shrink" else "Safe zone shrinks in  ") + UI.fmt_time(left)
			else:
				top_sub.text = ""
		"cs", "arena":
			var sc: Array = sm.get("sc", [0, 0])
			var team: int = clampi(a.team, 0, 1) if a else 0
			top_label.text = "YOU %d  :  %d ENEMY" % [sc[team], sc[1 - team]]
			var ptxt: String = {"buy": "BUY PHASE", "fight": "ROUND %d" % int(sm.get("rn", 1)), "round_end": "ROUND OVER"}.get(ph, "")
			top_sub.text = "%s   %s%s" % [ptxt, UI.fmt_time(float(sm.get("timer", 0))), ("    $%d" % a.money) if a and m.kind == "cs" else ""]
			if ph == "buy" and _last_phase != "buy" and m.kind == "cs":
				_buy_panel()
			if ph != "buy" and _last_phase == "buy" and modal_open():
				_close_modal()
		"training":
			top_label.text = "TRAINING GROUND"
			top_sub.text = "Kills %d   Damage %d" % [a.kills if a else 0, int(a.damage_dealt) if a else 0]
	if ph != _last_phase and m.kind == "br":
		if _last_phase == "plane":
			Audio.loop("")
	_last_phase = ph
	var ping := Net.ping_ms()
	var ntxt := "FPS %d" % _fps if Settings.get_v("show_fps") or m.net_role == "client" else ""
	if m.net_role == "client":
		var loss := Net.packet_loss()
		ntxt += "   PING %d ms%s" % [ping, ("  LOSS %d%%" % int(loss * 100)) if loss > 0.01 else ""]
		net_label.add_theme_color_override("font_color", UI.GOOD if ping < 80 else (UI.GOLD if ping < 160 else UI.BAD))
	elif m.net_role == "host":
		ntxt += "   HOSTING"
	net_label.text = ntxt
	_update_team_box(a)
	_update_controls(a, ph)
	var dead := a == null or a.state == Actor.St.DEAD
	spectate_bar.visible = dead and m.kind != "training" and not end_shown and not modal_open()
	if spectate_bar.visible:
		spectate_label.text = "Spectating " + _name_of(pc.spectate_id)
	minimap.visible = not dead or m.kind != "training"
	overlay.queue_redraw()

func _update_team_box(me: Actor) -> void:
	if me == null or int(m.mode.get("team", 1)) <= 1:
		team_box.visible = false
		return
	team_box.visible = true
	var mates := []
	for id in m.actors:
		var o: Actor = m.actors[id]
		if o.team == me.team and o != me and not o.dummy:
			mates.append(o)
	while team_box.get_child_count() < mates.size():
		var row := UI.vbox(1)
		row.add_child(UI.label("", 17, UI.TEXT, 4))
		row.add_child(UI.progress(100, 100, UI.GOOD, 8))
		team_box.add_child(row)
	for i in team_box.get_child_count():
		var row: Control = team_box.get_child(i)
		row.visible = i < mates.size()
		if i < mates.size():
			var o: Actor = mates[i]
			(row.get_child(0) as Label).text = o.name + ("  [DOWN]" if o.state == Actor.St.KNOCKED else ("  [OUT]" if o.state == Actor.St.DEAD else ""))
			var bar: ProgressBar = row.get_child(1)
			bar.value = o.hp if o.state == Actor.St.ALIVE else (o.knock_hp if o.state == Actor.St.KNOCKED else 0.0)

func _update_controls(a: Actor, ph: String) -> void:
	if a == null:
		touch.visible = false
		return
	var alive := a.state == Actor.St.ALIVE
	var plane := a.state == Actor.St.PLANE
	for id in ["fire_r", "fire_l", "aim", "reload", "crouch", "heal", "build", "throw"]:
		touch.set_visible_btn(id, alive)
	touch.set_visible_btn("jump", alive or plane or a.state == Actor.St.KNOCKED)
	touch.set_label("jump", "JUMP!" if plane else "")
	touch.set_visible_btn("build", alive and m.rules.building_allowed())
	touch.set_badge("heal", str(int(a.meds["med_bandage"]) + int(a.meds["med_kit"]) + int(a.meds["med_drink"])))
	touch.set_badge("build", str(a.blocks))
	touch.set_badge("throw", str(int(a.throws.get(a.slots[4], 0))) if a.slots[4] != "" else "0")
	touch.buttons["fire_r"]["icon"] = "build" if pc.build_mode else "fire"
	var ctx := pc.context_target()
	touch.set_visible_btn("interact", not ctx.is_empty())
	touch.set_label("interact", str(ctx.get("text", "")))
	touch.set_visible_btn("emote", alive)
	touch.set_visible_btn("bag", alive or a.state == Actor.St.KNOCKED)
	touch.map_rect = Rect2(minimap.position, minimap.size)
	var slots := []
	for s in 4:
		var id: String = a.slots[s]
		var w := DB.weapon(id)
		var sub := ""
		if id != "" and w.get("ammo", "") != "":
			sub = "%d / %s" % [a.mag[s], "INF" if a.infinite_ammo else str(int(a.ammo[w["ammo"]]))]
		elif id != "":
			sub = "Melee"
		slots.append({"text": DB.item_name(id) if id != "" else "", "sub": sub, "active": a.cur == s, "empty": id == "",
			"col": DB.RARITY_COLORS[DB.item_rarity(id)] if id != "" else Color.WHITE})
	touch.slots = slots if alive else []
	var rows := []
	if alive:
		var near := pc.nearby_loot(4)
		if near.size() > 1:
			for e in near:
				var it: Dictionary = e[2]
				rows.append({"id": e[1], "text": DB.item_name(it["item"]) + (" x%d" % int(it["n"]) if int(it["n"]) > 1 else ""), "col": DB.RARITY_COLORS[DB.item_rarity(it["item"])]})
	touch.rows = rows
	if pc.build_mode and a.blocks <= 0:
		pc.build_mode = false
		touch.set_on("build", false)

# ------------------------------------------------------------------ overlay drawing
func _draw_overlay() -> void:
	var a := m.local_actor()
	var sz := overlay.size
	var c := sz * 0.5
	var t := m.time
	var font := UI.font
	if a == null:
		return
	# hurt vignette & low hp
	var hurt_k := clampf(1.0 - (t - hurt_t) / 0.45, 0.0, 1.0)
	var low := clampf((35.0 - a.hp) / 35.0, 0.0, 1.0) if a.state == Actor.St.ALIVE else (0.7 if a.state == Actor.St.KNOCKED else 0.0)
	var vig := maxf(hurt_k * 0.45, low * (0.25 + 0.1 * sin(Time.get_ticks_msec() * 0.006)))
	if vig > 0.01:
		var col := Color(0.85, 0.05, 0.05, vig)
		var e := sz.y * 0.16
		overlay.draw_rect(Rect2(0, 0, sz.x, e), col)
		overlay.draw_rect(Rect2(0, sz.y - e, sz.x, e), col)
		overlay.draw_rect(Rect2(0, e, e, sz.y - 2 * e), col)
		overlay.draw_rect(Rect2(sz.x - e, e, e, sz.y - 2 * e), col)
	# outside the zone
	var z := m.zone_view_dict()
	if not z.is_empty() and bool(z.get("on", false)) and a.is_alive() and not a.in_air_phase():
		if Vector2(a.pos.x, a.pos.z).distance_to(z["c"]) > float(z["r"]):
			overlay.draw_rect(Rect2(Vector2.ZERO, sz), Color(0.2, 0.4, 1.0, 0.12))
			overlay.draw_string_outline(font, Vector2(0, sz.y * 0.3), "YOU ARE OUTSIDE THE SAFE ZONE", HORIZONTAL_ALIGNMENT_CENTER, sz.x, 28, 7, Color.BLACK)
			overlay.draw_string(font, Vector2(0, sz.y * 0.3), "YOU ARE OUTSIDE THE SAFE ZONE", HORIZONTAL_ALIGNMENT_CENTER, sz.x, 28, Color(0.5, 0.75, 1.0))
	# scope
	if pc.is_scoped():
		var r := sz.y * 0.42
		var black := Color(0, 0, 0, 0.92)
		overlay.draw_rect(Rect2(0, 0, c.x - r, sz.y), black)
		overlay.draw_rect(Rect2(c.x + r, 0, sz.x - c.x - r, sz.y), black)
		var pts := PackedVector2Array()
		for i in 33:
			var ang := PI + i * PI / 32.0
			pts.append(c + Vector2(cos(ang), sin(ang)) * r)
		pts.append(Vector2(c.x + r, 0))
		pts.append(Vector2(c.x - r, 0))
		overlay.draw_colored_polygon(pts, black)
		var pts2 := PackedVector2Array()
		for i in 33:
			var ang2 := i * PI / 32.0
			pts2.append(c + Vector2(cos(ang2), sin(ang2)) * r)
		pts2.append(Vector2(c.x - r, sz.y))
		pts2.append(Vector2(c.x + r, sz.y))
		overlay.draw_colored_polygon(pts2, black)
		overlay.draw_arc(c, r, 0, TAU, 64, Color(0, 0, 0), 4.0)
		overlay.draw_line(c - Vector2(r, 0), c + Vector2(r, 0), Color(0, 0, 0, 0.9), 1.5)
		overlay.draw_line(c - Vector2(0, r), c + Vector2(0, r), Color(0, 0, 0, 0.9), 1.5)
		overlay.draw_circle(c, 2.5, Color(1, 0.2, 0.2))
	elif a.can_fight() and not pc.build_mode:
		var w := a.weapon()
		var spread: float = float(w.get("ads", 1.0) if pc.aiming or pc.mouse_aim else w.get("hip", 2.0)) + a.bloom
		var hv := Vector2(a.vel.x, a.vel.z).length()
		if hv > 1.0:
			spread *= 1.35
		if not a.on_ground:
			spread *= 2.0
		var gap := 6.0 + spread * 5.0
		var cc := Color(1, 1, 1, 0.95)
		if int(w.get("cat", -1)) == DB.Cat.MELEE:
			overlay.draw_circle(c, 3.0, cc)
		else:
			for d in [Vector2(1, 0), Vector2(-1, 0), Vector2(0, 1), Vector2(0, -1)]:
				overlay.draw_line(c + d * gap, c + d * (gap + 10.0), Color(0, 0, 0, 0.6), 4.0)
				overlay.draw_line(c + d * gap, c + d * (gap + 10.0), cc, 2.0)
			overlay.draw_circle(c, 1.8, cc)
	elif pc.build_mode:
		overlay.draw_rect(Rect2(c - Vector2(8, 8), Vector2(16, 16)), UI.ACCENT2, false, 2.0)
	# hit / kill markers
	var hk := 1.0 - (t - hit_t) / 0.22
	if hk > 0.0:
		var hc := Color(1.0, 0.85, 0.2, hk) if hit_head else Color(1, 1, 1, hk)
		for d2 in [Vector2(1, 1), Vector2(-1, 1), Vector2(1, -1), Vector2(-1, -1)]:
			overlay.draw_line(c + d2 * 9.0, c + d2 * 18.0, hc, 3.0)
	var kk := 1.0 - (t - kill_t) / 0.7
	if kk > 0.0:
		UI.draw_icon(overlay, "skull", c + Vector2(0, -60), 20.0, Color(1.0, 0.25, 0.2, kk))
	# damage direction arcs
	var keep := []
	for dd in dmg_dirs:
		var age: float = t - float(dd[1])
		if age > 1.3:
			continue
		keep.append(dd)
		var rel := float(dd[0]) - pc.yaw
		var ang3 := -rel - PI * 0.5
		var col2 := Color(1.0, 0.2, 0.15, 1.0 - age / 1.3)
		overlay.draw_arc(c, 120.0, ang3 - 0.35, ang3 + 0.35, 16, col2, 7.0, true)
	dmg_dirs = keep
	# progress bars: reload / heal / revive
	var prog := -1.0
	var ptxt := ""
	if a.use_item != "":
		var dur: float = float(DB.ITEMS.get(a.use_item, {}).get("time", 1.0))
		prog = 1.0 - (a.use_end - t) / dur
		ptxt = "Using " + DB.item_name(a.use_item)
	elif a.reload_end > t:
		prog = 1.0 - (a.reload_end - t) / maxf(0.1, float(a.weapon().get("rel", 1.0)))
		ptxt = "Reloading"
	elif a.revive_target != -1:
		prog = 1.0 - (a.revive_end - t) / 4.0
		ptxt = "Reviving"
	if prog >= 0.0:
		var pr := Rect2(c + Vector2(-110, 60), Vector2(220, 12))
		overlay.draw_rect(pr, Color(0, 0, 0, 0.6))
		overlay.draw_rect(Rect2(pr.position, Vector2(pr.size.x * clampf(prog, 0, 1), pr.size.y)), UI.ACCENT2)
		overlay.draw_string_outline(font, pr.position + Vector2(0, -6), ptxt, HORIZONTAL_ALIGNMENT_CENTER, 220, 18, 5, Color.BLACK)
		overlay.draw_string(font, pr.position + Vector2(0, -6), ptxt, HORIZONTAL_ALIGNMENT_CENTER, 220, 18, Color.WHITE)
	# health + armour (bottom centre above weapon slots)
	if a.is_alive() and not a.in_air_phase():
		var s := sz.y / 720.0
		var bw := 380.0 * s
		var hb := Rect2(c.x - bw * 0.5, sz.y - 100.0 * s, bw, 16.0 * s)
		overlay.draw_rect(hb.grow(2), Color(0, 0, 0, 0.55))
		if a.state == Actor.St.KNOCKED:
			overlay.draw_rect(Rect2(hb.position, Vector2(hb.size.x * a.knock_hp / Actor.KNOCK_HP, hb.size.y)), Color(1.0, 0.45, 0.2))
			overlay.draw_string(font, hb.position + Vector2(0, -6 * s), "KNOCKED - bleeding out", HORIZONTAL_ALIGNMENT_CENTER, bw, int(17 * s), UI.BAD)
		else:
			var hp_col := UI.GOOD if a.hp > 50 else (UI.GOLD if a.hp > 25 else UI.BAD)
			overlay.draw_rect(Rect2(hb.position, Vector2(hb.size.x * a.hp / Actor.MAX_HP, hb.size.y)), hp_col)
			overlay.draw_string(font, hb.position + Vector2(6 * s, 14 * s), "%d" % int(ceil(a.hp)), HORIZONTAL_ALIGNMENT_LEFT, 80, int(15 * s), Color(0.05, 0.05, 0.05))
			var ax := hb.position.x
			for k in 2:
				var lv: int = a.vest_lvl if k == 0 else a.helm_lvl
				var dur2: float = a.vest_dur if k == 0 else a.helm_dur
				var maxd: float = float(DB.ITEMS.get(("vest_%d" if k == 0 else "helm_%d") % maxi(1, lv), {}).get("dur", 100))
				var ar := Rect2(ax + k * (bw * 0.5 + 2), hb.position.y - 12.0 * s, bw * 0.5 - 2, 6.0 * s)
				overlay.draw_rect(ar, Color(0, 0, 0, 0.5))
				if lv > 0:
					overlay.draw_rect(Rect2(ar.position, Vector2(ar.size.x * clampf(dur2 / maxd, 0, 1), ar.size.y)), UI.ACCENT2)
				overlay.draw_string_outline(font, ar.position + Vector2(0, -3 * s), ("VEST" if k == 0 else "HELMET") + (" Lv.%d" % lv if lv > 0 else " -"), HORIZONTAL_ALIGNMENT_LEFT, 140, int(14 * s), 4, Color.BLACK)
				overlay.draw_string(font, ar.position + Vector2(0, -3 * s), ("VEST" if k == 0 else "HELMET") + (" Lv.%d" % lv if lv > 0 else " -"), HORIZONTAL_ALIGNMENT_LEFT, 140, int(14 * s), UI.DIM)
