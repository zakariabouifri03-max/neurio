extends Node
## Main menu / lobby: 3D character diorama, top bar (level, currencies), navigation, mode selection and START.

const NAV := [["MODES", "modes"], ["ROOMS", "rooms"], ["SHOP", "shop"], ["LOCKER", "locker"], ["MISSIONS", "missions"],
	["RANKED", "ranked"], ["FRIENDS", "friends"], ["SETTINGS", "settings"]]

## Selection state lives in the Game autoload so it survives scene changes.
var sel_mode: String:
	get:
		return Game.menu_mode
	set(v):
		Game.menu_mode = v
var net_mode: String:
	get:
		return Game.menu_net
	set(v):
		Game.menu_net = v
var ranked: bool:
	get:
		return Game.menu_ranked
	set(v):
		Game.menu_ranked = v

var ui: Control
var overlay: Control
var preview_actor: Actor
var preview_view: ActorView
var lobby: Node3D
var cam: Camera3D
var name_label: Label
var level_label: Label
var xp_bar: ProgressBar
var coins_label: Label
var gems_label: Label
var mode_title: Label
var mode_sub: Label
var start_btn: Button
var net_buttons := {}
var ranked_check: CheckButton
var missions_btn: Button
var queue_box: Control
var play_card: Control
var _orbit := 0.0
var panel_right := false     # shop/locker open: show the character on the right
var _look_shift := 0.55
var _cam_dist := 3.5

func _ready() -> void:
	get_tree().root.theme = UI.build_theme()
	_build_lobby()
	var layer := CanvasLayer.new()
	add_child(layer)
	ui = Control.new()
	ui.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	ui.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.theme = UI.build_theme()
	layer.add_child(ui)
	_build_top_bar()
	_build_nav()
	_build_play_card()
	overlay = Control.new()
	overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.add_child(overlay)
	Profile.changed.connect(_refresh)
	Net.queue_changed.connect(_on_queue)
	Net.room_changed.connect(_on_room_changed)
	Net.disconnected.connect(func(reason): notice("Disconnected", reason))
	Net.invite_received.connect(func(from, code):
		notice("Room invite", "%s invited you to room %s. Open ROOMS and join with the code." % [from, code]))
	_refresh()
	Audio.music("music_menu")
	if not Game.last_results.is_empty():
		call_deferred("_show_results", Game.last_results)
		Game.last_results = {}
	if Game.menu_notice != "":
		notice("Notice", Game.menu_notice)
		Game.menu_notice = ""
	if not Profile.p.get("season_rewards", []).is_empty():
		var sr: Array = Profile.p["season_rewards"]
		var r: Dictionary = sr[sr.size() - 1]
		notice("Season rewards", "Season ended at %s rank.\n+%d coins  +%d gems%s" % [r["rank"], int(r["coins"]), int(r["gems"]),
			("\nUnlocked: " + DB.COSMETICS.get(r["item"], {}).get("name", "")) if str(r.get("item", "")) != "" else ""])
		Profile.p["season_rewards"] = []
		Profile.save()
	if Net.role != "none" and not Net.room.is_empty():
		call_deferred("open_panel", "rooms")
	if Game.autoplay in ["tour", "bench"]:
		var ap: Node = load("res://tests/autoplay.gd").new()
		add_child(ap)
		ap.call("start_menu", self)

# ------------------------------------------------------------------ 3D lobby
func _build_lobby() -> void:
	VoxelArt.build()
	VoxelArt.unlit_mode = Settings.is_unlit()
	lobby = Node3D.new()
	add_child(lobby)
	var env := WorldEnvironment.new()
	var e := Environment.new()
	var sky := Sky.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(0.2, 0.42, 0.82)
	sm.sky_horizon_color = Color(0.72, 0.84, 0.96)
	sm.ground_horizon_color = Color(0.72, 0.84, 0.96)
	sm.ground_bottom_color = Color(0.35, 0.5, 0.7)
	sky.sky_material = sm
	e.background_mode = Environment.BG_SKY
	e.sky = sky
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.65, 0.7, 0.82)
	e.ambient_light_energy = 0.8
	e.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.environment = e
	lobby.add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation = Vector3(deg_to_rad(-48), deg_to_rad(-30), 0)
	sun.shadow_enabled = Settings.shadows_enabled()
	lobby.add_child(sun)
	# little floating voxel island
	var w := VoxelWorld.new()
	w.setup(16, 16, 16)
	var heights := PackedInt32Array()
	var surf := PackedByteArray()
	heights.resize(256)
	surf.resize(256)
	for x in 16:
		for z in 16:
			var d := Vector2(x - 7.5, z - 7.5).length()
			heights[x * 16 + z] = 0 if d > 7.6 else int(6 - d * 0.35)
			surf[x * 16 + z] = Blocks.GRASS
	WorldGen._alloc(w, heights, surf)
	for x in 16:
		for z in 16:
			if heights[x * 16 + z] <= 0:
				for y in 16:
					w.data[(x * 16 + z) * 16 + y] = Blocks.AIR
				w.top[x * 16 + z] = 0
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	WorldGen._oak(w, 2, w.ground_y(2, 2), 2, rng)
	WorldGen._boulder(w, 12, w.ground_y(12, 11), 11, rng)
	w.set_b(12, w.ground_y(12, 3), 3, Blocks.CRATE)
	w.set_b(12, w.ground_y(12, 3) + 1, 3, Blocks.CRATE)
	w.set_b(13, w.ground_y(13, 3), 3, Blocks.CRATE)
	VoxelMesher.prepare()
	var mi := MeshInstance3D.new()
	mi.mesh = VoxelMesher.arrays_to_mesh(VoxelMesher.build_chunk(w, 0, 0))
	mi.position = Vector3(-8, -6, -8)
	lobby.add_child(mi)
	cam = Camera3D.new()
	cam.fov = 50
	lobby.add_child(cam)
	cam.current = true
	_rebuild_preview()

func _rebuild_preview(cos: Dictionary = {}) -> void:
	if preview_view:
		preview_view.queue_free()
	preview_actor = Actor.new()
	preview_actor.name = Profile.player_name()
	preview_actor.cosmetics = cos if not cos.is_empty() else Profile.equip_dict()
	preview_actor.cur = 3
	preview_actor.slots[3] = ""
	preview_actor.on_ground = true
	preview_actor.pos = Vector3(0.6, 0.0, 0.0)
	preview_actor.yaw = PI - 0.35
	preview_view = ActorView.new()
	lobby.add_child(preview_view)
	preview_view.setup(preview_actor, 0, Settings.is_unlit())
	preview_view.label.visible = false
	preview_view.set_weapon("", "")
	preview_view.snap_to(preview_actor.pos)

## Shows a cosmetic on the lobby character without buying/equipping it.
func preview_cosmetic(id: String) -> void:
	var c: Dictionary = DB.COSMETICS.get(id, {})
	if c.is_empty():
		return
	var cos := Profile.equip_dict()
	if c["type"] in ["emote", "victory"]:
		var emote_id := id
		if c["type"] == "victory":
			for eid in DB.COSMETICS:
				if DB.COSMETICS[eid]["type"] == "emote" and int(DB.COSMETICS[eid]["anim"]) == int(c["anim"]):
					emote_id = eid
		_rebuild_preview(cos)
		preview_actor.emote = emote_id
		var who := preview_actor
		get_tree().create_timer(4.0).timeout.connect(func():
			if who:
				who.emote = "")
		return
	cos[c["type"]] = id
	_rebuild_preview(cos)
	if c["type"] == "wrap":
		# show the wrap on a rifle held in the aiming pose
		preview_actor.slots[0] = "ar_strike"
		preview_actor.cur = 0
		preview_view.set_weapon("ar_strike", id)

func _process(dt: float) -> void:
	_orbit += dt * 0.35
	var chest := Vector3(0.6, 1.0, 0.0)
	_look_shift = lerpf(_look_shift, -1.45 if panel_right else 0.55, minf(1.0, dt * 6.0))
	_cam_dist = lerpf(_cam_dist, 4.6 if panel_right else 3.5, minf(1.0, dt * 6.0))
	cam.global_position = chest + Vector3(sin(_orbit) * 0.45, 0.25, _cam_dist)
	cam.look_at(chest + Vector3(_look_shift, 0.05, 0), Vector3.UP)

# ------------------------------------------------------------------ layout
func _build_top_bar() -> void:
	var bar := UI.panel(Color(0.05, 0.07, 0.12, 0.82), 0, Color(0, 0, 0, 0))
	bar.set_anchors_preset(Control.PRESET_TOP_WIDE)
	bar.custom_minimum_size = Vector2(0, 72)
	var h := UI.hbox(14)
	var badge := UI.panel(UI.ACCENT, 30, Color(1, 0.9, 0.6))
	badge.custom_minimum_size = Vector2(58, 50)
	level_label = UI.label("1", 26, Color(0.15, 0.08, 0), 0)
	level_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	badge.add_child(level_label)
	h.add_child(badge)
	var nv := UI.vbox(2)
	name_label = UI.label("Player", 24)
	nv.add_child(name_label)
	xp_bar = UI.progress(0, 100, UI.ACCENT, 10)
	xp_bar.custom_minimum_size = Vector2(220, 10)
	nv.add_child(xp_bar)
	h.add_child(nv)
	h.add_child(UI.spacer(0, 0, true))
	var title := UI.label("BLOCKSTRIKE ROYALE", 30, UI.ACCENT, 6)
	h.add_child(title)
	h.add_child(UI.spacer(0, 0, true))
	coins_label = _currency_pill(h, "coin")
	gems_label = _currency_pill(h, "gem")
	h.add_child(UI.button("Settings", func(): open_panel("settings"), "ghost", Vector2(120, 48), 20))
	bar.add_child(h)
	ui.add_child(bar)

func _currency_pill(parent: Control, icon: String) -> Label:
	var p := UI.panel(Color(0, 0, 0, 0.45), 20, Color(1, 1, 1, 0.15))
	var h := UI.hbox(8)
	var ic := Control.new()
	ic.custom_minimum_size = Vector2(26, 26)
	ic.draw.connect(func(): UI.draw_icon(ic, icon, Vector2(13, 13), 11, Color.WHITE))
	h.add_child(ic)
	var l := UI.label("0", 22, UI.GOLD if icon == "coin" else UI.GEM)
	l.custom_minimum_size = Vector2(70, 0)
	h.add_child(l)
	p.add_child(h)
	parent.add_child(p)
	return l

func _build_nav() -> void:
	var v := UI.vbox(10)
	v.position = Vector2(22, 96)
	v.size = Vector2(230, 560)
	for n in NAV:
		var key: String = n[1]
		var b := UI.button(n[0], func(): open_panel(key), "normal", Vector2(220, 56), 24)
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		v.add_child(b)
		if key == "missions":
			missions_btn = b
	ui.add_child(v)

func _build_play_card() -> void:
	var p := UI.panel(Color(0.05, 0.07, 0.12, 0.88), 18)
	p.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	p.position = Vector2(-450, -330)
	p.size = Vector2(430, 310)
	var v := UI.vbox(10)
	mode_title = UI.label("", 28, UI.TEXT, 0)
	mode_sub = UI.label("", 18, UI.DIM, 0)
	mode_sub.autowrap_mode = TextServer.AUTOWRAP_WORD
	v.add_child(mode_title)
	v.add_child(mode_sub)
	var nh := UI.hbox(6)
	for nm in [["OFFLINE", "offline"], ["LAN", "lan"], ["ONLINE", "online"]]:
		var key: String = nm[1]
		var b := UI.button(nm[0], func():
			net_mode = key
			_refresh(), "ghost", Vector2(126, 44), 19)
		net_buttons[key] = b
		nh.add_child(b)
	v.add_child(nh)
	ranked_check = UI.check("Ranked match", ranked, func(x):
		ranked = x
		_refresh())
	v.add_child(ranked_check)
	start_btn = UI.button("START", _on_start, "primary", Vector2(0, 74), 36)
	v.add_child(start_btn)
	p.add_child(v)
	ui.add_child(p)
	play_card = p
	queue_box = UI.panel(Color(0.05, 0.07, 0.12, 0.92), 14)
	queue_box.set_anchors_preset(Control.PRESET_CENTER_TOP)
	queue_box.position = Vector2(-260, 90)
	queue_box.size = Vector2(520, 70)
	var qh := UI.hbox(10)
	var ql := UI.label("Searching...", 22)
	ql.name = "Q"
	ql.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	qh.add_child(ql)
	qh.add_child(UI.button("Cancel", func():
		Net.cancel_queue()
		queue_box.visible = false, "danger", Vector2(120, 46), 20))
	queue_box.add_child(qh)
	queue_box.visible = false
	ui.add_child(queue_box)

func _refresh() -> void:
	name_label.text = Profile.player_name()
	level_label.text = str(Profile.level())
	var xp := Profile.xp_progress()
	xp_bar.max_value = xp.y
	xp_bar.value = xp.x
	coins_label.text = str(int(Profile.p["coins"]))
	gems_label.text = str(int(Profile.p["gems"]))
	var md: Dictionary = DB.MODES[sel_mode]
	mode_title.text = md["name"]
	var map: Dictionary = DB.MAPS[md["map"]]
	mode_sub.text = "%s  -  up to %d players\n%s" % [map["name"], int(md["players"]), map["desc"]]
	for k in net_buttons:
		var b: Button = net_buttons[k]
		b.add_theme_stylebox_override("normal", UI.box(UI.ACCENT2.darkened(0.3) if k == net_mode else Color(1, 1, 1, 0.06), 12, UI.ACCENT2 if k == net_mode else Color(1, 1, 1, 0.15), 2))
	ranked_check.visible = sel_mode != "training" and net_mode != "lan"
	var label := "START"
	match net_mode:
		"offline":
			label = "START  (vs bots)" if sel_mode != "training" else "START TRAINING"
		"lan":
			label = "LAN ROOMS"
		"online":
			label = "FIND MATCH" if sel_mode != "training" else "START TRAINING"
	start_btn.text = label
	var n := Profile.claimable_count()
	missions_btn.text = "MISSIONS" + ("  (%d)" % n if n > 0 else "")
	if preview_actor and preview_actor.cosmetics != Profile.equip_dict():
		_rebuild_preview()

func _on_start() -> void:
	if sel_mode == "training":
		Game.start_offline("training", {"bot_count": 2})
		return
	match net_mode:
		"offline":
			Game.start_offline(sel_mode, {"ranked": ranked, "difficulty": 2 if ranked else int(Settings.get_v("difficulty"))})
		"lan":
			open_panel("rooms")
		"online":
			if str(Settings.get_v("server_addr")).strip_edges() == "":
				notice("Online server not configured", "Real online matches need a BlockStrike dedicated server.\nEnter its address in Settings > Online.\nRun one yourself with:  godot --headless --path . -- --server\n(see docs/SERVER.md). You can play LAN or Offline vs bots right now.")
				return
			if Net.role != "client" or not Net.connected:
				var err := Net.connect_online()
				if err != "":
					notice("Connection failed", err)
					return
				queue_box.visible = true
				(queue_box.find_child("Q", true, false) as Label).text = "Connecting to server..."
				await Net.connected_ok
			Net.quick_play(sel_mode, ranked)
			queue_box.visible = true
			(queue_box.find_child("Q", true, false) as Label).text = "Searching for players..."

func _on_queue(info: Dictionary) -> void:
	queue_box.visible = true
	(queue_box.find_child("Q", true, false) as Label).text = "Searching %s - %d in queue - %ds (bots fill in %ds)" % [DB.MODES.get(info.get("mode", ""), {}).get("short", ""), int(info.get("waiting", 1)), int(info.get("secs", 0)), int(info.get("eta", 0))]

func _on_room_changed(r: Dictionary) -> void:
	if not r.is_empty():
		queue_box.visible = false

# ------------------------------------------------------------------ overlays
func open_panel(key: String) -> void:
	close_panel()
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.5)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	overlay.add_child(dim)
	overlay.mouse_filter = Control.MOUSE_FILTER_STOP
	panel_right = key in ["shop", "locker"]
	play_card.visible = false
	if panel_right:
		dim.color = Color(0, 0, 0, 0.12)
	var p := UI.panel()
	p.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	p.offset_left = 40
	p.offset_right = -480 if panel_right else -40
	p.offset_top = 84
	p.offset_bottom = -20
	var v := UI.vbox(10)
	var head := UI.hbox()
	var title := UI.label(key.to_upper(), 34, UI.ACCENT, 4)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(title)
	head.add_child(UI.button("Back", close_panel, "ghost", Vector2(120, 48), 22))
	v.add_child(head)
	var body := Control.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.add_child(body)
	p.add_child(v)
	overlay.add_child(p)
	var content: Control
	if key == "rooms":
		content = RoomsPanel.new()
		(content as RoomsPanel).menu = self
	else:
		content = MenuPanels.build(key, self)
	content.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	body.add_child(content)

func close_panel() -> void:
	panel_right = false
	if play_card:
		play_card.visible = true
	for c in overlay.get_children():
		c.queue_free()
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_refresh()

func notice(title: String, text: String) -> void:
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.55)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var p := UI.panel()
	p.set_anchors_preset(Control.PRESET_CENTER)
	p.position = Vector2(-330, -170)
	p.size = Vector2(660, 340)
	var v := UI.vbox(14)
	v.add_child(UI.label(title, 30, UI.ACCENT, 4))
	var l := UI.label(text, 20, UI.TEXT)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD
	l.custom_minimum_size = Vector2(600, 0)
	l.size_flags_vertical = Control.SIZE_EXPAND_FILL
	v.add_child(l)
	v.add_child(UI.button("OK", func():
		dim.queue_free()
		p.queue_free(), "primary", Vector2(0, 52)))
	p.add_child(v)
	ui.add_child(dim)
	ui.add_child(p)

func select_mode(mode: String) -> void:
	sel_mode = mode
	close_panel()

func _show_results(r: Dictionary) -> void:
	var res: Dictionary = r["res"]
	var rw: Dictionary = r["rewards"]
	var won: bool = res.get("won", false)
	var lines := []
	var title := "VICTORY!" if won else "MATCH COMPLETE"
	if res.get("kind", "") == "br":
		title = "#%d  %s" % [int(res.get("placement", 0)), "CHAMPION!" if won else "PLACE"]
	elif res.get("kind", "") == "training":
		title = "TRAINING SESSION"
	lines.append("Eliminations %d    Damage %d    Headshots %d" % [int(res.get("kills", 0)), int(res.get("damage", 0)), int(res.get("headshots", 0))])
	lines.append("Survived %s    Healed %d    Blocks placed %d" % [UI.fmt_time(float(res.get("survive", 0))), int(res.get("healed", 0)), int(res.get("blocks", 0))])
	lines.append("")
	lines.append("+%d XP     +%d coins" % [int(rw.get("xp", 0)), int(rw.get("coins", 0))])
	for up in rw.get("levels", []):
		lines.append("LEVEL UP! Level %d  (+%d coins%s)" % [int(up["level"]), int(up["coins"]), (" +%d gems" % int(up["gems"])) if int(up["gems"]) > 0 else ""])
		Audio.play_ui("levelup")
	for mt in rw.get("missions", []):
		lines.append("Mission complete: " + str(mt))
	if res.get("ranked", false):
		var d: int = int(rw.get("rp_delta", 0))
		lines.append("Ranked: %s%d RP  -  %s" % ["+" if d >= 0 else "", d, DB.RANKS[int(rw.get("rank_after", 0))]["name"]])
		if int(rw.get("rank_after", 0)) > int(rw.get("rank_before", 0)):
			lines.append("PROMOTED to %s!" % DB.RANKS[int(rw["rank_after"])]["name"])
	notice(title, "\n".join(lines))
