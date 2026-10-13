extends Node
## LAN transport layer. The offline prototype is authoritative locally.
## Internet matchmaking still needs a deployed dedicated server and authentication service.

signal status_changed(message: String, connected: bool)
signal player_list_changed(players: Array)

const DEFAULT_PORT := 7777
const MAX_PLAYERS := 32

var peer: ENetMultiplayerPeer
var mode := "offline"
var room_code := ""
var connected_players: Array = []
var server_configured := false

func _ready() -> void:
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)
	multiplayer.connected_to_server.connect(_on_connected_to_server)
	multiplayer.connection_failed.connect(_on_connection_failed)
	multiplayer.server_disconnected.connect(_on_server_disconnected)

func host_lan(port: int = DEFAULT_PORT) -> bool:
	stop()
	peer = ENetMultiplayerPeer.new()
	var result := peer.create_server(port, MAX_PLAYERS)
	if result != OK:
		status_changed.emit("LAN host failed: %s" % error_string(result), false)
		return false
	multiplayer.multiplayer_peer = peer
	mode = "lan_host"
	room_code = _make_room_code(port)
	connected_players = ["Host"]
	status_changed.emit("LAN room %s hosting on port %d" % [room_code, port], true)
	player_list_changed.emit(connected_players)
	return true

func join_lan(address: String, port: int = DEFAULT_PORT) -> bool:
	stop()
	if address.strip_edges().is_empty():
		status_changed.emit("Enter a local IPv4 address", false)
		return false
	peer = ENetMultiplayerPeer.new()
	var result := peer.create_client(address.strip_edges(), port)
	if result != OK:
		status_changed.emit("LAN join failed: %s" % error_string(result), false)
		return false
	multiplayer.multiplayer_peer = peer
	mode = "lan_client"
	status_changed.emit("Connecting to %s:%d" % [address, port], false)
	return true

func stop() -> void:
	if multiplayer.multiplayer_peer != null:
		multiplayer.multiplayer_peer.close()
	multiplayer.multiplayer_peer = null
	peer = null
	mode = "offline"
	room_code = ""
	connected_players.clear()

func is_networked() -> bool:
	return mode != "offline"

func _make_room_code(port: int) -> String:
	return "%04d" % (port % 10000)

func _on_peer_connected(id: int) -> void:
	if mode == "lan_host":
		connected_players.append("Player %d" % id)
	player_list_changed.emit(connected_players)

func _on_peer_disconnected(id: int) -> void:
	connected_players.erase("Player %d" % id)
	player_list_changed.emit(connected_players)
	status_changed.emit("Player %d disconnected" % id, false)

func _on_connected_to_server() -> void:
	connected_players = ["Host", "You"]
	status_changed.emit("Connected to LAN host", true)
	player_list_changed.emit(connected_players)

func _on_connection_failed() -> void:
	status_changed.emit("LAN connection failed", false)
	stop()

func _on_server_disconnected() -> void:
	status_changed.emit("LAN host disconnected", false)
	stop()
