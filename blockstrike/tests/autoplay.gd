extends Node
## CI driver (needs a renderer, e.g. xvfb + Mesa):
##   --autoplay=tour   visits every menu and plays scripted moments of every mode, saving screenshots
##   --autoplay=bench  measures frame time / draw calls / triangles / memory per quality preset
## Output goes to res://docs/screenshots and res://docs/ci (when run from the project folder).

const SHOT_DIR := "res://docs/screenshots"
const CI_DIR := "res://docs/ci"
const TOUR_MODES := ["training", "br_solo", "clash_squad", "arena_2v2"]
const BENCH_Q := [0, 1, 2]

var scene: Node
var m: Match

func _shot(name: String) -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(SHOT_DIR))
	var path := ProjectSettings.globalize_path("%s/%s.png" % [SHOT_DIR, name])
	img.save_png(path)
	print("[autoplay] screenshot ", path)

func _wait(sec: float) -> void:
	await get_tree().create_timer(sec).timeout

func _log(text: String) -> void:
	print("[autoplay] ", text)

# ------------------------------------------------------------------ menu
func start_menu(menu: Node) -> void:
	if Game.autoplay == "bench":
		Game.set_meta("bench_i", 0)
		_start_bench_match()
		return
	await _wait(2.5)
	await _shot("01_main_menu")
	var i := 2
	for key in ["modes", "shop", "locker", "missions", "ranked", "friends", "settings", "rooms"]:
		menu.call("open_panel", key)
		await _wait(0.8)
		await _shot("%02d_menu_%s" % [i, key])
		i += 1
	menu.call("close_panel")
	Net.leave()
	Game.set_meta("tour_i", 0)
	Game.start_offline(TOUR_MODES[0], {"bot_count": 3, "difficulty": 1})

# ------------------------------------------------------------------ matches
func start(match_scene: Node) -> void:
	scene = match_scene
	m = Game.current_match
	while m.loading:
		await _wait(0.2)
	if Game.autoplay == "bench":
		await _bench()
		return
	var mode: String = m.cfg.get("mode", "training")
	_log("tour match " + mode)
	match mode:
		"training":
			await _tour_training()
		"br_solo":
			await _tour_br()
		"clash_squad", "arena_2v2":
			await _tour_rounds(mode)
	var ti: int = int(Game.get_meta("tour_i", 0)) + 1
	Game.set_meta("tour_i", ti)
	if ti < TOUR_MODES.size():
		Game.current_match = null
		Game.start_offline(TOUR_MODES[ti], {"difficulty": 1})
	else:
		_log("tour complete")
		get_tree().quit(0)

func _pc() -> PlayerController:
	return m.controller as PlayerController

func _aim_at(p: Vector3) -> void:
	var a := m.local_actor()
	if a == null:
		return
	var to := p - (a.pos + Vector3(0, 1.6, 0))
	_pc().yaw = atan2(-to.x, -to.z)
	_pc().pitch = atan2(to.y, Vector2(to.x, to.z).length())

func _tour_training() -> void:
	await _wait(3.5)
	await _shot("20_training_spawn")
	var a := m.local_actor()
	var target: Actor = null
	for id in m.actors:
		var o: Actor = m.actors[id]
		if o.dummy:
			target = o
			break
	if target:
		a.pos = target.pos + Vector3(0, 0, 9)
		(m.views[a.id] as ActorView).snap_to(a.pos)
		await _wait(0.3)
		for k in 45:
			_aim_at(target.pos + Vector3(0, 1.1, 0))
			_pc().touch.fire_down = true
			await get_tree().physics_frame
		await _shot("21_training_shooting")
		_pc().touch.fire_down = false
	# build a little wall
	_pc().build_mode = true
	_pc().touch.set_on("build", true)
	_pc().pitch = -0.35
	await _wait(0.4)
	for k in 4:
		_pc().do_action("place")
		await _wait(0.15)
	await _wait(0.5)
	await _shot("22_training_building")
	_pc().build_mode = false
	_pc().touch.set_on("build", false)
	(m.hud as HUD)._inventory_panel()
	await _wait(0.5)
	await _shot("23_inventory")
	(m.hud as HUD)._close_modal()

func _tour_br() -> void:
	await _wait(5.0)
	await _shot("30_br_plane")
	(m.hud as HUD)._map_panel()
	await _wait(0.6)
	await _shot("31_br_map")
	(m.hud as HUD)._close_modal()
	m.local_action({"t": "jump"})
	await _wait(2.5)
	await _shot("32_br_skydive")
	var a := m.local_actor()
	var t0 := Time.get_ticks_msec()
	while a.state != Actor.St.ALIVE and Time.get_ticks_msec() - t0 < 30000:
		await _wait(0.5)
	await _wait(1.0)
	if m.world.in_water(a.pos):
		# landed in the sea: walk out to the nearest point of interest for a nicer capture
		var poi: Dictionary = m.world.pois[0]
		var bd0 := 1e9
		for p in m.world.pois:
			var d0 := Vector2(a.pos.x, a.pos.z).distance_to(p["pos"])
			if d0 < bd0:
				bd0 = d0
				poi = p
		var pp: Vector2 = poi["pos"]
		a.pos = Vector3(pp.x + 3.5, m.world.column_top_solid(int(pp.x + 3.5), int(pp.y)), pp.y)
		(m.views[a.id] as ActorView).snap_to(a.pos)
		await _wait(1.0)
	await _shot("33_br_landed")
	# wait until some bots are on the ground
	var tw := 0.0
	while tw < 30.0:
		var grounded := 0
		for id in m.actors:
			if (m.actors[id] as Actor).state == Actor.St.ALIVE and id != a.id:
				grounded += 1
		if grounded >= 4:
			break
		await _wait(1.0)
		tw += 1.0
	# give a weapon and walk towards the nearest bot to capture combat
	a.give("ar_strike", 1)
	a.give("vest_2", 1)
	a.give("helm_2", 1)
	a.ammo["rifle"] = 120
	a.infinite_ammo = true
	m.mark_inv(a)
	var best: Actor = null
	var bd := 1e9
	for id in m.actors:
		var o: Actor = m.actors[id]
		if o != a and o.state == Actor.St.ALIVE and not o.dummy and o.pos.distance_to(a.pos) < bd:
			bd = o.pos.distance_to(a.pos)
			best = o
	if best:
		a.pos = best.pos + Vector3(4, 0.5, 6)
		(m.views[a.id] as ActorView).snap_to(a.pos)
		for k in 40:
			_aim_at(best.pos + Vector3(0, 1.2, 0))
			_pc().touch.fire_down = true
			await get_tree().physics_frame
		await _shot("34_br_combat")
		_pc().touch.fire_down = false
	_pc().aiming = true
	_pc().touch.set_on("aim", true)
	await _wait(0.6)
	await _shot("35_br_aim")
	_pc().aiming = false
	_pc().touch.set_on("aim", false)

func _tour_rounds(mode: String) -> void:
	await _wait(2.0)
	await _shot("40_%s_start" % mode)
	(m.hud as HUD)._close_modal()
	await _wait(14.0 if mode == "clash_squad" else 8.0)
	await _shot("41_%s_fight" % mode)
	var a := m.local_actor()
	for id in m.actors:
		var o: Actor = m.actors[id]
		if o.team != a.team and o.state == Actor.St.ALIVE:
			a.pos = o.pos + Vector3(3, 0.5, 5)
			(m.views[a.id] as ActorView).snap_to(a.pos)
			for k in 30:
				_aim_at(o.pos + Vector3(0, 1.2, 0))
				_pc().touch.fire_down = true
				await get_tree().physics_frame
			_pc().touch.fire_down = false
			break
	await _shot("42_%s_combat" % mode)

# ------------------------------------------------------------------ benchmark
func _start_bench_match() -> void:
	var i: int = int(Game.get_meta("bench_i", 0))
	Settings.data["quality"] = BENCH_Q[i]
	Settings.data["render_scale"] = 0.0
	Settings.data["view_dist"] = 0
	Settings.data["shadows"] = -1
	Settings.data["fps"] = 240
	Settings.apply()
	Engine.max_fps = 0
	Game.start_offline("br_solo", {"difficulty": 1, "seed": 777})

func _bench() -> void:
	var q: int = BENCH_Q[int(Game.get_meta("bench_i", 0))]
	var qn: String = Settings.QUALITY_NAMES[q]
	m.local_action({"t": "jump"})
	var a := m.local_actor()
	var t0 := Time.get_ticks_msec()
	var sky_res: Dictionary = await _sample(8.0, true)
	while a.state != Actor.St.ALIVE and Time.get_ticks_msec() - t0 < 40000:
		await _wait(0.3)
	var ground_res: Dictionary = await _sample(20.0, true)
	await _shot("bench_%s" % qn.to_lower())
	var line := "| %s | %.1f | %.1f | %.1f | %d | %d | %d | %d |" % [qn, ground_res["fps"], ground_res["p1"], sky_res["fps"], ground_res["draws"],
		ground_res["prims"], int(Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0), int(Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0)]
	_log("BENCH " + line)
	var rows: Array = Game.get_meta("bench_rows", [])
	rows.append(line)
	Game.set_meta("bench_rows", rows)
	var i: int = int(Game.get_meta("bench_i", 0)) + 1
	Game.set_meta("bench_i", i)
	if i < BENCH_Q.size():
		Game.current_match = null
		_start_bench_match()
		return
	var md := "# CI benchmark (automated)\n\n"
	md += "Battle Royale Solo, 31 bots, Cubic Isle. Measured on a GitHub Actions VM with **Mesa llvmpipe software rendering (no GPU)**.\n"
	md += "FPS here is CPU-rasterised and NOT representative of phones; draw calls, triangles and memory are the comparable numbers.\n\n"
	md += "| Preset | FPS on ground (avg) | 1% low | FPS skydiving | Draw calls | Triangles | Static mem (MB) | Video mem (MB) |\n|---|---|---|---|---|---|---|---|\n"
	for r in rows:
		md += str(r) + "\n"
	md += "\nGenerated %s with Godot %s.\n" % [Time.get_datetime_string_from_system(true), Engine.get_version_info()["string"]]
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(CI_DIR))
	var f := FileAccess.open(ProjectSettings.globalize_path(CI_DIR + "/benchmark.md"), FileAccess.WRITE)
	f.store_string(md)
	f.close()
	_log("bench complete")
	get_tree().quit(0)

func _sample(sec: float, rotate: bool) -> Dictionary:
	var frames: Array[float] = []
	var draws := 0.0
	var prims := 0.0
	var n := 0
	var t_end := Time.get_ticks_msec() + int(sec * 1000)
	var last := Time.get_ticks_usec()
	while Time.get_ticks_msec() < t_end:
		await get_tree().process_frame
		var now := Time.get_ticks_usec()
		frames.append((now - last) / 1000.0)
		last = now
		draws += Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)
		prims += Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME)
		n += 1
		if rotate and m.controller:
			_pc().yaw += 0.01
	frames.sort()
	var avg := 0.0
	for f in frames:
		avg += f
	avg /= maxf(1.0, frames.size())
	var p99: float = frames[int(frames.size() * 0.99)] if frames.size() > 0 else 0.0
	return {"fps": 1000.0 / maxf(avg, 0.001), "p1": 1000.0 / maxf(p99, 0.001), "draws": int(draws / maxf(1, n)), "prims": int(prims / maxf(1, n))}
