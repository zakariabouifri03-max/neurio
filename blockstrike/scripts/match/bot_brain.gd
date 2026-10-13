class_name BotBrain
extends RefCounted
## Server-side AI. Produces the same input commands / actions a human client would send, so bots obey
## exactly the same movement, weapon and inventory rules as players.

var m: Match
var a: Actor
var skill := 0.5
var target_id := -1
var last_seen := Vector3.ZERO
var last_seen_t := -100.0
var react_at := 0.0
var think_at := 0.0
var goal := Vector3.ZERO
var has_goal := false
var goal_loot := -1
var goal_until := 0.0
var yaw := 0.0
var pitch := 0.0
var aim_err := Vector3.ZERO
var err_at := 0.0
var strafe := 1.0
var strafe_at := 0.0
var burst_until := 0.0
var pause_until := 0.0
var stuck_t := 0.0
var last_pos := Vector3.ZERO
var detour_until := 0.0
var detour := Vector3.ZERO
var drop_target := Vector2.ZERO
var best_drop_d := 1e9
var loot_phase_until := 0.0
var cd_build := 0.0
var cd_nade := 0.0
var cd_heal := 0.0
var dummy := false
var dummy_origin := Vector3.ZERO
var dummy_moving := false
var jump_next := false
var steer_until := 0.0
var steer_cache := Vector3.FORWARD
var builds_left := 3

func _init(match_node: Match, actor: Actor, sk: float) -> void:
	m = match_node
	a = actor
	skill = clampf(sk, 0.05, 1.0)
	yaw = actor.yaw
	think_at = randf() * 0.3

func think(dt: float) -> Dictionary:
	var t := Match.time
	var cmd := {"mx": 0.0, "mz": 0.0, "yaw": yaw, "pitch": pitch, "b": 0}
	if dummy:
		return _dummy(t, cmd)
	match a.state:
		Actor.St.DEAD:
			return cmd
		Actor.St.PLANE:
			_plane_logic()
			return cmd
		Actor.St.SKYDIVE, Actor.St.PARACHUTE:
			var to := Vector3(drop_target.x, a.pos.y, drop_target.y) - a.pos
			if to.length() > 2.0:
				yaw = atan2(-to.x, -to.z)
				cmd["mz"] = 1.0
			pitch = -0.7
			cmd["yaw"] = yaw
			cmd["pitch"] = pitch
			return cmd
		Actor.St.KNOCKED:
			var mate := _nearest_mate()
			if mate:
				_steer_to(mate.pos, cmd)
			cmd["yaw"] = yaw
			return cmd
	if t >= think_at:
		think_at = t + lerpf(0.45, 0.22, skill) + randf() * 0.1
		_perceive(t)
		_decide(t)
	var tgt: Actor = m.actors.get(target_id)
	var visible := tgt != null and tgt.is_alive() and t - last_seen_t < 0.5
	# ---- movement
	if visible and (armed() or a.pos.distance_to(tgt.pos) < 6.0):
		var d := a.pos.distance_to(tgt.pos)
		var wd := a.weapon()
		var ideal: float = clampf(float(wd.get("rng", 20.0)) * 0.6, 4.0, 45.0)
		if t > strafe_at:
			strafe_at = t + randf_range(0.5, 1.4)
			strafe = -strafe if randf() < 0.7 else strafe
			if randf() < 0.15 + skill * 0.25 and d < 25.0:
				jump_next = true
		var to := (tgt.pos - a.pos)
		to.y = 0
		var fwd := 0.0
		if d > ideal * 1.3:
			fwd = 1.0
		elif d < ideal * 0.5:
			fwd = -0.6
		var dir := to.normalized() * fwd + to.normalized().cross(Vector3.UP) * strafe * 0.8
		_move_dir(dir, cmd)
		cmd["b"] |= Match.BTN_SPRINT if d > 35.0 else 0
		if d > 30.0 and skill > 0.5 and int(wd.get("cat", 0)) == DB.Cat.SR:
			cmd["b"] |= Match.BTN_CROUCH
	elif has_goal:
		_steer_to(goal, cmd)
		cmd["b"] |= Match.BTN_SPRINT
	elif tgt != null and tgt.is_alive() and t - last_seen_t < 4.0 and armed():
		_steer_to(last_seen, cmd)
	if jump_next:
		cmd["b"] |= Match.BTN_JUMP
		jump_next = false
	# ---- stuck detection
	var moved := Vector2(a.pos.x - last_pos.x, a.pos.z - last_pos.z).length()
	var wants_move: bool = absf(cmd["mx"]) + absf(cmd["mz"]) > 0.3
	if wants_move and moved < 0.05 * dt * 30.0:
		stuck_t += dt
		if stuck_t > 0.35:
			cmd["b"] |= Match.BTN_JUMP
		if stuck_t > 1.4:
			stuck_t = 0.0
			detour_until = t + randf_range(0.8, 1.6)
			var side := Vector3(-sin(yaw), 0, -cos(yaw)).cross(Vector3.UP) * (1.0 if randf() < 0.5 else -1.0)
			detour = (side - Vector3(-sin(yaw), 0, -cos(yaw)) * 0.3).normalized()
	else:
		stuck_t = maxf(0.0, stuck_t - dt)
	last_pos = a.pos
	if t < detour_until:
		var keep_yaw := yaw
		_move_dir(detour, cmd)
		yaw = keep_yaw
	# ---- aiming & firing
	if visible:
		_aim_and_fire(tgt, t, dt, cmd)
	elif tgt != null and tgt.is_alive() and t - last_seen_t < 2.5:
		_break_cover(tgt, dt, cmd)
	else:
		var mv := Vector2(cmd["mx"], cmd["mz"])
		if mv.length() > 0.1 and t >= detour_until:
			pass
		pitch = lerpf(pitch, 0.0, dt * 3.0)
	cmd["yaw"] = yaw
	cmd["pitch"] = pitch
	return cmd

# ------------------------------------------------------------------ perception / decisions
func _perceive(t: float) -> void:
	var best: Actor = null
	var best_d := 1e9
	var sight := 85.0 + skill * 60.0
	var eye := a.eye_pos()
	var fwd := a.forward()
	var checks := 0
	var cands := []
	for id in m.actors:
		var o: Actor = m.actors[id]
		if o == a or not o.is_alive() or o.in_air_phase() or not m.rules.is_enemy(a, o):
			continue
		var d := a.pos.distance_to(o.pos)
		if d > sight:
			continue
		cands.append([d, o])
	cands.sort_custom(func(x, y): return x[0] < y[0])
	for c in cands:
		if checks >= 3:
			break
		var o: Actor = c[1]
		var d: float = c[0]
		var to := (o.pos - a.pos).normalized()
		var aware := o.id == a.last_attacker and t - a.last_hurt < 3.0
		if not aware and fwd.dot(to) < -0.2 and d > 12.0:
			continue
		if not armed() and d > (6.0 if aware else 3.5):
			continue
		checks += 1
		var tp := o.pos + Vector3(0, o.height() * 0.6, 0)
		if m.world.line_of_sight(eye, tp) and not m.in_smoke(eye, tp):
			if d < best_d:
				best = o
				best_d = d
	if best:
		if best.id != target_id:
			react_at = t + lerpf(0.75, 0.22, skill) + randf() * 0.15
			target_id = best.id
		last_seen = best.pos
		last_seen_t = t
	elif t - last_seen_t > 4.0:
		target_id = -1

func _decide(t: float) -> void:
	var tgt: Actor = m.actors.get(target_id)
	var engaged := tgt != null and tgt.is_alive() and t - last_seen_t < 1.0 and (armed() or a.pos.distance_to(tgt.pos) < 6.0)
	# the zone beats everything except a fight at point-blank range
	var zg: Variant = m.rules.bot_zone_goal(a)
	if zg != null and m.rules.zone_on and Vector2(a.pos.x, a.pos.z).distance_to(m.rules.zc) > m.rules.zr * 0.97 \
			and not (engaged and a.pos.distance_to(tgt.pos) < 12.0):
		goal = zg
		has_goal = true
		goal_loot = -1
		goal_until = t + 3.0
		target_id = -1 if not engaged else target_id
		return
	# heal
	if not engaged and a.hp < 60.0 and a.use_item == "" and t > cd_heal:
		var med := a.best_med()
		if med != "":
			m.queue_action(a, {"t": "use", "item": med})
			cd_heal = t + 2.0
			return
	# weapon & reload management
	var best_slot := _best_slot(a.pos.distance_to(tgt.pos) if tgt else 30.0)
	if best_slot != a.cur and not a.busy(t):
		m.queue_action(a, {"t": "slot", "i": best_slot})
	elif a.weapon().get("mag", 0) > 0 and a.mag[a.cur] < (1 if engaged else int(a.weapon()["mag"] * 0.6)) and not a.busy(t):
		m.queue_action(a, {"t": "reload"})
	# build cover when under fire
	if engaged and a.blocks > 0 and builds_left > 0 and t > cd_build and t - a.last_hurt < 1.0 and skill > 0.35 and a.hp < 70.0 \
			and a.pos.distance_to(tgt.pos) > 10.0 and randf() < 0.35:
		cd_build = t + 10.0
		builds_left -= 1
		var f := (tgt.pos - a.pos)
		f.y = 0
		f = f.normalized()
		var base := Vector3i((a.pos + f * 1.6).floor())
		var side := Vector3i(roundi(f.z), 0, roundi(-f.x))
		for c in [base, base + Vector3i.UP, base + side, base + side + Vector3i.UP]:
			m.queue_action(a, {"t": "build", "c": c})
	# grenade at last known position behind cover
	if tgt and not engaged and t - last_seen_t < 3.0 and t > cd_nade and a.throws["gr_frag"] > 0:
		var d := a.pos.distance_to(last_seen)
		if d > 7.0 and d < 28.0:
			cd_nade = t + 8.0
			var to := last_seen - a.pos
			yaw = atan2(-to.x, -to.z)
			pitch = clampf(0.25 + d * 0.012, 0.2, 0.7)
			m.queue_action(a, {"t": "throw", "item": "gr_frag", "yaw": yaw, "pitch": pitch})
	if engaged:
		has_goal = false
		return
	# goals
	if goal_loot != -1 and not m.loot.has(goal_loot):
		goal_loot = -1
		has_goal = false
	if goal_loot != -1:
		var it: Dictionary = m.loot[goal_loot]
		if a.pos.distance_to(it["pos"]) < 2.0:
			m.queue_action(a, {"t": "pick", "id": goal_loot})
			goal_loot = -1
			has_goal = false
		elif t > goal_until or not a.wants_item(it["item"]):
			goal_loot = -1
			has_goal = false
		else:
			goal = it["pos"]
			has_goal = true
		return
	var zone_goal: Variant = m.rules.bot_zone_goal(a)
	if zone_goal != null:
		goal = zone_goal
		has_goal = true
		goal_until = t + 4.0
		return
	var lid := _find_loot(40.0 if not armed() else (26.0 if t < loot_phase_until else 12.0))
	if lid != -1:
		goal_loot = lid
		m.loot_claims[lid] = a.id
		goal = m.loot[lid]["pos"]
		has_goal = true
		goal_until = t + 20.0
		return
	var mate := _knocked_mate()
	if mate:
		if a.pos.distance_to(mate.pos) < 1.8:
			m.queue_action(a, {"t": "revive", "id": mate.id})
		else:
			goal = mate.pos
			has_goal = true
		return
	if not has_goal or t > goal_until or a.pos.distance_to(goal) < 3.0:
		goal = m.rules.bot_roam_goal(a)
		has_goal = true
		goal_until = t + randf_range(10.0, 22.0)

## True when the bot holds any gun with ammo (in the mag or in reserve).
func armed() -> bool:
	for s in 3:
		var id: String = a.slots[s]
		if id == "":
			continue
		var at: String = DB.weapon(id).get("ammo", "")
		if a.infinite_ammo or a.mag[s] > 0 or int(a.ammo.get(at, 0)) > 0:
			return true
	return false

func _best_slot(dist: float) -> int:
	var best := a.cur
	var best_score := -1.0
	for s in 4:
		var id: String = a.slots[s]
		if id == "":
			continue
		var w := DB.weapon(id)
		var at: String = w.get("ammo", "")
		if at != "" and a.mag[s] <= 0 and a.ammo[at] <= 0 and not a.infinite_ammo:
			continue
		var score := float(w["dmg"]) * float(w.get("pel", 1)) * float(w["rps"])
		var r: float = w["rng"]
		if dist > r * 1.3:
			score *= 0.35
		if int(w["cat"]) == DB.Cat.SR and dist < 15.0:
			score *= 0.4
		if int(w["cat"]) == DB.Cat.MELEE:
			score = 1.0 if dist > 3.0 else 200.0
		if score > best_score:
			best_score = score
			best = s
	return best

func _find_loot(radius: float) -> int:
	var best := -1
	var bd := 1e9
	for id in m.loot:
		var it: Dictionary = m.loot[id]
		var d := a.pos.distance_to(it["pos"])
		if d > radius or absf((it["pos"] as Vector3).y - a.pos.y) > 6.0 or not a.wants_item(it["item"]):
			continue
		var claim: int = int(m.loot_claims.get(id, -1))
		if claim != -1 and claim != a.id and m.actors.has(claim):
			var other: Actor = m.actors[claim]
			if other.is_alive() and other.pos.distance_to(it["pos"]) < d:
				continue
		var score := d
		if DB.is_weapon(it["item"]) and int(DB.weapon(it["item"])["cat"]) <= DB.Cat.PISTOL and not armed():
			score -= 25.0
		if score < bd:
			bd = score
			best = id
	return best

func _nearest_mate() -> Actor:
	var best: Actor = null
	var bd := 1e9
	for id in m.actors:
		var o: Actor = m.actors[id]
		if o != a and o.team == a.team and o.state == Actor.St.ALIVE:
			var d := a.pos.distance_to(o.pos)
			if d < bd:
				bd = d
				best = o
	return best

func _knocked_mate() -> Actor:
	for id in m.actors:
		var o: Actor = m.actors[id]
		if o != a and o.team == a.team and o.state == Actor.St.KNOCKED and a.pos.distance_to(o.pos) < 30.0:
			return o
	return null

# ------------------------------------------------------------------ movement helpers
func _steer_to(p: Vector3, cmd: Dictionary) -> void:
	var to := p - a.pos
	to.y = 0
	var d := to.length()
	if d < 0.6:
		return
	_move_dir(_steer_dir(to / d, minf(d, 2.6)), cmd)

## Local obstacle avoidance: if the straight line is blocked, fan out in 22.5 degree steps and take the
## first free direction (1-block steps count as free because actors auto-step).
func _steer_dir(dir: Vector3, dist: float) -> Vector3:
	if Match.time < steer_until:
		return steer_cache
	if _clear(dir, dist):
		return dir
	for k in range(1, 8):
		for sgn in [1.0, -1.0]:
			var cand := dir.rotated(Vector3.UP, sgn * k * PI / 8.0)
			if _clear(cand, 2.0):
				steer_cache = cand
				steer_until = Match.time + 0.5
				return cand
	return dir

func _clear(dir: Vector3, dist: float) -> bool:
	var w := m.world
	var steps := int(dist / 0.5) + 1
	for i in range(1, steps + 1):
		var p := a.pos + dir * (i * 0.5)
		var x := floori(p.x)
		var z := floori(p.z)
		var y := floori(a.pos.y + 0.05)
		var low := w.is_solid_at(x, y, z)
		var mid := w.is_solid_at(x, y + 1, z)
		var high := w.is_solid_at(x, y + 2, z)
		if mid or (low and high):
			return false
		if low and w.is_solid_at(x, y + 2, z):
			return false
		if not low and not w.is_solid_at(x, y - 1, z) and not w.is_solid_at(x, y - 2, z) and not w.is_solid_at(x, y - 3, z):
			return false
	return true

func _move_dir(dir: Vector3, cmd: Dictionary) -> void:
	if dir.length() < 0.01:
		return
	if target_id == -1 or Match.time - last_seen_t > 0.35:
		var want := atan2(-dir.x, -dir.z)
		yaw = rotate_toward(yaw, want, 0.35)
	var fwd := Vector3(-sin(yaw), 0, -cos(yaw))
	var right := Vector3(cos(yaw), 0, -sin(yaw))
	cmd["mz"] = clampf(dir.dot(fwd), -1.0, 1.0)
	cmd["mx"] = clampf(dir.dot(right), -1.0, 1.0)

func _aim_and_fire(tgt: Actor, t: float, dt: float, cmd: Dictionary) -> void:
	var d := a.pos.distance_to(tgt.pos)
	if t > err_at:
		err_at = t + randf_range(0.35, 0.7)
		var mag := (1.0 - skill) * (0.25 + d * 0.035) + 0.05
		aim_err = Vector3(randf_range(-1, 1), randf_range(-0.6, 0.6), randf_range(-1, 1)) * mag
	var head := randf() < skill * 0.25
	var aim_pt := tgt.pos + Vector3(0, tgt.height() * (0.86 if head else 0.55), 0) + aim_err
	var to := aim_pt - a.eye_pos()
	var want_yaw := atan2(-to.x, -to.z)
	var want_pitch := atan2(to.y, Vector2(to.x, to.z).length())
	var rate := deg_to_rad(160.0 + 380.0 * skill) * dt
	yaw = rotate_toward(yaw, want_yaw, rate)
	pitch = move_toward(pitch, want_pitch, rate)
	var err := absf(angle_difference(yaw, want_yaw)) + absf(pitch - want_pitch)
	var tol := atan2(0.7, maxf(d, 1.0)) + 0.02
	var wd := a.weapon()
	var cat: int = wd.get("cat", DB.Cat.MELEE)
	if cat == DB.Cat.SR or (d > 25.0 and cat != DB.Cat.SG):
		cmd["b"] |= Match.BTN_AIM
	if t < react_at or err > tol * 2.5:
		return
	if cat == DB.Cat.MELEE and d > 2.4:
		return
	if d > float(wd.get("max", 50.0)):
		return
	if bool(wd.get("auto", false)):
		if t < pause_until:
			return
		if t > burst_until:
			burst_until = t + randf_range(0.35, 0.9 + skill)
			pause_until = burst_until + randf_range(0.15, 0.5 * (1.2 - skill))
		cmd["b"] |= Match.BTN_FIRE
	else:
		if t >= a.next_fire and randf() < 0.5 + skill * 0.4:
			cmd["b"] |= Match.BTN_FIRE

## Shoot player-built blocks that hide a recently seen enemy (bullets damage built blocks).
func _break_cover(tgt: Actor, dt: float, cmd: Dictionary) -> void:
	var eye := a.eye_pos()
	var aim_pt := last_seen + Vector3(0, 1.0, 0)
	var to := aim_pt - eye
	var hit := m.world.raycast(eye, to.normalized(), minf(to.length(), 30.0))
	if hit.is_empty() or int(hit["block"]) != Blocks.BUILD:
		return
	var want_yaw := atan2(-to.x, -to.z)
	var want_pitch := atan2(to.y, Vector2(to.x, to.z).length())
	var rate := deg_to_rad(200.0 + 300.0 * skill) * dt
	yaw = rotate_toward(yaw, want_yaw, rate)
	pitch = move_toward(pitch, want_pitch, rate)
	if absf(angle_difference(yaw, want_yaw)) < 0.08 and int(a.weapon().get("cat", 0)) != DB.Cat.MELEE:
		cmd["b"] |= Match.BTN_FIRE

# ------------------------------------------------------------------ battle royale drop
func _plane_logic() -> void:
	if drop_target == Vector2.ZERO:
		drop_target = m.rules.bot_drop_target(a)
	var p := Vector2(a.pos.x, a.pos.z)
	var d := p.distance_to(drop_target)
	if d < best_drop_d:
		best_drop_d = d
	elif d > best_drop_d + 4.0 or d < 40.0:
		m.queue_action(a, {"t": "jump"})
		loot_phase_until = Match.time + randf_range(55.0, 90.0)

# ------------------------------------------------------------------ training dummies
func _dummy(t: float, cmd: Dictionary) -> Dictionary:
	if dummy_moving and a.state == Actor.St.ALIVE:
		var off := a.pos.x - dummy_origin.x
		if absf(off) > 3.5:
			strafe = -signf(off)
		# facing +Z (yaw = PI) the actor's right vector is -X, so world +X needs mx = -1
		cmd["mx"] = -strafe
	cmd["yaw"] = PI
	return cmd
