extends Node
## Networking: ENet transport, rooms/lobby, LAN discovery, matchmaking (dedicated server) and the
## match RPC bridge. All RPCs live on /root/Net so every peer has identical node paths.
##
## Roles: "none" (offline), "host" (LAN host = server + player, peer 1), "client", "dedicated".

signal status_changed(text: String)
signal room_changed(room: Dictionary)
signal lan_rooms_changed(rooms: Array)
signal chat_received(from: String, text: String)
signal queue_changed(info: Dictionary)
signal invite_received(from: String, code: String)
signal presence_received(online: Array)
signal disconnected(reason: String)
signal connected_ok

const DEFAULT_PORT := 7777
const LAN_DISCOVERY_PORT := 7778
const BEACON := "BSR1|"
const B32 := "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

var role := "none"
var peer: ENetMultiplayerPeer
var my_peer := 1
var room := {}                 # client-side copy of current room (public state)
var server_info := {}
var connected := false
var in_queue := false
# server state
var rooms := {}                # code -> room dict (server side)
var peer_room := {}            # peer -> code
var peer_info := {}            # peer -> {name, pid, cos, ver}
var queues := {}               # queue key -> Array[peer]
var queue_since := {}          # peer -> time
# discovery
var lan_rooms := {}            # "ip:port" -> {info, seen}
var _udp_listen: PacketPeerUDP
var _udp_send: PacketPeerUDP
var _beacon_t := 0.0
var _clock := 0.0
var _pending_join := ""

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)
	multiplayer.connected_to_server.connect(_on_connected)
	multiplayer.connection_failed.connect(_on_failed)
	multiplayer.server_disconnected.connect(_on_server_lost)

func _process(dt: float) -> void:
	_clock += dt
	if _udp_listen:
		_poll_discovery()
	if role == "host" and room_open_for_lan():
		_beacon_t -= dt
		if _beacon_t <= 0.0:
			_beacon_t = 1.0
			_send_beacon()
	if role == "dedicated" or role == "host":
		_tick_queues()

# ================================================================== connection management
func is_online() -> bool:
	return role != "none"

func host_lan(opts: Dictionary) -> String:
	leave()
	peer = ENetMultiplayerPeer.new()
	var port: int = int(Settings.get_v("lan_port"))
	var err := peer.create_server(port, 31)
	if err != OK:
		peer = null
		return "Could not open port %d (error %d)" % [port, err]
	multiplayer.multiplayer_peer = peer
	role = "host"
	my_peer = 1
	connected = true
	peer_info[1] = _my_info()
	var code := lan_code(local_ip(), port)
	_create_room_internal(1, opts, code)
	_start_discovery_sender()
	status_changed.emit("Hosting LAN room %s" % code)
	return ""

func join(addr: String, port: int) -> String:
	leave()
	peer = ENetMultiplayerPeer.new()
	var err := peer.create_client(addr, port)
	if err != OK:
		peer = null
		return "Could not connect (error %d)" % err
	multiplayer.multiplayer_peer = peer
	role = "client"
	status_changed.emit("Connecting to %s:%d ..." % [addr, port])
	return ""

func join_code(code: String) -> String:
	var d := parse_lan_code(code)
	if d.is_empty():
		return "Invalid room code"
	_pending_join = ""
	return join(d["ip"], d["port"])

func connect_online() -> String:
	var addr: String = str(Settings.get_v("server_addr")).strip_edges()
	if addr == "":
		return "Online server not configured. Enter a server address in Settings > Online (see docs/SERVER.md)."
	var port: int = int(Settings.get_v("server_port"))
	return join(addr, port)

func start_dedicated(port: int) -> void:
	peer = ENetMultiplayerPeer.new()
	var err := peer.create_server(port, 128)
	if err != OK:
		push_error("Dedicated server: cannot bind port %d (error %d)" % [port, err])
		get_tree().quit(1)
		return
	multiplayer.multiplayer_peer = peer
	role = "dedicated"
	my_peer = 1
	connected = true
	print("[server] BlockStrike Royale dedicated server v%s listening on UDP %d" % [DB.VERSION, port])

func leave() -> void:
	if role == "client" and connected:
		c_leave_room.rpc_id(1)
	if peer:
		peer.close()
	multiplayer.multiplayer_peer = null
	peer = null
	role = "none"
	connected = false
	room = {}
	rooms.clear()
	peer_room.clear()
	peer_info.clear()
	queues.clear()
	in_queue = false
	_udp_send = null

func _my_info() -> Dictionary:
	return {"name": Profile.player_name(), "pid": Profile.p.get("id", ""), "cos": Profile.equip_dict(), "ver": DB.VERSION, "proto": DB.NET_PROTOCOL}

func _on_connected() -> void:
	connected = true
	my_peer = multiplayer.get_unique_id()
	c_hello.rpc_id(1, _my_info())
	status_changed.emit("Connected")
	connected_ok.emit()

func _on_failed() -> void:
	status_changed.emit("Connection failed")
	disconnected.emit("Could not reach the host. Check the address/code and that both devices are on the same network.")
	leave()

func _on_server_lost() -> void:
	disconnected.emit("Connection to the host was lost.")
	var was_in_match := Game.current_match != null
	leave()
	if was_in_match:
		Game.connection_lost()

func _on_peer_connected(id: int) -> void:
	if role == "dedicated":
		print("[server] peer %d connected" % id)

func _on_peer_disconnected(id: int) -> void:
	if role == "client":
		return
	var code: String = peer_room.get(id, "")
	_leave_queue(id)
	if code != "" and rooms.has(code):
		var r: Dictionary = rooms[code]
		var m: Match = r.get("match")
		if m and is_instance_valid(m):
			for aid in m.actors:
				var a: Actor = m.actors[aid]
				if a.peer_id == id and not a.is_bot:
					a.is_bot = true
					a.name += " (bot)"
					m.brains[aid] = BotBrain.new(m, a, 0.4)
					m.announce("%s disconnected - a bot took over" % a.name)
		(r["players"] as Dictionary).erase(id)
		if r["host"] == id:
			_pick_new_host(r)
		_broadcast_room(code)
		if (r["players"] as Dictionary).is_empty() and role == "dedicated":
			_close_room(code)
	peer_room.erase(id)
	peer_info.erase(id)
	if role == "dedicated":
		print("[server] peer %d disconnected" % id)

func peer_rtt(p: int) -> float:
	if peer == null or p == 1:
		return 0.0
	var pp := peer.get_peer(p)
	if pp == null:
		return 0.1
	return pp.get_statistic(ENetPacketPeer.PEER_ROUND_TRIP_TIME) / 1000.0

func ping_ms() -> int:
	if role != "client" or peer == null:
		return 0
	var pp := peer.get_peer(1)
	return pp.get_statistic(ENetPacketPeer.PEER_ROUND_TRIP_TIME) if pp else 0

func packet_loss() -> float:
	if role != "client" or peer == null:
		return 0.0
	var pp := peer.get_peer(1)
	return pp.get_statistic(ENetPacketPeer.PEER_PACKET_LOSS) / float(ENetPacketPeer.PACKET_LOSS_SCALE) if pp else 0.0

# ================================================================== room codes & LAN discovery
static func lan_code(ip: String, port: int) -> String:
	var parts := ip.split(".")
	if parts.size() != 4:
		return "LOCAL"
	var v := 0
	for p in parts:
		v = (v << 8) | (int(p) & 255)
	v = (v << 16) | (port & 65535)
	var s := ""
	for i in 10:
		s = B32[v & 31] + s
		v >>= 5
	return s.substr(0, 5) + "-" + s.substr(5)

static func parse_lan_code(code: String) -> Dictionary:
	code = code.strip_edges().to_upper().replace("-", "").replace(" ", "")
	if code.length() != 10:
		return {}
	var v := 0
	for ch in code:
		var i := B32.find(ch)
		if i < 0:
			return {}
		v = (v << 5) | i
	var port := v & 65535
	v >>= 16
	var ip := "%d.%d.%d.%d" % [(v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255]
	return {"ip": ip, "port": port}

static func local_ip() -> String:
	var best := "127.0.0.1"
	for a in IP.get_local_addresses():
		if a.count(".") != 3 or a.begins_with("127.") or a.begins_with("169.254."):
			continue
		if a.begins_with("192.168.") or a.begins_with("10.") or a.begins_with("172."):
			return a
		best = a
	return best

func start_discovery_listener() -> void:
	if _udp_listen:
		return
	_udp_listen = PacketPeerUDP.new()
	var err := _udp_listen.bind(LAN_DISCOVERY_PORT, "*")
	if err != OK:
		_udp_listen = null
		status_changed.emit("LAN scan unavailable (port %d busy)" % LAN_DISCOVERY_PORT)

func stop_discovery_listener() -> void:
	if _udp_listen:
		_udp_listen.close()
	_udp_listen = null
	lan_rooms.clear()

func _start_discovery_sender() -> void:
	_udp_send = PacketPeerUDP.new()
	_udp_send.set_broadcast_enabled(true)
	_udp_send.set_dest_address("255.255.255.255", LAN_DISCOVERY_PORT)

func room_open_for_lan() -> bool:
	return _udp_send != null and rooms.size() > 0

func _send_beacon() -> void:
	for code in rooms:
		var r: Dictionary = rooms[code]
		if r.get("private", false):
			continue
		var info := {"name": r["name"], "mode": r["mode"], "players": (r["players"] as Dictionary).size(), "max": r["max"],
			"port": int(Settings.get_v("lan_port")), "code": code, "ver": DB.VERSION, "state": r["state"]}
		_udp_send.put_packet((BEACON + JSON.stringify(info)).to_utf8_buffer())

func _poll_discovery() -> void:
	var changed := false
	while _udp_listen.get_available_packet_count() > 0:
		var pkt := _udp_listen.get_packet().get_string_from_utf8()
		var ip := _udp_listen.get_packet_ip()
		if not pkt.begins_with(BEACON):
			continue
		var info = JSON.parse_string(pkt.substr(BEACON.length()))
		if info is Dictionary:
			info["ip"] = ip
			lan_rooms["%s:%d" % [ip, int(info.get("port", DEFAULT_PORT))]] = {"info": info, "seen": _clock}
			changed = true
	for k in lan_rooms.keys():
		if _clock - float(lan_rooms[k]["seen"]) > 4.0:
			lan_rooms.erase(k)
			changed = true
	if changed:
		var out := []
		for k in lan_rooms:
			out.append(lan_rooms[k]["info"])
		lan_rooms_changed.emit(out)

# ================================================================== client -> server API
func create_room(opts: Dictionary) -> void:
	if role == "client":
		c_create_room.rpc_id(1, opts)

func join_room(code: String) -> void:
	if role == "client":
		c_join_room.rpc_id(1, code)

func quick_play(mode: String, ranked: bool) -> void:
	if role == "client":
		in_queue = true
		c_quick.rpc_id(1, mode, ranked)

func cancel_queue() -> void:
	in_queue = false
	if role == "client":
		c_cancel_quick.rpc_id(1)

func set_ready(v: bool) -> void:
	if role == "client":
		c_ready.rpc_id(1, v)
	elif role == "host":
		_set_ready(1, v)

func set_team(t: int) -> void:
	if role == "client":
		c_team.rpc_id(1, t)
	elif role == "host":
		_set_team(1, t)

func set_room_opts(opts: Dictionary) -> void:
	if role == "client":
		c_room_opts.rpc_id(1, opts)
	elif role == "host":
		_room_opts(1, opts)

func start_room_match() -> void:
	if role == "client":
		c_start.rpc_id(1)
	elif role == "host":
		_try_start(1)

func send_chat(text: String) -> void:
	text = text.strip_edges().substr(0, 120)
	if text == "":
		return
	if role == "client":
		c_chat.rpc_id(1, text)
	elif role == "host":
		_chat(1, text)

func invite_friend(pid: String) -> void:
	if role == "client":
		c_invite.rpc_id(1, pid)

func request_presence(pids: Array) -> void:
	if role == "client":
		c_presence.rpc_id(1, pids)

func leave_room() -> void:
	if role == "client":
		c_leave_room.rpc_id(1)
		room = {}
		room_changed.emit(room)
	elif role == "host":
		leave()
		room_changed.emit({})

func send_loaded() -> void:
	if role == "client":
		c_loaded.rpc_id(1)

func send_cmds(list: Array) -> void:
	if role == "client" and connected:
		c_cmd.rpc_id(1, encode_cmds(list))

func send_action(act: Dictionary) -> void:
	if role == "client" and connected:
		c_act.rpc_id(1, act)

# ================================================================== RPCs: client -> server
@rpc("any_peer", "reliable")
func c_hello(info: Dictionary) -> void:
	var id := multiplayer.get_remote_sender_id()
	if int(info.get("proto", 0)) != DB.NET_PROTOCOL:
		s_error.rpc_id(id, "Version mismatch: server runs v%s. Please update the game." % DB.VERSION)
		return
	info["name"] = str(info.get("name", "Player")).substr(0, 16)
	peer_info[id] = info
	s_welcome.rpc_id(id, {"peer": id, "server": "LAN host" if role == "host" else "Dedicated server", "ver": DB.VERSION,
		"role": role, "rooms": _public_room_list()})
	if role == "host":
		var code: String = rooms.keys()[0] if rooms.size() > 0 else ""
		if code != "":
			_join_room_internal(id, code)

@rpc("any_peer", "reliable")
func c_create_room(opts: Dictionary) -> void:
	var id := multiplayer.get_remote_sender_id()
	if role != "dedicated" or not peer_info.has(id):
		return
	_leave_current(id)
	var code := _random_code()
	_create_room_internal(id, opts, code)

@rpc("any_peer", "reliable")
func c_join_room(code: String) -> void:
	var id := multiplayer.get_remote_sender_id()
	code = code.strip_edges().to_upper()
	if not rooms.has(code):
		s_error.rpc_id(id, "Room %s not found" % code)
		return
	_leave_current(id)
	_join_room_internal(id, code)

@rpc("any_peer", "reliable")
func c_quick(mode: String, ranked: bool) -> void:
	var id := multiplayer.get_remote_sender_id()
	if not DB.MODES.has(mode) or mode == "training":
		return
	_leave_current(id)
	var key := mode + ("|r" if ranked else "")
	if not queues.has(key):
		queues[key] = []
	if not (id in queues[key]):
		queues[key].append(id)
	queue_since[id] = _clock
	_send_queue_status(key)

@rpc("any_peer", "reliable")
func c_cancel_quick() -> void:
	_leave_queue(multiplayer.get_remote_sender_id())

@rpc("any_peer", "reliable")
func c_leave_room() -> void:
	_leave_current(multiplayer.get_remote_sender_id())

@rpc("any_peer", "reliable")
func c_ready(v: bool) -> void:
	_set_ready(multiplayer.get_remote_sender_id(), v)

@rpc("any_peer", "reliable")
func c_team(t: int) -> void:
	_set_team(multiplayer.get_remote_sender_id(), t)

@rpc("any_peer", "reliable")
func c_room_opts(opts: Dictionary) -> void:
	_room_opts(multiplayer.get_remote_sender_id(), opts)

@rpc("any_peer", "reliable")
func c_start() -> void:
	_try_start(multiplayer.get_remote_sender_id())

@rpc("any_peer", "reliable")
func c_chat(text: String) -> void:
	_chat(multiplayer.get_remote_sender_id(), text.substr(0, 120))

@rpc("any_peer", "reliable")
func c_invite(pid: String) -> void:
	var id := multiplayer.get_remote_sender_id()
	var code: String = peer_room.get(id, "")
	for p in peer_info:
		if str(peer_info[p].get("pid", "")) == pid and code != "":
			s_invite.rpc_id(p, str(peer_info[id]["name"]), code)

@rpc("any_peer", "reliable")
func c_presence(pids: Array) -> void:
	var id := multiplayer.get_remote_sender_id()
	var online := []
	for p in peer_info:
		if str(peer_info[p].get("pid", "")) in pids:
			online.append(str(peer_info[p]["pid"]))
	s_presence.rpc_id(id, online)

@rpc("any_peer", "reliable")
func c_loaded() -> void:
	var id := multiplayer.get_remote_sender_id()
	var code: String = peer_room.get(id, "")
	if code == "" or not rooms.has(code):
		return
	var r: Dictionary = rooms[code]
	r["loaded"][id] = true
	_check_all_loaded(code)

@rpc("any_peer", "unreliable_ordered")
func c_cmd(data: PackedByteArray) -> void:
	var id := multiplayer.get_remote_sender_id()
	var m := _match_of(id)
	if m == null:
		return
	var aid := _actor_of(m, id)
	if aid < 0:
		return
	var a: Actor = m.actors[aid]
	var q: Array = m.cmd_queue.get(aid, [])
	var last_q: int = int(q[q.size() - 1]["s"]) if q.size() > 0 else a.last_seq
	for c in decode_cmds(data):
		if int(c["s"]) > last_q:
			q.append(c)
			last_q = int(c["s"])
	m.cmd_queue[aid] = q

@rpc("any_peer", "reliable")
func c_act(act: Dictionary) -> void:
	var id := multiplayer.get_remote_sender_id()
	var m := _match_of(id)
	if m == null:
		return
	var aid := _actor_of(m, id)
	if aid >= 0:
		m.queue_action(m.actors[aid], act)

# ================================================================== RPCs: server -> client
@rpc("authority", "reliable")
func s_welcome(info: Dictionary) -> void:
	server_info = info
	status_changed.emit("Connected to %s (v%s)" % [info.get("server", "server"), info.get("ver", "?")])

@rpc("authority", "reliable")
func s_error(msg: String) -> void:
	status_changed.emit(msg)
	if msg.begins_with("Version"):
		disconnected.emit(msg)
	else:
		chat_received.emit("System", msg)

@rpc("authority", "reliable")
func s_room(r: Dictionary) -> void:
	room = r
	if not r.is_empty():
		in_queue = false
	room_changed.emit(r)

@rpc("authority", "reliable")
func s_queue(info: Dictionary) -> void:
	queue_changed.emit(info)

@rpc("authority", "reliable")
func s_chat(from: String, text: String) -> void:
	chat_received.emit(from, text)

@rpc("authority", "reliable")
func s_invite(from: String, code: String) -> void:
	invite_received.emit(from, code)

@rpc("authority", "reliable")
func s_presence(online: Array) -> void:
	presence_received.emit(online)

@rpc("authority", "reliable")
func s_start(cfg: Dictionary) -> void:
	cfg["net"] = "client"
	cfg["local_peer"] = my_peer
	Game.start_match(cfg)

@rpc("authority", "reliable")
func s_init(st: Dictionary) -> void:
	var m := Game.current_match
	if m:
		m.client_init(st)
		m.hud_event.emit("started", {})

@rpc("authority", "unreliable_ordered")
func s_snap(data: PackedByteArray) -> void:
	var m := Game.current_match
	if m and not m.loading:
		m.client_snapshot(decode_snapshot(data))

@rpc("authority", "reliable")
func s_ev(evs: Array) -> void:
	var m := Game.current_match
	if m:
		m.client_events(evs)

# ================================================================== server internals: rooms
func _random_code() -> String:
	var r := RandomNumberGenerator.new()
	r.randomize()
	while true:
		var c := ""
		for i in 6:
			c += B32[r.randi() % B32.length()]
		if not rooms.has(c):
			return c
	return "AAAAAA"

func _create_room_internal(host: int, opts: Dictionary, code: String) -> void:
	var mode: String = opts.get("mode", "br_squad")
	if not DB.MODES.has(mode):
		mode = "br_squad"
	var md: Dictionary = DB.MODES[mode]
	rooms[code] = {"code": code, "name": str(opts.get("name", str(peer_info.get(host, {}).get("name", "Room")) + "'s room")).substr(0, 24),
		"host": host, "mode": mode, "map": str(opts.get("map", md["map"])), "max": clampi(int(opts.get("max", md["players"])), 2, int(md["players"])),
		"bots": bool(opts.get("bots", true)), "building": bool(opts.get("building", true)), "difficulty": clampi(int(opts.get("difficulty", 1)), 0, 2),
		"private": bool(opts.get("private", false)), "ranked": bool(opts.get("ranked", false)), "players": {}, "state": "lobby", "match": null, "loaded": {}}
	_join_room_internal(host, code)

func _join_room_internal(id: int, code: String) -> void:
	var r: Dictionary = rooms[code]
	if r["state"] != "lobby":
		_send_to(id, "s_error", ["That room is already in a match. Try again when it ends."])
		return
	var players: Dictionary = r["players"]
	if players.size() >= int(r["max"]):
		_send_to(id, "s_error", ["Room is full"])
		return
	var info: Dictionary = peer_info.get(id, {"name": "Player", "cos": {}})
	players[id] = {"name": info.get("name", "Player"), "pid": info.get("pid", ""), "cos": info.get("cos", {}), "ready": id == r["host"], "team": -1}
	peer_room[id] = code
	_broadcast_room(code)

func _leave_current(id: int) -> void:
	_leave_queue(id)
	var code: String = peer_room.get(id, "")
	if code == "" or not rooms.has(code):
		return
	var r: Dictionary = rooms[code]
	(r["players"] as Dictionary).erase(id)
	peer_room.erase(id)
	if id != 1:
		_send_to(id, "s_room", [{}])
	if r["host"] == id:
		_pick_new_host(r)
	if (r["players"] as Dictionary).is_empty() and role == "dedicated":
		_close_room(code)
	else:
		_broadcast_room(code)

func _pick_new_host(r: Dictionary) -> void:
	var ps: Array = (r["players"] as Dictionary).keys()
	r["host"] = ps[0] if ps.size() > 0 else -1

func _close_room(code: String) -> void:
	var r: Dictionary = rooms.get(code, {})
	var m = r.get("match")
	if m and is_instance_valid(m):
		(m as Node).queue_free()
	rooms.erase(code)
	if role == "dedicated":
		print("[server] room %s closed" % code)

func _public_room(r: Dictionary) -> Dictionary:
	var ps := []
	for pid in r["players"]:
		var p: Dictionary = r["players"][pid]
		ps.append({"peer": pid, "name": p["name"], "ready": p["ready"], "team": p["team"], "host": pid == r["host"], "ping": int(peer_rtt(pid) * 1000.0)})
	return {"code": r["code"], "name": r["name"], "mode": r["mode"], "map": r["map"], "max": r["max"], "bots": r["bots"], "building": r["building"],
		"difficulty": r["difficulty"], "private": r["private"], "ranked": r["ranked"], "state": r["state"], "players": ps, "host": r["host"],
		"lan": role == "host"}

func _public_room_list() -> Array:
	var out := []
	for code in rooms:
		var r: Dictionary = rooms[code]
		if not r["private"]:
			out.append({"code": code, "name": r["name"], "mode": r["mode"], "players": (r["players"] as Dictionary).size(), "max": r["max"], "state": r["state"]})
	return out

func _broadcast_room(code: String) -> void:
	if not rooms.has(code):
		return
	var pub := _public_room(rooms[code])
	for pid in rooms[code]["players"]:
		_send_to(pid, "s_room", [pub])

## Sends an RPC to a peer; if the peer is the local host (peer 1 in host role) the call is made locally.
func _send_to(pid: int, method: String, args: Array) -> void:
	if pid == 1 and role == "host":
		callv(method, args)
		if method == "s_room":
			room = args[0]
	elif pid != 1 and peer != null:
		var c := Callable(self, method)
		match args.size():
			0:
				c.rpc_id(pid)
			1:
				c.rpc_id(pid, args[0])
			2:
				c.rpc_id(pid, args[0], args[1])

func _set_ready(id: int, v: bool) -> void:
	var code: String = peer_room.get(id, "")
	if code == "":
		return
	var p: Dictionary = rooms[code]["players"].get(id, {})
	if not p.is_empty():
		p["ready"] = v
		_broadcast_room(code)

func _set_team(id: int, t: int) -> void:
	var code: String = peer_room.get(id, "")
	if code == "":
		return
	var r: Dictionary = rooms[code]
	var p: Dictionary = r["players"].get(id, {})
	if p.is_empty():
		return
	var md: Dictionary = DB.MODES[r["mode"]]
	var max_team := 1 if md["kind"] in ["cs", "arena"] else int(r["max"]) / int(md["team"]) - 1
	p["team"] = clampi(t, -1, max_team)
	_broadcast_room(code)

func _room_opts(id: int, opts: Dictionary) -> void:
	var code: String = peer_room.get(id, "")
	if code == "" or rooms[code]["host"] != id or rooms[code]["state"] != "lobby":
		return
	var r: Dictionary = rooms[code]
	if opts.has("mode") and DB.MODES.has(opts["mode"]) and opts["mode"] != "training":
		r["mode"] = opts["mode"]
		r["map"] = DB.MODES[r["mode"]]["map"]
		r["max"] = DB.MODES[r["mode"]]["players"]
	if opts.has("map") and DB.MAPS.has(opts["map"]):
		r["map"] = opts["map"]
	for k in ["bots", "building", "private"]:
		if opts.has(k):
			r[k] = bool(opts[k])
	if opts.has("difficulty"):
		r["difficulty"] = clampi(int(opts["difficulty"]), 0, 2)
	if opts.has("max"):
		r["max"] = clampi(int(opts["max"]), 2, int(DB.MODES[r["mode"]]["players"]))
	_broadcast_room(code)

func _chat(id: int, text: String) -> void:
	var code: String = peer_room.get(id, "")
	if code == "":
		return
	var nm: String = str(peer_info.get(id, {}).get("name", "?"))
	for pid in rooms[code]["players"]:
		_send_to(pid, "s_chat", [nm, text])

func _try_start(id: int) -> void:
	var code: String = peer_room.get(id, "")
	if code == "":
		return
	var r: Dictionary = rooms[code]
	if r["host"] != id or r["state"] != "lobby":
		return
	_start_room_match(code)

func _start_room_match(code: String) -> void:
	var r: Dictionary = rooms[code]
	var players := []
	for pid in r["players"]:
		var p: Dictionary = r["players"][pid]
		players.append({"peer": pid, "name": p["name"], "team": p["team"], "cos": p["cos"]})
	var cfg := {"mode": r["mode"], "map": r["map"], "seed": randi(), "players": players, "bots": r["bots"], "building": r["building"],
		"difficulty": r["difficulty"], "ranked": r["ranked"], "max_players": r["max"] if not r["bots"] else DB.MODES[r["mode"]]["players"], "room": code}
	if not r["bots"]:
		cfg["max_players"] = players.size()
	r["state"] = "loading"
	r["loaded"] = {}
	r["start_t"] = _clock
	_broadcast_room(code)
	for pid in r["players"]:
		if pid == 1 and role == "host":
			continue
		var c2 := cfg.duplicate()
		s_start.rpc_id(pid, c2)
	if role == "host":
		var hc := cfg.duplicate()
		hc["net"] = "host"
		hc["local_peer"] = 1
		Game.start_match(hc)
	else:
		var sc := cfg.duplicate()
		sc["net"] = "dedicated"
		sc["local_peer"] = -1
		var m := Match.new()
		m.name = "Match_" + code
		get_tree().root.add_child(m)
		m.setup(sc)
		m.set_meta("room", code)
		m.set_meta("hold", true)
		r["match"] = m

## Called by the LAN host's match scene once its own world is ready.
func host_match_ready(m: Match) -> void:
	var code: String = peer_room.get(1, "")
	if code == "":
		return
	rooms[code]["match"] = m
	rooms[code]["loaded"][1] = true
	m.set_meta("room", code)
	m.set_meta("hold", true)
	_check_all_loaded(code)

func _check_all_loaded(code: String) -> void:
	var r: Dictionary = rooms[code]
	var m: Match = r.get("match")
	if m == null or not is_instance_valid(m):
		return
	var all := true
	for pid in r["players"]:
		if not r["loaded"].has(pid):
			all = false
	if all or _clock - float(r.get("start_t", _clock)) > 40.0:
		_begin_match(code)

func _begin_match(code: String) -> void:
	var r: Dictionary = rooms[code]
	if r["state"] == "playing":
		return
	r["state"] = "playing"
	var m: Match = r["match"]
	m.remove_meta("hold")
	var st := m.init_state()
	for pid in r["players"]:
		if pid == 1 and role == "host":
			continue
		var s2 := st.duplicate()
		var aid := _actor_of(m, pid)
		if aid >= 0:
			s2["inv"] = (m.actors[aid] as Actor).inv_dict()
		s_init.rpc_id(pid, s2)
	_broadcast_room(code)
	if role == "dedicated":
		print("[server] room %s match started (%s, %d players)" % [code, r["mode"], (r["players"] as Dictionary).size()])

func match_over(m: Match) -> void:
	var code: String = m.get_meta("room", "")
	if code == "" or not rooms.has(code):
		return
	var r: Dictionary = rooms[code]
	r["state"] = "lobby"
	for pid in r["players"]:
		(r["players"][pid] as Dictionary)["ready"] = pid == r["host"]
	if role == "dedicated":
		m.queue_free()
	r["match"] = null
	_broadcast_room(code)

func _match_of(pid: int) -> Match:
	var code: String = peer_room.get(pid, "")
	if code == "" or not rooms.has(code):
		return null
	var m = rooms[code].get("match")
	return m if m and is_instance_valid(m) else null

func _actor_of(m: Match, pid: int) -> int:
	for aid in m.actors:
		var a: Actor = m.actors[aid]
		if a.peer_id == pid and not a.dummy:
			return aid
	return -1

# ================================================================== matchmaking queues (dedicated server)
func _leave_queue(id: int) -> void:
	for key in queues:
		if id in queues[key]:
			queues[key].erase(id)
			_send_queue_status(key)
	queue_since.erase(id)

func _send_queue_status(key: String) -> void:
	var q: Array = queues.get(key, [])
	for pid in q:
		var waited := _clock - float(queue_since.get(pid, _clock))
		_send_to(pid, "s_queue", [{"mode": key.split("|")[0], "waiting": q.size(), "secs": int(waited), "eta": maxi(0, 15 - int(waited))}])

var _qt := 0.0
func _tick_queues() -> void:
	if _clock - _qt < 1.0:
		return
	_qt = _clock
	for code in rooms.keys():
		if rooms.has(code) and rooms[code]["state"] == "loading":
			_check_all_loaded(code)
	for key in queues:
		var q: Array = queues[key]
		if q.is_empty():
			continue
		var mode: String = key.split("|")[0]
		var md: Dictionary = DB.MODES[mode]
		var oldest := 0.0
		for pid in q:
			oldest = maxf(oldest, _clock - float(queue_since.get(pid, _clock)))
		if q.size() >= int(md["players"]) or oldest >= 15.0:
			var take: Array = q.slice(0, mini(q.size(), int(md["players"])))
			for pid in take:
				q.erase(pid)
				queue_since.erase(pid)
			var code := _random_code()
			var host: int = take[0]
			rooms[code] = {"code": code, "name": "Quick %s" % md["short"], "host": host, "mode": mode, "map": md["map"], "max": md["players"],
				"bots": true, "building": true, "difficulty": 1, "private": true, "ranked": key.ends_with("|r"), "players": {}, "state": "lobby",
				"match": null, "loaded": {}}
			for pid in take:
				_join_room_internal(pid, code)
			_start_room_match(code)
		else:
			_send_queue_status(key)

# ================================================================== per-tick server flush (called by Match)
func server_flush(m: Match, evs: Array, snap: bool) -> void:
	if m.has_meta("hold"):
		return
	var code: String = m.get_meta("room", "")
	if code == "" or not rooms.has(code):
		return
	var r: Dictionary = rooms[code]
	var common := []
	var targeted := {}
	for ev in evs:
		var d: Dictionary = ev[1]
		if d.has("_to"):
			var to: int = int(d["_to"])
			if not targeted.has(to):
				targeted[to] = []
			targeted[to].append(ev)
		else:
			common.append(ev)
	var snap_common := encode_snapshot(m) if snap else PackedByteArray()
	for pid in r["players"]:
		if pid == 1 and role == "host":
			continue
		var list := common.duplicate()
		if targeted.has(pid):
			list.append_array(targeted[pid])
		if not list.is_empty():
			s_ev.rpc_id(pid, list)
		if snap:
			var aid := _actor_of(m, pid)
			var tail := PackedByteArray()
			tail.resize(18)
			if aid >= 0:
				var a: Actor = m.actors[aid]
				tail.encode_u32(0, a.last_seq)
				tail.encode_float(4, a.vel.x)
				tail.encode_float(8, a.vel.y)
				tail.encode_float(12, a.vel.z)
				tail.encode_u16(16, clampi(a.mag[a.cur], 0, 65535))
			var full := snap_common.duplicate()
			full.append_array(tail)
			s_snap.rpc_id(pid, full)
	for ev in evs:
		if ev[0] == "end":
			get_tree().create_timer(10.0).timeout.connect(match_over.bind(m))

# ================================================================== binary codecs
const CMD_SIZE := 21
const ACTOR_SIZE := 26

static func encode_cmds(list: Array) -> PackedByteArray:
	var b := PackedByteArray()
	b.resize(1 + list.size() * CMD_SIZE)
	b.encode_u8(0, list.size())
	var o := 1
	for e in list:
		var c: Dictionary = e[1]
		b.encode_u32(o, int(e[0]))
		b.encode_float(o + 4, float(c["mx"]))
		b.encode_float(o + 8, float(c["mz"]))
		b.encode_float(o + 12, float(c["yaw"]))
		b.encode_float(o + 16, float(c["pitch"]))
		b.encode_u8(o + 20, int(c["b"]) & 255)
		o += CMD_SIZE
	return b

static func decode_cmds(b: PackedByteArray) -> Array:
	var out := []
	if b.size() < 1:
		return out
	var n := b.decode_u8(0)
	if b.size() < 1 + n * CMD_SIZE:
		return out
	var o := 1
	for i in n:
		var yaw := b.decode_float(o + 12)
		var pitch := b.decode_float(o + 16)
		if is_nan(yaw) or is_nan(pitch):
			o += CMD_SIZE
			continue
		out.append({"s": b.decode_u32(o), "mx": clampf(b.decode_float(o + 4), -1.0, 1.0), "mz": clampf(b.decode_float(o + 8), -1.0, 1.0),
			"yaw": yaw, "pitch": clampf(pitch, -1.5, 1.5), "b": b.decode_u8(o + 20)})
		o += CMD_SIZE
	return out

static func encode_snapshot(m: Match) -> PackedByteArray:
	var wl := DB.WEAPONS.keys()
	var ids := m.actors.keys()
	var b := PackedByteArray()
	b.resize(6 + ids.size() * ACTOR_SIZE)
	b.encode_float(0, m.time)
	b.encode_u16(4, ids.size())
	var o := 6
	for id in ids:
		var a: Actor = m.actors[id]
		b.encode_u16(o, a.id)
		b.encode_float(o + 2, a.pos.x)
		b.encode_float(o + 6, a.pos.y)
		b.encode_float(o + 10, a.pos.z)
		b.encode_u16(o + 14, int(fposmod(a.yaw, TAU) / TAU * 65535.0))
		b.encode_s16(o + 16, int(clampf(a.pitch, -1.6, 1.6) * 10000.0))
		b.encode_u8(o + 18, a.state)
		var f := (1 if a.crouch else 0) | (2 if a.aiming else 0) | (4 if a.on_ground else 0) | (8 if a.reload_end > m.time else 0) | (16 if a.use_item != "" else 0)
		b.encode_u8(o + 19, f)
		var wi := wl.find(a.weapon_id()) if a.weapon_id() != "" else 255
		b.encode_u8(o + 20, wi if wi >= 0 else 255)
		b.encode_u8(o + 21, clampi(int(ceil(a.hp if a.state != Actor.St.KNOCKED else a.knock_hp)), 0, 255))
		b.encode_u8(o + 22, (a.vest_lvl << 4) | a.helm_lvl)
		var ei := 0
		if a.emote != "":
			ei = maxi(0, DB.COSMETICS.keys().find(a.emote))
		b.encode_u16(o + 23, ei)
		b.encode_u8(o + 25, clampi(a.team, 0, 255))
		o += ACTOR_SIZE
	return b

static func decode_snapshot(b: PackedByteArray) -> Dictionary:
	var out := {"t": b.decode_float(0), "a": []}
	var n := b.decode_u16(4)
	var o := 6
	for i in n:
		out["a"].append([b.decode_u16(o), Vector3(b.decode_float(o + 2), b.decode_float(o + 6), b.decode_float(o + 10)),
			b.decode_u16(o + 14) / 65535.0 * TAU, b.decode_s16(o + 16) / 10000.0, b.decode_u8(o + 18), b.decode_u8(o + 19),
			b.decode_u8(o + 20), b.decode_u8(o + 21), b.decode_u8(o + 22), b.decode_u16(o + 23)])
		o += ACTOR_SIZE
	if b.size() >= o + 18:
		out["me"] = {"ack": b.decode_u32(o), "vel": Vector3(b.decode_float(o + 4), b.decode_float(o + 8), b.decode_float(o + 12)), "mag": b.decode_u16(o + 16)}
	return out
