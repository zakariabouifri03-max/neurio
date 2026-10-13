extends Node
## MatchConfig - builds and validates match settings.
##
## A MatchSettings dictionary is the single contract between menus, the match
## manager, the bot filler and the network layer.  Every consumer validates what
## it receives, so a hand-edited room setting cannot put the game into an
## impossible state (e.g. 5 players in a 2v2, or building on a map that forbids it).

const DEFAULT_TEAM_SIZE := 1

## Creates a fully populated settings block for a mode/variant/map combination.
func build(mode_id: String, variant_id: String = "", map_id: String = "",
		   player_count: int = 1, options: Dictionary = {}) -> Dictionary:
	var mode: Dictionary = ContentDB.mode(mode_id)
	if mode.is_empty():
		push_warning("MatchConfig: unknown mode '%s', falling back to training" % mode_id)
		mode = ContentDB.mode("training")
		mode_id = "training"
	var variant: Dictionary = {}
	for entry: Variant in mode.get("variants", []):
		if str((entry as Dictionary).get("id", "")) == variant_id:
			variant = entry
	var team_size: int = int(variant.get("team_size", mode.get("team_size", DEFAULT_TEAM_SIZE)))
	var max_players: int = int(variant.get("max_players", mode.get("max_players", 8)))
	var resolved_map: String = map_id
	if resolved_map.is_empty() or ContentDB.map_data(resolved_map).is_empty():
		resolved_map = ContentDB.default_map_for_mode(mode_id)
	var map_info: Dictionary = ContentDB.map_data(resolved_map)
	var settings: Dictionary = {
		"mode": mode_id,
		"variant": str(variant.get("id", variant_id)),
		"mode_name": str(mode.get("name", mode_id)),
		"map": resolved_map,
		"map_name": str(map_info.get("name", resolved_map)),
		"team_size": team_size,
		"max_players": max_players,
		"player_count": clampi(player_count, 1, max_players),
		"bot_fill": bool(mode.get("bot_fill", true)),
		"friendly_fire": bool(mode.get("friendly_fire", false)),
		"respawn": bool(mode.get("respawn", false)),
		"respawn_delay_s": float(mode.get("respawn_delay_s", 3.0)),
		"spectate": bool(mode.get("spectate", true)),
		"zones": mode.get("zones", {"enabled": false}),
		"loot_multiplier": float(mode.get("loot_multiplier", 1.0)),
		"match_duration_s": float(mode.get("match_duration_s", 600.0)),
		"prep_time_s": float(mode.get("prep_time_s", 5.0)),
		"rounds_to_win": int(mode.get("rounds_to_win", 0)),
		"max_rounds": int(mode.get("max_rounds", 0)),
		"round_time_s": float(mode.get("round_time_s", 120.0)),
		"buy_time_s": float(mode.get("buy_time_s", 0.0)),
		"credits_start": int(mode.get("credits_start", 0)),
		"credits_per_round": int(mode.get("credits_per_round", 0)),
		"credits_per_elimination": int(mode.get("credits_per_elimination", 0)),
		"credits_per_round_win": int(mode.get("credits_per_round_win", 0)),
		"infinite_ammo": bool(mode.get("infinite_ammo", false)),
		"counts_for_progression": bool(mode.get("counts_for_progression", true)),
		"loadout": mode.get("loadout", {}),
		"building": map_info.get("building", {"allowed": false, "max_blocks_per_player": 0,
											  "build_distance": 6.0, "mode_default": "off"}),
		"server_authoritative": bool(options.get("server_authoritative", false)),
		"bots_allowed": bool(options.get("bots_allowed", true)),
		"bot_difficulty": str(options.get("bot_difficulty",
			SaveManager.data.flags.get("training_bot_difficulty", "normal"))),
		"teams": int(options.get("teams", 2)),
		"room_code": str(options.get("room_code", "")),
		"ranked": false,
		"allow_spectate_after_death": bool(mode.get("spectate", true)),
	}
	settings["building"] = _resolve_building(settings["building"], options)
	settings["match_id"] = _make_match_id(mode_id)
	return settings

func _resolve_building(building: Dictionary, options: Dictionary) -> Dictionary:
	var out: Dictionary = building.duplicate(true)
	var requested: String = str(options.get("building", out.get("mode_default", "off")))
	match requested:
		"off":
			out["allowed"] = false
		"limited":
			out["allowed"] = true
			out["max_blocks_per_player"] = mini(int(out.get("max_blocks_per_player", 20)), 24)
		"free":
			out["allowed"] = true
			out["max_blocks_per_player"] = maxi(int(out.get("max_blocks_per_player", 24)), 64)
		_:
			out["allowed"] = bool(out.get("allowed", false))
	out["requested"] = requested
	return out

func _make_match_id(mode_id: String) -> String:
	var rng := RandomNumberGenerator.new()
	rng.randomize()
	return "%s-%08x" % [mode_id, rng.randi()]

## Validates settings before a match is allowed to start.
func validate(settings: Dictionary) -> GameResult:
	if settings.is_empty():
		return GameResult.fail(GameResult.Code.INVALID, "empty settings")
	var mode_id: String = str(settings.get("mode", ""))
	if ContentDB.mode(mode_id).is_empty():
		return GameResult.fail(GameResult.Code.INVALID, "unknown mode '%s'" % mode_id)
	var map_id: String = str(settings.get("map", ""))
	if ContentDB.map_data(map_id).is_empty():
		return GameResult.fail(GameResult.Code.INVALID, "unknown map '%s'" % map_id)
	var mode: Dictionary = ContentDB.mode(mode_id)
	if not map_id in ContentDB.map_data(map_id).get("mode_tags", []) and mode_id != "training":
		return GameResult.fail(GameResult.Code.INVALID,
			"%s is not playable in %s" % [settings.get("map_name", map_id), mode.get("name", mode_id)])
	var team_size: int = int(settings.get("team_size", 1))
	if team_size < 1 or team_size > 8:
		return GameResult.fail(GameResult.Code.INVALID, "team size out of range")
	if int(settings.get("teams", 2)) < 1 or int(settings.get("teams", 2)) > 32:
		return GameResult.fail(GameResult.Code.INVALID, "team count out of range")
	var max_players: int = int(settings.get("max_players", 1))
	var total_slots: int = int(settings.get("teams", 2)) * team_size
	if max_players > total_slots:
		max_players = total_slots
	if int(settings.get("player_count", 1)) > max_players:
		return GameResult.fail(GameResult.Code.FULL, "more players than slots")
	if int(settings.get("max_players", 1)) > GameConfig.NET["max_players_internet"]:
		return GameResult.fail(GameResult.Code.INVALID, "too many players for one server")
	var duration: float = float(settings.get("match_duration_s", 600.0))
	if duration < 60.0 or duration > 3600.0:
		return GameResult.fail(GameResult.Code.INVALID, "match duration out of range")
	if int(settings.get("rounds_to_win", 0)) > int(settings.get("max_rounds", 0)) \
			and int(settings.get("max_rounds", 0)) > 0:
		return GameResult.fail(GameResult.Code.INVALID, "round target exceeds maximum rounds")
	if bool(settings.get("building", {}).get("allowed", false)) \
			and not bool(ContentDB.map_data(map_id).get("building", {}).get("allowed", false)):
		return GameResult.fail(GameResult.Code.INVALID, "building is disabled on this map")
	return GameResult.ok(settings)

## Team assignment used by team modes: balances counts, keeps squads together.
func assign_teams(player_ids: Array, team_count: int) -> Dictionary:
	var teams: Dictionary = {}
	for index: int in team_count:
		teams[index + 1] = []
	for i: int in player_ids.size():
		var team: int = (i % team_count) + 1
		(teams[team] as Array).append(player_ids[i])
	return teams

func slot_count(settings: Dictionary) -> int:
	return int(settings.get("teams", 2)) * int(settings.get("team_size", 1))
