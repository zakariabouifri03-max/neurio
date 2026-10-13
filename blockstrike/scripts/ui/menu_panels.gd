class_name MenuPanels
extends RefCounted
## Builders for the main-menu panels.

static var shop_tab := "featured"
static var locker_tab := "skin"
static var settings_tab := "graphics"

static func build(key: String, menu: Node) -> Control:
	match key:
		"modes":
			return _modes(menu)
		"shop":
			return _shop(menu, false)
		"locker":
			return _shop(menu, true)
		"missions":
			return _missions(menu)
		"ranked":
			return _ranked(menu)
		"friends":
			return _friends(menu)
		"settings":
			return _settings(menu)
	return UI.label("?")

static func _scroll(child: Control) -> ScrollContainer:
	var sc := ScrollContainer.new()
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	child.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sc.add_child(child)
	return sc

static func _rebuild(menu: Node, key: String) -> void:
	menu.call("open_panel", key)

# ------------------------------------------------------------------ modes
static func _modes(menu: Node) -> Control:
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 16)
	grid.add_theme_constant_override("v_separation", 16)
	var descs := {
		"br_solo": "Drop from the plane, loot, survive the shrinking zone. Last one standing wins.",
		"br_duo": "Team up in pairs. Knocked teammates can be revived.",
		"br_squad": "Squads of four battle for the island. Revive and coordinate.",
		"clash_squad": "4v4 rounds. Earn credits and buy weapons each round. First to 4 wins.",
		"arena_2v2": "Fast 2v2 rounds on a small arena with random loadouts. First to 3.",
		"training": "Practice range with weapon racks, moving targets and AI bots.",
	}
	for mode in DB.MODE_ORDER:
		var md: Dictionary = DB.MODES[mode]
		var card := UI.panel(UI.BG2 if mode != menu.get("sel_mode") else UI.ACCENT2.darkened(0.55), 16, UI.ACCENT2 if mode == menu.get("sel_mode") else UI.LINE)
		card.custom_minimum_size = Vector2(360, 230)
		var v := UI.vbox(8)
		v.add_child(UI.label(md["name"], 26, UI.TEXT))
		v.add_child(UI.label("%s  -  %d players  -  teams of %d" % [DB.MAPS[md["map"]]["name"], int(md["players"]), int(md["team"])], 17, UI.GOLD))
		var d := UI.label(descs.get(mode, ""), 18, UI.DIM)
		d.autowrap_mode = TextServer.AUTOWRAP_WORD
		d.custom_minimum_size = Vector2(320, 70)
		v.add_child(d)
		var m: String = mode
		v.add_child(UI.button("Select", func(): menu.call("select_mode", m), "primary" if mode == menu.get("sel_mode") else "blue", Vector2(0, 48), 22))
		card.add_child(v)
		grid.add_child(card)
	var v2 := UI.vbox(12)
	v2.add_child(UI.label("Choose OFFLINE (vs AI bots), LAN (same Wi-Fi) or ONLINE (dedicated server) on the play card.", 18, UI.DIM))
	v2.add_child(grid)
	return _scroll(v2)

# ------------------------------------------------------------------ shop & locker
static func _shop(menu: Node, locker: bool) -> Control:
	var root := UI.vbox(10)
	var tabs := UI.hbox(8)
	var tab: String = locker_tab if locker else shop_tab
	var tab_list := ["featured"] + DB.COSMETIC_TYPES if not locker else DB.COSMETIC_TYPES
	for t in tab_list:
		var name: String = "Featured" if t == "featured" else DB.COSMETIC_TYPE_NAMES[t]
		var tt: String = t
		tabs.add_child(UI.button(name, func():
			if locker:
				locker_tab = tt
			else:
				shop_tab = tt
			_rebuild(menu, "locker" if locker else "shop"), "blue" if t == tab else "ghost", Vector2(0, 44), 18))
	root.add_child(tabs)
	var note := UI.label("All items are cosmetic only and never change combat stats. Coins and gems are earned by playing." if not locker
		else "Equip cosmetics you own. Tap Preview to see them on your character.", 17, UI.DIM)
	root.add_child(note)
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 12)
	grid.add_theme_constant_override("v_separation", 12)
	var items := []
	if tab == "featured":
		for id in Profile.featured():
			items.append(DB.COSMETICS[id])
	else:
		items = DB.cosmetics_of(tab)
	for c in items:
		var id: String = c["id"]
		var owned := Profile.owns(id)
		if locker and not owned:
			continue
		var equipped: bool = Profile.equip_dict().get(c["type"], "") == id
		var card := UI.panel(UI.BG2, 12, DB.RARITY_COLORS[int(c["rarity"])])
		card.custom_minimum_size = Vector2(270, 170)
		var v := UI.vbox(6)
		v.add_child(UI.label(c["name"], 22, DB.RARITY_COLORS[int(c["rarity"])]))
		v.add_child(UI.label("%s  -  %s" % [DB.RARITY_NAMES[int(c["rarity"])], DB.COSMETIC_TYPE_NAMES[c["type"]]], 15, UI.DIM))
		var price := Profile.price_of(id)
		var ptxt := ""
		if owned:
			ptxt = "EQUIPPED" if equipped else "OWNED"
		elif int(price["gems"]) > 0:
			ptxt = "%d gems" % int(price["gems"])
		else:
			ptxt = "%d coins" % int(price["coins"])
		if price.get("sale", false) and not owned:
			ptxt += "  (-20%)"
		v.add_child(UI.label(ptxt, 19, UI.GOOD if owned else (UI.GEM if int(price["gems"]) > 0 else UI.GOLD)))
		var h := UI.hbox(6)
		h.add_child(UI.button("Preview", func(): menu.call("preview_cosmetic", id), "ghost", Vector2(110, 40), 17))
		if owned:
			var b := UI.button("Equipped" if equipped else "Equip", func():
				Profile.equip(c["type"], id)
				_rebuild(menu, "locker" if locker else "shop"), "good", Vector2(110, 40), 17)
			b.disabled = equipped
			h.add_child(b)
		else:
			h.add_child(UI.button("Buy", func():
				var err := Profile.buy(id)
				if err == "":
					Audio.play_ui("buy")
					Profile.equip(c["type"], id)
					_rebuild(menu, "shop")
				else:
					Audio.play_ui("error")
					menu.call("notice", "Can't buy", err), "primary", Vector2(110, 40), 17))
		v.add_child(h)
		card.add_child(v)
		grid.add_child(card)
	root.add_child(_scroll(grid))
	return root

# ------------------------------------------------------------------ missions & achievements
static func _missions(menu: Node) -> Control:
	var cols := UI.hbox(16)
	for kind in ["daily", "weekly"]:
		var v := UI.vbox(10)
		v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		v.add_child(UI.label("DAILY MISSIONS" if kind == "daily" else "WEEKLY MISSIONS", 26, UI.ACCENT))
		var list: Array = Profile.p[kind]["list"]
		for i in list.size():
			var mrec: Dictionary = list[i]
			var d := Profile.mission_def(kind, mrec["id"])
			if d.is_empty():
				continue
			var row := UI.panel(UI.BG2, 12)
			var rv := UI.vbox(6)
			rv.add_child(UI.label(d["text"], 20))
			var rew := "+%d coins  +%d XP" % [int(d.get("coins", 0)), int(d.get("xp", 0))]
			if int(d.get("gems", 0)) > 0:
				rew += "  +%d gems" % int(d["gems"])
			var h := UI.hbox(8)
			var pb := UI.progress(float(mrec["progress"]), float(d["goal"]), UI.GOOD)
			pb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			h.add_child(pb)
			h.add_child(UI.label("%d/%d" % [int(mrec["progress"]), int(d["goal"])], 17, UI.DIM))
			rv.add_child(h)
			var h2 := UI.hbox(8)
			var rl := UI.label(rew, 16, UI.GOLD)
			rl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			h2.add_child(rl)
			var done := int(mrec["progress"]) >= int(d["goal"])
			var idx := i
			var k: String = kind
			var b := UI.button("Claimed" if mrec["claimed"] else "Claim", func():
				if Profile.claim_mission(k, idx):
					Audio.play_ui("buy")
				_rebuild(menu, "missions"), "good" if done and not mrec["claimed"] else "ghost", Vector2(110, 40), 17)
			b.disabled = mrec["claimed"] or not done
			h2.add_child(b)
			rv.add_child(h2)
			row.add_child(rv)
			v.add_child(row)
		cols.add_child(v)
	var av := UI.vbox(8)
	av.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	av.add_child(UI.label("ACHIEVEMENTS", 26, UI.ACCENT))
	for a in DB.ACHIEVEMENTS:
		var prog := Profile.achievement_progress(a)
		var claimed: bool = Profile.p["ach"].has(a["id"])
		var h3 := UI.hbox(8)
		var l := UI.label("%s  (%d/%d)" % [a["text"], mini(prog, int(a["goal"])), int(a["goal"])], 17, UI.GOOD if claimed else UI.TEXT)
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		l.autowrap_mode = TextServer.AUTOWRAP_WORD
		h3.add_child(l)
		var aid: String = a["id"]
		var b2 := UI.button("Done" if claimed else "+%d gems" % int(a["gems"]), func():
			if Profile.claim_achievement(aid):
				Audio.play_ui("buy")
			_rebuild(menu, "missions"), "good" if prog >= int(a["goal"]) and not claimed else "ghost", Vector2(120, 38), 16)
		b2.disabled = claimed or prog < int(a["goal"])
		h3.add_child(b2)
		av.add_child(h3)
	cols.add_child(av)
	return _scroll(cols)

# ------------------------------------------------------------------ ranked
static func _ranked(menu: Node) -> Control:
	var v := UI.vbox(12)
	var rp := Profile.rp()
	var ri := DB.rank_index(rp)
	var rank: Dictionary = DB.RANKS[ri]
	var top := UI.hbox(24)
	var badge := UI.panel(rank["color"].darkened(0.5), 18, rank["color"])
	badge.custom_minimum_size = Vector2(240, 140)
	var bv := UI.vbox(4)
	bv.add_child(UI.label(rank["name"].to_upper(), 40, rank["color"], 6))
	bv.add_child(UI.label("%d RP" % rp, 26))
	badge.add_child(bv)
	top.add_child(badge)
	var info := UI.vbox(8)
	info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	info.add_child(UI.label("Season %d  -  %d days left" % [Profile.season_id() % 1000, Profile.season_days_left()], 24, UI.ACCENT))
	if ri < DB.RANKS.size() - 1:
		var nxt: Dictionary = DB.RANKS[ri + 1]
		info.add_child(UI.label("Next: %s at %d RP" % [nxt["name"], int(nxt["rp"])], 20))
		var pb := UI.progress(rp - int(rank["rp"]), int(nxt["rp"]) - int(rank["rp"]), rank["color"], 16)
		pb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		info.add_child(pb)
	else:
		info.add_child(UI.label("Top league reached!", 20, UI.GOLD))
	info.add_child(UI.label("Peak this season: %s   Ranked matches: %d" % [DB.RANKS[DB.rank_index(int(Profile.p["rank"]["peak"]))]["name"], int(Profile.p["rank"]["matches"])], 18, UI.DIM))
	var hb := UI.hbox(10)
	hb.add_child(UI.button("Ranked BR Squad", func():
		menu.set("sel_mode", "br_squad")
		menu.set("ranked", true)
		menu.call("close_panel"), "primary", Vector2(0, 50), 20))
	hb.add_child(UI.button("Ranked Clash Squad", func():
		menu.set("sel_mode", "clash_squad")
		menu.set("ranked", true)
		menu.call("close_panel"), "primary", Vector2(0, 50), 20))
	info.add_child(hb)
	info.add_child(UI.label("Ranked works ONLINE (vs players + bot fill) or OFFLINE vs hard bots.", 16, UI.DIM))
	top.add_child(info)
	v.add_child(top)
	v.add_child(UI.label("LEAGUES & SEASON REWARDS (based on your peak rank)", 22, UI.ACCENT))
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 12)
	grid.add_theme_constant_override("v_separation", 8)
	for i in DB.RANKS.size():
		var r: Dictionary = DB.RANKS[i]
		var rw: Dictionary = DB.SEASON_REWARDS[i]
		var txt := "%s  %d+ RP\n%d coins%s%s" % [r["name"], int(r["rp"]), int(rw["coins"]), (" + %d gems" % int(rw["gems"])) if int(rw["gems"]) > 0 else "",
			("\n+ " + DB.COSMETICS[rw["item"]]["name"]) if rw.has("item") else ""]
		var card := UI.panel(UI.BG2 if i != ri else r["color"].darkened(0.6), 10, r["color"])
		card.custom_minimum_size = Vector2(290, 92)
		card.add_child(UI.label(txt, 17, r["color"] if i <= ri else UI.DIM))
		grid.add_child(card)
	v.add_child(grid)
	v.add_child(UI.label("RECENT MATCHES", 22, UI.ACCENT))
	for h in (Profile.p["history"] as Array).slice(0, 6):
		var md: String = DB.MODES.get(h["mode"], {}).get("short", h["mode"])
		v.add_child(UI.label("%s   #%d   %d kills   %d dmg   %s" % [md, int(h["place"]), int(h["kills"]), int(h["dmg"]),
			("%+d RP" % int(h["rp"])) if int(h.get("rp", 0)) != 0 else ""], 17, UI.GOOD if h["won"] else UI.TEXT))
	return _scroll(v)

# ------------------------------------------------------------------ friends
static func _friends(menu: Node) -> Control:
	var v := UI.vbox(12)
	var h := UI.hbox(10)
	h.add_child(UI.label("Your friend code:", 22))
	h.add_child(UI.label(str(Profile.p["id"]), 28, UI.GOLD, 4))
	h.add_child(UI.button("Copy", func():
		DisplayServer.clipboard_set(str(Profile.p["id"]))
		menu.call("notice", "Copied", "Friend code copied to clipboard."), "ghost", Vector2(100, 44), 18))
	v.add_child(h)
	var add := UI.hbox(10)
	var le := LineEdit.new()
	le.placeholder_text = "Enter a friend code (8 characters)"
	le.custom_minimum_size = Vector2(380, 48)
	add.add_child(le)
	add.add_child(UI.button("Add friend", func():
		var err := Profile.add_friend(le.text)
		if err != "":
			menu.call("notice", "Friends", err)
		else:
			_rebuild(menu, "friends"), "good", Vector2(160, 48), 20))
	v.add_child(add)
	var online_note := "Online status and invites work while connected to an online server." if Net.role != "client" else "Connected - online friends are marked."
	v.add_child(UI.label(online_note, 17, UI.DIM))
	var list := UI.vbox(8)
	var online: Array = menu.get_meta("online_friends", [])
	for f in Profile.p["friends"]:
		var row := UI.hbox(10)
		var on: bool = str(f["id"]) in online
		var l := UI.label("%s   (%s)   %s" % [f["name"], f["id"], "ONLINE" if on else ("offline" if Net.role == "client" else "")], 20, UI.GOOD if on else UI.TEXT)
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(l)
		var fid: String = f["id"]
		if Net.role == "client" and not Net.room.is_empty():
			row.add_child(UI.button("Invite", func(): Net.invite_friend(fid), "blue", Vector2(110, 40), 17))
		row.add_child(UI.button("Remove", func():
			Profile.remove_friend(fid)
			_rebuild(menu, "friends"), "danger", Vector2(110, 40), 17))
		list.add_child(row)
	if (Profile.p["friends"] as Array).is_empty():
		list.add_child(UI.label("No friends yet - share your code!", 20, UI.DIM))
	v.add_child(list)
	if Net.role == "client":
		var ids := []
		for f in Profile.p["friends"]:
			ids.append(f["id"])
		Net.request_presence(ids)
		if not Net.presence_received.is_connected(_on_presence.bind(menu)):
			Net.presence_received.connect(_on_presence.bind(menu), CONNECT_ONE_SHOT)
	v.add_child(UI.label("RECENT PLAYERS", 22, UI.ACCENT))
	for r in (Profile.p["recent"] as Array).slice(0, 10):
		v.add_child(UI.label("%s  -  %s" % [r["name"], DB.MODES.get(r["mode"], {}).get("short", "")], 18, UI.DIM))
	return _scroll(v)

static func _on_presence(online: Array, menu: Node) -> void:
	if menu.get_meta("online_friends", []) != online:
		menu.set_meta("online_friends", online)

# ------------------------------------------------------------------ settings
static func _settings(menu: Node) -> Control:
	var root := UI.vbox(10)
	var tabs := UI.hbox(8)
	for t in [["graphics", "Graphics"], ["controls", "Controls"], ["audio", "Audio"], ["gameplay", "Gameplay"], ["online", "Online"], ["about", "About"]]:
		var key: String = t[0]
		tabs.add_child(UI.button(t[1], func():
			settings_tab = key
			_rebuild(menu, "settings"), "blue" if key == settings_tab else "ghost", Vector2(0, 44), 19))
	root.add_child(tabs)
	var v := UI.vbox(12)
	match settings_tab:
		"graphics":
			v.add_child(_row("Quality preset", UI.options(["Auto (%s)" % Settings.QUALITY_NAMES[Settings.detected_quality], "Low", "Medium", "High"], int(Settings.get_v("quality")) + 1,
				func(i):
					Settings.set_v("quality", i - 1)
					Settings.set_v("render_scale", 0.0)
					Settings.set_v("view_dist", 0)
					Settings.set_v("shadows", -1)
					_rebuild(menu, "settings"))))
			var rs_val := Settings.render_scale()
			v.add_child(_row("Resolution scale (%d%%)" % int(rs_val * 100), UI.slider(0.5, 1.0, 0.05, rs_val, func(x): Settings.set_v("render_scale", x))))
			v.add_child(_row("View distance (%d m)" % int(Settings.view_distance()), UI.slider(48, 200, 8, Settings.view_distance(), func(x): Settings.set_v("view_dist", int(x)))))
			v.add_child(_row("Frame rate cap", UI.options(["30 FPS", "60 FPS", "90 FPS", "120 FPS"], [30, 60, 90, 120].find(Settings.fps_cap()), func(i): Settings.set_v("fps", [30, 60, 90, 120][i]))))
			v.add_child(UI.check("Shadows", Settings.shadows_enabled(), func(x): Settings.set_v("shadows", 1 if x else 0)))
			v.add_child(UI.check("Show FPS counter", bool(Settings.get_v("show_fps")), func(x): Settings.set_v("show_fps", x)))
			v.add_child(UI.label("Low: unlit voxels, no shadows, 64 m view, 70% resolution, 30 FPS (2-3 GB phones).\nMedium: lighting + shadows, 96 m.  High: 140 m, glow, full resolution.", 16, UI.DIM))
		"controls":
			v.add_child(_row("Look sensitivity", UI.slider(0.2, 3.0, 0.05, float(Settings.get_v("sens_look")), func(x): Settings.set_v("sens_look", x))))
			v.add_child(_row("Aim (scope) sensitivity", UI.slider(0.2, 2.0, 0.05, float(Settings.get_v("sens_aim")), func(x): Settings.set_v("sens_aim", x))))
			v.add_child(_row("Button opacity", UI.slider(0.3, 1.0, 0.05, float(Settings.get_v("btn_opacity")), func(x): Settings.set_v("btn_opacity", x))))
			v.add_child(_row("Button size", UI.slider(0.7, 1.4, 0.05, float(Settings.get_v("btn_scale")), func(x): Settings.set_v("btn_scale", x))))
			v.add_child(UI.check("Invert vertical look", bool(Settings.get_v("invert_y")), func(x): Settings.set_v("invert_y", x)))
			v.add_child(UI.check("Left fire button", bool(Settings.get_v("left_fire")), func(x): Settings.set_v("left_fire", x)))
			v.add_child(UI.check("Auto pick-up (ammo, meds, better armour)", bool(Settings.get_v("auto_pickup")), func(x): Settings.set_v("auto_pickup", x)))
			v.add_child(UI.check("Vibration", bool(Settings.get_v("vibration")), func(x): Settings.set_v("vibration", x)))
			v.add_child(UI.button("Reset button layout", func():
				Settings.reset_layout()
				menu.call("notice", "Layout", "Button positions reset. Move buttons in a match: Pause > Edit button layout."), "ghost", Vector2(320, 48), 20))
			v.add_child(UI.label("Desktop: WASD move, mouse look (click to capture), LMB fire, RMB aim, Space jump, C crouch, R reload,\nF interact, 1-5 weapons, H heal, B build mode (V / LMB place), G throw, M map, Tab inventory, Esc pause.", 16, UI.DIM))
		"audio":
			v.add_child(_row("Master volume", UI.slider(0, 1, 0.05, float(Settings.get_v("vol_master")), func(x): Settings.set_v("vol_master", x))))
			v.add_child(_row("Music", UI.slider(0, 1, 0.05, float(Settings.get_v("vol_music")), func(x): Settings.set_v("vol_music", x))))
			v.add_child(_row("Effects", UI.slider(0, 1, 0.05, float(Settings.get_v("vol_sfx")), func(x): Settings.set_v("vol_sfx", x))))
		"gameplay":
			v.add_child(_row("Bot difficulty (offline)", UI.options(["Easy", "Normal", "Hard"], int(Settings.get_v("difficulty")), func(i): Settings.set_v("difficulty", i))))
			v.add_child(UI.check("Allow block building in offline matches", bool(Settings.get_v("building")), func(x): Settings.set_v("building", x)))
			v.add_child(UI.check("Damage numbers", bool(Settings.get_v("damage_numbers")), func(x): Settings.set_v("damage_numbers", x)))
		"online":
			var name_le := LineEdit.new()
			name_le.text = Profile.player_name()
			name_le.custom_minimum_size = Vector2(320, 48)
			name_le.max_length = 16
			name_le.text_submitted.connect(func(t): Profile.set_player_name(t))
			name_le.focus_exited.connect(func(): Profile.set_player_name(name_le.text))
			v.add_child(_row("Player name", name_le))
			var addr := LineEdit.new()
			addr.text = str(Settings.get_v("server_addr"))
			addr.placeholder_text = "e.g. play.example.com or 203.0.113.5"
			addr.custom_minimum_size = Vector2(420, 48)
			addr.text_changed.connect(func(t): Settings.set_v("server_addr", t.strip_edges()))
			v.add_child(_row("Online server address", addr))
			var port := SpinBox.new()
			port.min_value = 1024
			port.max_value = 65535
			port.value = int(Settings.get_v("server_port"))
			port.value_changed.connect(func(x): Settings.set_v("server_port", int(x)))
			v.add_child(_row("Server port (UDP)", port))
			var lport := SpinBox.new()
			lport.min_value = 1024
			lport.max_value = 65535
			lport.value = int(Settings.get_v("lan_port"))
			lport.value_changed.connect(func(x): Settings.set_v("lan_port", int(x)))
			v.add_child(_row("LAN host port (UDP)", lport))
			v.add_child(UI.label("Online play requires a dedicated server you host (see docs/SERVER.md). Nothing is sent anywhere unless you set an address.\nLAN works on the same Wi-Fi with no server; LAN discovery uses UDP port 7778.", 16, UI.DIM))
		"about":
			var t := "BlockStrike Royale v%s  (network protocol %d)\nMade with Godot Engine 4 (MIT licence) - godotengine.org\n\nAll characters, weapons, maps, textures and sounds are original and generated procedurally by this project.\nFont: Lilita One by Juan Montoreano, SIL Open Font License 1.1 (assets/fonts/LilitaOne-OFL.txt).\n\nNo ads, no tracking, no real-money purchases." % [DB.VERSION, DB.NET_PROTOCOL]
			var l := UI.label(t, 19, UI.TEXT)
			l.autowrap_mode = TextServer.AUTOWRAP_WORD
			v.add_child(l)
			v.add_child(UI.button("Reset profile (delete progress)", func():
				DirAccess.remove_absolute(ProjectSettings.globalize_path(Profile.PATH))
				Profile._load()
				Profile._ensure()
				Profile.refresh_missions()
				Profile.save()
				menu.call("close_panel"), "danger", Vector2(380, 48), 18))
	root.add_child(_scroll(v))
	return root

static func _row(text: String, ctrl: Control) -> HBoxContainer:
	var h := UI.hbox(14)
	var l := UI.label(text, 21)
	l.custom_minimum_size = Vector2(340, 0)
	h.add_child(l)
	ctrl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(ctrl)
	return h
