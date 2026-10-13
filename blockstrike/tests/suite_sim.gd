extends Node
## Headless gameplay tests: runs complete bot-only matches as fast as possible and checks the rules,
## plus unit tests for collision, raycasts, codecs and room codes.

var failures := []

func check(cond: bool, msg: String) -> void:
	if not cond:
		failures.append(msg)
		print("  FAIL: ", msg)

func run() -> bool:
	_unit_tests()
	for mode in ["arena_2v2", "clash_squad", "br_solo", "br_squad"]:
		await _sim_match(mode, 4242)
	for sd in [7, 99]:
		await _sim_match("clash_squad", sd)
	_training_test()
	print("failures: %d" % failures.size())
	return failures.is_empty()

func _unit_tests() -> void:
	print("[unit] voxel world / actor")
	var w := WorldGen.generate("arena_blocks")
	var a := Actor.new()
	a.pos = Vector3(28.5, 20.0, 20.5)
	for i in 90:
		a.move_step(w, 0, 0, false, 1.0 / 30.0)
	check(a.on_ground, "actor should land on the arena floor")
	check(absf(a.pos.y - 6.0) < 0.05, "arena floor height should be 6, got %f" % a.pos.y)
	# step-up: put a 1-block step in front and walk into it
	w.set_b(28, 6, 18, Blocks.STONE)
	a.pos = Vector3(28.5, 6.0, 19.6)
	a.yaw = 0.0
	var max_y := 0.0
	for i in 30:
		a.move_step(w, 0, 1.0, false, 1.0 / 30.0)
		max_y = maxf(max_y, a.pos.y)
	check(max_y > 6.9 and a.pos.z < 18.0, "auto step-up onto 1 block failed: %s (max y %f)" % [str(a.pos), max_y])
	# wall blocks movement
	for y in range(6, 10):
		w.set_b(28, y, 14, Blocks.STONE)
	a.pos = Vector3(28.5, 7.0, 16.5)
	for i in 60:
		a.move_step(w, 0, 1.0, false, 1.0 / 30.0)
	check(a.pos.z > 15.29, "wall should stop the actor: z=%f" % a.pos.z)
	var hit := w.raycast(Vector3(28.5, 7.5, 20.0), Vector3(0, 0, -1), 50.0)
	check(not hit.is_empty() and (hit["pos"] as Vector3i).z <= 18, "raycast should hit the step/wall")
	var hit2 := w.raycast(Vector3(28.5, 30.0, 28.5), Vector3(0, -1, 0), 100.0)
	check(not hit2.is_empty() and int(hit2["normal"].y) == 1, "downward raycast should hit the floor top face")
	# hitbox
	var t := Actor.new()
	t.pos = Vector3(10, 6, 10)
	var r := t.ray_hit(Vector3(10, 7.7, 20), Vector3(0, 0, -1), 50.0, t.pos)
	check(not r.is_empty() and r[1] == 1, "head ray should register a headshot")
	var r2 := t.ray_hit(Vector3(10, 7.0, 20), Vector3(0, 0, -1), 50.0, t.pos)
	check(not r2.is_empty() and r2[1] == 0, "body ray should register a body hit")
	print("[unit] codecs")
	for ip in ["192.168.1.37", "10.0.0.2", "172.16.5.250"]:
		var code := Net.lan_code(ip, 7777)
		var back := Net.parse_lan_code(code)
		check(back.get("ip", "") == ip and int(back.get("port", 0)) == 7777, "lan code roundtrip %s -> %s -> %s" % [ip, code, str(back)])
	var cmds := [[5, {"mx": 0.5, "mz": -1.0, "yaw": 1.25, "pitch": -0.3, "b": 19}], [6, {"mx": 0.0, "mz": 1.0, "yaw": -2.0, "pitch": 0.1, "b": 1}]]
	var dec := Net.decode_cmds(Net.encode_cmds(cmds))
	check(dec.size() == 2 and int(dec[0]["s"]) == 5 and int(dec[0]["b"]) == 19 and absf(float(dec[1]["yaw"]) + 2.0) < 0.001, "cmd codec roundtrip")
	# inventory
	var inv := Actor.new()
	inv.give("ar_strike", 1)
	inv.give("smg_buzz", 1)
	var res := inv.give("sr_hawk", 1)
	check(inv.slots[0] != "" and inv.slots[1] != "" and res["drop"].size() == 1, "third primary should swap and drop one")
	inv.give("vest_2", 1)
	check(inv.vest_lvl == 2, "vest pickup")
	check(not inv.give("vest_1", 1)["ok"], "worse vest should be refused")
	inv.give("med_kit", 5)
	check(int(inv.meds["med_kit"]) == 3, "med kit stack cap")

func _sim_match(mode: String, seed: int) -> void:
	print("[sim] %s seed %d" % [mode, seed])
	var m := Match.new()
	m.set_meta("hold", true)
	add_child(m)
	m.setup({"mode": mode, "net": "dedicated", "seed": seed, "players": [], "bots": true, "difficulty": 1, "building": true})
	check(m.actors.size() == int(DB.MODES[mode]["players"]), "%s: actor count %d" % [mode, m.actors.size()])
	var t0 := Time.get_ticks_msec()
	var ticks := 0
	var max_ticks := 30 * 60 * 16
	var landed := 0
	var shots := 0
	var kills := 0
	var picks := 0
	var builds := 0
	var max_tick_ms := 0.0
	while not m.rules.ended and ticks < max_ticks:
		var ts := Time.get_ticks_usec()
		m._server_tick(Match.TICK)
		var dt_ms := (Time.get_ticks_usec() - ts) / 1000.0
		if ticks > 30:
			max_tick_ms = maxf(max_tick_ms, dt_ms)
		ticks += 1
		for ev in m.events:
			pass
		if ticks % 300 == 0:
			await get_tree().process_frame
		if ticks == 30 * 100 and mode.begins_with("br"):
			var armed := 0
			var alive := 0
			for id in m.actors:
				var ac: Actor = m.actors[id]
				if ac.is_alive():
					alive += 1
					if ac.slots[0] != "" or ac.slots[1] != "" or ac.slots[2] != "":
						armed += 1
			print("   t=100s: alive %d, armed with a gun %d" % [alive, armed])
	for id in m.actors:
		var a: Actor = m.actors[id]
		kills += a.kills
		picks += a.loot_picked
		builds += a.blocks_placed
		if a.state != Actor.St.PLANE:
			landed += 1
	var wall := Time.get_ticks_msec() - t0
	var game_s := ticks / 30.0
	print("   ended=%s winner=%d after %.0f s game time (%d ms wall, %.2f ms/tick avg, %.1f ms worst)  kills=%d pickups=%d blocks=%d score=%s" % [
		str(m.rules.ended), m.rules.winner_team, game_s, wall, float(wall) / ticks, max_tick_ms, kills, picks, builds, str(m.rules.score)])
	check(m.rules.ended, "%s should finish within %d s of game time" % [mode, max_ticks / 30])
	check(kills > 0, "%s: bots should eliminate each other" % mode)
	if mode.begins_with("br"):
		check(landed == m.actors.size(), "%s: every bot should leave the plane" % mode)
		check(picks > 10, "%s: bots should loot (picked %d)" % [mode, picks])
		check(m.rules.z_idx >= 1, "%s: zone should progress" % mode)
	else:
		check(m.rules.score[0] + m.rules.score[1] >= m.rules.wins_needed, "%s: rounds should be played" % mode)
	var res := m.local_result()
	check(res.is_empty(), "dedicated match has no local player")
	m.queue_free()
	await get_tree().process_frame

func _training_test() -> void:
	print("[sim] training")
	var m := Match.new()
	m.set_meta("hold", true)
	add_child(m)
	m.setup({"mode": "training", "net": "dedicated", "seed": 1, "players": [], "bot_count": 2})
	var dummies := 0
	for id in m.actors:
		if (m.actors[id] as Actor).dummy:
			dummies += 1
	check(dummies >= 3, "training should spawn target dummies (%d)" % dummies)
	check(m.loot.size() >= 20, "training racks should spawn items (%d)" % m.loot.size())
	for i in 30 * 20:
		m._server_tick(Match.TICK)
	var bot_dmg := 0.0
	for id in m.actors:
		bot_dmg += (m.actors[id] as Actor).damage_dealt
	print("   training damage dealt by bots in 20 s: %d" % int(bot_dmg))
	m.queue_free()
