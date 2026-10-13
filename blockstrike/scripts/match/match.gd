class_name Match
extends Node3D
## Runs one match. On the authority (offline / LAN host / dedicated server) it simulates everything at
## 30 Hz; on network clients it predicts the local player and interpolates everyone else.

signal hud_event(type: String, data: Dictionary)

const BTN_FIRE := 1
const BTN_AIM := 2
const BTN_JUMP := 4
const BTN_CROUCH := 8
const BTN_SPRINT := 16
const BTN_AUTOPICK := 32
const TICK := 1.0 / 30.0
const SMOKE_R := 4.6

static var time := 0.0

var cfg := {}
var mode := {}
var kind := "br"
var map_id := ""
var seed := 0
var world: VoxelWorld
var terrain: VoxelTerrain
var effects: Effects
var rules: ModeRules
var actors := {}
var views := {}
var brains := {}
var loot := {}
var loot_views := {}
var loot_claims := {}      # loot id -> bot actor id (bots spread over different items)
var crates := {}
var crate_nodes := {}
var projectiles: Array = []
var proj_nodes := {}
var smokes: Array = []
var actions: Array = []
var events: Array = []
var cmd_queue := {}
var last_cmd := {}
var prev_fire := {}
var next_id := 1
var next_obj := 1
var is_server := true
var has_view := true
var net_role := "offline"
var local_id := -1
var local_peer := 1
var controller: Node
var hud: Node
var sun: DirectionalLight3D
var env: WorldEnvironment
var plane_node: Node3D
var loading := true
var match_ended := false
var tick_n := 0
var pending: Array = []
var seq := 0
var spectate_id := -1
var summary_cache := {}
var zone_cache := {}
var end_data := {}
var start_msec := 0
var _pending_loot_add: Array = []
var _pending_loot_del: Array = []
var _pending_blocks: Array = []
var _rng := RandomNumberGenerator.new()
var _correction := Vector3.ZERO
var recent_shots: Array = []   # [pos, time] for minimap gunfire markers
var _air_view := false
var debug_kills := OS.has_environment("BSR_DEBUG_KILLS")

# ================================================================== setup
func setup(c: Dictionary) -> void:
	cfg = c
	net_role = c.get("net", "offline")
	is_server = net_role in ["offline", "host", "dedicated"]
	has_view = net_role != "dedicated"
	mode = DB.MODES.get(c.get("mode", "training"), DB.MODES["training"])
	kind = mode["kind"]
	map_id = c.get("map", mode["map"])
	seed = int(c.get("seed", randi()))
	_rng.seed = seed
	local_peer = int(c.get("local_peer", 1))
	time = 0.0
	Match.time = 0.0
	start_msec = Time.get_ticks_msec()
	world = WorldGen.generate(map_id)
	rules = ModeRules.new(self, kind, int(mode["team"]))
	if has_view:
		_setup_view()
	if is_server:
		_create_actors()
		rules.setup()
		_flush_pending()
	if not has_view:
		loading = false

func _setup_view() -> void:
	VoxelArt.build()
	VoxelArt.unlit_mode = Settings.is_unlit()
	env = WorldEnvironment.new()
	var e := Environment.new()
	var sky := Sky.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(0.25, 0.48, 0.85)
	sm.sky_horizon_color = Color(0.68, 0.82, 0.95)
	sm.ground_horizon_color = Color(0.68, 0.82, 0.95)
	sm.ground_bottom_color = Color(0.3, 0.42, 0.55)
	sm.sun_angle_max = 20.0
	sky.sky_material = sm
	e.background_mode = Environment.BG_SKY
	e.sky = sky
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.62, 0.68, 0.8)
	e.ambient_light_energy = 0.6
	e.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	e.fog_enabled = true
	e.fog_mode = Environment.FOG_MODE_DEPTH
	e.fog_light_color = Color(0.7, 0.82, 0.94)
	e.fog_depth_begin = Settings.view_distance() * 0.55
	e.fog_depth_end = Settings.view_distance()
	e.fog_sky_affect = 0.0
	e.glow_enabled = false
	env.environment = e
	add_child(env)
	sun = DirectionalLight3D.new()
	sun.rotation = Vector3(deg_to_rad(-52), deg_to_rad(-38), 0)
	sun.light_energy = 1.05
	sun.light_color = Color(1.0, 0.97, 0.9)
	sun.shadow_enabled = Settings.shadows_enabled()
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	sun.directional_shadow_max_distance = 45.0 if Settings.quality() < 2 else 70.0
	sun.shadow_blur = 1.0
	add_child(sun)
	terrain = VoxelTerrain.new()
	terrain.view_distance = Settings.view_distance()
	terrain.cast_shadows = Settings.shadows_enabled()
	add_child(terrain)
	terrain.build_done.connect(_on_terrain_ready)
	terrain.start_build(world)
	effects = Effects.new()
	effects.particle_scale = [0.4, 0.75, 1.0][Settings.quality()]
	add_child(effects)
	if world.water_level > 0:
		_add_ocean()
	if kind == "br":
		plane_node = MeshInstance3D.new()
		(plane_node as MeshInstance3D).mesh = Models.plane_mesh()
		(plane_node as MeshInstance3D).material_override = VoxelArt.prop_material()
		plane_node.visible = false
		add_child(plane_node)

## Big flat sea around the map (outside the voxel area only, so rivers keep their voxel water).
func _add_ocean() -> void:
	var y := float(world.water_level) - 0.06
	var S := float(world.sx)
	var Z := float(world.sz)
	var e := 900.0
	var quads := [[Vector2(-e, -e), Vector2(S + e, 0)], [Vector2(-e, Z), Vector2(S + e, Z + e)], [Vector2(-e, 0), Vector2(0, Z)], [Vector2(S, 0), Vector2(S + e, Z)]]
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	for q in quads:
		var a: Vector2 = q[0]
		var b: Vector2 = q[1]
		for p in [Vector2(a.x, a.y), Vector2(b.x, a.y), Vector2(b.x, b.y), Vector2(a.x, a.y), Vector2(b.x, b.y), Vector2(a.x, b.y)]:
			v.append(Vector3(p.x, y, p.y))
			n.append(Vector3.UP)
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	arr[Mesh.ARRAY_NORMAL] = n
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.16, 0.38, 0.68)
	mat.roughness = 0.3
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	if Settings.is_unlit():
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)

func _on_terrain_ready() -> void:
	loading = false
	hud_event.emit("loaded", {})
	if net_role == "client":
		Net.send_loaded()

func set_underwater(on: bool) -> void:
	if not has_view:
		return
	var e := env.environment
	if on:
		e.fog_light_color = Color(0.08, 0.3, 0.55)
		e.fog_depth_begin = 0.0
		e.fog_depth_end = 16.0
	else:
		e.fog_light_color = Color(0.7, 0.82, 0.94)
		var dist := Settings.view_distance()
		e.fog_depth_begin = dist * 0.55
		e.fog_depth_end = dist
		_air_view = false

func apply_quality() -> void:
	if not has_view:
		return
	VoxelArt.unlit_mode = Settings.is_unlit()
	terrain.apply_quality(Settings.view_distance(), Settings.shadows_enabled())
	sun.shadow_enabled = Settings.shadows_enabled()
	env.environment.fog_depth_begin = Settings.view_distance() * 0.55
	env.environment.fog_depth_end = Settings.view_distance()
	effects.particle_scale = [0.4, 0.75, 1.0][Settings.quality()]

# ================================================================== actors
func _create_actors() -> void:
	var humans: Array = cfg.get("players", [])
	var tsize: int = mode["team"]
	var total: int = int(cfg.get("max_players", mode["players"]))
	var fill: bool = cfg.get("bots", true)
	var team_of := {}
	var next_team := 0
	var team_count := {}
	for h in humans:
		var t: int = int(h.get("team", -1))
		if kind in ["cs", "arena"]:
			if t < 0 or t > 1:
				t = 0 if int(team_count.get(0, 0)) <= int(team_count.get(1, 0)) else 1
		elif kind == "training":
			t = 0
		else:
			if t < 0:
				while int(team_count.get(next_team, 0)) >= tsize:
					next_team += 1
				t = next_team
		team_count[t] = int(team_count.get(t, 0)) + 1
		var a := add_actor(str(h.get("name", "Player")), t, false, int(h.get("peer", 1)), h.get("cos", DB.DEFAULT_EQUIP))
		if a.peer_id == local_peer and net_role != "dedicated":
			local_id = a.id
	if kind == "training":
		for i in int(cfg.get("bot_count", 2)):
			_add_training_bot(0.35)
		return
	if not fill:
		return
	var diff: int = int(cfg.get("difficulty", 1))
	var names := DB.BOT_NAMES.duplicate()
	var brng := RandomNumberGenerator.new()
	brng.seed = seed + 5
	for i in range(names.size() - 1, 0, -1):
		var j := brng.randi() % (i + 1)
		var tmp = names[i]
		names[i] = names[j]
		names[j] = tmp
	var bi := 0
	while actors.size() < total:
		var t := 0
		if kind in ["cs", "arena"]:
			t = 0 if int(team_count.get(0, 0)) < tsize else 1
			if int(team_count.get(1, 0)) >= tsize and t == 1:
				break
		else:
			while int(team_count.get(next_team, 0)) >= tsize:
				next_team += 1
			t = next_team
		team_count[t] = int(team_count.get(t, 0)) + 1
		var sk := clampf([0.28, 0.5, 0.75][diff] + brng.randf_range(-0.15, 0.15), 0.08, 0.95)
		var a := add_actor(names[bi % names.size()], t, true, 0, random_cosmetics(brng), sk)
		bi += 1

func add_actor(nm: String, team: int, bot: bool, peer: int, cos: Dictionary, skill := 0.5) -> Actor:
	var a := Actor.new()
	a.id = next_id
	next_id += 1
	a.name = nm
	a.team = team
	a.is_bot = bot
	a.peer_id = peer
	a.cosmetics = cos
	a.skill = skill
	a.alive_since = time
	actors[a.id] = a
	if bot:
		brains[a.id] = BotBrain.new(self, a, skill)
	if has_view:
		_make_view(a)
	return a

func random_cosmetics(r: RandomNumberGenerator) -> Dictionary:
	var out := {}
	for t in ["skin", "outfit", "helmet", "backpack", "wrap"]:
		var list := DB.cosmetics_of(t)
		out[t] = list[r.randi() % list.size()]["id"]
	return out

func spawn_dummy(pos: Vector3, moving: bool) -> void:
	var a := add_actor("Target Dummy", 99, true, 0, {}, 0.0)
	a.dummy = true
	a.hp = 200.0
	a.pos = pos
	a.yaw = PI
	a.set_meta("home", pos)
	var b: BotBrain = brains[a.id]
	b.dummy = true
	b.dummy_origin = pos
	b.dummy_moving = moving
	if has_view:
		var old = views.get(a.id)
		if old:
			(old as Node).queue_free()
		_make_view(a)

func _add_training_bot(skill: float) -> void:
	var r := RandomNumberGenerator.new()
	r.seed = randi()
	var a := add_actor(DB.BOT_NAMES[r.randi() % DB.BOT_NAMES.size()], 1, true, 0, random_cosmetics(r), skill)
	var bs: Array = world.spawns.get("bots", [Vector3(20, 10, 20)])
	respawn(a, bs[r.randi() % bs.size()])
	rules._bot_loadout(a)

func local_actor() -> Actor:
	return actors.get(local_id)

func relation_to_local(a: Actor) -> int:
	if a.id == local_id:
		return 0
	var me := local_actor()
	if me and me.team == a.team and not a.dummy:
		return 1
	return 2

func _make_view(a: Actor) -> void:
	if a.dummy:
		var dv := DummyView.new()
		add_child(dv)
		dv.setup(a)
		views[a.id] = dv
		return
	var v := ActorView.new()
	add_child(v)
	v.setup(a, relation_to_local(a), Settings.is_unlit())
	views[a.id] = v

## Duck-typed call on an actor view (ActorView or DummyView).
func _view_call(id: int, method: String, args: Array = []) -> void:
	var v = views.get(id)
	if v != null and is_instance_valid(v) and (v as Object).has_method(method):
		(v as Object).callv(method, args)

func respawn(a: Actor, p: Vector3) -> void:
	a.state = Actor.St.ALIVE
	a.hp = Actor.MAX_HP
	a.knock_hp = Actor.KNOCK_HP
	a.pos = p
	a.vel = Vector3.ZERO
	a.crouch = false
	a.use_item = ""
	a.reload_end = 0.0
	a.emote = ""
	a.revive_target = -1
	a.alive_since = time
	push_event("respawn", {"a": a.id, "p": p})

# ================================================================== main loop
func _physics_process(_dt: float) -> void:
	if loading or (match_ended and not is_server) or has_meta("hold"):
		return
	if is_server:
		_server_tick(TICK)
	else:
		_client_tick(TICK)

var _perf_t := 0.0
var _perf_frames := 0

func _process(dt: float) -> void:
	if not has_view or loading:
		return
	_update_visuals(dt)
	# periodic performance line (visible in `adb logcat -s godot`)
	_perf_t += dt
	_perf_frames += 1
	if _perf_t >= 10.0:
		print("[perf] %s q=%s fps=%.1f draws=%d tris=%d static_mem=%dMB video_mem=%dMB actors=%d loot=%d" % [kind, Settings.QUALITY_NAMES[Settings.quality()],
			_perf_frames / _perf_t, int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)),
			int(Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME)), int(Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0),
			int(Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0), actors.size(), loot.size()])
		_perf_t = 0.0
		_perf_frames = 0

func _server_tick(dt: float) -> void:
	time += dt
	Match.time = time
	tick_n += 1
	rules.tick(dt)
	var acts := actions
	actions = []
	for e in acts:
		var a: Actor = actors.get(e[0])
		if a:
			_do_action(a, e[1])
	for id in actors.keys():
		var a: Actor = actors.get(id)
		if a == null:
			continue
		if brains.has(id):
			_sim_actor(a, (brains[id] as BotBrain).think(dt), dt)
		elif id == local_id:
			_sim_actor(a, controller.call("make_cmd") if controller else {}, dt)
		else:
			var q: Array = cmd_queue.get(id, [])
			if q.is_empty():
				var lc: Dictionary = last_cmd.get(id, {})
				if not lc.is_empty():
					lc = lc.duplicate()
					lc["b"] = int(lc["b"]) & ~BTN_FIRE & ~BTN_JUMP
					lc["mx"] = 0.0
					lc["mz"] = 0.0
				_sim_actor(a, lc, dt)
			else:
				var n := 0
				while not q.is_empty() and n < 2:
					var c: Dictionary = q.pop_front()
					last_cmd[id] = c
					a.last_seq = int(c.get("s", 0))
					_sim_actor(a, c, dt)
					n += 1
				if q.size() > 6:
					q.clear()
		a.history.append([time, a.pos])
		if a.history.size() > 20:
			a.history.pop_front()
	_update_projectiles(dt)
	_update_crates(dt)
	if tick_n % 5 == 0:
		_auto_pickups()
		smokes = smokes.filter(func(s): return float(s[1]) > time)
	if tick_n % 30 == 0:
		push_event("sum", rules.summary())
	_flush_pending()
	if has_view:
		for ev in events:
			_present(ev[0], ev[1])
		for id in views:
			_view_call(id, "tick_sync")
	if net_role != "offline":
		Net.server_flush(self, events, tick_n % 2 == 0)
	events.clear()

func _flush_pending() -> void:
	if not _pending_loot_add.is_empty():
		events.append(["loot_add", {"l": _pending_loot_add}])
		_pending_loot_add = []
	if not _pending_loot_del.is_empty():
		events.append(["loot_del", {"l": _pending_loot_del}])
		_pending_loot_del = []
	if not _pending_blocks.is_empty():
		events.append(["blocks", {"l": _pending_blocks}])
		_pending_blocks = []
	for id in actors:
		var a: Actor = actors[id]
		if a.inv_dirty and not a.is_bot:
			a.inv_dirty = false
			events.append(["inv", {"a": a.id, "inv": a.inv_dict(), "_to": a.peer_id}])

func push_event(type: String, data: Dictionary) -> void:
	events.append([type, data])
	if debug_kills and type == "kill":
		var att: Actor = actors.get(int(data["a"]))
		var vic: Actor = actors.get(int(data["v"]))
		print("    t=%.0f %s(team %d) -> %s(team %d) w=%s knock=%d" % [time, att.name if att else "-", att.team if att else -1, vic.name, vic.team, data["w"], int(data["k"])])

func queue_action(a: Actor, act: Dictionary) -> void:
	actions.append([a.id, act])

func mark_inv(a: Actor) -> void:
	a.inv_dirty = true

func announce(text: String) -> void:
	push_event("announce", {"t": text})

func broadcast_zone() -> void:
	push_event("zone", rules.zone_dict())

# ================================================================== simulation of one actor
func _sim_actor(a: Actor, cmd: Dictionary, dt: float) -> void:
	if a.state == Actor.St.DEAD:
		return
	if cmd.is_empty():
		cmd = {"mx": 0.0, "mz": 0.0, "yaw": a.yaw, "pitch": a.pitch, "b": 0}
	var b: int = int(cmd.get("b", 0))
	var frozen := rules.frozen()
	a.yaw = float(cmd.get("yaw", a.yaw))
	a.pitch = clampf(float(cmd.get("pitch", a.pitch)), -1.45, 1.45)
	a.aiming = (b & BTN_AIM) != 0 and a.state == Actor.St.ALIVE
	a.sprint = (b & BTN_SPRINT) != 0
	if a.state == Actor.St.ALIVE:
		a.try_set_crouch(world, (b & BTN_CROUCH) != 0)
	var mx: float = clampf(float(cmd.get("mx", 0.0)), -1.0, 1.0)
	var mz: float = clampf(float(cmd.get("mz", 0.0)), -1.0, 1.0)
	if frozen:
		mx = 0.0
		mz = 0.0
	if a.emote != "" and (absf(mx) + absf(mz) > 0.1 or (b & BTN_FIRE) != 0):
		a.emote = ""
	if a.revive_target != -1 and absf(mx) + absf(mz) > 0.2:
		a.revive_target = -1
	a.move_step(world, mx, mz, (b & BTN_JUMP) != 0 and not frozen, dt)
	if a.pending_fall_damage > 0.0:
		apply_damage(a, null, a.pending_fall_damage, false, "fall")
		a.pending_fall_damage = 0.0
	if a.pos.y < -8.0 and a.is_alive():
		eliminate(a, null, "void", false)
		return
	_update_timers(a, dt)
	var fire := (b & BTN_FIRE) != 0 and not frozen
	var edge := fire and not bool(prev_fire.get(a.id, false))
	prev_fire[a.id] = fire
	if fire:
		_try_fire(a, edge)
	a.bloom = maxf(0.0, a.bloom - dt * 5.0)
	if (b & BTN_AUTOPICK) != 0:
		a.set_meta("autopick", true)

func _update_timers(a: Actor, dt: float) -> void:
	if a.reload_end > 0.0 and time >= a.reload_end:
		_finish_reload(a)
	if a.use_item != "" and time >= a.use_end:
		_finish_use(a)
	if a.hot_left > 0.0 and a.state == Actor.St.ALIVE:
		var h := minf(a.hot_left, 2.0 * dt)
		a.hot_left -= h
		var before := a.hp
		a.hp = minf(Actor.MAX_HP, a.hp + h)
		a.healed += a.hp - before
	if a.revive_target != -1:
		var t: Actor = actors.get(a.revive_target)
		if t == null or t.state != Actor.St.KNOCKED or a.state != Actor.St.ALIVE or a.pos.distance_to(t.pos) > 2.8:
			a.revive_target = -1
		elif time >= a.revive_end:
			a.revive_target = -1
			t.state = Actor.St.ALIVE
			t.hp = 30.0
			t.knock_hp = Actor.KNOCK_HP
			a.revives += 1
			push_event("revive", {"a": a.id, "v": t.id})
	if a.state == Actor.St.KNOCKED:
		a.knock_hp -= 2.6 * dt
		if a.knock_hp <= 0.0:
			eliminate(a, actors.get(a.last_attacker), "bleed", false)
	if a.emote != "" and time > a.emote_end:
		a.emote = ""

# ================================================================== weapons
func _try_fire(a: Actor, edge: bool) -> void:
	if a.state != Actor.St.ALIVE or time < a.next_fire or a.switch_end > time:
		return
	var wid := a.weapon_id()
	var w := DB.weapon(wid)
	if w.is_empty():
		return
	if a.use_item != "":
		a.use_item = ""
	var cat: int = w["cat"]
	if cat == DB.Cat.THROW:
		if edge:
			_throw(a, wid, a.yaw, a.pitch)
		return
	if not bool(w.get("auto", false)) and not edge:
		return
	if cat == DB.Cat.MELEE:
		_melee(a, wid, w)
		return
	if a.reload_end > time:
		return
	if a.mag[a.cur] <= 0:
		_start_reload(a)
		return
	a.mag[a.cur] -= 1
	a.next_fire = time + 1.0 / float(w["rps"])
	a.last_shot = time
	var spread_deg: float = (float(w["ads"]) if a.aiming else float(w["hip"])) + a.bloom
	var hv := Vector2(a.vel.x, a.vel.z).length()
	if hv > 1.0:
		spread_deg *= 1.35
		if cat == DB.Cat.SR and a.aiming:
			spread_deg += 1.5
	if not a.on_ground:
		spread_deg *= 2.0
	if a.crouch:
		spread_deg *= 0.75
	a.bloom = minf(a.bloom + float(w["rec"]) * 0.32, 5.0)
	var origin := a.eye_pos()
	var dir := a.aim_dir()
	var rewind := _rewind_for(a)
	var first := {}
	var maxd: float = w["max"]
	for i in int(w["pel"]):
		var d := _spread(dir, deg_to_rad(spread_deg))
		var hit := _trace(a, origin, d, maxd, rewind)
		if i == 0:
			first = hit
		var victim: Actor = hit["actor"]
		if victim:
			var dist: float = hit["t"]
			var dmg: float = w["dmg"]
			if dist > float(w["rng"]):
				dmg *= lerpf(1.0, 0.5, clampf((dist - float(w["rng"])) / maxf(1.0, maxd - float(w["rng"])), 0.0, 1.0))
			if hit["head"]:
				dmg *= float(w["head"])
			apply_damage(victim, a, dmg, hit["head"], wid)
		elif not (hit["block"] as Dictionary).is_empty():
			var bh: Dictionary = hit["block"]
			var bp: Vector3i = bh["pos"]
			if int(bh["block"]) == Blocks.BUILD and world.damage_block(bp.x, bp.y, bp.z, int(float(w["dmg"]) * 0.6)):
				_pending_blocks.append([bp.x, bp.y, bp.z, Blocks.AIR])
	var ev := {"a": a.id, "e": first.get("point", origin + dir * maxd), "w": wid}
	if first.get("actor") != null:
		ev["h"] = 2
	elif not (first.get("block", {}) as Dictionary).is_empty():
		ev["h"] = 1
		ev["b"] = int(first["block"]["block"])
		ev["n"] = Vector3(first["block"]["normal"])
	push_event("shot", ev)

func _spread(dir: Vector3, ang: float) -> Vector3:
	if ang <= 0.0001:
		return dir
	var up := Vector3.UP if absf(dir.y) < 0.95 else Vector3.RIGHT
	var r := dir.cross(up).normalized()
	var u := r.cross(dir).normalized()
	var a := _rng.randf() * TAU
	var m := sqrt(_rng.randf()) * tan(ang * 0.5)
	return (dir + (r * cos(a) + u * sin(a)) * m).normalized()

func _rewind_for(a: Actor) -> float:
	if a.is_bot or a.id == local_id or net_role == "offline":
		return 0.0
	return clampf(Net.peer_rtt(a.peer_id) * 0.5 + 0.11, 0.0, 0.3)

func pos_at(o: Actor, back: float) -> Vector3:
	if back <= 0.0 or o.history.is_empty():
		return o.pos
	var t := time - back
	for i in range(o.history.size() - 1, 0, -1):
		var h0: Array = o.history[i - 1]
		var h1: Array = o.history[i]
		if float(h0[0]) <= t:
			var span: float = float(h1[0]) - float(h0[0])
			var k := clampf((t - float(h0[0])) / span, 0.0, 1.0) if span > 0.0 else 1.0
			return (h0[1] as Vector3).lerp(h1[1], k)
	return o.history[0][1]

func _trace(shooter: Actor, origin: Vector3, dir: Vector3, maxd: float, rewind: float) -> Dictionary:
	var bh := world.raycast(origin, dir, maxd)
	var best_t: float = float(bh["dist"]) if not bh.is_empty() else maxd
	var best: Actor = null
	var head := false
	for id in actors:
		var o: Actor = actors[id]
		if o == shooter or not o.is_alive() or o.state == Actor.St.PLANE:
			continue
		if not o.dummy and not rules.is_enemy(shooter, o):
			continue
		var p := pos_at(o, rewind)
		if p.distance_to(origin) > best_t + 3.0:
			continue
		var r := o.ray_hit(origin, dir, best_t, p)
		if not r.is_empty() and float(r[0]) < best_t:
			best_t = r[0]
			best = o
			head = r[1] == 1
	return {"t": best_t, "point": origin + dir * best_t, "actor": best, "head": head, "block": bh if best == null else {}}

func _melee(a: Actor, wid: String, w: Dictionary) -> void:
	a.next_fire = time + 1.0 / float(w["rps"])
	a.last_shot = time
	var origin := a.eye_pos()
	var dir := a.aim_dir()
	var hit := _trace(a, origin, dir, float(w["rng"]), 0.0)
	var victim: Actor = hit["actor"]
	if victim == null:
		var bd := float(w["rng"]) + 0.5
		for id in actors:
			var o: Actor = actors[id]
			if o == a or not o.is_alive() or (not o.dummy and not rules.is_enemy(a, o)) or o.in_air_phase():
				continue
			var to := (o.pos + Vector3(0, 0.9, 0)) - origin
			if to.length() < bd and to.normalized().dot(dir) > 0.75:
				bd = to.length()
				victim = o
	if victim:
		apply_damage(victim, a, float(w["dmg"]) * (float(w["head"]) if hit["head"] else 1.0), hit["head"], wid)
	elif not (hit["block"] as Dictionary).is_empty():
		var bp: Vector3i = hit["block"]["pos"]
		if world.damage_block(bp.x, bp.y, bp.z, int(w.get("block_dmg", 40))):
			_pending_blocks.append([bp.x, bp.y, bp.z, Blocks.AIR])
	push_event("shot", {"a": a.id, "e": hit["point"], "w": wid, "h": 2 if victim else 0})

func _start_reload(a: Actor) -> void:
	var w := a.weapon()
	var mag_size: int = int(w.get("mag", 0))
	if mag_size == 0 or a.mag[a.cur] >= mag_size or a.reload_end > time or a.state != Actor.St.ALIVE:
		return
	var at: String = w.get("ammo", "")
	if not a.infinite_ammo and int(a.ammo.get(at, 0)) <= 0:
		return
	a.use_item = ""
	a.reload_end = time + float(w["rel"])
	push_event("reload", {"a": a.id})

func _finish_reload(a: Actor) -> void:
	a.reload_end = 0.0
	var w := a.weapon()
	var at: String = w.get("ammo", "")
	if at == "":
		return
	var need: int = int(w["mag"]) - a.mag[a.cur]
	var take := need if a.infinite_ammo else mini(need, int(a.ammo[at]))
	a.mag[a.cur] += take
	if not a.infinite_ammo:
		a.ammo[at] -= take
	mark_inv(a)

func _finish_use(a: Actor) -> void:
	var item := a.use_item
	a.use_item = ""
	if a.state != Actor.St.ALIVE or int(a.meds.get(item, 0)) <= 0:
		return
	var it: Dictionary = DB.ITEMS[item]
	a.meds[item] -= 1
	var heal: float = it["heal"]
	if item == "med_drink":
		heal = 25.0
		a.hot_left = 16.0
	var before := a.hp
	a.hp = minf(Actor.MAX_HP, a.hp + heal)
	a.healed += a.hp - before
	mark_inv(a)
	push_event("heal", {"a": a.id})

# ================================================================== damage
func apply_damage(v: Actor, att: Actor, dmg: float, head: bool, src: String) -> void:
	if v.state == Actor.St.DEAD or v.state == Actor.St.PLANE or dmg <= 0.0:
		return
	if not rules.allow_damage(att, v):
		return
	var armor := false
	var real := dmg
	if v.state == Actor.St.KNOCKED:
		v.knock_hp -= dmg
		push_event("hit", {"v": v.id, "a": att.id if att else -1, "d": int(round(dmg)), "h": false, "ar": false, "s": src})
		if att:
			v.last_attacker = att.id
		if v.knock_hp <= 0.0:
			eliminate(v, att, src, head)
		return
	if src != "zone" and src != "fall" and src != "void":
		if head and v.helm_lvl > 0:
			var absorbed: float = dmg * float(DB.ARMOR_REDUCTION[v.helm_lvl])
			real -= absorbed
			v.helm_dur -= absorbed * 1.6
			armor = true
			if v.helm_dur <= 0.0:
				v.helm_lvl = 0
				v.helm_dur = 0.0
			mark_inv(v)
		elif not head and v.vest_lvl > 0:
			var absorbed2: float = dmg * float(DB.ARMOR_REDUCTION[v.vest_lvl])
			real -= absorbed2
			v.vest_dur -= absorbed2 * 1.6
			armor = true
			if v.vest_dur <= 0.0:
				v.vest_lvl = 0
				v.vest_dur = 0.0
			mark_inv(v)
	real = minf(real, v.hp)
	v.hp -= real
	v.last_hurt = time
	if att and att != v:
		v.last_attacker = att.id
		att.damage_dealt += real
		if head:
			att.headshots += 1
	push_event("hit", {"v": v.id, "a": att.id if att else -1, "d": int(round(real)), "h": head, "ar": armor, "s": src})
	if v.hp <= 0.0:
		if v.dummy:
			eliminate(v, att, src, head)
		elif rules.knock_allowed(v):
			_knock(v, att, src)
		else:
			eliminate(v, att, src, head)

func _knock(v: Actor, att: Actor, src: String) -> void:
	v.state = Actor.St.KNOCKED
	v.hp = 0.0
	v.knock_hp = Actor.KNOCK_HP
	v.crouch = false
	v.use_item = ""
	v.reload_end = 0.0
	v.revive_target = -1
	push_event("kill", {"v": v.id, "a": att.id if att else -1, "w": src, "hs": false, "k": 1})
	rules.on_knock(v, att)

func eliminate(v: Actor, att: Actor, src: String, head: bool) -> void:
	if v.state == Actor.St.DEAD:
		return
	v.state = Actor.St.DEAD
	v.hp = 0.0
	v.died_at = time
	v.use_item = ""
	v.reload_end = 0.0
	v.revive_target = -1
	var credit := att
	if (credit == null or credit == v) and v.last_attacker != -1 and time - v.last_hurt < 12.0:
		credit = actors.get(v.last_attacker)
	if credit and credit != v and credit.team != v.team and not v.dummy:
		credit.kills += 1
	if kind == "br":
		_drop_inventory(v)
	push_event("kill", {"v": v.id, "a": credit.id if credit else -1, "w": src, "hs": head, "k": 0})
	rules.on_eliminated(v, credit)

func _drop_inventory(v: Actor) -> void:
	var items := []
	for s in 3:
		if v.slots[s] != "":
			items.append([v.slots[s], 1])
	for at in v.ammo:
		if int(v.ammo[at]) > 0:
			items.append(["ammo_" + at, int(v.ammo[at])])
	for md in v.meds:
		if int(v.meds[md]) > 0:
			items.append([md, int(v.meds[md])])
	for th in v.throws:
		if int(v.throws[th]) > 0:
			items.append([th, int(v.throws[th])])
	if v.vest_lvl > 0:
		items.append(["vest_%d" % v.vest_lvl, 1])
	if v.helm_lvl > 0:
		items.append(["helm_%d" % v.helm_lvl, 1])
	if v.blocks > 0:
		items.append(["blocks", v.blocks])
	v.reset_loadout()
	for i in items.size():
		var ang := i * 2.4
		var r := 0.6 + i * 0.12
		var p := v.pos + Vector3(cos(ang) * r, 0, sin(ang) * r)
		p.y = world.surface_below(floori(p.x), floori(p.z), floori(v.pos.y + 1.0))
		spawn_loot(items[i][0], items[i][1], p)

# ================================================================== actions
func _do_action(a: Actor, act: Dictionary) -> void:
	var t: String = act.get("t", "")
	match t:
		"reload":
			_start_reload(a)
		"slot":
			var i: int = int(act.get("i", 0))
			if i >= 0 and i < 5 and a.slots[i] != "" and i != a.cur and a.state == Actor.St.ALIVE:
				if i == 4 and int(a.throws.get(a.slots[4], 0)) <= 0:
					return
				a.cur = i
				a.switch_end = time + 0.35
				a.reload_end = 0.0
				a.use_item = ""
				mark_inv(a)
		"throw_sel":
			var types := ["gr_frag", "gr_smoke", "gr_wall"]
			var idx := types.find(a.slots[4])
			for k in range(1, 4):
				var cand: String = types[(idx + k) % 3]
				if int(a.throws[cand]) > 0:
					a.slots[4] = cand
					break
			mark_inv(a)
		"use":
			var item: String = act.get("item", "")
			if a.state == Actor.St.ALIVE and int(a.meds.get(item, 0)) > 0 and a.hp < Actor.MAX_HP and a.use_item == "":
				a.reload_end = 0.0
				a.use_item = item
				a.use_end = time + float(DB.ITEMS[item]["time"])
				a.emote = ""
		"cancel":
			a.use_item = ""
		"pick":
			_do_pick(a, int(act.get("id", -1)))
		"open":
			_open_crate(a, int(act.get("id", -1)))
		"build":
			var c = act.get("c")
			if c is Vector3i:
				_do_build(a, c)
		"throw":
			var item2: String = act.get("item", a.slots[4])
			if a.state == Actor.St.ALIVE and time >= a.next_fire:
				_throw(a, item2, float(act.get("yaw", a.yaw)), float(act.get("pitch", a.pitch)))
		"emote":
			if a.state == Actor.St.ALIVE and a.on_ground and not a.busy(time):
				a.emote = str(act.get("id", "emote_wave"))
				a.emote_end = time + 4.0
				push_event("emote", {"a": a.id, "id": a.emote})
		"jump":
			rules.jump(a)
		"revive":
			var tgt: Actor = actors.get(int(act.get("id", -1)))
			if tgt and tgt.team == a.team and tgt.state == Actor.St.KNOCKED and a.state == Actor.St.ALIVE and a.pos.distance_to(tgt.pos) < 2.6:
				a.revive_target = tgt.id
				a.revive_end = time + 4.0
		"buy":
			rules.buy(a, str(act.get("item", "")))
		"drop":
			_do_drop(a, str(act.get("item", "")))
		"train":
			if kind == "training":
				if act.get("op", "") == "add":
					_add_training_bot(float(act.get("skill", 0.4)))
				elif act.get("op", "") == "clear":
					for id in actors.keys():
						var o: Actor = actors[id]
						if o.is_bot and not o.dummy:
							_remove_actor(id)
		"spectate":
			pass

func _remove_actor(id: int) -> void:
	actors.erase(id)
	brains.erase(id)
	push_event("remove", {"a": id})

func _do_pick(a: Actor, id: int) -> void:
	var it: Dictionary = loot.get(id, {})
	if it.is_empty() or a.state != Actor.St.ALIVE:
		return
	if a.pos.distance_to(it["pos"]) > 3.0:
		return
	var res := a.give(it["item"], int(it["n"]))
	if not res["ok"]:
		return
	remove_loot(id)
	for d in res["drop"]:
		spawn_loot(d[0], d[1], (it["pos"] as Vector3) + Vector3(_rng.randf_range(-0.6, 0.6), 0, _rng.randf_range(-0.6, 0.6)))
	a.loot_picked += 1
	mark_inv(a)
	rules.on_item_taken(int(it.get("spot", -2)))
	push_event("pick", {"a": a.id, "i": it["item"], "n": it["n"], "_to": a.peer_id})

func _do_drop(a: Actor, item: String) -> void:
	if a.state != Actor.St.ALIVE:
		return
	var n := 0
	var s := a.slots.find(item)
	if s >= 0 and s < 3:
		a._return_mag(s)
		a.slots[s] = ""
		if a.cur == s:
			a.cur = DB.SLOT_MELEE
		n = 1
	elif a.meds.has(item) and int(a.meds[item]) > 0:
		n = int(a.meds[item])
		a.meds[item] = 0
	elif item.begins_with("ammo_") and int(a.ammo.get(item.substr(5), 0)) > 0:
		n = int(a.ammo[item.substr(5)])
		a.ammo[item.substr(5)] = 0
	if n > 0:
		spawn_loot(item, n, a.pos + a.forward() * 0.9)
		mark_inv(a)

func _auto_pickups() -> void:
	for id in actors:
		var a: Actor = actors[id]
		if a.state != Actor.St.ALIVE or a.dummy:
			continue
		if not a.is_bot and not a.has_meta("autopick"):
			continue
		for lid in loot.keys():
			var it: Dictionary = loot.get(lid, {})
			if it.is_empty():
				continue
			if a.pos.distance_to(it["pos"]) < 1.7 and a.wants_item(it["item"]):
				_do_pick(a, lid)

func _do_build(a: Actor, c: Vector3i) -> void:
	if not rules.building_allowed() or a.state != Actor.St.ALIVE or a.blocks <= 0 or rules.frozen():
		return
	if a.eye_pos().distance_to(Vector3(c) + Vector3(0.5, 0.5, 0.5)) > 6.5:
		return
	if not _cell_free_for_block(c):
		return
	world.set_block(c.x, c.y, c.z, Blocks.BUILD)
	a.blocks -= 1
	a.blocks_placed += 1
	mark_inv(a)
	_pending_blocks.append([c.x, c.y, c.z, Blocks.BUILD])

func _cell_free_for_block(c: Vector3i) -> bool:
	if not world.can_build_at(c):
		return false
	for id in actors:
		var o: Actor = actors[id]
		if not o.is_alive():
			continue
		if o.pos.x + Actor.HW > c.x and o.pos.x - Actor.HW < c.x + 1 and o.pos.z + Actor.HW > c.z and o.pos.z - Actor.HW < c.z + 1 \
				and o.pos.y + o.height() > c.y and o.pos.y < c.y + 1:
			return false
	return true

# ================================================================== loot
func spawn_loot(item: String, n: int, pos: Vector3, spot := -2) -> int:
	var id := next_obj
	next_obj += 1
	loot[id] = {"id": id, "item": item, "n": n, "pos": pos, "spot": spot}
	_pending_loot_add.append([id, item, n, pos])
	return id

func remove_loot(id: int) -> void:
	loot_claims.erase(id)
	if loot.erase(id):
		_pending_loot_del.append(id)

func clear_loot() -> void:
	for id in loot.keys():
		remove_loot(id)

func spawn_initial_loot() -> void:
	var r := RandomNumberGenerator.new()
	r.seed = seed + 99
	for i in world.loot_spots.size():
		var s: Array = world.loot_spots[i]
		var tier: int = s[1]
		if tier == -1:
			if s.size() > 2:
				spawn_spot_item(i)
			continue
		if r.randf() > 0.8:
			continue
		var pos: Vector3 = s[0]
		var item := DB.weighted_pick(DB.LOOT_TABLES[clampi(tier, 0, 2)], r)
		if item == "ammo":
			var at: String = DB.AMMO_TYPES[r.randi() % 4]
			spawn_loot("ammo_" + at, DB.AMMO_PICKUP[at], pos)
			continue
		spawn_loot(item, _amount_for(item), pos)
		var wd := DB.weapon(item)
		if wd.get("ammo", "") != "":
			spawn_loot("ammo_" + str(wd["ammo"]), DB.AMMO_PICKUP[wd["ammo"]], pos + Vector3(0.7, 0, 0.3))

func spawn_spot_item(i: int) -> void:
	var s: Array = world.loot_spots[i]
	var item: String = s[2]
	var n := _amount_for(item)
	if item.begins_with("ammo_"):
		n = DB.AMMO_PICKUP[item.substr(5)] * 2
	spawn_loot(item, n, s[0], i)

func _amount_for(item: String) -> int:
	match item:
		"med_bandage":
			return 3
		"blocks":
			return 10
		"gr_frag", "gr_smoke", "gr_wall":
			return 1 + _rng.randi() % 2
	return 1

# ================================================================== throwables
func _throw(a: Actor, item: String, yaw: float, pitch: float) -> void:
	if int(a.throws.get(item, 0)) <= 0:
		return
	a.throws[item] -= 1
	if int(a.throws[item]) <= 0:
		a.slots[4] = ""
		for th in ["gr_frag", "gr_smoke", "gr_wall"]:
			if int(a.throws[th]) > 0:
				a.slots[4] = th
				break
		if a.slots[4] == "" and a.cur == 4:
			a.cur = DB.SLOT_MELEE
			for s in [0, 1, 2]:
				if a.slots[s] != "":
					a.cur = s
					break
	a.next_fire = time + 0.8
	a.last_shot = time
	var dir := Vector3(-sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch))
	var p := {"id": next_obj, "t": item, "pos": a.eye_pos() + dir * 0.6, "vel": dir * 17.0 + Vector3(0, 3.0, 0) + a.vel * 0.4,
		"o": a.id, "fuse": time + float(DB.WEAPONS[item]["fuse"]), "fd": Vector3(dir.x, 0, dir.z).normalized(), "rest": false}
	next_obj += 1
	projectiles.append(p)
	push_event("proj", {"id": p["id"], "t": item, "p": p["pos"], "v": p["vel"], "a": a.id})
	mark_inv(a)

static func step_projectile(w: VoxelWorld, p: Dictionary, dt: float) -> bool:
	## Returns true when the projectile touched the ground this step.
	var vel: Vector3 = p["vel"]
	var pos: Vector3 = p["pos"]
	vel.y -= 20.0 * dt
	var np := pos + vel * dt
	var landed := false
	if w.is_solid_at(floori(np.x), floori(np.y), floori(np.z)):
		if w.is_solid_at(floori(pos.x), floori(np.y), floori(pos.z)):
			if vel.y < 0.0:
				landed = true
			vel.y = -vel.y * 0.3
			vel.x *= 0.6
			vel.z *= 0.6
			np.y = pos.y
		if w.is_solid_at(floori(np.x), floori(pos.y), floori(pos.z)):
			vel.x = -vel.x * 0.4
			np.x = pos.x
		if w.is_solid_at(floori(pos.x), floori(pos.y), floori(np.z)):
			vel.z = -vel.z * 0.4
			np.z = pos.z
		if w.is_solid_at(floori(np.x), floori(np.y), floori(np.z)):
			np = pos
	if vel.length() < 0.6 and landed:
		vel = Vector3.ZERO
	p["vel"] = vel
	p["pos"] = np
	return landed

func _update_projectiles(dt: float) -> void:
	var keep: Array = []
	for p in projectiles:
		var landed := step_projectile(world, p, dt)
		if p["t"] == "gr_wall" and landed:
			p["fuse"] = minf(float(p["fuse"]), time)
		if time >= float(p["fuse"]):
			_detonate(p)
		else:
			keep.append(p)
	projectiles = keep

func _detonate(p: Dictionary) -> void:
	var pos: Vector3 = p["pos"]
	var owner: Actor = actors.get(int(p["o"]))
	match str(p["t"]):
		"gr_frag":
			var w: Dictionary = DB.WEAPONS["gr_frag"]
			var r: float = w["radius"]
			for id in actors:
				var o: Actor = actors[id]
				if not o.is_alive() or o.in_air_phase():
					continue
				var c := o.pos + Vector3(0, 0.9, 0)
				var d := c.distance_to(pos)
				if d < r and world.line_of_sight(pos + Vector3(0, 0.3, 0), c):
					apply_damage(o, owner, float(w["dmg"]) * pow(1.0 - d / r, 0.8), false, "gr_frag")
			var ip := Vector3i(pos.floor())
			for x in range(-2, 3):
				for y in range(-2, 3):
					for z in range(-2, 3):
						var c2 := ip + Vector3i(x, y, z)
						if world.get_b(c2.x, c2.y, c2.z) == Blocks.BUILD and Vector3(x, y, z).length() <= 2.3:
							if world.damage_block(c2.x, c2.y, c2.z, 400):
								_pending_blocks.append([c2.x, c2.y, c2.z, Blocks.AIR])
			push_event("boom", {"p": pos, "r": r})
		"gr_smoke":
			smokes.append([pos, time + 14.0])
			push_event("smoke", {"p": pos, "d": 14.0})
		"gr_wall":
			var fd: Vector3 = p["fd"]
			var side := Vector3(-fd.z, 0, fd.x)
			var base := Vector3i(floori(pos.x), floori(pos.y + 0.2), floori(pos.z))
			while base.y > 0 and not world.is_solid_at(base.x, base.y - 1, base.z):
				base.y -= 1
			for k in range(-1, 2):
				for h in 2:
					var c3 := Vector3i(floori(pos.x + side.x * k), base.y + h, floori(pos.z + side.z * k))
					if _cell_free_for_block(c3) or (h == 1 and world.get_b(c3.x, c3.y, c3.z) == Blocks.AIR and _no_actor_in(c3)):
						world.set_block(c3.x, c3.y, c3.z, Blocks.BUILD)
						_pending_blocks.append([c3.x, c3.y, c3.z, Blocks.BUILD])
			push_event("wall", {"p": pos})
	push_event("proj_end", {"id": p["id"]})

func _no_actor_in(c: Vector3i) -> bool:
	for id in actors:
		var o: Actor = actors[id]
		if o.is_alive() and Rect2(o.pos.x - Actor.HW, o.pos.z - Actor.HW, Actor.HW * 2, Actor.HW * 2).intersects(Rect2(c.x, c.z, 1, 1)) \
				and o.pos.y < c.y + 1 and o.pos.y + o.height() > c.y:
			return false
	return true

func in_smoke(a: Vector3, b: Vector3) -> bool:
	for s in smokes:
		var c: Vector3 = s[0]
		var ab := b - a
		var t := clampf((c - a).dot(ab) / maxf(ab.length_squared(), 0.001), 0.0, 1.0)
		if (a + ab * t).distance_to(c + Vector3(0, 1.5, 0)) < SMOKE_R:
			return true
	return false

# ================================================================== supply crates
func spawn_crate(p: Vector2) -> void:
	var id := next_obj
	next_obj += 1
	var g := float(world.column_top_solid(int(p.x), int(p.y)))
	crates[id] = {"id": id, "pos": Vector3(p.x, 78.0, p.y), "g": g, "landed": false}
	push_event("crate", {"id": id, "p": crates[id]["pos"], "g": g})
	announce("Supply drop incoming!")

func _update_crates(dt: float) -> void:
	for id in crates:
		var c: Dictionary = crates[id]
		if not c["landed"]:
			var p: Vector3 = c["pos"]
			p.y = maxf(float(c["g"]), p.y - 3.5 * dt)
			c["pos"] = p
			if p.y <= float(c["g"]):
				c["landed"] = true

func _open_crate(a: Actor, id: int) -> void:
	var c: Dictionary = crates.get(id, {})
	if c.is_empty() or not c["landed"] or a.state != Actor.St.ALIVE or a.pos.distance_to(c["pos"]) > 3.2:
		return
	crates.erase(id)
	var r := RandomNumberGenerator.new()
	r.seed = seed + id * 31
	for i in 4:
		var item := DB.weighted_pick(DB.SUPPLY_TABLE, r)
		var ang := i * PI * 0.5
		var pos: Vector3 = (c["pos"] as Vector3) + Vector3(cos(ang) * 1.1, 0, sin(ang) * 1.1)
		spawn_loot(item, _amount_for(item), pos)
		var wd := DB.weapon(item)
		if wd.get("ammo", "") != "":
			spawn_loot("ammo_" + str(wd["ammo"]), DB.AMMO_PICKUP[wd["ammo"]] * 2, pos + Vector3(0.4, 0, 0.4))
	a.supply_opened += 1
	push_event("crate_open", {"id": id})

# ================================================================== end of match
func end_match() -> void:
	if match_ended:
		return
	match_ended = true
	var place := {}
	var stats := {}
	for id in actors:
		var a: Actor = actors[id]
		if a.dummy:
			continue
		var pl: int = int(rules.team_place.get(a.team, 0))
		if pl == 0:
			pl = a.placement if a.placement > 0 else (1 if a.team == rules.winner_team else 2)
		a.placement = pl
		place[a.id] = pl
		var st := a.stats_dict()
		st["survive"] = int((a.died_at if a.died_at >= 0.0 else time) - a.alive_since)
		st["rounds"] = int(a.get_meta("rounds_won", 0))
		stats[a.id] = st
	var teams := {}
	for id in actors:
		teams[(actors[id] as Actor).team] = true
	end_data = {"winner": rules.winner_team, "place": place, "stats": stats, "score": rules.score, "players": place.size(), "teams": teams.size()}
	push_event("end", end_data)

## Personal result for the local player, consumed by Profile.record_match and the results screen.
func local_result() -> Dictionary:
	var a := local_actor()
	if a == null:
		return {}
	var st: Dictionary = (end_data.get("stats", {}) as Dictionary).get(a.id, a.stats_dict())
	var pl: int = int((end_data.get("place", {}) as Dictionary).get(a.id, a.placement))
	if pl == 0:
		pl = rules.teams_alive().size() + 1 if is_server else int(summary_cache.get("teams", 1)) + 1
	var won := pl == 1
	var res := st.duplicate()
	res["mode"] = cfg.get("mode", "training")
	res["kind"] = kind
	res["placement"] = pl
	res["won"] = won
	res["players"] = actors.size()
	res["teams"] = int(end_data.get("teams", 1))
	res["ranked"] = bool(cfg.get("ranked", false))
	res["online"] = net_role != "offline"
	res["score"] = end_data.get("score", [0, 0])
	res["team"] = a.team
	res["duration"] = int(time)
	if not res.has("survive"):
		res["survive"] = int((a.died_at if a.died_at >= 0.0 else time) - a.alive_since)
	return res

# ================================================================== presentation (clients + host)
func _present(type: String, d: Dictionary) -> void:
	match type:
		"shot":
			var a: Actor = actors.get(int(d["a"]))
			if a == null:
				return
			var v = views.get(a.id)
			if a.id != local_id:
				recent_shots.append([a.pos, time])
				if recent_shots.size() > 24:
					recent_shots.pop_front()
			if a.id == local_id and not is_server:
				return  # already predicted locally
			_shot_fx(a, v, d.get("w", ""), d["e"], int(d.get("h", 0)), int(d.get("b", 0)), d.get("n", Vector3.UP))
		"hit":
			var victim: Actor = actors.get(int(d["v"]))
			var vv = views.get(int(d["v"]))
			_view_call(int(d["v"]), "hurt")
			if int(d["a"]) == local_id and victim and int(d["v"]) != local_id:
				var vp: Vector3 = (vv as Node3D).global_position if vv else victim.pos
				if Settings.get_v("damage_numbers"):
					effects.number(vp + Vector3(0, 2.0, 0), int(d["d"]), d["h"], d["ar"])
				Audio.play_ui("hit_head" if d["h"] else "hit", -2.0)
			if victim and str(d.get("s", "")) not in ["zone", "fall"] and vv and d["d"] > 0:
				effects.blood((vv as Node3D).global_position + Vector3(0, 1.2, 0))
			hud_event.emit("hit", d)
		"kill":
			hud_event.emit("kill", d)
			var killer: int = int(d["a"])
			if killer == local_id and int(d["v"]) != local_id:
				Audio.play_ui("kill" if int(d["k"]) == 0 else "knock", 0.0)
			if int(d["v"]) == local_id and int(d["k"]) == 0:
				Audio.play_ui("death", 0.0)
		"loot_add":
			for e in d["l"]:
				if not is_server:
					loot[int(e[0])] = {"id": int(e[0]), "item": e[1], "n": int(e[2]), "pos": e[3]}
				_make_loot_view(int(e[0]), str(e[1]), e[3])
		"loot_del":
			for id in d["l"]:
				if not is_server:
					loot.erase(int(id))
				var n = loot_views.get(int(id))
				if n:
					(n as Node).queue_free()
					loot_views.erase(int(id))
		"blocks":
			for b in d["l"]:
				if not is_server:
					world.set_block(int(b[0]), int(b[1]), int(b[2]), int(b[3]))
				if int(b[3]) == Blocks.AIR:
					effects.burst(Vector3(b[0], b[1], b[2]) + Vector3(0.5, 0.5, 0.5), Vector3.UP, Blocks.map_color(Blocks.BUILD), 12)
			Audio.play_3d("block", Vector3(d["l"][0][0], d["l"][0][1], d["l"][0][2]), -6.0)
		"proj":
			var n2 := MeshInstance3D.new()
			n2.mesh = Models.weapon_mesh(str(d["t"]))
			n2.material_override = VoxelArt.prop_material()
			add_child(n2)
			n2.global_position = d["p"]
			proj_nodes[int(d["id"])] = {"node": n2, "p": {"pos": d["p"], "vel": d["v"]}}
			Audio.play_3d("throw", d["p"], -4.0)
			var ta: Actor = actors.get(int(d.get("a", -1)))
			if ta:
				ta.shot_rt = Time.get_ticks_msec() / 1000.0
		"proj_end":
			var pn: Dictionary = proj_nodes.get(int(d["id"]), {})
			if not pn.is_empty():
				(pn["node"] as Node).queue_free()
				proj_nodes.erase(int(d["id"]))
		"boom":
			effects.explosion(d["p"], d["r"])
			Audio.play_3d("explosion", d["p"], 4.0)
			if controller and local_actor():
				var dist := (d["p"] as Vector3).distance_to(local_actor().pos)
				if dist < 22.0:
					controller.call("shake", (1.0 - dist / 22.0) * 0.6)
		"smoke":
			effects.smoke(d["p"], d["d"])
			Audio.play_3d("smoke", d["p"], -2.0)
			if not is_server:
				smokes.append([d["p"], time + float(d["d"])])
		"wall":
			Audio.play_3d("block", d["p"], 0.0)
		"crate":
			var cn := Node3D.new()
			var box := MeshInstance3D.new()
			box.mesh = Models.crate_mesh()
			box.material_override = VoxelArt.prop_material()
			box.position = Vector3(-0.0, 0, 0)
			cn.add_child(box)
			var ch := MeshInstance3D.new()
			ch.mesh = Models.parachute_mesh(Color(1.0, 0.55, 0.1))
			ch.material_override = VoxelArt.prop_material()
			ch.name = "Chute"
			ch.position = Vector3(0, 0.6, 0)
			cn.add_child(ch)
			var beam := MeshInstance3D.new()
			beam.mesh = Models.beam_mesh(3)
			beam.material_override = VoxelArt.mat_glow
			beam.scale = Vector3(3, 12, 3)
			cn.add_child(beam)
			add_child(cn)
			cn.global_position = d["p"]
			crate_nodes[int(d["id"])] = {"node": cn, "g": float(d["g"])}
			if not is_server:
				crates[int(d["id"])] = {"id": int(d["id"]), "pos": d["p"], "g": float(d["g"]), "landed": false}
			Audio.play_ui("supply", -4.0)
		"crate_open":
			var cnd: Dictionary = crate_nodes.get(int(d["id"]), {})
			if not cnd.is_empty():
				effects.burst((cnd["node"] as Node3D).global_position + Vector3(0, 0.8, 0), Vector3.UP, Color(1.0, 0.6, 0.2), 20, 1.5)
				(cnd["node"] as Node).queue_free()
				crate_nodes.erase(int(d["id"]))
			crates.erase(int(d["id"]))
		"zone":
			zone_cache = d
		"sum":
			summary_cache = d
		"inv":
			if not is_server and int(d["a"]) == local_id and local_actor():
				local_actor().apply_inv(d["inv"])
			hud_event.emit("inv", d)
		"pick":
			if int(d["a"]) == local_id:
				Audio.play_ui("pickup", -6.0)
				hud_event.emit("pick", d)
		"reload":
			var ra: Actor = actors.get(int(d["a"]))
			if ra and (ra.id != local_id or is_server):
				Audio.play_3d("reload", ra.pos, -8.0)
		"heal":
			var ha: Actor = actors.get(int(d["a"]))
			if ha:
				Audio.play_3d("heal", ha.pos, -6.0)
		"respawn":
			_view_call(int(d["a"]), "snap_to", [d["p"]])
			if not is_server and actors.has(int(d["a"])):
				var ra2: Actor = actors[int(d["a"])]
				ra2.pos = d["p"]
				ra2.state = Actor.St.ALIVE
				ra2.hp = Actor.MAX_HP
		"revive":
			hud_event.emit("revive", d)
		"emote":
			var ea: Actor = actors.get(int(d["a"]))
			if ea and not is_server:
				ea.emote = str(d["id"])
				ea.emote_end = time + 4.0
		"round":
			hud_event.emit("round", d)
		"announce":
			hud_event.emit("announce", d)
		"remove":
			var rv2 = views.get(int(d["a"]))
			if rv2:
				(rv2 as Node).queue_free()
				views.erase(int(d["a"]))
			if not is_server:
				actors.erase(int(d["a"]))
		"end":
			end_data = d
			match_ended = true
			hud_event.emit("end", d)

func _shot_fx(a: Actor, v, wid: String, end: Vector3, h: int, block: int, normal: Vector3) -> void:
	a.shot_rt = Time.get_ticks_msec() / 1000.0
	var w := DB.weapon(wid)
	var cat: int = w.get("cat", DB.Cat.MELEE)
	var from := a.eye_pos()
	if v is ActorView and (v as ActorView).flash:
		from = (v as ActorView).flash.global_position if (v as ActorView).visible else from
	if cat != DB.Cat.MELEE:
		if a.id == local_id:
			# start our own tracers a bit ahead of the muzzle so they never cover the camera
			var dir := (end - from)
			if dir.length() > 2.0:
				effects.tracer(from + dir.normalized() * 1.2, end)
		else:
			effects.tracer(from, end)
	var snd: String = w.get("snd", "shot_ar")
	var vol := 0.0 if a.id == local_id else -3.0
	Audio.play_3d(snd, a.pos + Vector3(0, 1.4, 0), vol, randf_range(0.94, 1.06))
	if h == 1:
		effects.impact(end, normal, block)

func _make_loot_view(id: int, item: String, pos: Vector3) -> void:
	var n := Node3D.new()
	var mi := MeshInstance3D.new()
	mi.mesh = Models.item_mesh(item)
	mi.material_override = VoxelArt.prop_material()
	mi.position = Vector3(0, 0.15, 0)
	if DB.is_weapon(item) and int(DB.weapon(item)["cat"]) != DB.Cat.THROW:
		mi.position = Vector3(0, 0.22, 0)
		mi.scale = Vector3(1.3, 1.3, 1.3)
	mi.visibility_range_end = 55.0
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.name = "M"
	n.add_child(mi)
	var r := DB.item_rarity(item)
	if r >= 1 or DB.is_weapon(item):
		var beam := MeshInstance3D.new()
		beam.mesh = Models.beam_mesh(r)
		beam.material_override = VoxelArt.mat_glow
		beam.visibility_range_end = 90.0 if r >= 2 else 45.0
		beam.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		n.add_child(beam)
	add_child(n)
	n.global_position = pos
	loot_views[id] = n

func _update_visuals(dt: float) -> void:
	var t_ms := Time.get_ticks_msec()
	var spin := float(t_ms % 6283) / 1000.0
	for id in loot_views:
		var n: Node3D = loot_views[id]
		var m := n.get_node_or_null("M")
		if m:
			(m as Node3D).rotation.y = spin
	# crates & projectiles (pure presentation)
	for id in crate_nodes:
		var cn: Dictionary = crate_nodes[id]
		var node: Node3D = cn["node"]
		var c: Dictionary = crates.get(id, {})
		var p: Vector3 = node.global_position
		if not c.is_empty():
			p = c["pos"]
			if not is_server and not c["landed"]:
				p.y = maxf(float(cn["g"]), p.y - 3.5 * dt)
				c["pos"] = p
				c["landed"] = p.y <= float(cn["g"])
		node.global_position = p
		var ch := node.get_node_or_null("Chute")
		if ch:
			(ch as Node3D).visible = p.y > float(cn["g"]) + 0.2
	for id in proj_nodes:
		var pn: Dictionary = proj_nodes[id]
		step_projectile(world, pn["p"], dt)
		var node2: Node3D = pn["node"]
		node2.global_position = pn["p"]["pos"]
		node2.rotation.x += dt * 8.0
	# plane
	if plane_node:
		var ph := str(summary_cache.get("ph", "")) if not is_server else rules.phase
		plane_node.visible = ph == "plane"
		if plane_node.visible:
			var pp := rules.plane_pos(time) if is_server else _client_plane_pos()
			plane_node.global_position = pp + Vector3(0, 2.0, 0)
			var dir := (rules.plane_b - rules.plane_a)
			if dir.length() > 0.1:
				plane_node.look_at(plane_node.global_position + dir, Vector3.UP)
	# zone wall
	var z := zone_view_dict()
	if not z.is_empty():
		effects.set_zone(z["c"], z["r"], z["on"], float(maxi(world.sx, world.sz)))
	# see the whole island from the sky: extend fog + chunk visibility while airborne
	var me := local_actor()
	var air := me != null and me.in_air_phase()
	if air != _air_view:
		_air_view = air
		var dist := maxf(Settings.view_distance(), 150.0 if Settings.quality() == 0 else 200.0) if air else Settings.view_distance()
		terrain.apply_quality(dist, Settings.shadows_enabled() and not air)
		env.environment.fog_depth_begin = dist * (0.75 if air else 0.55)
		env.environment.fog_depth_end = dist * (1.25 if air else 1.0)
	# local view correction smoothing (network clients)
	if not is_server:
		_correction = _correction.lerp(Vector3.ZERO, minf(1.0, dt * 10.0))
	for id in views:
		var a: Actor = actors.get(id)
		if a:
			_view_call(id, "set_weapon", [a.weapon_id() if a.state == Actor.St.ALIVE else "", str(a.cosmetics.get("wrap", "wrap_none"))])

func _client_plane_pos() -> Vector3:
	return rules.plane_pos(time)

func zone_view_dict() -> Dictionary:
	if is_server:
		return rules.zone_dict()
	if zone_cache.is_empty():
		return {}
	var z := zone_cache.duplicate()
	if str(z.get("st", "")) == "shrink" and kind == "br":
		var k := clampf((time - float(z["t0"])) / maxf(0.01, float(z["t1"]) - float(z["t0"])), 0.0, 1.0)
		z["c"] = (z["fc"] as Vector2).lerp(z["nc"], k)
		z["r"] = lerpf(float(z["fr"]), float(z["nr"]), k)
	elif str(z.get("st", "")) == "shrink":
		var k2 := clampf((time - float(z["t0"])) / maxf(0.01, float(z["t1"]) - float(z["t0"])), 0.0, 1.0)
		z["r"] = lerpf(float(z["fr"]), float(z["nr"]), k2)
	return z

func hud_summary() -> Dictionary:
	if is_server:
		return rules.summary()
	return summary_cache

# ================================================================== local player input (host / offline / client)
func local_action(act: Dictionary) -> void:
	var a := local_actor()
	if a == null:
		return
	if is_server:
		queue_action(a, act)
	else:
		Net.send_action(act)
		# light prediction for responsiveness
		match str(act.get("t", "")):
			"slot":
				var i: int = int(act.get("i", 0))
				if a.slots[i] != "":
					a.cur = i
			"use":
				a.use_item = str(act.get("item", ""))
				a.use_end = time + float(DB.ITEMS.get(a.use_item, {}).get("time", 1.0))

# ================================================================== network client side
func client_init(st: Dictionary) -> void:
	for e in st["actors"]:
		var a := Actor.new()
		a.id = int(e["id"])
		a.name = str(e["n"])
		a.team = int(e["t"])
		a.is_bot = bool(e["b"])
		a.peer_id = int(e["p"])
		a.cosmetics = e["c"]
		a.dummy = bool(e.get("d", false))
		a.pos = e["pos"]
		a.state = int(e.get("s", 0))
		actors[a.id] = a
		if a.peer_id == local_peer and not a.is_bot:
			local_id = a.id
		next_id = maxi(next_id, a.id + 1)
	for id in actors:
		_make_view(actors[id])
		_view_call(id, "snap_to", [actors[id].pos])
	for e in st["loot"]:
		loot[int(e[0])] = {"id": int(e[0]), "item": e[1], "n": int(e[2]), "pos": e[3]}
		_make_loot_view(int(e[0]), str(e[1]), e[3])
	for b in st.get("blocks", []):
		world.set_block(int(b[0]), int(b[1]), int(b[2]), int(b[3]))
	zone_cache = st.get("zone", {})
	summary_cache = st.get("sum", {})
	time = float(st.get("time", 0.0))
	var pl: Dictionary = st.get("plane", {})
	if not pl.is_empty():
		rules.plane_a = pl["a"]
		rules.plane_b = pl["b"]
		rules.plane_t0 = float(pl["t0"])
		rules.plane_dur = float(pl["dur"])
	if local_actor() and st.has("inv"):
		local_actor().apply_inv(st["inv"])

func init_state() -> Dictionary:
	var acts := []
	for id in actors:
		var a: Actor = actors[id]
		acts.append({"id": a.id, "n": a.name, "t": a.team, "b": a.is_bot, "p": a.peer_id, "c": a.cosmetics, "d": a.dummy, "pos": a.pos, "s": a.state})
	var l := []
	for id in loot:
		var it: Dictionary = loot[id]
		l.append([id, it["item"], it["n"], it["pos"]])
	return {"actors": acts, "loot": l, "zone": rules.zone_dict(), "sum": rules.summary(), "time": time,
		"plane": {"a": rules.plane_a, "b": rules.plane_b, "t0": rules.plane_t0, "dur": rules.plane_dur}}

func client_events(evs: Array) -> void:
	for ev in evs:
		_present(str(ev[0]), ev[1])

func _client_tick(dt: float) -> void:
	time += dt
	Match.time = time
	var a := local_actor()
	if a and controller:
		var cmd: Dictionary = controller.call("make_cmd")
		seq += 1
		cmd["s"] = seq
		pending.append([seq, cmd])
		if pending.size() > 90:
			pending.pop_front()
		Net.send_cmds(pending.slice(maxi(0, pending.size() - 3)))
		_predict(a, cmd, dt)
	_view_call(local_id, "tick_sync")

func _predict(a: Actor, cmd: Dictionary, dt: float) -> void:
	if a.state == Actor.St.DEAD or a.state == Actor.St.PLANE:
		return
	var frozen := str(summary_cache.get("ph", "")) in ["buy", "round_end"]
	a.yaw = cmd["yaw"]
	a.pitch = cmd["pitch"]
	var b: int = cmd["b"]
	a.aiming = (b & BTN_AIM) != 0
	a.sprint = (b & BTN_SPRINT) != 0
	if a.state == Actor.St.ALIVE:
		a.try_set_crouch(world, (b & BTN_CROUCH) != 0)
	a.move_step(world, 0.0 if frozen else cmd["mx"], 0.0 if frozen else cmd["mz"], (b & BTN_JUMP) != 0 and not frozen, dt)
	a.pending_fall_damage = 0.0
	# predicted shooting feedback
	var fire := (b & BTN_FIRE) != 0 and not frozen
	var edge := fire and not bool(prev_fire.get(a.id, false))
	prev_fire[a.id] = fire
	if fire and a.state == Actor.St.ALIVE and time >= a.next_fire and a.use_item == "":
		var w := a.weapon()
		if w.is_empty():
			return
		var cat: int = w["cat"]
		if cat == DB.Cat.THROW or (not bool(w.get("auto", false)) and not edge):
			return
		if cat != DB.Cat.MELEE and a.mag[a.cur] <= 0:
			return
		a.next_fire = time + 1.0 / float(w["rps"])
		if cat != DB.Cat.MELEE:
			a.mag[a.cur] -= 1
		var o := a.eye_pos()
		var dir := a.aim_dir()
		var hit := world.raycast(o, dir, float(w.get("max", 3.0)))
		var end := o + dir * (float(hit["dist"]) if not hit.is_empty() else float(w.get("max", 3.0)))
		_shot_fx(a, views.get(a.id), a.weapon_id(), end, 1 if not hit.is_empty() else 0, int(hit.get("block", 0)), Vector3(hit.get("normal", Vector3i.UP)))

func client_snapshot(snap: Dictionary) -> void:
	var now := Time.get_ticks_msec() / 1000.0
	var st: float = snap["t"]
	if absf(st - time) > 0.5:
		time = st
	else:
		time = lerpf(time, st, 0.1)
	for e in snap["a"]:
		var id: int = e[0]
		var a: Actor = actors.get(id)
		if a == null:
			continue
		var p: Vector3 = e[1]
		var flags: int = e[5]
		a.state = e[4]
		a.hp = float(e[7])
		a.vest_lvl = int(e[8]) >> 4
		a.helm_lvl = int(e[8]) & 15
		var wi: int = e[6]
		if id == local_id:
			_reconcile(a, p, snap.get("me", {}), flags)
			continue
		a.pos = p
		a.yaw = e[2]
		a.pitch = e[3]
		a.crouch = (flags & 1) != 0
		a.aiming = (flags & 2) != 0
		a.on_ground = (flags & 4) != 0
		a.reload_end = time + 1.0 if (flags & 8) != 0 else 0.0
		a.use_item = "med_bandage" if (flags & 16) != 0 else ""
		var vel_est: Vector3 = (p - a.get_meta("lp", p)) * 15.0
		a.set_meta("lp", p)
		a.vel = vel_est
		# remote actors only need the held weapon for visuals: keep it in slot 0
		var wl := DB.WEAPONS.keys()
		a.cur = 0
		a.slots[0] = wl[wi] if wi < wl.size() else ""
		var ei: int = e[9]
		if ei == 0 and a.emote != "" and time > a.emote_end:
			a.emote = ""
		_view_call(id, "push_sample", [now, p, a.yaw, a.pitch])

func _reconcile(a: Actor, srv_pos: Vector3, me: Dictionary, flags: int) -> void:
	var ack: int = int(me.get("ack", 0))
	while not pending.is_empty() and int(pending[0][0]) <= ack:
		pending.pop_front()
	var before := a.pos
	a.pos = srv_pos
	a.vel = me.get("vel", a.vel)
	a.on_ground = (flags & 4) != 0
	a.crouch = (flags & 1) != 0
	if me.has("mag"):
		a.mag[a.cur] = int(me["mag"])
	if a.state == Actor.St.ALIVE or a.state == Actor.St.SKYDIVE or a.state == Actor.St.PARACHUTE or a.state == Actor.St.KNOCKED:
		for pc in pending:
			var c: Dictionary = pc[1]
			a.yaw = c["yaw"]
			var b: int = c["b"]
			a.move_step(world, c["mx"], c["mz"], (b & BTN_JUMP) != 0, TICK)
			a.pending_fall_damage = 0.0
	var err := before - a.pos
	if err.length() > 4.0:
		_view_call(a.id, "snap_to", [a.pos])
