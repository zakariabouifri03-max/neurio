class_name PlayerController
extends Node
## Converts touch / keyboard / mouse input into simulation commands and drives the third-person camera.

var m: Match
var cam: Camera3D
var touch: TouchControls
var yaw := 0.0
var pitch := -0.1
var aiming := false
var crouch_on := false
var jump_req := false
var mouse_fire := false
var mouse_aim := false
var shake_amt := 0.0
var recoil_acc := 0.0
var cam_dist := 3.0
var cur_fov := 72.0
var build_mode := false
var ghost: MeshInstance3D
var ghost_cell := Vector3i.ZERO
var ghost_ok := false
var spectate_id := -1
var _last_shot_rt := 0.0
var _cam_pos := Vector3.ZERO
var _initialized := false
var ui_blocking := false

const BASE_FOV := 72.0

func setup(match_node: Match, camera: Camera3D) -> void:
	m = match_node
	cam = camera
	cam.fov = BASE_FOV
	cam.near = 0.08
	cam.far = 400.0
	ghost = MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(1.02, 1.02, 1.02)
	var gm := StandardMaterial3D.new()
	gm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	gm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	gm.albedo_color = Color(0.3, 0.85, 1.0, 0.35)
	bm.material = gm
	ghost.mesh = bm
	ghost.visible = false
	m.add_child(ghost)

# ------------------------------------------------------------------ commands (called at 30 Hz by Match)
func make_cmd() -> Dictionary:
	var a := m.local_actor()
	var mv := Vector2.ZERO
	if touch and touch.joy_active:
		mv = touch.joy_vec
	if not ui_blocking:
		mv.x += Input.get_action_strength("move_right") - Input.get_action_strength("move_left")
		mv.y += Input.get_action_strength("move_forward") - Input.get_action_strength("move_back")
	mv = mv.limit_length(1.0)
	var b := 0
	var fire := (touch != null and touch.fire_down) or mouse_fire
	if build_mode:
		fire = false
	if fire:
		b |= Match.BTN_FIRE
	if aiming or mouse_aim:
		b |= Match.BTN_AIM
	if jump_req:
		b |= Match.BTN_JUMP
		jump_req = false
	if crouch_on:
		b |= Match.BTN_CROUCH
	if Input.is_action_pressed("sprint") or (touch and touch.joy_active and touch.joy_vec.length() > 0.96):
		b |= Match.BTN_SPRINT
	if Settings.get_v("auto_pickup"):
		b |= Match.BTN_AUTOPICK
	var aim := _aim_angles(a)
	return {"mx": mv.x, "mz": mv.y, "yaw": aim.x, "pitch": aim.y, "b": b}

## Yaw/pitch from the actor's eye towards whatever is under the crosshair (third-person aiming).
func _aim_angles(a: Actor) -> Vector2:
	if a == null or cam == null or not a.can_fight():
		return Vector2(yaw, pitch)
	var o := cam.global_position
	var f := -cam.global_transform.basis.z
	var hit := m.world.raycast(o, f, 220.0)
	var target := o + f * (float(hit["dist"]) if not hit.is_empty() else 220.0)
	var to := target - a.eye_pos()
	if to.length() < 1.5 or f.dot(to.normalized()) < 0.2:
		to = f
	return Vector2(atan2(-to.x, -to.z), atan2(to.y, Vector2(to.x, to.z).length()))

# ------------------------------------------------------------------ actions
func do_action(name: String) -> void:
	var a := m.local_actor()
	match name:
		"jump":
			if a and a.state == Actor.St.PLANE:
				m.local_action({"t": "jump"})
			else:
				jump_req = true
		"crouch":
			crouch_on = touch.is_on("crouch") if touch else not crouch_on
		"aim":
			aiming = touch.is_on("aim") if touch else not aiming
		"reload":
			m.local_action({"t": "reload"})
		"heal":
			if a:
				var med := a.best_med()
				if med != "":
					m.local_action({"t": "use", "item": med})
				else:
					m.hud_event.emit("toast", {"t": "No healing items" if a.hp < Actor.MAX_HP else "Health is full"})
		"build":
			build_mode = touch.is_on("build") if touch else not build_mode
			if build_mode and a and a.blocks <= 0:
				build_mode = false
				if touch:
					touch.set_on("build", false)
				m.hud_event.emit("toast", {"t": "No blocks - loot Block Packs"})
		"place":
			if build_mode and ghost_ok:
				m.local_action({"t": "build", "c": ghost_cell})
		"throw":
			if a and a.slots[4] != "":
				var aim := _aim_angles(a)
				m.local_action({"t": "throw", "item": a.slots[4], "yaw": aim.x, "pitch": aim.y + 0.12})
			else:
				m.hud_event.emit("toast", {"t": "No throwables"})
		"throw_sel":
			m.local_action({"t": "throw_sel"})
		"interact":
			_interact()
		"emote":
			m.local_action({"t": "emote", "id": Profile.equip_dict().get("emote", "emote_wave")})
		"next_weapon":
			if a:
				for k in range(1, 5):
					var s := (a.cur + k) % 4
					if a.slots[s] != "":
						m.local_action({"t": "slot", "i": s})
						break

func _interact() -> void:
	var a := m.local_actor()
	if a == null:
		return
	if a.state == Actor.St.PLANE:
		m.local_action({"t": "jump"})
		return
	var ctx := context_target()
	match str(ctx.get("kind", "")):
		"revive":
			m.local_action({"t": "revive", "id": ctx["id"]})
		"crate":
			m.local_action({"t": "open", "id": ctx["id"]})
		"loot":
			m.local_action({"t": "pick", "id": ctx["id"]})

## What the interact button would do right now.
func context_target() -> Dictionary:
	var a := m.local_actor()
	if a == null or a.state != Actor.St.ALIVE:
		return {}
	for id in m.actors:
		var o: Actor = m.actors[id]
		if o != a and o.team == a.team and o.state == Actor.St.KNOCKED and o.pos.distance_to(a.pos) < 2.4:
			return {"kind": "revive", "id": id, "text": "Revive " + o.name}
	for id in m.crates:
		var c: Dictionary = m.crates[id]
		if c.get("landed", false) and a.pos.distance_to(c["pos"]) < 3.0:
			return {"kind": "crate", "id": id, "text": "Open supply drop"}
	var best := -1
	var bd := 2.6
	for id in m.loot:
		var it: Dictionary = m.loot[id]
		var d := a.pos.distance_to(it["pos"])
		if d < bd:
			bd = d
			best = id
	if best != -1:
		return {"kind": "loot", "id": best, "text": "Pick up " + DB.item_name(m.loot[best]["item"])}
	return {}

func nearby_loot(max_n := 4) -> Array:
	var a := m.local_actor()
	var out := []
	if a == null or a.state != Actor.St.ALIVE:
		return out
	for id in m.loot:
		var it: Dictionary = m.loot[id]
		var d := a.pos.distance_to(it["pos"])
		if d < 2.8:
			out.append([d, id, it])
	out.sort_custom(func(x, y): return x[0] < y[0])
	return out.slice(0, max_n)

func shake(amount: float) -> void:
	shake_amt = maxf(shake_amt, amount)

# ------------------------------------------------------------------ input
func _unhandled_input(event: InputEvent) -> void:
	if m == null or ui_blocking:
		return
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var sens: float = float(Settings.get_v("sens_look")) * 0.0024
		if aiming or mouse_aim:
			sens *= float(Settings.get_v("sens_aim")) / _zoom()
		yaw -= event.relative.x * sens
		pitch -= event.relative.y * sens * (-1.0 if Settings.get_v("invert_y") else 1.0)
	elif event is InputEventMouseButton:
		if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
			if event.button_index == MOUSE_BUTTON_LEFT:
				mouse_fire = event.pressed
				if event.pressed and build_mode:
					do_action("place")
			elif event.button_index == MOUSE_BUTTON_RIGHT:
				mouse_aim = event.pressed
			elif event.button_index == MOUSE_BUTTON_WHEEL_UP and event.pressed:
				do_action("next_weapon")
		elif event.pressed and event.button_index == MOUSE_BUTTON_LEFT and not Settings.is_mobile and not (touch and touch.visible):
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif event is InputEventKey and event.pressed and not event.echo:
		var a := m.local_actor()
		if event.is_action("jump"):
			do_action("jump")
		elif event.is_action("crouch"):
			crouch_on = not crouch_on
			if touch:
				touch.set_on("crouch", crouch_on)
		elif event.is_action("reload"):
			do_action("reload")
		elif event.is_action("interact"):
			do_action("interact")
		elif event.is_action("heal"):
			do_action("heal")
		elif event.is_action("build"):
			build_mode = not build_mode
			if touch:
				touch.set_on("build", build_mode)
			if build_mode and a and a.blocks <= 0:
				build_mode = false
		elif event.is_action("place_block"):
			do_action("place")
		elif event.is_action("throw"):
			do_action("throw")
		elif event.is_action("emote"):
			do_action("emote")
		elif event.is_action("next_weapon"):
			do_action("next_weapon")
		else:
			for i in 5:
				if event.is_action("slot_%d" % (i + 1)):
					m.local_action({"t": "slot", "i": i})

func _zoom() -> float:
	var a := m.local_actor()
	if a == null:
		return 1.0
	return float(a.weapon().get("zoom", 1.0))

func is_scoped() -> bool:
	var a := m.local_actor()
	return a != null and (aiming or mouse_aim) and a.can_fight() and _zoom() >= 2.5

# ------------------------------------------------------------------ camera (every frame)
func _process(dt: float) -> void:
	if m == null or cam == null or m.loading:
		return
	var a := m.local_actor()
	if touch:
		var d := touch.take_look()
		var sens: float = float(Settings.get_v("sens_look")) * 0.0052
		if aiming:
			sens *= float(Settings.get_v("sens_aim")) / _zoom()
		yaw -= d.x * sens
		pitch -= d.y * sens * (-1.0 if Settings.get_v("invert_y") else 1.0)
	pitch = clampf(pitch, -1.35, 1.25)
	if a and not _initialized:
		yaw = a.yaw
		_initialized = true
	# recoil: detect new local shots
	if a and a.shot_rt > _last_shot_rt:
		_last_shot_rt = a.shot_rt
		var w := a.weapon()
		var rec: float = deg_to_rad(float(w.get("rec", 0.0)))
		if aiming:
			rec *= 0.7
		if a.crouch:
			rec *= 0.8
		pitch += rec
		recoil_acc += rec
		yaw += deg_to_rad(randf_range(-1.0, 1.0) * float(w.get("recx", 0.0)))
		shake(minf(0.12, rec * 0.6))
	if recoil_acc > 0.0 and not ((touch and touch.fire_down) or mouse_fire):
		var back := minf(recoil_acc, recoil_acc * 5.0 * dt + 0.002)
		pitch -= back * 0.6
		recoil_acc -= back
	# target to follow
	var follow: Actor = a
	if a == null or a.state == Actor.St.DEAD:
		follow = m.actors.get(spectate_id)
		if follow == null or not follow.is_alive():
			_pick_spectate()
			follow = m.actors.get(spectate_id)
	var v = m.views.get(follow.id) if follow else null
	var base_pos: Vector3 = (v as Node3D).global_position if v else (follow.pos if follow else Vector3(m.world.sx * 0.5, 40, m.world.sz * 0.5))
	var height := 1.6
	var dist := 3.1
	var side := 0.62
	if follow:
		if follow.crouch:
			height = 1.15
		match follow.state:
			Actor.St.PLANE:
				dist = 14.0
				height = 4.0
				side = 0.0
			Actor.St.SKYDIVE, Actor.St.PARACHUTE:
				dist = 6.5
				height = 2.6
				side = 0.0
			Actor.St.KNOCKED:
				height = 0.9
	var target_fov := BASE_FOV
	if (aiming or mouse_aim) and a and a.can_fight():
		var z := _zoom()
		target_fov = BASE_FOV / z
		dist = 1.6 if z < 2.5 else 0.3
		side = 0.55 if z < 2.5 else 0.0
	cur_fov = lerpf(cur_fov, target_fov, minf(1.0, dt * 14.0))
	cam.fov = cur_fov
	var view_yaw := yaw
	var view_pitch := pitch
	if follow and follow != a:
		view_yaw = follow.yaw
		view_pitch = clampf(follow.pitch, -0.6, 0.6)
	var basis := Basis.from_euler(Vector3(view_pitch, view_yaw, 0))
	var pivot := base_pos + Vector3(0, height, 0)
	var desired := pivot + basis * Vector3(side, 0.25, dist)
	var dir := desired - pivot
	var hit := m.world.raycast(pivot, dir.normalized(), dir.length() + 0.3)
	if not hit.is_empty():
		desired = pivot + dir.normalized() * maxf(0.2, float(hit["dist"]) - 0.3)
	if shake_amt > 0.001:
		desired += Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * shake_amt * 0.25
		shake_amt = move_toward(shake_amt, 0.0, dt * 1.8)
	cam.global_position = desired
	cam.global_transform.basis = basis
	_update_ghost(a)

func _update_ghost(a: Actor) -> void:
	ghost.visible = false
	ghost_ok = false
	if not build_mode or a == null or a.state != Actor.St.ALIVE:
		return
	var o := cam.global_position
	var f := -cam.global_transform.basis.z
	var hit := m.world.raycast(o, f, 9.0)
	var cell := Vector3i.ZERO
	if not hit.is_empty() and a.eye_pos().distance_to(hit["point"]) < 6.0:
		cell = (hit["pos"] as Vector3i) + (hit["normal"] as Vector3i)
	else:
		var p := a.pos + a.forward() * 1.6
		cell = Vector3i(floori(p.x), floori(a.pos.y + 0.1), floori(p.z))
	ghost_cell = cell
	ghost_ok = m.world.can_build_at(cell) and not _actor_in_cell(cell)
	ghost.visible = true
	ghost.global_position = Vector3(cell) + Vector3(0.5, 0.5, 0.5)
	var mat: StandardMaterial3D = (ghost.mesh as BoxMesh).material
	mat.albedo_color = Color(0.3, 0.85, 1.0, 0.38) if ghost_ok else Color(1.0, 0.3, 0.25, 0.3)

func _actor_in_cell(c: Vector3i) -> bool:
	for id in m.actors:
		var o: Actor = m.actors[id]
		if o.is_alive() and o.pos.x + 0.3 > c.x and o.pos.x - 0.3 < c.x + 1 and o.pos.z + 0.3 > c.z and o.pos.z - 0.3 < c.z + 1 \
				and o.pos.y < c.y + 1 and o.pos.y + o.height() > c.y:
			return true
	return false

func _pick_spectate() -> void:
	var me := m.local_actor()
	var best := -1
	for id in m.actors:
		var o: Actor = m.actors[id]
		if not o.is_alive() or o.dummy or (me and o == me):
			continue
		if me and o.team == me.team:
			spectate_id = id
			return
		if best == -1:
			best = id
	if me and me.last_attacker != -1 and m.actors.has(me.last_attacker) and (m.actors[me.last_attacker] as Actor).is_alive():
		best = me.last_attacker
	spectate_id = best

func next_spectate() -> void:
	var ids := []
	for id in m.actors:
		var o: Actor = m.actors[id]
		if o.is_alive() and not o.dummy and id != m.local_id:
			ids.append(id)
	if ids.is_empty():
		return
	var i := ids.find(spectate_id)
	spectate_id = ids[(i + 1) % ids.size()]
