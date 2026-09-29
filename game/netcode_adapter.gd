class_name RoadfallNetcodeAdapter
extends Node

## Online seam: the offline match uses the exact same MatchDirector contract and
## substitutes bots. A server implementation can replace this adapter without
## touching vehicles, routes, loot, UI, or progression.

signal connection_state_changed(state: String)
signal server_snapshot(snapshot: Dictionary)

var state := "OFFLINE_BOTS"
var crossplay_enabled := true
var authoritative := false
var last_snapshot: Dictionary = {}

func connect_matchmaking(_ranked: bool, crossplay: bool) -> void:
    crossplay_enabled = crossplay
    state = "OFFLINE_BOTS"
    authoritative = false
    connection_state_changed.emit(state)

func submit_drive_input(input: Dictionary, tick: int) -> Dictionary:
    # A real backend validates this same payload: speed, acceleration, route,
    # destination progression, loot, inventory, rewards and winner state.
    return {"tick":tick, "input":input, "client_time":Time.get_ticks_msec()}

func validate_vehicle_snapshot(snapshot: Dictionary) -> bool:
    var speed := float(snapshot.get("speed", 0.0))
    var acceleration := float(snapshot.get("acceleration", 0.0))
    var teleport := float(snapshot.get("teleport_distance", 0.0))
    return speed <= 90.0 and acceleration <= 32.0 and teleport <= 120.0

func validate_reward(reward: Dictionary) -> bool:
    return int(reward.get("credits", 0)) >= 0 and int(reward.get("gems", 0)) >= 0 and int(reward.get("place", 99)) <= RoadfallData.MAX_COMPETITORS

func report_player(player_id: String, reason: String) -> Dictionary:
    return {"player":player_id, "reason":reason, "queued":true}

func create_private_lobby() -> String:
    return "RF-%04d" % (randi() % 10000)
