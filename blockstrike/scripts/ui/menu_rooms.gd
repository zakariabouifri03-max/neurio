class_name RoomsPanel
extends Control
## Custom rooms: LAN host / discovery / join by code, online rooms, and the room lobby
## (players, teams, ready status, ping, host settings, chat, invites).

var menu: Node
var box: VBoxContainer
var chat_log: Array = []
var lan_list: Array = []
var host_mode := "br_squad"
var status := ""

func _ready() -> void:
	box = UI.vbox(12)
	var sc := ScrollContainer.new()
	sc.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sc.add_child(box)
	add_child(sc)
	host_mode = Game.menu_mode if Game.menu_mode != "training" else "br_squad"
	Net.room_changed.connect(func(_r): _rebuild())
	Net.lan_rooms_changed.connect(func(l):
		lan_list = l
		if Net.room.is_empty():
			_rebuild())
	Net.chat_received.connect(func(f, t):
		chat_log.append("%s: %s" % [f, t])
		if chat_log.size() > 30:
			chat_log.pop_front()
		_rebuild())
	Net.status_changed.connect(func(s):
		status = s
		_rebuild())
	Net.start_discovery_listener()
	tree_exiting.connect(func(): Net.stop_discovery_listener())
	_rebuild()

func _rebuild() -> void:
	if not is_inside_tree():
		return
	for c in box.get_children():
		c.queue_free()
	if Net.room.is_empty():
		_build_browser()
	else:
		_build_lobby(Net.room)

func _section(title: String) -> VBoxContainer:
	var p := UI.panel(UI.BG2, 14)
	var v := UI.vbox(10)
	v.add_child(UI.label(title, 24, UI.ACCENT))
	p.add_child(v)
	box.add_child(p)
	return v

# ------------------------------------------------------------------ not in a room
func _build_browser() -> void:
	if status != "":
		box.add_child(UI.label(status, 18, UI.GOLD))
	var lan := _section("LAN  (same Wi-Fi, no server needed)")
	var h := UI.hbox(10)
	var modes := []
	for m in DB.MODE_ORDER:
		if m != "training":
			modes.append(DB.MODES[m]["short"])
	var mlist: Array = DB.MODE_ORDER.filter(func(x): return x != "training")
	h.add_child(UI.label("Mode", 20))
	h.add_child(UI.options(modes, maxi(0, mlist.find(host_mode)), func(i): host_mode = mlist[i]))
	h.add_child(UI.button("Host LAN room", func():
		var err := Net.host_lan({"mode": host_mode, "bots": true, "building": true, "difficulty": int(Settings.get_v("difficulty"))})
		if err != "":
			menu.call("notice", "LAN", err), "primary", Vector2(220, 50), 21))
	lan.add_child(h)
	lan.add_child(UI.label("Rooms found on this network:", 18, UI.DIM))
	if lan_list.is_empty():
		lan.add_child(UI.label("Scanning... (hosts appear automatically within a few seconds)", 18, UI.DIM))
	for r in lan_list:
		var row := UI.hbox(10)
		var l := UI.label("%s   -   %s   %d/%d   %s" % [r.get("name", "Room"), DB.MODES.get(r.get("mode", ""), {}).get("short", "?"), int(r.get("players", 0)), int(r.get("max", 0)),
			"(in match)" if r.get("state", "") != "lobby" else ""], 20)
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(l)
		var ip: String = r.get("ip", "")
		var port: int = int(r.get("port", Net.DEFAULT_PORT))
		row.add_child(UI.button("Join", func():
			var err := Net.join(ip, port)
			if err != "":
				menu.call("notice", "LAN", err), "good", Vector2(110, 44), 19))
		lan.add_child(row)
	var jc := UI.hbox(10)
	var le := LineEdit.new()
	le.placeholder_text = "Room code e.g. KXQ8M-AB3CD  (or IP address)"
	le.custom_minimum_size = Vector2(420, 48)
	jc.add_child(le)
	jc.add_child(UI.button("Join by code / IP", func():
		var t := le.text.strip_edges()
		var err := ""
		if t.count(".") == 3:
			var parts := t.split(":")
			err = Net.join(parts[0], int(parts[1]) if parts.size() > 1 else int(Settings.get_v("lan_port")))
		else:
			err = Net.join_code(t)
		if err != "":
			menu.call("notice", "Join", err), "blue", Vector2(240, 48), 20))
	lan.add_child(jc)
	var on := _section("ONLINE  (dedicated server)")
	var addr: String = str(Settings.get_v("server_addr"))
	if addr == "":
		var l2 := UI.label("No online server configured. Set one in Settings > Online. Host your own with the headless server build (docs/SERVER.md).", 18, UI.DIM)
		l2.autowrap_mode = TextServer.AUTOWRAP_WORD
		on.add_child(l2)
		return
	if Net.role != "client" or not Net.connected:
		on.add_child(UI.label("Server: %s:%d" % [addr, int(Settings.get_v("server_port"))], 18, UI.DIM))
		on.add_child(UI.button("Connect", func():
			var err := Net.connect_online()
			if err != "":
				menu.call("notice", "Online", err), "primary", Vector2(200, 50)))
		return
	var oh := UI.hbox(10)
	oh.add_child(UI.label("Connected", 20, UI.GOOD))
	oh.add_child(UI.options(modes, maxi(0, mlist.find(host_mode)), func(i): host_mode = mlist[i]))
	oh.add_child(UI.button("Create room", func(): Net.create_room({"mode": host_mode, "bots": true, "building": true}), "primary", Vector2(200, 48), 20))
	on.add_child(oh)
	var oj := UI.hbox(10)
	var le2 := LineEdit.new()
	le2.placeholder_text = "6-letter room code"
	le2.custom_minimum_size = Vector2(260, 48)
	oj.add_child(le2)
	oj.add_child(UI.button("Join room", func(): Net.join_room(le2.text), "blue", Vector2(180, 48), 20))
	on.add_child(oj)
	for r in Net.server_info.get("rooms", []):
		var row2 := UI.hbox(10)
		var l3 := UI.label("%s  -  %s  %d/%d" % [r["name"], DB.MODES.get(r["mode"], {}).get("short", ""), int(r["players"]), int(r["max"])], 19)
		l3.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row2.add_child(l3)
		var code: String = r["code"]
		row2.add_child(UI.button("Join", func(): Net.join_room(code), "good", Vector2(100, 42), 18))
		on.add_child(row2)
	on.add_child(UI.button("Disconnect", func():
		Net.leave()
		_rebuild(), "ghost", Vector2(180, 44), 18))

# ------------------------------------------------------------------ room lobby
func _build_lobby(r: Dictionary) -> void:
	var me_host: bool = int(r.get("host", -1)) == Net.my_peer
	var md: Dictionary = DB.MODES.get(r["mode"], DB.MODES["br_squad"])
	var head := _section("%s   -   %s" % [r["name"], md["name"]])
	var ch := UI.hbox(10)
	ch.add_child(UI.label("Room code:", 20))
	ch.add_child(UI.label(str(r["code"]), 28, UI.GOLD, 4))
	ch.add_child(UI.button("Copy code", func(): DisplayServer.clipboard_set(str(r["code"])), "ghost", Vector2(140, 42), 18))
	ch.add_child(UI.label(("LAN - friends on the same Wi-Fi can join with this code" if r.get("lan", false) else "Share this code with friends"), 16, UI.DIM))
	head.add_child(ch)
	head.add_child(UI.label("Map: %s    Bots fill: %s    Building: %s    Difficulty: %s%s" % [DB.MAPS.get(r["map"], {}).get("name", r["map"]), "on" if r["bots"] else "off",
		"on" if r["building"] else "off", ["Easy", "Normal", "Hard"][int(r["difficulty"])], "    PRIVATE" if r["private"] else ""], 18, UI.DIM))
	var cols := UI.hbox(14)
	var pl := UI.vbox(8)
	pl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	pl.add_child(UI.label("PLAYERS  %d / %d" % [(r["players"] as Array).size(), int(r["max"])], 22, UI.ACCENT))
	var all_ready := true
	for p in r["players"]:
		var row := UI.hbox(10)
		var team_txt: String = "Auto" if int(p["team"]) < 0 else ("Team %d" % (int(p["team"]) + 1) if md["kind"] == "br" else ["Blue", "Red"][clampi(int(p["team"]), 0, 1)])
		var l := UI.label("%s%s" % ["[HOST] " if p["host"] else "", p["name"]], 21, UI.GOLD if int(p["peer"]) == Net.my_peer else UI.TEXT)
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(l)
		row.add_child(UI.label(team_txt, 18, UI.ACCENT2))
		var ping: int = int(p.get("ping", 0))
		row.add_child(UI.label("%d ms" % ping if int(p["peer"]) != 1 else "host", 17, UI.GOOD if ping < 80 else (UI.GOLD if ping < 160 else UI.BAD)))
		row.add_child(UI.label("READY" if p["ready"] else "not ready", 18, UI.GOOD if p["ready"] else UI.DIM))
		if not p["ready"]:
			all_ready = false
		pl.add_child(row)
	var acts := UI.hbox(10)
	var my_ready := false
	for p in r["players"]:
		if int(p["peer"]) == Net.my_peer:
			my_ready = p["ready"]
	if not me_host:
		acts.add_child(UI.button("Not ready" if my_ready else "Ready!", func(): Net.set_ready(not my_ready), "good" if not my_ready else "ghost", Vector2(170, 50), 21))
	var teams := ["Auto"]
	var max_team := 2 if md["kind"] in ["cs", "arena"] else int(r["max"]) / int(md["team"])
	for t in max_team:
		teams.append(("Team %d" % (t + 1)) if md["kind"] == "br" else ["Blue", "Red"][t])
	if int(md["team"]) > 1 or md["kind"] in ["cs", "arena"]:
		acts.add_child(UI.options(teams, 0, func(i): Net.set_team(i - 1)))
	if me_host:
		var sb := UI.button("START MATCH", func(): Net.start_room_match(), "primary", Vector2(240, 54), 24)
		acts.add_child(sb)
		if not all_ready:
			acts.add_child(UI.label("(starts even if not everyone is ready)", 15, UI.DIM))
	acts.add_child(UI.button("Leave room", func():
		Net.leave_room()
		_rebuild(), "danger", Vector2(160, 50), 20))
	pl.add_child(acts)
	cols.add_child(pl)
	if me_host:
		var hs := UI.vbox(8)
		hs.custom_minimum_size = Vector2(380, 0)
		hs.add_child(UI.label("ROOM SETTINGS", 22, UI.ACCENT))
		var mlist: Array = DB.MODE_ORDER.filter(func(x): return x != "training")
		var mnames := mlist.map(func(x): return DB.MODES[x]["short"])
		hs.add_child(UI.options(mnames, maxi(0, mlist.find(r["mode"])), func(i): Net.set_room_opts({"mode": mlist[i]})))
		var maps: Array = DB.MAPS.keys()
		hs.add_child(UI.options(maps.map(func(x): return DB.MAPS[x]["name"]), maxi(0, maps.find(r["map"])), func(i): Net.set_room_opts({"map": maps[i]})))
		hs.add_child(UI.check("Fill with bots", r["bots"], func(x): Net.set_room_opts({"bots": x})))
		hs.add_child(UI.check("Block building", r["building"], func(x): Net.set_room_opts({"building": x})))
		hs.add_child(UI.check("Private (hidden from lists)", r["private"], func(x): Net.set_room_opts({"private": x})))
		hs.add_child(UI.options(["Easy bots", "Normal bots", "Hard bots"], int(r["difficulty"]), func(i): Net.set_room_opts({"difficulty": i})))
		cols.add_child(hs)
	box.add_child(cols)
	var chat := _section("CHAT")
	for line in chat_log.slice(maxi(0, chat_log.size() - 8)):
		chat.add_child(UI.label(line, 17, UI.TEXT))
	var cin := UI.hbox(10)
	var le := LineEdit.new()
	le.placeholder_text = "Say something..."
	le.custom_minimum_size = Vector2(500, 46)
	le.text_submitted.connect(func(t):
		Net.send_chat(t)
		le.text = "")
	cin.add_child(le)
	cin.add_child(UI.button("Send", func():
		Net.send_chat(le.text)
		le.text = "", "blue", Vector2(100, 46), 18))
	chat.add_child(cin)
