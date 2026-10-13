extends Node3D
## Runs one match: generates the map, spawns the player and AI, runs the battle
## royale zone / supply drops / loot / respawns, decides the winner and grants rewards.
## Characters call back into this node through the "arena" hooks listed below.

const PLAYER_SCENE := preload("res://scenes/player.tscn")
const BOT_SCENE := preload("res://scenes/bot.tscn")
const VoxelWorld := preload("res://scripts/world/voxel_world.gd")
const MapGen := preload("res://scripts/world/map_generator.gd")
const FX := preload("res://scripts/weapons/fx.gd")
const LootPickup := preload("res://scripts/world/loot_pickup.gd")
const SupplyDrop := preload("res://scripts/world/supply_drop.gd")
const SafeZone := preload("res://scripts/match/safe_zone.gd")
const GameModes := preload("res://scripts/match/game_modes.gd")
const WDB := preload("res://scripts/weapons/weapon_db.gd")
const BD := preload("res://scripts/world/block_defs.gd")
const HUD := preload("res://scripts/ui/hud.gd")
const MobileControls := preload("res://scripts/ui/mobile_controls.gd")
const Bot := preload("res://scripts/characters/bot.gd")

const MAP_SEED := 20261013
const TRAIN_RESPAWN_BOT := 5.0
const TRAIN_RESPAWN_PLAYER := 3.0
const SUPPLY_FIRST := 100.0
const SUPPLY_EVERY := 90.0
const PICKUP_RANGE := 2.3
const AUTO_RANGE := 1.4

var mode_id: String = "br_solo"
var mode: Dictionary = {}
var gen
var world
var fx
var hud
var mobile
var env: Environment
var sun: DirectionalLight3D
var player = null
var spectator_cam: Camera3D

var state: String = "loading"
var match_time: float = 0.0
var countdown: float = 3.0
var zone_time: float = 0.0
var zone_center: Vector2 = Vector2(56, 56)
var zone_radius: float = 80.0
var zone_phase: int = 0
var zone_dps: float = 0.0
var zone_shrinking: bool = false
var zone_next_in: float = 0.0
var next_supply_t: float = SUPPLY_FIRST
var player_placement: int = 0
var player_kills: int = 0
var player_headshots: int = 0
var paused: bool = false
var inventory_open: bool = false
var rng := RandomNumberGenerator.new()

var _chars_root
var _pickup_root
var _chars: Array = []
var _pickups: Array = []
var _supply_roots: Array = []
var _respawns: Array = []
var _zone_mesh: MeshInstance3D
var _zone_tick: float = 0.0
var _vis_t: float = 0.0
var _spectate_idx: int = 0
var _ended: bool = false
var _notify_queue: Array = []
var _last_outside: bool = false


func _ready() -> void:
	mode_id = Game.current_mode
	mode = GameModes.get_mode(mode_id)
	rng.randomize()
	_build_environment()
	world = VoxelWorld.new()
	world.name = "VoxelWorld"
	add_child(world)
	fx = FX.new()
	fx.name = "FX"
	fx.particle_scale = float(Game.preset()["particles"])
	add_child(fx)
	_chars_root = Node3D.new()
	_chars_root.name = "Characters"
	add_child(_chars_root)
	_pickup_root = Node3D.new()
	_pickup_root.name = "Pickups"
	add_child(_pickup_root)

	var ui := CanvasLayer.new()
	ui.name = "UI"
	ui.layer = 5
	ui.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(ui)
	hud = HUD.new()
	hud.set_anchors_preset(Control.PRESET_FULL_RECT)
	ui.add_child(hud)
	hud.resume_pressed.connect(toggle_pause)
	hud.spectate_next_pressed.connect(func() -> void: _spectate_idx += 1)
	hud.quit_pressed.connect(_quit_to_menu)
	hud.edit_layout_pressed.connect(_start_layout_edit)
	hud.slot_pressed.connect(_on_hud_slot)
	hud.use_heal_pressed.connect(func() -> void: if player: player.use_heal())
	hud.drop_slot_pressed.connect(_on_hud_drop)
	hud.again_pressed.connect(_on_again)
	hud.lobby_pressed.connect(_quit_to_menu)
	hud.set_mode_name(mode.get("name", "Match"))

	var mui := CanvasLayer.new()
	mui.name = "TouchUI"
	mui.layer = 6
	mui.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(mui)
	mobile = MobileControls.new()
	mobile.set_anchors_preset(Control.PRESET_FULL_RECT)
	mui.add_child(mobile)
	mobile.pause_pressed.connect(toggle_pause)

	Controls.reset()
	Controls.enabled = false
	call_deferred("_start_generation")


func _exit_tree() -> void:
	Controls.reset()
	Controls.enabled = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


## Desktop only: capture the mouse for look while playing; release it in menus and overlays.
func _update_mouse_mode() -> void:
	if DisplayServer.is_touchscreen_available():
		return
	var want_captured: bool = state == "live" and not paused and not inventory_open and not _ended
	var target_mode := Input.MOUSE_MODE_CAPTURED if want_captured else Input.MOUSE_MODE_VISIBLE
	if Input.mouse_mode != target_mode:
		Input.mouse_mode = target_mode


func _build_environment() -> void:
	var we := WorldEnvironment.new()
	we.name = "Environment"
	env = Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var psm := ProceduralSkyMaterial.new()
	psm.sky_top_color = Color(0.22, 0.48, 0.9)
	psm.sky_horizon_color = Color(0.72, 0.86, 0.96)
	psm.ground_horizon_color = Color(0.62, 0.76, 0.84)
	psm.ground_bottom_color = Color(0.2, 0.26, 0.2)
	sky.sky_material = psm
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.85
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.fog_light_color = Color(0.72, 0.84, 0.94)
	we.environment = env
	add_child(we)
	sun = DirectionalLight3D.new()
	sun.name = "Sun"
	sun.rotation_degrees = Vector3(-55, 35, 0)
	sun.light_energy = 1.05
	sun.light_color = Color(1.0, 0.96, 0.88)
	sun.shadow_bias = 0.04
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	add_child(sun)
	Game.apply_graphics(env, sun)


# ---------------------------------------------------------------- generation
func _start_generation() -> void:
	hud.set_loading("Generating Ironridge Valley...")
	await get_tree().process_frame
	gen = MapGen.new()
	gen.generate(MAP_SEED)
	world.setup(gen)
	hud.set_loading("Building voxel meshes...")
	await get_tree().process_frame
	await world.build_all_async(6)
	hud.set_minimap(ImageTexture.create_from_image(gen.build_minimap()), Vector2(gen.size.x, gen.size.z))
	_spawn_entities()
	_create_zone_visual()
	hud.set_loading("")
	state = "countdown"
	countdown = 3.0
	Controls.enabled = false


func _spawn_entities() -> void:
	var spawns: PackedVector3Array = gen.spawn_points
	var team_size: int = int(mode["team_size"])
	player = PLAYER_SCENE.instantiate()
	player.display_name = str(Game.profile["name"])
	player.team = 0
	_chars_root.add_child(player)
	player.inv.unlimited_ammo = mode_id == "training"   # inv exists after _ready
	_register(player)
	player.global_position = spawns[0]
	player.setup_loadout(_loadout_weapons(true), _loadout_ammo(), _loadout_items(true))
	player.set_camera_far(float(Game.preset()["view_distance"]) * 2.0)

	var n_bots: int = int(mode["bots"])
	for i in n_bots:
		var b = BOT_SCENE.instantiate()
		b.display_name = "%s %02d" % [Bot.NAMES[i % Bot.NAMES.size()], i + 1]
		if bool(mode["br"]):
			b.team = (i + 1) / maxi(team_size, 1)
		else:
			b.team = 1
		b.difficulty = rng.randf_range(0.7, 0.95)
		_chars_root.add_child(b)
		_register(b)
		b.global_position = spawns[(i + 1) % spawns.size()]
		b.setup_loadout(_loadout_weapons(false), _loadout_ammo(), _loadout_items(false))
	# loot on the ground
	for p in gen.loot_points:
		_spawn_random_loot(p)


func _register(c) -> void:
	c.arena = self
	c.world = world
	c.fx = fx
	c.died.connect(_on_char_died)
	if c == player:
		c.hit_landed.connect(hud.hit_marker)
		c.damaged.connect(hud.damage_flash)
	_chars.append(c)


func _loadout_weapons(is_player: bool) -> Array:
	if bool(mode["br"]):
		return ["pistol", "knife"]
	if is_player:
		return ["ar", "pistol", "knife"]
	return ["ar", "pistol", "knife"]


func _loadout_ammo() -> Dictionary:
	if bool(mode["br"]):
		return {"light": 24, "medium": 0, "shell": 0, "heavy": 0}
	return WDB.START_AMMO.duplicate()


func _loadout_items(is_player: bool) -> Dictionary:
	if bool(mode["br"]):
		return {"bandage": 1, "medkit": 0, "armor_plate": 0, "blocks": 12 if is_player else 0}
	return {"bandage": 3, "medkit": 2, "armor_plate": 2, "blocks": 30}


func characters_list() -> Array:
	return _chars


func is_live() -> bool:
	return state == "live" and not paused


func zone_center_3d() -> Vector3:
	return Vector3(zone_center.x, 0.0, zone_center.y)


func is_outside_zone(pos: Vector3) -> bool:
	if not bool(mode["br"]):
		return false
	return not SafeZone.contains(zone_center, zone_radius, pos)


func random_roam_point(_from: Vector3) -> Vector3:
	if gen == null or gen.spawn_points.is_empty():
		return Vector3(zone_center.x, 14, zone_center.y)
	for i in 12:
		var p: Vector3 = gen.spawn_points[rng.randi() % gen.spawn_points.size()]
		if not is_outside_zone(p):
			return p
	return zone_center_3d()


func _random_spawn_point(min_from_player: float) -> Vector3:
	var best: Vector3 = gen.spawn_points[0]
	for i in 30:
		var p: Vector3 = gen.spawn_points[rng.randi() % gen.spawn_points.size()]
		best = p
		if player == null or not player.alive or p.distance_to(player.global_position) >= min_from_player:
			return p
	return best


# ---------------------------------------------------------------- pickups
func _spawn_random_loot(p: Vector3) -> void:
	var r: float = rng.randf()
	if r < 0.27:
		var wid: String = WDB.LOOT_WEAPONS[rng.randi() % WDB.LOOT_WEAPONS.size()]
		_spawn_pickup("weapon", wid, 1, p)
	elif r < 0.52:
		var t: String = WDB.AMMO_TYPES[rng.randi() % WDB.AMMO_TYPES.size()]
		_spawn_pickup("ammo", t, int(WDB.AMMO_PICKUP[t]), p)
	elif r < 0.68:
		if rng.randf() < 0.65:
			_spawn_pickup("item", "bandage", 1, p)
		else:
			_spawn_pickup("item", "medkit", 1, p)
	elif r < 0.78:
		_spawn_pickup("item", "armor_plate", 1, p)
	else:
		_spawn_pickup("item", "blocks", 8, p)


func _spawn_pickup(kind: String, item: String, amount: int, at: Vector3):
	var n = LootPickup.new()
	_pickup_root.add_child(n)
	n.setup(kind, item, amount, at)
	_pickups.append(n)
	return n


func _drop_pickup(kind: String, item: String, amount: int, at: Vector3, cooldown: float) -> void:
	var p := at + Vector3(rng.randf_range(-0.7, 0.7), 0.0, rng.randf_range(-0.7, 0.7))
	var n = _spawn_pickup(kind, item, amount, p)
	n.cooldown = cooldown


func _remove_pickup(n) -> void:
	_pickups.erase(n)
	if is_instance_valid(n):
		n.queue_free()


func _can_use_pickup(c, n, allow_replace: bool) -> bool:
	if n.cooldown > 0.0:
		return false
	if n.kind == "weapon":
		if allow_replace:
			return true
		var def: Dictionary = WDB.get_def(n.item)
		return c.inv.slots[int(def["slot"])] == null
	return true


func _collect(c, n, allow_replace: bool) -> bool:
	match n.kind:
		"weapon":
			var replaced: String = c.inv.add_weapon(n.item)
			if replaced != "":
				_drop_pickup("weapon", replaced, 1, c.global_position, 2.5)
			c.equip_slot(int(WDB.get_def(n.item)["slot"]))
			c._refresh_weapon_model()
		"ammo":
			c.inv.add_ammo(n.item, n.amount)
		"item":
			c.inv.add_item(n.item, n.amount)
	if c == player:
		Sfx.play("pickup", -4.0)
		_notify("Picked up %s" % n.describe())
	_remove_pickup(n)
	return true


## Used by bots (after walking to a loot goal) and by the player's USE button.
func try_pickup(c) -> bool:
	var best = null
	var best_d := PICKUP_RANGE
	for n in _pickups:
		if not is_instance_valid(n):
			continue
		var d: float = Vector2(n.global_position.x - c.global_position.x, n.global_position.z - c.global_position.z).length()
		if d >= best_d:
			continue
		if _can_use_pickup(c, n, c == player):
			best_d = d
			best = n
		elif c != player and n.cooldown <= 0.0:
			# a bot standing on something it cannot use: stop it being chosen again for a while
			n.cooldown = 4.0
	if best == null:
		return false
	return _collect(c, best, c == player)


## Called by a bot that could not reach a loot goal. Hides that pickup for a while.
func mark_unreachable(pos: Vector3) -> void:
	for n in _pickups:
		if is_instance_valid(n) and Vector2(n.global_position.x - pos.x, n.global_position.z - pos.z).length() < 1.5:
			n.cooldown = 25.0


func try_interact(c) -> bool:
	return try_pickup(c)


func nearest_loot_for(pos: Vector3, has_gun: bool, radius: float) -> Dictionary:
	var best = null
	var best_d := radius
	for n in _pickups:
		if not is_instance_valid(n) or n.cooldown > 0.0:
			continue
		var d: float = Vector2(n.global_position.x - pos.x, n.global_position.z - pos.z).length()
		if d >= best_d:
			continue
		if n.kind == "weapon" and has_gun and not _is_upgrade(n.item):
			continue
		best_d = d
		best = n
	if best == null:
		return {}
	return {"pos": best.global_position, "node": best}


func _is_upgrade(item: String) -> bool:
	return item == "ar" or item == "shotgun" or item == "sniper" or item == "smg"


func _update_auto_pickups() -> void:
	if player == null or not player.alive:
		return
	for n in _pickups.duplicate():
		if not is_instance_valid(n):
			continue
		var auto: bool = n.kind == "ammo" or (n.kind == "item" and (n.item == "armor_plate" or n.item == "blocks"))
		if not auto:
			continue
		var d: float = Vector2(n.global_position.x - player.global_position.x, n.global_position.z - player.global_position.z).length()
		if d < AUTO_RANGE and n.cooldown <= 0.0:
			_collect(player, n, false)


# ---------------------------------------------------------------- building
func request_build(c) -> bool:
	if not c.alive or c.inv.items.get("blocks", 0) <= 0:
		if c == player:
			_notify("No build blocks")
		return false
	if c.get("camera") == null:
		return false
	var cam_from: Vector3 = c.camera.global_position
	var fwd: Vector3 = -c.camera.global_basis.z
	var hit: Dictionary = world.raycast(cam_from, cam_from + fwd * 7.0, 1, [c])
	if hit.is_empty():
		_notify("Aim at a surface to build")
		return false
	var p: Vector3 = hit["position"] + hit["normal"] * 0.5
	var cell := Vector3i(floori(p.x), floori(p.y), floori(p.z))
	if world.get_block(cell.x, cell.y, cell.z) != BD.AIR:
		return false
	for ch in _chars:
		if not ch.alive:
			continue
		var cp: Vector3 = ch.global_position
		if absf(cell.x + 0.5 - cp.x) < 0.85 and absf(cell.z + 0.5 - cp.z) < 0.85 and cell.y + 1 > cp.y and cell.y < cp.y + 1.9:
			_notify("Too close to a player")
			return false
	world.set_block(cell, BD.SANDBAG)
	c.inv.items["blocks"] = int(c.inv.items["blocks"]) - 1
	Sfx.play_at("build", Vector3(cell) + Vector3(0.5, 0.5, 0.5), -2.0)
	fx.burst(Vector3(cell) + Vector3(0.5, 0.5, 0.5), hit["normal"], "dust", Color(0.85, 0.75, 0.5))
	return true


# ---------------------------------------------------------------- main loop
func _process(delta: float) -> void:
	# pause and inventory keys are handled here so they work while gameplay input is off
	if Controls.consume("pause"):
		toggle_pause()
	if Controls.consume("bag"):
		toggle_inventory()
	if state == "loading" or _ended:
		mobile.set_active(false)
		_update_hud(delta)
		return
	mobile.set_active(not paused and not inventory_open)
	_update_mouse_mode()
	if paused:
		_update_hud(delta)
		return
	match state:
		"countdown":
			countdown -= delta
			hud.set_banner("%d" % ceili(countdown), 0.2)
			if countdown <= 0.0:
				state = "live"
				Controls.enabled = true
				hud.set_banner("DROP IN!", 1.2)
				Sfx.play("ui", -2.0, 1.4)
		"live":
			_tick_live(delta)
	_update_hud(delta)
	if player.alive:
		hud.set_spectating(false)
	_flush_notifications(delta)


func _tick_live(delta: float) -> void:
	match_time += delta
	_zone_tick += delta
	_vis_t -= delta
	if _vis_t <= 0.0:
		_vis_t = 0.25
		var cam_pos: Vector3 = player.global_position if player.alive else (spectator_cam.global_position if spectator_cam else Vector3.ZERO)
		world.update_visibility(cam_pos, float(Game.preset()["view_distance"]))
	for r in _respawns.duplicate():
		r["time"] -= delta
		if r["time"] <= 0.0:
			_respawns.erase(r)
			_do_respawn(r["char"])

	if bool(mode["br"]):
		zone_time += delta
		var zs: Dictionary = SafeZone.state_at(zone_time)
		zone_radius = float(zs["radius"])
		zone_phase = int(zs["phase"])
		zone_dps = float(zs["dps"])
		zone_shrinking = bool(zs["shrinking"])
		zone_next_in = float(zs["next_in"])
		if _zone_tick >= 0.25:
			var tick: float = _zone_tick
			_zone_tick = 0.0
			for c in _chars:
				if c.alive and is_outside_zone(c.global_position):
					c.receive_damage(zone_dps * tick, false, null)
		_update_zone_visual()
		if match_time >= next_supply_t:
			next_supply_t += SUPPLY_EVERY
			_spawn_supply()
		if player.alive and is_outside_zone(player.global_position) != _last_outside:
			_last_outside = not _last_outside
			if _last_outside:
				hud.set_banner("OUTSIDE THE ZONE!", 2.0)
				Sfx.play("zone_warn", -4.0)
	_update_auto_pickups()
	_update_pickup_labels()
	if bool(mode["br"]):
		_check_br_end()
	if not player.alive and spectator_cam:
		_update_spectator(delta)
	if not player.alive and Controls.consume("switch"):
		_spectate_idx += 1


func _update_pickup_labels() -> void:
	var prompt := ""
	var best_d := PICKUP_RANGE + 0.5
	for n in _pickups:
		if not is_instance_valid(n):
			continue
		var d: float = Vector2(n.global_position.x - player.global_position.x, n.global_position.z - player.global_position.z).length()
		n.show_label(d < 4.0 and player.alive)
		if d < best_d and player.alive and n.kind != "ammo" and n.cooldown <= 0.0:
			best_d = d
			prompt = "USE: pick up %s" % n.describe()
	hud.set_prompt(prompt)


# ---------------------------------------------------------------- death & results
func _on_char_died(victim, killer) -> void:
	for d in victim.inv.drop_list():
		_drop_pickup(d["kind"], d["item"], int(d["amount"]), victim.global_position, 2.0)
	var kname: String = killer.display_name if killer else "Zone"
	var wname := ""
	if killer and killer.has_method("current_weapon_id") and killer.current_weapon_id() != "":
		wname = WDB.get_def(killer.current_weapon_id())["name"]
	var col := Color(1, 1, 1)
	if killer == player:
		col = Color(0.5, 1.0, 0.5)
		player_kills += 1
		if victim.last_hit_head:
			player_headshots += 1
	elif victim == player:
		col = Color(1.0, 0.5, 0.5)
	hud.add_feed("%s  %s  %s" % [kname, ("[" + wname + "]") if wname != "" else "", victim.display_name], col)
	Sfx.play_at("hurt", victim.global_position, -6.0, 0.6)

	if bool(mode["br"]):
		var alive_teams: Array = _alive_teams()
		if _team_alive_count(victim.team) == 0:
			victim.placement = alive_teams.size() + 1
			for c in _chars:
				if c.team == victim.team and c.placement == 0:
					c.placement = alive_teams.size() + 1
		if victim == player:
			player_placement = player.placement
			hud.set_banner("ELIMINATED  -  #%d" % player_placement, 3.0)
			_enter_spectator()
	else:
		var when := TRAIN_RESPAWN_PLAYER if victim == player else TRAIN_RESPAWN_BOT
		_respawns.append({"char": victim, "time": when})
		if victim == player:
			hud.set_banner("RESPAWNING...", 2.0)


func _team_alive_count(team_id: int) -> int:
	var n := 0
	for c in _chars:
		if c.team == team_id and c.alive:
			n += 1
	return n


func _alive_teams() -> Array:
	var teams: Array = []
	for c in _chars:
		if c.alive and not teams.has(c.team):
			teams.append(c.team)
	return teams


func _check_br_end() -> void:
	var teams := _alive_teams()
	if teams.size() <= 1:
		_end_match()


func _end_match() -> void:
	if _ended:
		return
	_ended = true
	state = "ended"
	Controls.enabled = false
	Controls.reset()
	var teams := _alive_teams()
	var won: bool = teams.size() == 1 and int(teams[0]) == int(player.team)
	var placement: int = 1 if won else maxi(int(player.placement), 2)
	var rewards: Dictionary = Game.grant_match_rewards(mode_id, player_kills, placement, won, player_headshots)
	Sfx.play("win" if won else "lose", -2.0)
	hud.show_results({
		"won": won, "placement": placement, "kills": player_kills, "headshots": player_headshots,
		"time": match_time, "rewards": rewards,
	})


func _on_again() -> void:
	Game.current_mode = mode_id
	get_tree().change_scene_to_file("res://scenes/match.tscn")


func _quit_to_menu() -> void:
	paused = false
	Controls.reset()
	Controls.enabled = false
	get_tree().change_scene_to_file("res://scenes/main.tscn")


func _do_respawn(c) -> void:
	var pos := _random_spawn_point(25.0)
	if c == player:
		c.setup_loadout(_loadout_weapons(true), _loadout_ammo(), _loadout_items(true))
		c.respawn_at(pos)
		c.set_camera_active(true)
		_notify("Respawned")
	else:
		c.respawn_at(pos)
		c.setup_loadout(_loadout_weapons(false), _loadout_ammo(), _loadout_items(false))


func _enter_spectator() -> void:
	player.set_camera_active(false)
	if spectator_cam == null:
		spectator_cam = Camera3D.new()
		spectator_cam.name = "SpectatorCam"
		spectator_cam.far = 320.0
		spectator_cam.fov = 70.0
		add_child(spectator_cam)
	spectator_cam.make_current()
	hud.set_spectating(true)


func _alive_others() -> Array:
	var out: Array = []
	for c in _chars:
		if c != player and c.alive:
			out.append(c)
	return out


func _update_spectator(delta: float) -> void:
	var others := _alive_others()
	if others.is_empty():
		return
	_spectate_idx = posmod(_spectate_idx, others.size())
	var t = others[_spectate_idx]
	var back: Vector3 = t.global_basis.z
	var goal: Vector3 = t.global_position + back * 4.2 + Vector3(0, 2.4, 0)
	spectator_cam.global_position = spectator_cam.global_position.lerp(goal, minf(1.0, delta * 5.0))
	spectator_cam.look_at(t.global_position + Vector3(0, 1.3, 0), Vector3.UP)
	hud.set_spectate_target(t.display_name)


func _on_hud_slot(i: int) -> void:
	if player and player.alive:
		player.equip_slot(i)


func _on_hud_drop(i: int) -> void:
	if player == null or not player.alive:
		return
	var w: Variant = player.inv.slots[i]
	if w == null:
		return
	player.inv.slots[i] = null
	if player.inv.active == i:
		player.inv.active = 0
	_drop_pickup("weapon", w["id"], 1, player.global_position, 2.0)
	player._refresh_weapon_model()
	_notify("Dropped %s" % WDB.get_def(w["id"])["name"])


func toggle_inventory() -> void:
	inventory_open = not inventory_open
	Controls.enabled = not inventory_open and state == "live" and not paused
	hud.set_inventory_open(inventory_open)


func toggle_pause() -> void:
	if state == "loading" or _ended:
		return
	paused = not paused
	Controls.enabled = not paused and state == "live" and not inventory_open
	hud.set_pause_open(paused)
	if paused:
		Controls.reset()


func _start_layout_edit() -> void:
	paused = false
	hud.set_pause_open(false)
	Controls.enabled = false
	mobile.start_edit()


# ---------------------------------------------------------------- zone visuals
func _create_zone_visual() -> void:
	_zone_mesh = MeshInstance3D.new()
	_zone_mesh.name = "ZoneWall"
	var cyl := CylinderMesh.new()
	cyl.top_radius = 1.0
	cyl.bottom_radius = 1.0
	cyl.height = 40.0
	cyl.cap_top = false
	cyl.cap_bottom = false
	cyl.radial_segments = 48
	_zone_mesh.mesh = cyl
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(1.0, 0.25, 0.2, 0.22)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_zone_mesh.material_override = m
	_zone_mesh.visible = bool(mode["br"])
	_zone_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_zone_mesh)
	_update_zone_visual()


func _update_zone_visual() -> void:
	if _zone_mesh == null:
		return
	_zone_mesh.position = Vector3(zone_center.x, 10.0, zone_center.y)
	_zone_mesh.scale = Vector3(zone_radius, 1.0, zone_radius)


# ---------------------------------------------------------------- supply drops
func _spawn_supply() -> void:
	for i in 40:
		var a: float = rng.randf() * TAU
		var r: float = sqrt(rng.randf()) * zone_radius * 0.6
		var x: int = clampi(int(zone_center.x + cos(a) * r), 2, gen.size.x - 3)
		var z: int = clampi(int(zone_center.y + sin(a) * r), 2, gen.size.z - 3)
		var top: int = world.ground_y(x, z)
		if world.get_block(x, top, z) == BD.WATER or world.get_block(x, top, z) == BD.AIR:
			continue
		var drop := SupplyDrop.new()
		add_child(drop)
		drop.setup(Vector3(x + 0.5, top + 1.0, z + 0.5), 45.0)
		drop.landed.connect(_on_supply_landed)
		_supply_roots.append(drop)
		_notify("Supply drop incoming!")
		return


func _on_supply_landed(pos: Vector3) -> void:
	fx.burst(pos + Vector3(0, 0.5, 0), Vector3.UP, "smoke", Color(0.9, 0.3, 0.2))
	Sfx.play_at("explode", pos, 2.0, 0.6)
	for i in 4:
		var off := Vector3(rng.randf_range(-2.0, 2.0), 0.0, rng.randf_range(-2.0, 2.0))
		if i < 2:
			_spawn_pickup("weapon", ["ar", "sniper", "shotgun"][rng.randi() % 3], 1, pos + off)
		else:
			_spawn_random_loot(pos + off)
	_notify("Supply drop landed!")


# ---------------------------------------------------------------- HUD
func _update_hud(delta: float) -> void:
	if hud == null or player == null:
		return
	var weapon_name := "-"
	var mag := 0
	var reserve := 0
	var reloading := false
	var slot_names: Array = []
	var slot_ids: Array = []
	if player.inv:
		for s in player.inv.slots:
			slot_names.append(WDB.get_def(s["id"])["name"] if s != null else "")
			slot_ids.append(s["id"] if s != null else "")
		if player.inv.current() != null:
			var cid: String = player.current_weapon_id()
			weapon_name = WDB.get_def(cid)["name"]
			mag = int(player.inv.current()["mag"])
			reserve = player.inv.reserve_of(cid)
			reloading = player.reload_t > 0.0
	var alive_count := 0
	for c in _chars:
		if c.alive:
			alive_count += 1
	var state_info := {
		"alive": player.alive, "hp": player.hp, "armor": player.armor,
		"weapon_name": weapon_name, "mag": mag, "reserve": reserve, "reloading": reloading,
		"active": player.inv.active, "slot_names": slot_names, "slot_ids": slot_ids,
		"items": player.inv.items, "ammo": player.inv.ammo,
		"time": match_time, "alive_count": alive_count, "total": _chars.size(),
		"br": bool(mode["br"]), "zone_center": zone_center, "zone_radius": zone_radius,
		"zone_phase": zone_phase, "zone_shrinking": zone_shrinking, "zone_next_in": zone_next_in,
		"zone_dps": zone_dps, "outside": player.alive and is_outside_zone(player.global_position),
		"player_pos": player.global_position, "player_yaw": player.facing_yaw() if player.has_method("facing_yaw") else 0.0,
		"kills": player_kills, "state": state, "countdown": countdown,
		"supply": _supply_markers(), "fps": Engine.get_frames_per_second(),
		"show_fps": bool(Game.settings["show_fps"]),
	}
	hud.update_state(state_info)


func _supply_markers() -> Array:
	var out: Array = []
	for d in _supply_roots:
		if is_instance_valid(d):
			out.append(Vector2(d.global_position.x, d.global_position.z))
	return out


func _notify(text: String) -> void:
	_notify_queue.append(text)


func _flush_notifications(delta: float) -> void:
	if _notify_queue.is_empty():
		return
	hud.notify(_notify_queue.pop_front())
