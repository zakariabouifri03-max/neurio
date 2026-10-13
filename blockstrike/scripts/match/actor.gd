class_name Actor
extends RefCounted
## Simulation state for one combatant (player or bot). Movement code is deterministic and shared by the
## authoritative server and by clients for prediction. No rendering here (see ActorView).

const HW := 0.3
const HEIGHT := 1.8
const CROUCH_HEIGHT := 1.3
const KNOCK_HEIGHT := 0.7
const GRAVITY := 24.0
const JUMP_V := 8.4
const WALK := 4.5
const SPRINT := 6.6
const CROUCH_SPEED := 2.2
const KNOCK_SPEED := 1.3
const MAX_HP := 100.0
const KNOCK_HP := 100.0
const MAX_BLOCKS := 60
const MAX_THROW := 6

enum St { ALIVE, KNOCKED, DEAD, PLANE, SKYDIVE, PARACHUTE }

var id := 0
var name := ""
var team := 0
var is_bot := false
var dummy := false
var last_seq := 0
var inv_dirty := true
var history: Array = []     # [time, pos] for lag compensation
var peer_id := 0
var cosmetics := {}
var skill := 0.5

var pos := Vector3.ZERO
var vel := Vector3.ZERO
var yaw := 0.0
var pitch := 0.0
var on_ground := false
var crouch := false
var sprint := false
var aiming := false
var state := St.ALIVE
var hp := MAX_HP
var knock_hp := KNOCK_HP
var vest_lvl := 0
var vest_dur := 0.0
var helm_lvl := 0
var helm_dur := 0.0
var step_smooth := 0.0     # visual offset after auto-stepping
var fall_start_y := 0.0

# inventory
var slots: Array = ["", "", "", "me_pick", ""]
var mag: Array = [0, 0, 0, 0, 0]
var ammo := {"light": 0, "rifle": 0, "shells": 0, "sniper": 0}
var meds := {"med_bandage": 0, "med_kit": 0, "med_drink": 0}
var throws := {"gr_frag": 0, "gr_smoke": 0, "gr_wall": 0}
var blocks := 0
var cur := 3
var infinite_ammo := false

# timers (match time)
var next_fire := 0.0
var reload_end := 0.0
var switch_end := 0.0
var use_item := ""
var use_end := 0.0
var hot_left := 0.0
var bloom := 0.0
var last_shot := -10.0
var shot_rt := -10.0          # real time of last shot (presentation only)
var last_hurt := -10.0
var last_attacker := -1
var emote := ""
var emote_end := 0.0
var revive_target := -1
var revive_end := 0.0
var respawn_at := 0.0
var money := 0             # clash squad credits
var spectating := -1

# stats
var kills := 0
var damage_dealt := 0.0
var headshots := 0
var healed := 0.0
var blocks_placed := 0
var loot_picked := 0
var revives := 0
var supply_opened := 0
var alive_since := 0.0
var died_at := -1.0
var placement := 0

func height() -> float:
	if state == St.KNOCKED:
		return KNOCK_HEIGHT
	return CROUCH_HEIGHT if crouch else HEIGHT

func eye_pos() -> Vector3:
	return pos + Vector3(0, height() - 0.22, 0)

func forward() -> Vector3:
	return Vector3(-sin(yaw), 0, -cos(yaw))

func aim_dir() -> Vector3:
	return Vector3(-sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch)).normalized()

func is_alive() -> bool:
	return state != St.DEAD

func can_fight() -> bool:
	return state == St.ALIVE

func in_air_phase() -> bool:
	return state == St.PLANE or state == St.SKYDIVE or state == St.PARACHUTE

func weapon_id() -> String:
	return slots[cur]

func weapon() -> Dictionary:
	return DB.weapon(slots[cur])

func busy(now: float) -> bool:
	return reload_end > now or switch_end > now or use_end > now

# ------------------------------------------------------------------ movement
## mx = strafe (-1..1, right positive), mz = forward (-1..1). Deterministic for prediction.
func move_step(w: VoxelWorld, mx: float, mz: float, jump: bool, dt: float) -> void:
	if state == St.DEAD or state == St.PLANE:
		return
	var h := height()
	var wish := Vector3(cos(yaw), 0, -sin(yaw)) * mx + forward() * mz
	var wl := wish.length()
	if wl > 1.0:
		wish /= wl
		wl = 1.0
	if state == St.SKYDIVE or state == St.PARACHUTE:
		var hs := 12.0 if state == St.SKYDIVE else 7.5
		var fall := (16.0 + maxf(0.0, mz) * 10.0 * maxf(0.0, -sin(pitch) + 0.3)) if state == St.SKYDIVE else 5.5
		vel.x = move_toward(vel.x, wish.x * hs, 14.0 * dt)
		vel.z = move_toward(vel.z, wish.z * hs, 14.0 * dt)
		vel.y = -fall
		var res := w.move_box(pos, HW, h, vel * dt)
		pos = res[0]
		var hit: Vector3i = res[1]
		var below := w.surface_below(floori(pos.x), floori(pos.z), floori(pos.y))
		if state == St.SKYDIVE and pos.y - below < 26.0:
			state = St.PARACHUTE
		if hit.y == -1 or pos.y <= below + 0.01:
			state = St.ALIVE
			on_ground = true
			vel = Vector3.ZERO
			fall_start_y = pos.y
		pos.x = clampf(pos.x, 1.0, w.sx - 1.0)
		pos.z = clampf(pos.z, 1.0, w.sz - 1.0)
		return
	var speed := WALK
	if state == St.KNOCKED:
		speed = KNOCK_SPEED
	elif crouch:
		speed = CROUCH_SPEED
	elif sprint and wl > 0.85 and not aiming:
		speed = SPRINT
	if aiming and state == St.ALIVE:
		speed *= 0.62
	var wd := weapon()
	if not wd.is_empty():
		speed *= float(wd.get("move", 1.0))
	if use_item != "":
		speed *= 0.55
	var in_water := w.in_water(pos)
	if in_water:
		speed *= 0.62
	var accel := 50.0 if on_ground else 9.0
	vel.x = move_toward(vel.x, wish.x * speed, accel * dt)
	vel.z = move_toward(vel.z, wish.z * speed, accel * dt)
	if jump and state == St.ALIVE and (on_ground or in_water):
		vel.y = JUMP_V * (0.75 if in_water and not on_ground else 1.0)
		on_ground = false
	vel.y -= GRAVITY * dt
	vel.y = maxf(vel.y, -4.0 if in_water else -48.0)
	var was_ground := on_ground
	var res := w.move_box(pos, HW, h, vel * dt)
	var np: Vector3 = res[0]
	var hit: Vector3i = res[1]
	# auto step-up of one block when walking into a ledge
	if was_ground and (hit.x != 0 or hit.z != 0) and state == St.ALIVE:
		var up := pos + Vector3(0, 1.02, 0)
		if w.box_free(up, HW, h):
			var r2 := w.move_box(up, HW, h, Vector3(vel.x * dt, 0, vel.z * dt))
			var r3 := w.move_box(r2[0], HW, h, Vector3(0, -1.1, 0))
			var p3: Vector3 = r3[0]
			var gained := Vector2(p3.x - pos.x, p3.z - pos.z).length()
			var normal_gain := Vector2(np.x - pos.x, np.z - pos.z).length()
			if gained > normal_gain + 0.005:
				step_smooth -= (p3.y - pos.y)
				np = p3
				hit = Vector3i(0, -1, 0)
	if hit.x != 0:
		vel.x = 0.0
	if hit.z != 0:
		vel.z = 0.0
	if hit.y == 1 and vel.y > 0.0:
		vel.y = 0.0
	if hit.y == -1:
		on_ground = true
		vel.y = 0.0
	else:
		on_ground = w.box_hits(np.x - HW, np.y - 0.06, np.z - HW, np.x + HW, np.y, np.z + HW) and vel.y <= 0.0
		if on_ground:
			vel.y = 0.0
	pos = np
	if was_ground and not on_ground:
		fall_start_y = pos.y
	if not was_ground and on_ground:
		var drop := fall_start_y - pos.y
		fall_start_y = pos.y
		if drop > 6.5 and not in_water:
			pending_fall_damage += (drop - 6.5) * 9.0
	if on_ground:
		fall_start_y = pos.y
	step_smooth = move_toward(step_smooth, 0.0, dt * 6.0)

var pending_fall_damage := 0.0

func try_set_crouch(w: VoxelWorld, want: bool) -> void:
	if want == crouch:
		return
	if not want and not w.box_free(pos, HW, HEIGHT):
		return
	crouch = want

# ------------------------------------------------------------------ hitboxes
## Returns [t, zone] where zone 1 = head, 0 = body; or [] on miss.
func ray_hit(o: Vector3, d: Vector3, max_t: float, at_pos: Vector3) -> Array:
	var h := height()
	if state == St.KNOCKED:
		var t0 := _ray_box(o, d, at_pos + Vector3(-0.45, 0, -0.45), at_pos + Vector3(0.45, KNOCK_HEIGHT, 0.45))
		return [t0, 0] if t0 >= 0.0 and t0 <= max_t else []
	var head_lo := h * 0.74
	var th := _ray_box(o, d, at_pos + Vector3(-0.26, head_lo, -0.26), at_pos + Vector3(0.26, h + 0.06, 0.26))
	var tb := _ray_box(o, d, at_pos + Vector3(-0.34, 0, -0.34), at_pos + Vector3(0.34, head_lo, 0.34))
	if th >= 0.0 and th <= max_t and (tb < 0.0 or th <= tb + 0.02):
		return [th, 1]
	if tb >= 0.0 and tb <= max_t:
		return [tb, 0]
	return []

static func _ray_box(o: Vector3, d: Vector3, bmin: Vector3, bmax: Vector3) -> float:
	var tmin := -INF
	var tmax := INF
	for a in 3:
		if absf(d[a]) < 1e-8:
			if o[a] < bmin[a] or o[a] > bmax[a]:
				return -1.0
		else:
			var inv := 1.0 / d[a]
			var t1 := (bmin[a] - o[a]) * inv
			var t2 := (bmax[a] - o[a]) * inv
			if t1 > t2:
				var tmp := t1
				t1 = t2
				t2 = tmp
			tmin = maxf(tmin, t1)
			tmax = minf(tmax, t2)
			if tmin > tmax:
				return -1.0
	if tmax < 0.0:
		return -1.0
	return maxf(tmin, 0.0)

# ------------------------------------------------------------------ inventory
## Returns {"ok": bool, "drop": [[item_id, amount], ...]}
func give(item: String, amount: int) -> Dictionary:
	var out := {"ok": true, "drop": []}
	if DB.is_weapon(item):
		var wd := DB.weapon(item)
		var cat: int = wd["cat"]
		var slot := DB.SLOT_PRIMARY_A
		match cat:
			DB.Cat.PISTOL:
				slot = DB.SLOT_PISTOL
			DB.Cat.MELEE:
				slot = DB.SLOT_MELEE
			DB.Cat.THROW:
				if throws[item] >= MAX_THROW:
					out["ok"] = false
					return out
				throws[item] = mini(MAX_THROW, throws[item] + maxi(1, amount))
				if slots[DB.SLOT_THROW] == "":
					slots[DB.SLOT_THROW] = item
				return out
			_:
				if slots[0] == "":
					slot = 0
				elif slots[1] == "":
					slot = 1
				elif cur == 1:
					slot = 1
				else:
					slot = 0
		if slots[slot] == item:
			# duplicate: just take ammo
			var at: String = wd.get("ammo", "")
			if at != "":
				ammo[at] = mini(DB.AMMO_MAX[at], ammo[at] + int(wd["mag"]))
			return out
		if slots[slot] != "" and not (slot == DB.SLOT_MELEE and slots[slot] == "me_pick"):
			out["drop"].append([slots[slot], 1])
			_return_mag(slot)
		slots[slot] = item
		mag[slot] = int(wd.get("mag", 0))
		var at2: String = wd.get("ammo", "")
		if at2 != "" and ammo[at2] < int(wd["mag"]):
			ammo[at2] = mini(DB.AMMO_MAX[at2], ammo[at2] + int(wd["mag"]))
		if slots[cur] == "" or cur == DB.SLOT_MELEE:
			cur = slot
		return out
	if item.begins_with("ammo_"):
		var t := item.substr(5)
		if not ammo.has(t) or ammo[t] >= DB.AMMO_MAX[t]:
			out["ok"] = false
			return out
		ammo[t] = mini(DB.AMMO_MAX[t], ammo[t] + amount)
		return out
	var it: Dictionary = DB.ITEMS.get(item, {})
	match it.get("kind", ""):
		"med":
			if meds[item] >= int(it["stack"]):
				out["ok"] = false
				return out
			meds[item] = mini(int(it["stack"]), meds[item] + maxi(1, amount))
		"armor":
			var lv: int = it["level"]
			if lv < vest_lvl or (lv == vest_lvl and vest_dur >= float(it["dur"]) * 0.9):
				out["ok"] = false
				return out
			if vest_lvl > 0:
				out["drop"].append(["vest_%d" % vest_lvl, 1])
			vest_lvl = lv
			vest_dur = float(it["dur"])
		"helmet":
			var lv2: int = it["level"]
			if lv2 < helm_lvl or (lv2 == helm_lvl and helm_dur >= float(it["dur"]) * 0.9):
				out["ok"] = false
				return out
			if helm_lvl > 0:
				out["drop"].append(["helm_%d" % helm_lvl, 1])
			helm_lvl = lv2
			helm_dur = float(it["dur"])
		"blocks":
			if blocks >= MAX_BLOCKS:
				out["ok"] = false
				return out
			blocks = mini(MAX_BLOCKS, blocks + maxi(1, amount))
		_:
			out["ok"] = false
	return out

func _return_mag(slot: int) -> void:
	var wd := DB.weapon(slots[slot])
	var at: String = wd.get("ammo", "")
	if at != "":
		ammo[at] = mini(DB.AMMO_MAX[at], ammo[at] + mag[slot])
	mag[slot] = 0

func wants_item(item: String) -> bool:
	if DB.is_weapon(item):
		var cat: int = DB.weapon(item)["cat"]
		if cat == DB.Cat.THROW:
			return throws[item] < MAX_THROW
		if cat == DB.Cat.PISTOL:
			return slots[2] == ""
		if cat == DB.Cat.MELEE:
			return false
		return slots[0] == "" or slots[1] == ""
	if item.begins_with("ammo_"):
		var t := item.substr(5)
		if ammo.get(t, 999) >= DB.AMMO_MAX.get(t, 0):
			return false
		for s in 3:
			if slots[s] != "" and DB.weapon(slots[s]).get("ammo", "") == t:
				return true
		return ammo[t] < 60
	var it: Dictionary = DB.ITEMS.get(item, {})
	match it.get("kind", ""):
		"med":
			return meds[item] < int(it["stack"])
		"armor":
			return int(it["level"]) > vest_lvl
		"helmet":
			return int(it["level"]) > helm_lvl
		"blocks":
			return blocks < MAX_BLOCKS
	return false

func best_med() -> String:
	if hp >= MAX_HP:
		return ""
	var missing := MAX_HP - hp
	if missing >= 50 and meds["med_kit"] > 0:
		return "med_kit"
	if meds["med_drink"] > 0 and missing >= 25:
		return "med_drink"
	if meds["med_bandage"] > 0:
		return "med_bandage"
	if meds["med_drink"] > 0:
		return "med_drink"
	if meds["med_kit"] > 0:
		return "med_kit"
	return ""

func reset_loadout() -> void:
	slots = ["", "", "", "me_pick", ""]
	mag = [0, 0, 0, 0, 0]
	for k in ammo:
		ammo[k] = 0
	for k in meds:
		meds[k] = 0
	for k in throws:
		throws[k] = 0
	blocks = 0
	cur = 3
	vest_lvl = 0
	vest_dur = 0.0
	helm_lvl = 0
	helm_dur = 0.0

func inv_dict() -> Dictionary:
	return {"s": slots.duplicate(), "m": mag.duplicate(), "a": ammo.duplicate(), "md": meds.duplicate(), "t": throws.duplicate(),
		"b": blocks, "c": cur, "v": [vest_lvl, vest_dur], "h": [helm_lvl, helm_dur], "mo": money}

func apply_inv(d: Dictionary) -> void:
	slots = d["s"]
	mag = d["m"]
	ammo = d["a"]
	meds = d["md"]
	throws = d["t"]
	blocks = int(d["b"])
	cur = int(d["c"])
	vest_lvl = int(d["v"][0])
	vest_dur = float(d["v"][1])
	helm_lvl = int(d["h"][0])
	helm_dur = float(d["h"][1])
	money = int(d.get("mo", 0))

func stats_dict() -> Dictionary:
	return {"kills": kills, "damage": int(damage_dealt), "headshots": headshots, "healed": int(healed), "blocks": blocks_placed,
		"loot": loot_picked, "revives": revives, "supply": supply_opened, "placement": placement}
