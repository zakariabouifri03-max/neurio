class_name MatchManager
extends Node3D
## Owns one live match: map, players, bots, zone, loot, scoring and results.
##
## The same class drives every mode and every way of playing (offline training,
## LAN host, LAN client, internet client).  It is authoritative on the host: bots,
## loot, the zone and all damage live here, and clients receive snapshots.  Nothing
## about a mode is hard-coded into the world - the behaviour differences come from
## data/modes.json plus the settings stored in `MatchState`.

signal match_ready()
signal match_started()
signal match_ended(result: Dictionary)
signal player_joined(player: PlayerController)
signal player_left(player: PlayerController)
signal kill_feed(entry: Dictionary)
signal phase_changed(phase: String, data: Dictionary)
signal notice(text: String, color: Color)
signal buy_phase_changed(active: bool, seconds_left: float)
signal spectate_target_changed(target: PlayerController)
signal leave_requested()

enum Phase { LOADING, WARMUP, BUY, ACTIVE, SHRINK, ENDED }

const MAX_PLAYERS := 60
const SNAPSHOT_INTERVAL := 1.0 / 20.0
const BOT_NAMES := ["Rook", "Vane", "Kilo", "Moss", "Juno", "Pike", "Wren", "Ash",
	"Nix", "Talon", "Sable", "Ivo", "Bracken", "Foxglove", "Marlin", "Quill",
	"Ridge", "Sparrow", "Thorne", "Umber", "Vesper", "Wisp", "Yarrow", "Zephyr"]

var settings: Dictionary = {}
var mode_id: String = "training"
var map_id: String = "training_base"
var mode_data: Dictionary = {}
var map_data: Dictionary = {}
var world: VoxelWorld = null
var zone: ZoneManager = null
var phase: int = Phase.LOADING
var phase_timer: float = 0.0
var score: Dictionary = {}          ## team -> points
var players: Array[PlayerController] = []
var bots: Array[BotController] = []
var local_player: PlayerController = null
var spectating: PlayerController = null
var round_number: int = 1
var teams_size: int = 1
var match_seed: int = 0

var is_authoritative: bool = true
var is_offline: bool = true

var _spawn_index: int = 0
var _rng := RandomNumberGenerator.new()
var _snapshot_timer: float = 0.0
var _zone_started: bool = false
var _next_supply_drop: float = 0.0
var _supply_index: int = 0
var _eliminated_order: Array = []
var _team_assignment: Dictionary = {}
var _world_ready_hooked: bool = false
var _transition_lock: bool = false
var spawn_points: Array = []
var _respawn_queue: Array = []

func _ready() -> void:
	set_process(true)
	set_physics_process(false)

func _exit_tree() -> void:
	if world != null and is_instance_valid(world):
		world.queue_free()

# ------------------------------------------------------------------ setup
## Builds a match from a validated MatchConfig settings dictionary.
func configure(config_settings: Dictionary, seed_value: int = 0) -> GameResult:
	if config_settings.is_empty():
		return GameResult.fail(GameResult.Code.INVALID, "empty match settings")
	var check := MatchConfig.validate(config_settings)
	if not check.succeeded():
		return GameResult.fail(GameResult.Code.INVALID, check.error_text())
	settings = config_settings.duplicate(true)
	MatchState.set_settings(settings)
	mode_id = str(settings.get("mode", "training"))
	map_id = str(settings.get("map", ContentDB.default_map_for_mode(mode_id)))
	mode_data = ContentDB.mode(mode_id)
	map_data = ContentDB.map_data(map_id)
	if mode_data.is_empty() or map_data.is_empty():
		return GameResult.fail(GameResult.Code.INVALID, "unknown mode or map")
	match_seed = seed_value if seed_value != 0 else int(settings.get("seed", 0))
	if match_seed == 0:
		match_seed = int(Time.get_ticks_usec() & 0x7fffffff)
	_rng.seed = match_seed
	teams_size = maxi(1, int(settings.get("teams_size", 1)))
	score.clear()
	_eliminated_order.clear()
	round_number = 1
	return _build_world()

func _build_world() -> GameResult:
	world = VoxelWorld.new()
	world.name = "VoxelWorld"
	add_child(world)
	# The viewer is attached once the local player exists, so the world starts
	# streaming exactly around the player that owns this screen.
	world.setup(map_id, match_seed, null)
	var size: Dictionary = map_data.get("size_blocks", {})
	var size_x := float(size.get("x", 256))
	var size_z := float(size.get("z", 256))
	zone = ZoneManager.new()
	zone.name = "ZoneManager"
	add_child(zone)
	zone.set_bounds(Rect2(0.0, 0.0, size_x, size_z))
	var modes_zone: Dictionary = mode_data.get("zones", {})
	var zone_enabled := bool(modes_zone.get("enabled", false))
	# The viewer is set after the local player spawns; the world streams around it.
	world.world_ready.connect(_on_world_ready, CONNECT_ONE_SHOT)
	_open_spawn_list()
	var initial_radius := maxf(size_x, size_z) * 0.5 * float(modes_zone.get("start_radius_mult", 1.0))
	zone.start(Vector2(size_x * 0.5, size_z * 0.5), initial_radius, match_seed, zone_enabled)
	_next_supply_drop = _match_seconds(float(ContentDB.loot_tables()
		.get("supply_drop_schedule", {}).get("first_at", 0.35)))
	phase = Phase.WARMUP
	phase_timer = float(mode_data.get("prep_time_s", 5.0))
	_spawn_loot()
	return GameResult.ok()

## Converts a fraction of the match duration into an absolute delay.
func _match_seconds(fraction: float) -> float:
	return fraction * float(mode_data.get("match_duration_s", 900.0))

## Fills the map's named places with loot containers according to their loot tier.
func _spawn_loot() -> void:
	if float(mode_data.get("loot_multiplier", 1.0)) <= 0.0:
		_spawn_training_props()
		return
	var space := world.container_space()
	if space == null:
		return
	var types := ["crate_wood", "crate_metal", "ammo_box", "med_box"]
	for place: Variant in world.places():
		var entry: Dictionary = place
		var place_id := str(entry.get("id", ""))
		var tier := str(entry.get("loot", "low"))
		var budget := int(round(6.0 * float(mode_data.get("loot_multiplier", 1.0))))
		var points := world.loot_points(place_id, budget)
		for index: int in points.size():
			var point: Vector3 = points[index]
			var type_id: String = types[index % types.size()]
			var container := LootContainer.new()
			container.setup(type_id, tier, int(_rng.randi()))
			space.add_child(container)
			container.global_position = point

## Training Ground has no loot table; it gets ammo/med boxes and targets instead.
func _spawn_training_props() -> void:
	var space := world.container_space()
	if space == null:
		return
	for place: Variant in world.places():
		var entry: Dictionary = place
		var points := world.loot_points(str(entry.get("id", "")), 6)
		for index: int in points.size():
			var container := LootContainer.new()
			var type_id := "ammo_box" if index % 3 != 2 else "med_box"
			container.setup(type_id, "mid", int(_rng.randi()))
			space.add_child(container)
			container.global_position = points[index]

func _open_spawn_list() -> void:
	spawn_points = world.spawn_points()
	if spawn_points.is_empty():
		spawn_points = [Vector3.ZERO]

func _on_world_ready() -> void:
	_world_ready_hooked = true
	match_ready.emit()

## Spawns the human player.  `player_id` is the local account id ("local" offline).
func spawn_local_player(player_id: String, display_name: String, team: int = 1) -> PlayerController:
	var spawn := _next_spawn(team)
	var player := Players.spawn_player(self, world, player_id, display_name, team, spawn, true)
	local_player = player
	_register_player(player)
	player.respawn_enabled = bool(mode_data.get("respawn", false))
	if world != null:
		world.set_viewer(player)
	AudioDirector.play_music(str(mode_data.get("music", "music_match")))
	return player

## Spawns a single bot of the given difficulty (`Settings` difficulty by default).
func spawn_bot(difficulty_id: String = "", team: int = 0) -> PlayerController:
	if players.size() >= MAX_PLAYERS:
		return null
	var level := difficulty_id
	if level.is_empty():
		level = str(settings.get("bot_difficulty", mode_data.get("bot_difficulty", "normal")))
	if not BotController.DIFFICULTIES.has(level):
		level = "normal"
	var resolved_team := team
	if resolved_team <= 0:
		resolved_team = _auto_team()
	var spawn := _next_spawn(resolved_team)
	var name := BOT_NAMES[int(_rng.randi_range(0, BOT_NAMES.size() - 1))]
	var bot_player := Players.spawn_player(self, world, "bot_%d" % (bots.size() + 1),
		"%s [%s]" % [name, level.capitalize()], resolved_team, spawn, false)
	bot_player.is_bot = true
	bot_player.animator.apply_cosmetics(Players.bot_cosmetics(bots.size()))
	var controller := BotController.new()
	controller.name = "BotBrain_%d" % (bots.size() + 1)
	add_child(controller)
	var brain_seed := match_seed + bots.size() * 7919
	controller.setup(bot_player, level, brain_seed, world, zone)
	controller.building = bot_player.building
	bots.append(controller)
	_register_player(bot_player)
	return bot_player

## Fills the match with bots and (offline) training dummies.
func populate_bots(count: int, difficulty_id: String = "", team: int = 0) -> int:
	var spawned := 0
	for i: int in count:
		var bot_team := team
		if bot_team <= 0 and teams_size > 1:
			bot_team = (i % teams_size) + 1
		if spawn_bot(difficulty_id, bot_team) != null:
			spawned += 1
	return spawned

## Spawns the bots the lobby asked for (bot_count / bot_difficulty in settings).
func populate_from_settings() -> int:
	var count := int(settings.get("bot_count", 0))
	if count <= 0:
		count = int(mode_data.get("bots_default", 0))
		if count <= 0 or not bool(settings.get("bots_allowed", true)):
			return 0
	return populate_bots(count, str(settings.get("bot_difficulty",
		mode_data.get("bot_difficulty", "normal"))))

## Records damage dealt by the local player (used for the results screen).
func record_damage(amount: int) -> void:
	if local_player == null or amount <= 0:
		return
	var key := "damage_%s" % local_player.player_id
	score[key] = int(score.get(key, 0)) + amount

func _auto_team() -> int:
	if teams_size <= 1:
		return 0
	var counts: Dictionary = {}
	for player: PlayerController in players:
		var t := player.team
		counts[t] = int(counts.get(t, 0)) + 1
	var best_team := 1
	var best_count := 1 << 30
	for team: int in range(1, teams_size + 1):
		var count := int(counts.get(team, 0))
		if count < best_count:
			best_count = count
			best_team = team
	return best_team

func _next_spawn(team: int) -> Vector3:
	if spawn_points.is_empty():
		_open_spawn_list()
	var point: Vector3
	var list: Array = []
	if teams_size > 1 and team > 0:
		var team_spawns: Dictionary = world.spawn_points_for_teams(teams_size)
		if team_spawns.has(team):
			list = team_spawns[team]
	if list.is_empty():
		list = spawn_points
	point = list[_spawn_index % maxi(1, list.size())]
	_spawn_index += 1
	return point

func _register_player(player: PlayerController) -> void:
	players.append(player)
	player.add_to_group("damageable")
	player.died.connect(_on_player_died)
	player.damaged.connect(_on_player_damaged)
	var weapons := player.weapons
	if weapons != null:
		weapons.killed.connect(_on_weapon_kill.bind(player))
		weapons.equip_from_loadout(_starting_loadout(player))
	player.infinite_ammo = bool(settings.get("infinite_ammo", false))
	if weapons != null:
		weapons.set_infinite_ammo(player.infinite_ammo)
	if player.inventory != null:
		player.inventory.bind(player)
	if player.building != null:
		player.building.apply_match_rules()
	if player.inventory != null and not player.is_local:
		# Give bots a reasonable starting kit so they fight instead of jogging.
		player.inventory.add("build_block", 20)
		player.inventory.add("bandage", 1)
	player_joined.emit(player)

func _starting_loadout(player: PlayerController) -> Dictionary:
	if player.is_bot:
		var pool: Array = ContentDB.weapons_for_rarity_zone("mid")
		var loadout: Dictionary = ContentDB.section("weapons").get("default_loadout", {}).duplicate()
		if not pool.is_empty():
			var pick: Dictionary = pool[int(_rng.randi_range(0, pool.size() - 1))]
			loadout["primary"] = str(pick.get("id", loadout.get("primary", "")))
		return loadout
	var loadout_settings: Dictionary = settings.get("loadout", {})
	if str(settings.get("mode", "")) == "training":
		return ContentDB.section("weapons").get("default_loadout", {})
	if not loadout_settings.is_empty():
		return loadout_settings
	return ContentDB.section("weapons").get("default_loadout", {})

# ------------------------------------------------------------------ lifecycle
func start_match() -> void:
	phase = Phase.ACTIVE
	phase_timer = 0.0
	_transition_lock = false
	AudioDirector.play_ui("match_start", 0.0)
	notice.emit(_mode_notice(), UiKit.rarity_color("uncommon"))
	phase_changed.emit("active", {})
	match_started.emit()

func _process(delta: float) -> void:
	match phase:
		Phase.WARMUP:
			phase_timer -= delta
			if phase_timer <= 0.0:
				if float(mode_data.get("buy_time_s", 0.0)) > 0.0:
					_enter_buy_phase()
				else:
					start_match()
		Phase.BUY:
			phase_timer -= delta
			buy_phase_changed.emit(true, maxf(0.0, phase_timer))
			if phase_timer <= 0.0:
				buy_phase_changed.emit(false, 0.0)
				start_match()
		Phase.ACTIVE, Phase.SHRINK:
			_tick_active(delta)
		Phase.ENDED:
			pass
	_tick_respawns(delta)
	if is_authoritative:
		_snapshot_timer += delta
		if _snapshot_timer >= SNAPSHOT_INTERVAL:
			_snapshot_timer = 0.0
			_broadcast_snapshot()

func _enter_buy_phase() -> void:
	phase = Phase.BUY
	phase_timer = float(mode_data.get("buy_time_s", 20.0))
	buy_phase_changed.emit(true, phase_timer)
	notice.emit("Buy phase: spend your credits (%d s)" % int(phase_timer), UiKit.rarity_color("rare"))
	for player: PlayerController in players:
		if player.inventory != null:
			player.inventory.credits = int(settings.get("starting_credits",
				mode_data.get("credits_start", 800)))
		player.resupply(ContentDB.section("weapons").get("default_loadout", {}))
		player.infinite_ammo = false
		player.weapons.set_infinite_ammo(false)
		player.spawn_at(_next_spawn(player.team))

func _tick_active(delta: float) -> void:
	_check_team_win()
	if bool(mode_data.get("zone", {}).get("enabled", false)):
		if not _zone_started and phase == Phase.ACTIVE:
			var delay := float(mode_data.get("zone", {}).get("start_delay", 30.0))
			if phase_timer >= delay:
				_zone_started = true
				zone.running = true
		phase_timer += delta
		if zone.finished and not _transition_lock:
			_transition_lock = true
			notice.emit("The zone has closed", UiKit.rarity_color("legendary"))
	if bool(mode_data.get("zones", {}).get("enabled", false)) and mode_id == "br":
		_tick_supply_drops()
	if float(mode_data.get("round_time_s", 0.0)) > 0.0 \
			and phase_timer > float(mode_data.get("round_time_s")):
		_end_round("draw")

func _tick_supply_drops() -> void:
	_next_supply_drop -= get_process_delta_time()
	if _next_supply_drop > 0.0:
		return
	var drops: Array = world.drop_points()
	if drops.is_empty():
		_next_supply_drop = 60.0
		return
	var index := _supply_index % drops.size()
	_supply_index += 1
	var point: Vector3 = drops[index]
	if zone != null and zone.running and not zone.inside_next(point):
		point = Vector3(zone.target_center.x, point.y, zone.target_center.y)
		point.y = world.ground_y(point.x, point.z)
	_spawn_supply_drop(point)
	var schedule: Dictionary = ContentDB.loot_tables().get("supply_drop_schedule", {})
	_next_supply_drop = _match_seconds(float(schedule.get("interval", 0.2))) \
		* _rng.randf_range(0.85, 1.15)

func _spawn_supply_drop(position: Vector3) -> void:
	var space := world.container_space()
	if space == null:
		return
	var container := LootContainer.new()
	container.setup("supply_drop", "high", int(_rng.randi()))
	space.add_child(container)
	container.global_position = position + Vector3(0, 1.5, 0)
	notice.emit("Supply drop incoming", UiKit.rarity_color("epic"))
	AudioDirector.play_ui("ui_confirm", -6.0)
	for player: PlayerController in players:
		if player.is_local:
			player.loot_interacted.emit(container)

# ------------------------------------------------------------------ damage/kills
func _on_player_damaged(_amount: float, _attacker_id: String, _direction: Vector3) -> void:
	pass

## Weapon kills arrive with the shooter bound in, so credit is always exact.
func _on_weapon_kill(target: Node, weapon_id: String, shooter: PlayerController) -> void:
	if target is PlayerController:
		register_kill(target as PlayerController, shooter, weapon_id)

func _on_player_died(killer_id: String, weapon_id: String) -> void:
	if not _eliminated_order.has(killer_id):
		pass

## Central kill bookkeeping: scores, kill feed, rewards, spectating.
func register_kill(victim: PlayerController, killer: PlayerController, weapon_id: String) -> void:
	if killer != null:
		killer_kills(killer)
	var entry := {
		"killer": killer.display_name if killer != null else "World",
		"victim": victim.display_name,
		"weapon": weapon_id,
		"headshot": false,
		"killer_id": killer.player_id if killer != null else "",
	}
	kill_feed.emit(entry)
	_eliminated_order.append(victim.player_id)
	if victim.is_local:
		AudioDirector.play_ui("elimination", -2.0)
		_begin_spectate(victim)
	else:
		AudioDirector.play_ui("defeat", -6.0)
	if killer != null and killer.is_local:
		AudioDirector.play_ui("victory", -3.0)
		if Missions != null:
			Missions.report("eliminations", 1)
	_check_mode_end()

func killer_kills(killer: PlayerController) -> void:
	var kills := int(score.get("kills_%s" % killer.player_id, 0)) + 1
	score["kills_%s" % killer.player_id] = kills
	if teams_size > 1:
		score[killer.team] = int(score.get(killer.team, 0)) + int(mode_data.get("team_win_score_per_kill", 0))

func alive_players() -> Array:
	var result: Array = []
	for player: PlayerController in players:
		if player.alive:
			result.append(player)
	return result

func alive_team_count(team: int) -> int:
	var count := 0
	for player: PlayerController in players:
		if player.alive and player.team == team:
			count += 1
	return count

func teams_present() -> Array:
	var teams: Array = []
	for player: PlayerController in players:
		if player.team > 0 and not teams.has(player.team):
			teams.append(player.team)
	teams.sort()
	return teams

func _check_mode_end() -> void:
	match mode_id:
		"br":
			var alive := alive_players()
			if players.size() > 1 and alive.size() <= 1:
				_end_round("victory" if alive.size() == 1 else "last_standing")
		"clash", "arena":
			var target_score := int(mode_data.get("rounds_to_win", 4))
			var winning_team := 0
			for team: int in teams_present():
				if int(score.get(team, 0)) >= target_score:
					winning_team = team
					break
			if winning_team == 0:
				for team: int in teams_present():
					if alive_team_count(team) == 0:
						winning_team = _other_team(team)
						break
			if winning_team != 0:
				_end_round("team_%d" % winning_team)
		_:
			pass

func _other_team(team: int) -> int:
	for other: int in teams_present():
		if other != team:
			return other
	return 0

func _check_team_win() -> void:
	if teams_size <= 1:
		return
	var alive_teams: Array = []
	for team: int in teams_present():
		if alive_team_count(team) > 0:
			alive_teams.append(team)
	if alive_teams.size() == 1 and teams_present().size() > 1 and mode_id != "training":
		_end_round("team_%d" % alive_teams[0])

# ------------------------------------------------------------------- rounds
func _end_round(outcome: String) -> void:
	if phase == Phase.ENDED:
		return
	phase = Phase.ENDED
	phase_timer = 0.0
	zone.stop()
	for controller: BotController in bots:
		controller.set_process(false)
	var summary := build_result(outcome)
	AudioDirector.play_ui("victory" if _local_won(outcome) else "defeat", -2.0)
	match_ended.emit(summary)
	# Offline play persists progress immediately; online play reports to the server.
	if is_offline:
		Progression.record_match(summary)
		Missions.report("matches_played", 1)
		Economy.grant_match_reward(summary)
	phase_changed.emit("ended", summary)

func _local_won(outcome: String) -> bool:
	if local_player == null:
		return false
	if outcome.begins_with("team_"):
		return local_player.team == int(outcome.substr(5))
	if outcome == "victory" or outcome == "last_standing":
		return local_player.alive and alive_players().size() <= 1
	return false

func build_result(outcome: String) -> Dictionary:
	var placement := 1
	if local_player != null:
		var position := _eliminated_order.find(local_player.player_id)
		if position >= 0:
			placement = _eliminated_order.size() - position
		else:
			placement = alive_players().size()
	var kills := int(score.get("kills_%s" % (local_player.player_id if local_player != null else ""), 0))
	var squad_kills := 0
	if local_player != null and teams_size > 1:
		for player: PlayerController in players:
			if player.team == local_player.team:
				squad_kills += int(score.get("kills_%s" % player.player_id, 0))
	var summary := {
		"mode": mode_id,
		"map": map_id,
		"outcome": outcome,
		"placement": maxi(1, placement),
		"players": players.size(),
		"kills": kills,
		"squad_kills": squad_kills,
		"damage": int(score.get("damage_%s" % (local_player.player_id if local_player != null else ""), 0)),
		"duration": phase_timer,
		"team_scores": score.duplicate(),
		"won": _local_won(outcome),
		"ranked": bool(settings.get("ranked", false)),
		"eliminated_order": _eliminated_order.duplicate(),
	}
	return summary

## Manual scoreboard feed (used by the HUD and by tests).
func scoreboard() -> Array:
	var rows: Array = []
	for player: PlayerController in players:
		rows.append({
			"name": player.display_name,
			"team": player.team,
			"kills": int(score.get("kills_%s" % player.player_id, 0)),
			"alive": player.alive,
			"health": player.health,
			"is_bot": player.is_bot,
			"is_local": player.is_local,
		})
	rows.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return int(a["kills"]) > int(b["kills"]))
	return rows

func _mode_notice() -> String:
	match mode_id:
		"br":
			return "Survive: the zone is closing"
		"clash":
			return "First to %d rounds" % int(mode_data.get("rounds_to_win", 4))
		"arena":
			return "2v2 arena - win the rounds"
	return "Training Ground"

# ------------------------------------------------------------------ respawns
func request_respawn(player: PlayerController, delay: float = 3.0) -> void:
	if player == null:
		return
	_respawn_queue.append({"player": player, "time": delay + Time.get_ticks_msec() / 1000.0})

func _tick_respawns(_delta: float) -> void:
	if _respawn_queue.is_empty():
		return
	var now := Time.get_ticks_msec() / 1000.0
	var remaining: Array = []
	for entry: Variant in _respawn_queue:
		var data: Dictionary = entry
		var player: PlayerController = data["player"]
		if not is_instance_valid(player):
			continue
		if float(data["time"]) <= now:
			player.spawn_at(_next_spawn(player.team))
			if player.is_local and not player.respawn_enabled:
				player.respawn_enabled = bool(settings.get("respawns", false))
		else:
			remaining.append(data)
	_respawn_queue = remaining

func _begin_spectate(victim: PlayerController) -> void:
	var candidates := alive_players()
	if candidates.is_empty():
		spectating = null
		return
	spectating = candidates[0]
	spectate_target_changed.emit(spectating)

func cycle_spectate(forward: bool = true) -> PlayerController:
	var candidates := alive_players()
	if candidates.is_empty():
		return null
	var index := candidates.find(spectating)
	index = 0 if index < 0 else (index + (1 if forward else -1) + candidates.size()) % candidates.size()
	spectating = candidates[index]
	spectate_target_changed.emit(spectating)
	return spectating

## Called when the local player is eliminated: the camera follows a live player.
func spectate_update(delta: float) -> void:
	if spectating == null or not is_instance_valid(spectating):
		return
	if local_player == null or local_player.camera == null:
		return
	var pivot := local_player.camera_pivot
	if pivot == null:
		return
	pivot.global_position = pivot.global_position.lerp(
		spectating.global_position + Vector3(0, 1.6, 0), minf(1.0, delta * 6.0))

# ------------------------------------------------------------------ buy phase
## Handles a purchase request during the buy phase (Clash Squad / Arena).
func purchase(item_id: String) -> GameResult:
	if phase != Phase.BUY:
		return GameResult.fail(GameResult.Code.UNAUTHORIZED, "not in the buy phase")
	if local_player == null or local_player.inventory == null:
		return GameResult.fail(GameResult.Code.INVALID, "no player")
	var weapon := ContentDB.weapon(item_id)
	if weapon.is_empty():
		return GameResult.fail(GameResult.Code.INVALID, "unknown item")
	var price := int(weapon.get("price", 0))
	var spend := local_player.inventory.spend_credits(price)
	if not spend.succeeded():
		return GameResult.fail(GameResult.Code.NOT_ENOUGH_FUNDS, "not enough credits")
	var slot := WeaponController._slot_for_category(str(weapon.get("category", "")))
	local_player.weapons.slots[slot] = item_id
	local_player.weapons.magazines[item_id] = int(weapon.get("magazine", 1))
	local_player.weapons.reserves[item_id] = int(weapon.get("reserve_ammo", 0))
	local_player.weapons.switch_to(slot)
	return GameResult.ok({"item": item_id, "credits": local_player.inventory.credits})

func buy_options() -> Array:
	var options: Array = []
	for weapon_id: String in ContentDB.weapon_ids():
		var weapon := ContentDB.weapon(weapon_id)
		var price := int(weapon.get("price", 0))
		if price <= 0:
			continue
		options.append({"id": weapon_id, "name": weapon.get("display_name", weapon_id),
			"price": price, "category": weapon.get("category", ""),
			"rarity": weapon.get("rarity", "common")})
	options.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return int(a["price"]) < int(b["price"]))
	return options

# ------------------------------------------------------------------ networking
func _broadcast_snapshot() -> void:
	if is_offline or not NetworkManager.is_host():
		return
	var payload: Dictionary = {"zone": zone.snapshot(), "players": {}}
	var player_states: Dictionary = {}
	for player: PlayerController in players:
		player_states[player.player_id] = player.state_snapshot()
	payload["players"] = player_states
	NetworkManager.send_snapshot(payload)

## Applies a host snapshot on a client (interpolated by PlayerController).
func apply_snapshot(payload: Dictionary) -> void:
	if payload.has("zone"):
		zone.apply_snapshot(payload["zone"])
	var player_states: Dictionary = payload.get("players", {})
	for player: PlayerController in players:
		var state: Variant = player_states.get(player.player_id)
		if state is Dictionary:
			player.apply_snapshot(state)

# ------------------------------------------------------------------ teardown
## Emitted when the player asks to leave; the app root performs the scene change.


func request_leave() -> void:
	_stop_everything()
	Lobby.leave_room()
	leave_requested.emit()

func _stop_everything() -> void:
	phase = Phase.ENDED
	zone.stop()
	for controller: BotController in bots:
		controller.set_process(false)
	if world != null:
		world.set_process(false)
	AudioDirector.stop_music()

func shutdown() -> void:
	_stop_everything()
	MatchState.clear()
	players.clear()
	bots.clear()
	local_player = null
	spectating = null
	queue_free()
