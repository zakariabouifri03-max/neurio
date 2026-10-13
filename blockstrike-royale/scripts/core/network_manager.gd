extends Node
## NetworkManager - LAN and internet sessions for BlockStrike Royale.
##
## Design:
##   * The host (or a dedicated server) is authoritative: it owns room state,
##     match state, damage, loot and results.  Clients send input and receive
##     state.  Nothing security relevant is trusted from a client.
##   * LAN uses ENet over the local network plus a UDP beacon so devices on the
##     same Wi-Fi can find each other.  Manual IP entry always remains available
##     because many routers block broadcast traffic between clients.
##   * Internet play needs a server address to be configured
##     (user://server.cfg or --server=host:port).  When no server is configured
##     the menu reports that honestly instead of pretending to be online.

signal session_started(kind: int)
signal session_ended(reason: String)
signal peer_joined(peer_id: int)
signal peer_left(peer_id: int)
signal connection_failed(reason: String)
signal connection_succeeded()
signal room_updated(room: Dictionary)
signal discovery_updated(rooms: Array)
signal clock_synced(offset_seconds: float)
signal snapshot_received(payload: Dictionary)
signal peer_state_received(peer_id: int, state: Dictionary)

enum Kind { NONE, LAN_HOST, LAN_CLIENT, INTERNET_HOST, INTERNET_CLIENT }

const SERVER_CONFIG_PATH := "user://server.cfg"
const ROOM_CODE_CHARS := "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const RECONNECT_WINDOW := 30.0
const DISCOVERY_INTERVAL := 1.0
const ROOM_STALE_SECONDS := 3.5

var kind: Kind = Kind.NONE
var account_verified: bool = false
var local_player_id: String = ""
var local_display_name: String = "Player"
var room: Dictionary = {}
var discovered_rooms: Dictionary = {}
var clock_offset: float = 0.0
var server_address: String = ""
var last_error: String = ""

var _udp: PacketPeerUDP = null
var _discovery_accum: float = 0.0
var _beacon_accum: float = 0.0
var _peer_timeouts: Dictionary = {}
var _rate_limits: Dictionary = {}
var _reconnect_slots: Dictionary = {}
var _is_server: bool = false

func _ready() -> void:
	local_player_id = str(SaveManager.data.profile.get("player_id", ""))
	local_display_name = str(SaveManager.data.profile.get("display_name", "Player"))
	_read_server_config()
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)
	multiplayer.connected_to_server.connect(_on_connected_to_server)
	multiplayer.connection_failed.connect(_on_connection_failed)
	multiplayer.server_disconnected.connect(_on_server_disconnected)
	set_process(true)

func _process(delta: float) -> void:
	if kind == Kind.NONE:
		return
	if kind == Kind.LAN_CLIENT or kind == Kind.INTERNET_CLIENT:
		_poll_discovery(delta)
	if _is_server and _udp != null:
		_beacon_accum += delta
		if _beacon_accum >= DISCOVERY_INTERVAL:
			_beacon_accum = 0.0
			_send_beacon()
	if _is_server and kind == Kind.LAN_HOST:
		_poll_discovery(delta)
	_check_peer_timeouts(delta)

# ------------------------------------------------------------------ session
func is_connected_session() -> bool:
	if kind == Kind.NONE:
		return false
	if kind == Kind.LAN_HOST or kind == Kind.INTERNET_HOST:
		return _is_server
	return multiplayer.multiplayer_peer != null \
		and multiplayer.multiplayer_peer.get_connection_status() \
			== MultiplayerPeer.CONNECTION_CONNECTED

func is_server() -> bool:
	return _is_server

func is_authoritative_session() -> bool:
	## Only a validated online account may move persistent ranked data.
	return account_verified and (kind == Kind.INTERNET_CLIENT or kind == Kind.INTERNET_HOST)

func authoritative_date() -> String:
	if not account_verified:
		return ""
	return Time.get_date_string_from_unix_time(int(Time.get_unix_time_from_system() + clock_offset))

func local_peer_id() -> int:
	if multiplayer.multiplayer_peer == null:
		return 0
	return multiplayer.get_unique_id()

## Hosts a LAN session that other devices on the same Wi-Fi can join.
func host_lan(port: int, room_settings: Dictionary) -> GameResult:
	_close_session(false)
	var peer := ENetMultiplayerPeer.new()
	var err := peer.create_server(port, GameConfig.NET["max_players_lan"])
	if err != OK:
		last_error = "could not listen on port %d (error %d)" % [port, err]
		connection_failed.emit(last_error)
		return GameResult.fail(GameResult.Code.OFFLINE, last_error)
	multiplayer.multiplayer_peer = peer
	_is_server = true
	kind = Kind.LAN_HOST
	room = _new_room(room_settings)
	room["host_id"] = local_peer_id()
	_register_player(local_peer_id())
	_begin_discovery()
	session_started.emit(kind)
	room_updated.emit(room)
	return GameResult.ok(room)

func join_lan(ip: String, port: int) -> GameResult:
	if ip.strip_edges().is_empty():
		return GameResult.fail(GameResult.Code.INVALID, "enter the host address")
	_close_session(false)
	var peer := ENetMultiplayerPeer.new()
	var err := peer.create_client(ip.strip_edges(), port)
	if err != OK:
		last_error = "could not reach %s:%d (error %d)" % [ip, port, err]
		connection_failed.emit(last_error)
		return GameResult.fail(GameResult.Code.OFFLINE, last_error)
	multiplayer.multiplayer_peer = peer
	_is_server = false
	kind = Kind.LAN_CLIENT
	_begin_discovery()
	return GameResult.ok()

## Internet sessions require a configured server; there is no fake fallback.
func host_internet(port: int, room_settings: Dictionary) -> GameResult:
	if server_address.is_empty():
		return GameResult.fail(GameResult.Code.OFFLINE,
			"no server configured - see docs/SERVER.md and user://server.cfg")
	var peer := ENetMultiplayerPeer.new()
	var err := peer.create_server(port, GameConfig.NET["max_players_internet"])
	if err != OK:
		return GameResult.fail(GameResult.Code.OFFLINE, "listen failed (%d)" % err)
	multiplayer.multiplayer_peer = peer
	_is_server = true
	kind = Kind.INTERNET_HOST
	room = _new_room(room_settings)
	room["host_id"] = local_peer_id()
	_register_player(local_peer_id())
	session_started.emit(kind)
	room_updated.emit(room)
	return GameResult.ok(room)

func join_internet(host: String, port: int, room_code: String = "") -> GameResult:
	var target := host
	if target.is_empty():
		target = server_address
	if target.is_empty():
		return GameResult.fail(GameResult.Code.OFFLINE,
			"no server configured - see docs/SERVER.md")
	_close_session(false)
	var peer := ENetMultiplayerPeer.new()
	var err := peer.create_client(target, port)
	if err != OK:
		last_error = "could not reach %s:%d (error %d)" % [target, port, err]
		connection_failed.emit(last_error)
		return GameResult.fail(GameResult.Code.OFFLINE, last_error)
	multiplayer.multiplayer_peer = peer
	_is_server = false
	kind = Kind.INTERNET_CLIENT
	room["requested_code"] = room_code
	return GameResult.ok()

func leave_session() -> void:
	_close_session(true)
	session_ended.emit("left")

func _close_session(notify: bool) -> void:
	if _udp != null:
		_udp.close()
		_udp = null
	if multiplayer.multiplayer_peer != null:
		multiplayer.multiplayer_peer.close()
		multiplayer.multiplayer_peer = null
	kind = Kind.NONE
	_is_server = false
	room = {}
	discovered_rooms.clear()
	_peer_timeouts.clear()
	if notify:
		room_updated.emit(room)

# ------------------------------------------------------------------ discovery
func _begin_discovery() -> void:
	if _udp != null:
		return
	_udp = PacketPeerUDP.new()
	_udp.set_broadcast_enabled(true)
	var bind_err := _udp.bind(GameConfig.NET["lan_discovery_port"])
	if bind_err != OK:
		push_warning("NetworkManager: LAN discovery unavailable (port busy); use manual IP entry")
		_udp = null

func _send_beacon() -> void:
	if _udp == null:
		return
	var payload := {
		"room_code": str(room.get("code", "")),
		"name": str(room.get("name", "BlockStrike Room")),
		"mode": str(room.get("mode", "br")),
		"map": str(room.get("map", "emerald_island")),
		"players": (room.get("players", {}) as Dictionary).size(),
		"max_players": int(room.get("max_players", 8)),
		"private": bool(room.get("private", false)),
	}
	var bytes := var_to_bytes(payload)
	_udp.set_dest_address("255.255.255.255", GameConfig.NET["lan_discovery_port"])
	_udp.put_packet(bytes)

func _poll_discovery(delta: float) -> void:
	_discovery_accum += delta
	if _udp == null:
		return
	while _udp.get_available_packet_count() > 0:
		var packet := _udp.get_packet()
		var ip := _udp.get_packet_ip()
		var parsed: Variant = bytes_to_var(packet)
		if typeof(parsed) != TYPE_DICTIONARY:
			continue
		var info: Dictionary = parsed
		var code := str(info.get("room_code", ""))
		if code.is_empty():
			continue
		info["ip"] = ip
		info["seen_at"] = float(Time.get_ticks_msec()) / 1000.0
		var is_new := not discovered_rooms.has(code)
		discovered_rooms[code] = info
	if _discovery_accum >= 0.5:
		_discovery_accum = 0.0
		var now := float(Time.get_ticks_msec()) / 1000.0
		var expired: Array = []
		for code: String in discovered_rooms.keys():
			if now - float(discovered_rooms[code].get("seen_at", 0.0)) > ROOM_STALE_SECONDS:
				expired.append(code)
		for code: Variant in expired:
			discovered_rooms.erase(code)
		var list: Array = discovered_rooms.values()
		list.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
			return str(a.get("name", "")) < str(b.get("name", "")))
		discovery_updated.emit(list)

func discovered_list() -> Array:
	var list: Array = discovered_rooms.values()
	return list

func find_room_by_code(code: String) -> Dictionary:
	var wanted := code.strip_edges().to_upper()
	if discovered_rooms.has(wanted):
		return discovered_rooms[wanted]
	for entry: Variant in discovered_rooms.values():
		if str((entry as Dictionary).get("room_code", "")) == wanted:
			return entry
	return {}

# ------------------------------------------------------------------ room state
func _new_room(settings: Dictionary) -> Dictionary:
	return {
		"code": generate_room_code(),
		"name": str(settings.get("name", "%s's Room" % local_display_name)),
		"mode": str(settings.get("mode", "br")),
		"variant": str(settings.get("variant", "")),
		"map": str(settings.get("map", "emerald_island")),
		"max_players": int(settings.get("max_players", 8)),
		"team_size": int(settings.get("team_size", 1)),
		"private": bool(settings.get("private", false)),
		"password": str(settings.get("password", "")),
		"building": str(settings.get("building", "mode_default")),
		"bot_difficulty": str(settings.get("bot_difficulty", "normal")),
		"players": {},
		"ready": {},
		"teams": {},
		"created_at": int(Time.get_unix_time_from_system()),
		"started": false,
	}

static func generate_room_code() -> String:
	var rng := RandomNumberGenerator.new()
	rng.randomize()
	var code := ""
	for i: int in 5:
		code += ROOM_CODE_CHARS[rng.randi_range(0, ROOM_CODE_CHARS.length() - 1)]
	return code

## Server side: adds or refreshes a player slot (used for joins and reconnects).
func _register_player(peer_id: int, info: Dictionary = {}) -> bool:
	if peer_id <= 0:
		return false
	var players: Dictionary = room.get("players", {})
	if players.has(peer_id):
		return false
	if players.size() >= int(room.get("max_players", 8)) and peer_id != local_peer_id():
		return false
	var entry := {
		"peer_id": peer_id,
		"name": str(info.get("name", "Player %d" % peer_id)),
		"player_id": str(info.get("player_id", "")),
		"ready": peer_id == local_peer_id(),
		"team": 0,
		"connected_at": int(Time.get_unix_time_from_system()),
	}
	players[peer_id] = entry
	room["players"] = players
	_assign_team(peer_id)
	if peer_id != local_peer_id():
		peer_joined.emit(peer_id)
	_broadcast_room()
	return true

func _assign_team(peer_id: int) -> void:
	var players: Dictionary = room.get("players", {})
	var team_count: int = maxi(2, int(room.get("max_players", 8)) / maxi(1, int(room.get("team_size", 1))))
	var counts: Dictionary = {}
	for id: Variant in players.keys():
		var team: int = int((players[id] as Dictionary).get("team", 0))
		if team > 0:
			counts[team] = int(counts.get(team, 0)) + 1
	var best_team := 1
	var best_count := 99999
	for team: int in range(1, team_count + 1):
		var count: int = int(counts.get(team, 0))
		if count < best_count:
			best_count = count
			best_team = team
	(players[peer_id] as Dictionary)["team"] = best_team
	room["players"] = players

func _remove_player(peer_id: int) -> void:
	var players: Dictionary = room.get("players", {})
	if not players.has(peer_id):
		return
	var info: Dictionary = players[peer_id]
	_reconnect_slots[str(info.get("player_id", ""))] = {
		"peer_id": peer_id,
		"until": float(Time.get_ticks_msec()) / 1000.0 + RECONNECT_WINDOW,
		"info": info,
	}
	players.erase(peer_id)
	room["players"] = players
	(room.get("ready", {}) as Dictionary).erase(peer_id)
	peer_left.emit(peer_id)
	if peer_id == int(room.get("host_id", 0)) and _is_server:
		# Host left: hand over to the longest connected player, or end the session.
		if players.is_empty():
			_close_session(true)
			session_ended.emit("host left")
		else:
			var next_id: int = players.keys()[0]
			room["host_id"] = next_id
			_broadcast_room()
			return
	_broadcast_room()

## Host -> clients gameplay snapshot.  Unreliable and ordered, because a dropped
## snapshot is always superseded by the next one; the match state is cumulative.
func send_snapshot(payload: Dictionary) -> void:
	if not is_server() or not is_connected_session():
		return
	rpc("receive_snapshot", payload)

@rpc("authority", "call_remote", "unreliable_ordered")
func receive_snapshot(payload: Dictionary) -> void:
	snapshot_received.emit(payload)

## Clients send their own input/state intent to the host (validated host-side).
func send_player_state(state: Dictionary) -> void:
	if is_server() or not is_connected_session():
		return
	rpc_id(1, "receive_player_state", state)

@rpc("any_peer", "call_remote", "unreliable_ordered")
func receive_player_state(state: Dictionary) -> void:
	if not is_server():
		return
	var sender := multiplayer.get_remote_sender_id()
	peer_state_received.emit(sender, state)

func _broadcast_room() -> void:
	var snapshot := _public_room()
	if _is_server and multiplayer.multiplayer_peer != null:
		rpc("receive_room", snapshot)
	room_updated.emit(snapshot)

func _public_room() -> Dictionary:
	var copy: Dictionary = room.duplicate(true)
	copy.erase("password")
	var player_list: Array = []
	for id: Variant in (room.get("players", {}) as Dictionary).keys():
		player_list.append((room["players"] as Dictionary)[id])
	copy["player_list"] = player_list
	return copy

# ------------------------------------------------------------------- RPCs
@rpc("any_peer", "call_remote", "reliable")
func receive_hello(protocol: int, player_name: String, player_id: String) -> void:
	if not _is_server:
		return
	var sender := multiplayer.get_remote_sender_id()
	if protocol != GameConfig.PROTOCOL_VERSION:
		rpc_id(sender, "receive_error", "version_mismatch",
			"Server runs protocol %d, you have %d - update the game" % [GameConfig.PROTOCOL_VERSION, protocol])
		return
	if not _allow(sender, "hello", 2.0):
		return
	var info := {"name": _sanitize_name(player_name), "player_id": player_id}
	if not _register_player(sender, info):
		rpc_id(sender, "receive_error", "room_full", "this room is full")
	rpc_id(sender, "receive_room", _public_room())
	rpc_id(sender, "receive_clock", float(Time.get_unix_time_from_system()))

@rpc("authority", "call_remote", "reliable")
func receive_room(snapshot: Dictionary) -> void:
	if _is_server:
		return
	room = snapshot
	room_updated.emit(snapshot)

@rpc("authority", "call_remote", "reliable")
func receive_error(code: String, message: String) -> void:
	last_error = message
	connection_failed.emit("%s: %s" % [code, message])

@rpc("authority", "call_remote", "reliable")
func receive_clock(server_time: float) -> void:
	var offset := server_time - float(Time.get_unix_time_from_system())
	clock_offset = offset
	clock_synced.emit(offset)

@rpc("any_peer", "call_remote", "reliable")
func receive_ready(ready: bool) -> void:
	if not _is_server:
		return
	var sender := multiplayer.get_remote_sender_id()
	var players: Dictionary = room.get("players", {})
	if not players.has(sender):
		return
	(players[sender] as Dictionary)["ready"] = ready
	room["players"] = players
	_broadcast_room()

@rpc("any_peer", "call_remote", "reliable")
func receive_team_request(team: int) -> void:
	if not _is_server:
		return
	var sender := multiplayer.get_remote_sender_id()
	var players: Dictionary = room.get("players", {})
	if not players.has(sender):
		return
	var team_count: int = maxi(2, int(room.get("max_players", 8)) / maxi(1, int(room.get("team_size", 1))))
	if team < 1 or team > team_count:
		return
	var limit: int = int(room.get("team_size", 1))
	var count := 0
	for id: Variant in players.keys():
		if id != sender and int((players[id] as Dictionary).get("team", 0)) == team:
			count += 1
	if count >= limit:
		rpc_id(sender, "receive_error", "team_full", "that team is full")
		return
	(players[sender] as Dictionary)["team"] = team
	room["players"] = players
	_broadcast_room()

@rpc("any_peer", "call_remote", "reliable")
func receive_start_request() -> void:
	if not _is_server:
		return
	var sender := multiplayer.get_remote_sender_id()
	if sender != int(room.get("host_id", 0)):
		rpc_id(sender, "receive_error", "not_host", "only the host can start the match")
		return
	if not _ready_to_start():
		rpc_id(sender, "receive_error", "not_ready", "all players must be ready first")
		return
	# The host starts the match locally; clients get the settings and follow.

@rpc("authority", "call_remote", "reliable")
func receive_match_start(settings: Dictionary) -> void:
	if _is_server:
		return
	var check := MatchConfig.validate(settings)
	if not check.succeeded():
		last_error = check.error_text()
		connection_failed.emit(last_error)
		return
	room["started"] = true
	Lobby.begin_networked_match(settings)

func _ready_to_start() -> bool:
	var players: Dictionary = room.get("players", {})
	if players.is_empty():
		return false
	for id: Variant in players.keys():
		if not bool((players[id] as Dictionary).get("ready", false)):
			return false
	return true

## Server: validates ready state, then tells everyone (including itself) to load.
func start_match_as_host(settings: Dictionary) -> GameResult:
	if not _is_server:
		return GameResult.fail(GameResult.Code.UNAUTHORIZED, "only the host can start")
	if not _ready_to_start():
		return GameResult.fail(GameResult.Code.NOT_READY, "waiting for players to ready up")
	var check := MatchConfig.validate(settings)
	if not check.succeeded():
		return check
	room["started"] = true
	rpc("receive_match_start", settings)
	room_updated.emit(_public_room())
	return GameResult.ok(settings)

func set_ready(ready: bool) -> void:
	if _is_server:
		var players: Dictionary = room.get("players", {})
		if players.has(local_peer_id()):
			(players[local_peer_id()] as Dictionary)["ready"] = ready
			room["players"] = players
			_broadcast_room()
		return
	rpc_id(1, "receive_ready", ready)

func request_team(team: int) -> void:
	if _is_server:
		receive_team_request(team)
		return
	rpc_id(1, "receive_team_request", team)

func request_start() -> void:
	if _is_server:
		return
	rpc_id(1, "receive_start_request")

# ------------------------------------------------------------------ helpers
func _sanitize_name(raw: String) -> String:
	var cleaned := raw.strip_edges()
	cleaned = cleaned.replace("\n", " ").replace("\t", " ")
	if cleaned.length() > 18:
		cleaned = cleaned.substr(0, 18)
	return "Player" if cleaned.is_empty() else cleaned

## Simple token bucket so a client cannot spam reliable RPCs.
func _allow(peer_id: int, action: String, per_second: float) -> bool:
	var key := "%d:%s" % [peer_id, action]
	var now := float(Time.get_ticks_msec()) / 1000.0
	var bucket: Dictionary = _rate_limits.get(key, {"tokens": per_second, "at": now})
	var elapsed: float = now - float(bucket["at"])
	bucket["tokens"] = minf(per_second, float(bucket["tokens"]) + elapsed * per_second)
	bucket["at"] = now
	if float(bucket["tokens"]) < 1.0:
		_rate_limits[key] = bucket
		return false
	bucket["tokens"] = float(bucket["tokens"]) - 1.0
	_rate_limits[key] = bucket
	return true

func _check_peer_timeouts(delta: float) -> void:
	if not _is_server:
		return
	# Slot expiry for players that disconnected and may still reconnect.
	var now := float(Time.get_ticks_msec()) / 1000.0
	for player_id: String in _reconnect_slots.keys():
		if now > float(_reconnect_slots[player_id].get("until", 0.0)):
			_reconnect_slots.erase(player_id)

func reconnect_window_active(player_id: String) -> bool:
	return _reconnect_slots.has(player_id)

# ------------------------------------------------------- transport callbacks
func _on_peer_connected(peer_id: int) -> void:
	if _is_server:
		return
	# Client side: hello protocol handshake.
	rpc_id(1, "receive_hello", GameConfig.PROTOCOL_VERSION, local_display_name, local_player_id)
	connection_succeeded.emit()

func _on_peer_disconnected(peer_id: int) -> void:
	if _is_server:
		_remove_player(peer_id)

func _on_connected_to_server() -> void:
	rpc_id(1, "receive_hello", GameConfig.PROTOCOL_VERSION, local_display_name, local_player_id)
	connection_succeeded.emit()

func _on_connection_failed() -> void:
	last_error = "connection failed - check the address, port and that both devices are on the same network"
	_close_session(false)
	connection_failed.emit(last_error)

func _on_server_disconnected() -> void:
	_close_session(false)
	session_ended.emit("server disconnected")

# ------------------------------------------------------------- server config
func _read_server_config() -> void:
	var args := OS.get_cmdline_args()
	for arg: String in args:
		if arg.begins_with("--server="):
			server_address = arg.substr(9)
	var config := ConfigFile.new()
	if config.load(SERVER_CONFIG_PATH) == OK:
		server_address = str(config.get_value("server", "address", server_address))
	if not server_address.is_empty():
		account_verified = false
