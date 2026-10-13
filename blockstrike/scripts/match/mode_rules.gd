class_name ModeRules
extends RefCounted
## Rules for every mode (server side): Battle Royale, Clash Squad, 2v2 Arena, Training.

const ZONE_PHASES := [
	{"wait": 55.0, "shrink": 45.0, "frac": 0.62, "dps": 1.0},
	{"wait": 40.0, "shrink": 38.0, "frac": 0.40, "dps": 2.0},
	{"wait": 35.0, "shrink": 32.0, "frac": 0.24, "dps": 4.0},
	{"wait": 30.0, "shrink": 28.0, "frac": 0.12, "dps": 7.0},
	{"wait": 25.0, "shrink": 24.0, "frac": 0.05, "dps": 10.0},
	{"wait": 18.0, "shrink": 22.0, "frac": 0.0, "dps": 16.0},
]
const PLANE_Y := 108.0
const PLANE_SPEED := 9.0

var m: Match
var kind := "br"
var team_size := 1
var knock := false
var phase := ""
var phase_end := 0.0
var ended := false
var winner_team := -1
var team_place := {}
# plane
var plane_a := Vector3.ZERO
var plane_b := Vector3.ZERO
var plane_t0 := 0.0
var plane_dur := 30.0
# zone
var zone_on := false
var zc := Vector2.ZERO
var zr := 1000.0
var znc := Vector2.ZERO
var znr := 1000.0
var z_from_c := Vector2.ZERO
var z_from_r := 1000.0
var z_idx := -1
var z_state := "wait"
var z_t0 := 0.0
var z_t1 := 0.0
var z_dps := 0.0
var z_tick := 0.0
var next_supply := 0.0
# rounds
var round_no := 0
var score := [0, 0]
var wins_needed := 4
var last_round_winner := -1
var loss_streak := [0, 0]
var round_loadout: Array = []
# training
var rack_respawn := {}      # spot index -> time
var respawn_queue := {}     # actor id -> time
var rng := RandomNumberGenerator.new()

func _init(match_node: Match, k: String, tsize: int) -> void:
	m = match_node
	kind = k
	team_size = tsize
	knock = (kind == "br" and team_size > 1) or kind == "cs"
	wins_needed = 4 if kind == "cs" else 3
	rng.seed = m.seed + 17

# ------------------------------------------------------------------ setup
func setup() -> void:
	var w := m.world
	match kind:
		"br":
			var ang := rng.randf() * TAU
			var c := Vector2(w.sx * 0.5, w.sz * 0.5) + Vector2(rng.randf_range(-30, 30), rng.randf_range(-30, 30))
			var dir := Vector2(cos(ang), sin(ang))
			var half := w.sx * 0.5 + 45.0
			plane_a = Vector3(c.x - dir.x * half, PLANE_Y, c.y - dir.y * half)
			plane_b = Vector3(c.x + dir.x * half, PLANE_Y, c.y + dir.y * half)
			plane_t0 = m.time + 3.0
			plane_dur = plane_a.distance_to(plane_b) / PLANE_SPEED
			phase = "plane"
			phase_end = plane_t0 + plane_dur
			for id in m.actors:
				var a: Actor = m.actors[id]
				a.state = Actor.St.PLANE
				a.pos = plane_a
				a.reset_loadout()
			zc = Vector2(w.sx * 0.5, w.sz * 0.5)
			zr = w.sx * 0.75
			znc = zc
			znr = zr
			zone_on = true
			z_idx = -1
			_next_zone_phase(plane_t0 + 20.0)
			next_supply = plane_t0 + plane_dur + 70.0
			m.spawn_initial_loot()
		"cs", "arena":
			for id in m.actors:
				var a: Actor = m.actors[id]
				a.money = DB.CS_START_MONEY
			_start_round()
		"training":
			phase = "training"
			var sp: Array = w.spawns.get("spawn", [Vector3(w.sx * 0.5, 20, w.sz * 0.5)])
			var i := 0
			for id in m.actors:
				var a: Actor = m.actors[id]
				if a.is_bot:
					continue
				a.pos = sp[i % sp.size()]
				a.yaw = 0.0
				a.reset_loadout()
				a.give("ar_cobalt", 1)
				a.give("pi_pea", 1)
				a.give("med_kit", 2)
				a.give("blocks", 30)
				a.infinite_ammo = true
				i += 1
			m.spawn_initial_loot()
			for d in w.dummies:
				m.spawn_dummy(d["pos"], d["moving"])

# ------------------------------------------------------------------ helpers
func is_enemy(a: Actor, b: Actor) -> bool:
	return a.team != b.team

func allow_damage(att: Actor, v: Actor) -> bool:
	if phase == "buy" or phase == "round_end" or ended:
		return false
	if v.in_air_phase():
		return false
	if att == null or att == v:
		return true
	return att.team != v.team

func frozen() -> bool:
	return phase == "buy" or (phase == "round_end" and kind != "training")

func building_allowed() -> bool:
	return m.cfg.get("building", true)

func plane_pos(t: float) -> Vector3:
	var k := clampf((t - plane_t0) / plane_dur, 0.0, 1.0)
	return plane_a.lerp(plane_b, k)

func teams_alive() -> Dictionary:
	var out := {}
	for id in m.actors:
		var a: Actor = m.actors[id]
		if a.is_alive() and not a.dummy:
			out[a.team] = true
	return out

func team_members(team: int) -> Array:
	var out := []
	for id in m.actors:
		var a: Actor = m.actors[id]
		if a.team == team and not a.dummy:
			out.append(a)
	return out

func team_standing(team: int) -> bool:
	for a in team_members(team):
		if a.state == Actor.St.ALIVE or a.in_air_phase():
			return true
	return false

# ------------------------------------------------------------------ tick
func tick(dt: float) -> void:
	if ended:
		return
	var t := m.time
	match kind:
		"br":
			_tick_br(t, dt)
		"cs", "arena":
			_tick_rounds(t, dt)
		"training":
			_tick_training(t)
	if zone_on:
		_tick_zone(t, dt)

func _tick_br(t: float, dt: float) -> void:
	if phase == "plane":
		var pp := plane_pos(t)
		var k := (t - plane_t0) / plane_dur
		var any := false
		for id in m.actors:
			var a: Actor = m.actors[id]
			if a.state == Actor.St.PLANE:
				a.pos = pp
				any = true
				if k >= 0.84:
					jump(a)  # force everyone out before the plane leaves the island
		if not any and t > plane_t0 + 2.0:
			phase = "play"
		if t > phase_end + 1.0:
			phase = "play"
	if t >= next_supply and z_idx <= 4 and m.world.supply_ok:
		next_supply = t + 80.0
		var ang := rng.randf() * TAU
		var r := sqrt(rng.randf()) * znr * 0.75
		m.spawn_crate(Vector2(znc.x + cos(ang) * r, znc.y + sin(ang) * r))
	var alive := teams_alive()
	if alive.size() <= 1 and phase != "plane":
		winner_team = alive.keys()[0] if alive.size() == 1 else -1
		if winner_team != -1:
			team_place[winner_team] = 1
		_finish()

func jump(a: Actor) -> void:
	if a.state != Actor.St.PLANE or m.time < plane_t0 + 1.0:
		return
	a.state = Actor.St.SKYDIVE
	var dir := (plane_b - plane_a).normalized()
	a.vel = dir * 6.0
	a.pos = plane_pos(m.time) + Vector3(rng.randf_range(-1.5, 1.5), -2.5, rng.randf_range(-1.5, 1.5))
	a.alive_since = m.time

func _next_zone_phase(start_t: float) -> void:
	z_idx += 1
	if z_idx >= ZONE_PHASES.size():
		z_state = "done"
		return
	var ph: Dictionary = ZONE_PHASES[z_idx]
	z_from_c = zc
	z_from_r = zr
	znr = m.world.sx * 0.5 * float(ph["frac"])
	var ang := rng.randf() * TAU
	var maxoff := maxf(0.0, zr - znr) * 0.85
	znc = zc + Vector2(cos(ang), sin(ang)) * rng.randf() * maxoff
	# keep the circle on the island
	znc.x = clampf(znc.x, znr + 8.0, m.world.sx - znr - 8.0) if znr * 2 + 16 < m.world.sx else m.world.sx * 0.5
	znc.y = clampf(znc.y, znr + 8.0, m.world.sz - znr - 8.0) if znr * 2 + 16 < m.world.sz else m.world.sz * 0.5
	z_state = "wait"
	z_t0 = start_t
	z_t1 = start_t + float(ph["wait"])
	z_dps = float(ph["dps"])
	m.broadcast_zone()

func _tick_zone(t: float, dt: float) -> void:
	if kind == "br":
		if z_state == "wait" and t >= z_t1:
			z_state = "shrink"
			z_t0 = t
			z_t1 = t + float(ZONE_PHASES[z_idx]["shrink"])
			m.broadcast_zone()
			m.announce("The safe zone is shrinking!")
		elif z_state == "shrink":
			var k := clampf((t - z_t0) / (z_t1 - z_t0), 0.0, 1.0)
			zc = z_from_c.lerp(znc, k)
			zr = lerpf(z_from_r, znr, k)
			if k >= 1.0:
				_next_zone_phase(t)
	elif z_state == "shrink":
		var k2 := clampf((t - z_t0) / (z_t1 - z_t0), 0.0, 1.0)
		zr = lerpf(z_from_r, znr, k2)
	elif z_state == "wait" and phase == "fight" and t >= z_t1:
		z_state = "shrink"
		z_t0 = t
		z_t1 = t + 35.0
		m.broadcast_zone()
		m.announce("The zone is closing in!")
	z_tick += dt
	if z_tick >= 1.0:
		z_tick -= 1.0
		var dps := z_dps if kind == "br" else 6.0
		if kind == "br" and z_idx < 0:
			return
		for id in m.actors:
			var a: Actor = m.actors[id]
			if not a.is_alive() or a.in_air_phase() or a.dummy:
				continue
			if Vector2(a.pos.x, a.pos.z).distance_to(zc) > zr:
				m.apply_damage(a, null, dps, false, "zone")

# ------------------------------------------------------------------ rounds (Clash Squad / Arena)
func _start_round() -> void:
	round_no += 1
	phase = "buy"
	phase_end = m.time + (12.0 if kind == "cs" else 6.0)
	zone_on = true
	zc = Vector2(m.world.sx * 0.5, m.world.sz * 0.5)
	zr = m.world.sx * 0.72
	z_from_r = zr
	znr = 7.0 if kind == "cs" else 4.0
	z_state = "wait"
	z_t1 = phase_end + (50.0 if kind == "cs" else 30.0)
	if kind == "arena":
		round_loadout = DB.ARENA_LOADOUTS[rng.randi() % DB.ARENA_LOADOUTS.size()]
	m.clear_loot()
	var counters := [0, 0]
	for id in m.actors:
		var a: Actor = m.actors[id]
		var spawns: Array = m.world.spawns.get("team%d" % clampi(a.team, 0, 1), [Vector3(10, 10, 10)])
		var idx: int = counters[clampi(a.team, 0, 1)]
		counters[clampi(a.team, 0, 1)] += 1
		var sp: Vector3 = spawns[idx % spawns.size()] + Vector3(0, 0, (idx / spawns.size()) * 1.2)
		var was_dead := a.state == Actor.St.DEAD or a.state == Actor.St.KNOCKED
		m.respawn(a, sp)
		a.yaw = PI * 0.5 if a.team == 0 else -PI * 0.5
		if kind == "arena" or was_dead or round_no == 1:
			a.reset_loadout()
			if kind == "arena":
				for w in round_loadout:
					a.give(w, 1)
				a.give("vest_2", 1)
				a.give("helm_2", 1)
				a.give("med_kit", 1)
				a.give("med_bandage", 2)
				a.give("gr_frag", 1)
				a.give("blocks", 10)
				for at in DB.AMMO_TYPES:
					a.ammo[at] = DB.AMMO_MAX[at] / 2
			else:
				a.give("pi_pea", 1)
				a.ammo["light"] = 48
				a.give("vest_1", 1)
		if a.is_bot and kind == "cs":
			_bot_buy(a)
		m.mark_inv(a)
	m.broadcast_zone()
	m.announce("Round %d - %s" % [round_no, "Buy phase" if kind == "cs" else "Get ready"])

func _bot_buy(a: Actor) -> void:
	var prefs := ["sr_longshot", "ar_strike", "ar_cobalt", "sg_thunder", "smg_hornet", "smg_buzz", "sg_boom", "pi_hammer"]
	if a.slots[0] == "":
		for w in prefs:
			if a.money >= DB.item_price(w) and randf() < 0.75:
				buy(a, w)
				break
	if a.vest_lvl < 2:
		buy(a, "vest_2")
	if a.helm_lvl < 2:
		buy(a, "helm_2")
	if a.meds["med_kit"] == 0:
		buy(a, "med_kit")
	if randf() < 0.5:
		buy(a, "gr_frag")

func buy(a: Actor, item: String) -> bool:
	if kind != "cs" or phase != "buy":
		return false
	if not (item in DB.CS_SHOP):
		return false
	var price := DB.item_price(item)
	if a.money < price:
		return false
	var res := a.give(item, DB.ITEMS.get(item, {}).get("amount", 1))
	if not res["ok"]:
		return false
	a.money -= price
	var wd := DB.weapon(item)
	if wd.has("ammo") and wd["ammo"] != "":
		var at: String = wd["ammo"]
		a.ammo[at] = mini(DB.AMMO_MAX[at], a.ammo[at] + int(wd["mag"]) * 3)
	m.mark_inv(a)
	return true

func _tick_rounds(t: float, dt: float) -> void:
	match phase:
		"buy":
			if t >= phase_end:
				phase = "fight"
				phase_end = t + (100.0 if kind == "cs" else 75.0)
				m.announce("FIGHT!")
		"fight":
			var a0 := team_standing(0)
			var a1 := team_standing(1)
			if not a0 or not a1 or t >= phase_end:
				var win := -1
				if a0 and not a1:
					win = 0
				elif a1 and not a0:
					win = 1
				else:
					var hp := [0.0, 0.0]
					for id in m.actors:
						var a: Actor = m.actors[id]
						if a.state == Actor.St.ALIVE:
							hp[clampi(a.team, 0, 1)] += a.hp
					win = 0 if hp[0] > hp[1] else (1 if hp[1] > hp[0] else -1)
				_end_round(win)
		"round_end":
			if t >= phase_end:
				if score[0] >= wins_needed or score[1] >= wins_needed:
					winner_team = 0 if score[0] > score[1] else 1
					team_place[winner_team] = 1
					team_place[1 - winner_team] = 2
					_finish()
				else:
					_start_round()

func _end_round(win: int) -> void:
	last_round_winner = win
	if win >= 0:
		score[win] += 1
	phase = "round_end"
	phase_end = m.time + 4.5
	zone_on = false
	for t in 2:
		loss_streak[t] = 0 if t == win else mini(4, loss_streak[t] + 1)
	for id in m.actors:
		var a: Actor = m.actors[id]
		if kind == "cs":
			# escalating loss bonus (like classic tactical shooters) keeps comebacks possible
			var t2 := clampi(a.team, 0, 1)
			a.money += DB.CS_ROUND_WIN if a.team == win else DB.CS_ROUND_LOSS + 500 * maxi(0, loss_streak[t2] - 1)
		if a.team == win:
			a.set_meta("rounds_won", int(a.get_meta("rounds_won", 0)) + 1)
		m.mark_inv(a)
	m.push_event("round", {"w": win, "s": score.duplicate(), "r": round_no})

# ------------------------------------------------------------------ training
func _tick_training(t: float) -> void:
	for spot in rack_respawn.keys():
		if t >= rack_respawn[spot]:
			rack_respawn.erase(spot)
			m.spawn_spot_item(spot)
	for id in respawn_queue.keys():
		if t >= respawn_queue[id]:
			respawn_queue.erase(id)
			var a: Actor = m.actors.get(id)
			if a == null:
				continue
			if a.dummy:
				m.respawn(a, a.get_meta("home"))
				a.hp = 200.0
			elif a.is_bot:
				var bs: Array = m.world.spawns.get("bots", [Vector3(20, 10, 20)])
				m.respawn(a, bs[rng.randi() % bs.size()])
				_bot_loadout(a)
			else:
				var sp: Array = m.world.spawns.get("spawn", [Vector3(48, 10, 70)])
				m.respawn(a, sp[0])
				a.infinite_ammo = true
				if a.slots[0] == "" and a.slots[1] == "":
					a.give("ar_cobalt", 1)
			m.mark_inv(a)

func _bot_loadout(a: Actor) -> void:
	a.reset_loadout()
	var lo: Array = DB.ARENA_LOADOUTS[rng.randi() % DB.ARENA_LOADOUTS.size()]
	for w in lo:
		a.give(w, 1)
	a.give("vest_1", 1)
	a.infinite_ammo = true

func on_item_taken(spot: int) -> void:
	if kind == "training" and spot >= 0:
		rack_respawn[spot] = m.time + 3.0

# ------------------------------------------------------------------ deaths
func on_knock(v: Actor, att: Actor) -> void:
	_check_team_wipe(v.team)

func on_eliminated(v: Actor, att: Actor) -> void:
	if kind == "training":
		respawn_queue[v.id] = m.time + (1.5 if v.dummy else 4.0)
		return
	if att and att != v and kind == "cs":
		att.money += DB.CS_KILL_REWARD
		m.mark_inv(att)
	_check_team_wipe(v.team)
	if kind == "br":
		var alive_teams := teams_alive()
		if not alive_teams.has(v.team) and not team_place.has(v.team):
			team_place[v.team] = alive_teams.size() + 1
			for mbr in team_members(v.team):
				mbr.placement = team_place[v.team]

func _check_team_wipe(team: int) -> void:
	if not knock:
		return
	if team_standing(team):
		return
	for a in team_members(team):
		if a.state == Actor.St.KNOCKED:
			m.eliminate(a, m.actors.get(a.last_attacker), "bleed", false)

func knock_allowed(v: Actor) -> bool:
	if not knock or kind == "training":
		return false
	for a in team_members(v.team):
		if a != v and (a.state == Actor.St.ALIVE or a.in_air_phase()):
			return true
	return false

func _finish() -> void:
	if ended:
		return
	ended = true
	phase = "end"
	m.end_match()

# ------------------------------------------------------------------ bot goals
func bot_drop_target(a: Actor) -> Vector2:
	var pois: Array = m.world.pois
	if pois.is_empty() or rng.randf() < 0.4:
		for i in 10:
			var cand := Vector2(rng.randf_range(40, m.world.sx - 40), rng.randf_range(40, m.world.sz - 40))
			if m.world.ground_y(int(cand.x), int(cand.y)) > m.world.water_level:
				return cand
	var p: Dictionary = pois[rng.randi() % pois.size()]
	var r: float = p["r"]
	return (p["pos"] as Vector2) + Vector2(rng.randf_range(-r, r), rng.randf_range(-r, r)) * 1.3

func bot_zone_goal(a: Actor) -> Variant:
	if not zone_on:
		return null
	var p := Vector2(a.pos.x, a.pos.z)
	var target_c := znc if kind == "br" and z_state != "done" else zc
	var target_r := znr if kind == "br" else zr
	if kind == "br" and z_idx < 0:
		return null
	var limit := target_r * 0.8 if kind == "br" else zr * 0.85
	if p.distance_to(target_c) > maxf(limit, 3.0) or p.distance_to(zc) > zr * 0.95:
		var to := (target_c - p).normalized() * minf(30.0, p.distance_to(target_c))
		var g := p + to
		return Vector3(g.x, a.pos.y, g.y)
	return null

func bot_roam_goal(a: Actor) -> Vector3:
	match kind:
		"cs", "arena":
			var enemy_spawn: Array = m.world.spawns.get("team%d" % (1 - clampi(a.team, 0, 1)), [Vector3(m.world.sx * 0.5, 10, m.world.sz * 0.5)])
			var mid := Vector3(m.world.sx * 0.5, a.pos.y, m.world.sz * 0.5)
			var tgt: Vector3 = mid.lerp(enemy_spawn[0], rng.randf_range(0.0, 0.9))
			return tgt + Vector3(rng.randf_range(-12, 12), 0, rng.randf_range(-12, 12))
		"training":
			for id in m.actors:
				var o: Actor = m.actors[id]
				if not o.is_bot and o.is_alive():
					return o.pos + Vector3(rng.randf_range(-10, 10), 0, rng.randf_range(-10, 10))
	var c := znc if kind == "br" else zc
	var r := minf(znr if kind == "br" else zr, 60.0)
	if kind == "br" and z_idx >= 3:
		r *= 0.45
	var ang := rng.randf() * TAU
	var d := sqrt(rng.randf()) * r * 0.8
	return Vector3(c.x + cos(ang) * d, a.pos.y, c.y + sin(ang) * d)

# ------------------------------------------------------------------ HUD / net summary
func summary() -> Dictionary:
	var t := m.time
	var d := {"k": kind, "ph": phase, "rn": round_no, "sc": score, "alive": 0, "teams": teams_alive().size()}
	var alive := 0
	for id in m.actors:
		var a: Actor = m.actors[id]
		if a.is_alive() and not a.dummy:
			alive += 1
	d["alive"] = alive
	match phase:
		"plane":
			d["timer"] = maxf(0.0, plane_t0 - t) if t < plane_t0 else maxf(0.0, phase_end - t)
		"buy", "fight", "round_end":
			d["timer"] = maxf(0.0, phase_end - t)
		_:
			d["timer"] = maxf(0.0, z_t1 - t) if kind == "br" else 0.0
	d["zs"] = z_state
	return d

func zone_dict() -> Dictionary:
	return {"on": zone_on, "c": zc, "r": zr, "nc": znc, "nr": znr, "st": z_state, "t0": z_t0, "t1": z_t1, "fc": z_from_c, "fr": z_from_r, "i": z_idx}
