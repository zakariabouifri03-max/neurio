class_name ActorView
extends Node3D
## Visual representation of an Actor: skinned blocky character, procedural animation, held weapon,
## muzzle flash, parachute, name tag. Interpolates between 30 Hz sim ticks or network snapshots.

const B_ROOT := 0
const B_HIPS := 1
const B_TORSO := 2
const B_HEAD := 3
const B_ARM_R := 4
const B_ARM_L := 5
const B_LEG_R := 6
const B_LEG_L := 7
const HIPS_REST := Vector3(0, 12 * CharacterBuilder.PX, 0)

var actor: Actor
var parts := {}
var skel: Skeleton3D
var weapon_mi: MeshInstance3D
var flash: MeshInstance3D
var chute: MeshInstance3D
var label: Label3D
var cur_weapon := "?"
var vest := -1
var helm := -1
var walk_phase := 0.0
var prev_pos := Vector3.ZERO
var cur_pos := Vector3.ZERO
var prev_yaw := 0.0
var cur_yaw := 0.0
var net_mode := false
var buf: Array = []           # [time, pos, yaw, pitch]
var vis_pitch := 0.0
var death_t := -1.0
var hurt_flash := 0.0
var step_acc := 0.0
var rel := 2                  # 0 self, 1 teammate, 2 enemy
var lying := 0.0

func setup(a: Actor, relation: int, unshaded: bool) -> void:
	actor = a
	rel = relation
	parts = CharacterBuilder.build(a.cosmetics, a.vest_lvl, a.helm_lvl, unshaded)
	add_child(parts["root"])
	skel = parts["skel"]
	vest = a.vest_lvl
	helm = a.helm_lvl
	weapon_mi = MeshInstance3D.new()
	weapon_mi.material_override = VoxelArt.prop_material()
	(parts["hand"] as Node3D).add_child(weapon_mi)
	flash = MeshInstance3D.new()
	flash.mesh = Models.boxes_mesh([[Vector3.ZERO, Vector3(0.14, 0.14, 0.22), Color(1.0, 0.8, 0.3, 0.9)], [Vector3.ZERO, Vector3(0.26, 0.05, 0.05), Color(1.0, 0.95, 0.6, 0.8)]], false)
	flash.material_override = VoxelArt.mat_glow
	flash.visible = false
	weapon_mi.add_child(flash)
	chute = MeshInstance3D.new()
	var tc := Color(0.2, 0.55, 1.0) if relation <= 1 else Color(1.0, 0.3, 0.25)
	chute.mesh = Models.parachute_mesh(tc)
	chute.material_override = VoxelArt.prop_material()
	chute.visible = false
	add_child(chute)
	label = Label3D.new()
	label.text = a.name
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.font_size = 40
	label.pixel_size = 0.005
	label.outline_size = 10
	label.position = Vector3(0, 2.2, 0)
	label.no_depth_test = relation == 1
	label.modulate = Color(0.45, 1.0, 0.55) if relation == 1 else (Color(1, 1, 1) if relation == 0 else Color(1.0, 0.45, 0.4))
	label.visible = relation == 1
	label.visibility_range_end = 120.0
	add_child(label)
	var gi: GeometryInstance3D = parts["mi"]
	gi.visibility_range_end = 260.0
	prev_pos = a.pos
	cur_pos = a.pos
	prev_yaw = a.yaw
	cur_yaw = a.yaw
	global_position = a.pos

## Called by the match after every simulation tick (local simulation path).
func tick_sync() -> void:
	prev_pos = cur_pos
	prev_yaw = cur_yaw
	cur_pos = actor.pos
	cur_yaw = actor.yaw

## Network path: store a snapshot sample for buffered interpolation.
func push_sample(t: float, p: Vector3, yaw: float, pitch: float) -> void:
	net_mode = true
	buf.append([t, p, yaw, pitch])
	if buf.size() > 12:
		buf.pop_front()

func snap_to(p: Vector3) -> void:
	prev_pos = p
	cur_pos = p
	buf.clear()
	global_position = p

func set_weapon(id: String, wrap: String) -> void:
	if id == cur_weapon:
		return
	cur_weapon = id
	if id == "":
		weapon_mi.mesh = null
		return
	weapon_mi.mesh = Models.weapon_mesh(id, wrap)
	var tip := 0.0
	for p in Models.WEAPON_PARTS.get(id, []):
		tip = minf(tip, (p[0] as Vector3).z - (p[1] as Vector3).z * 0.5)
	flash.position = Vector3(0, 0.08, tip - 0.08)

func hurt() -> void:
	hurt_flash = 0.12

func _process(dt: float) -> void:
	var a := actor
	if a == null:
		return
	var now: float = Time.get_ticks_msec() / 1000.0
	var yaw := cur_yaw
	var pitch := a.pitch
	if net_mode and buf.size() > 0:
		var rt := now - 0.11
		var s0: Array = buf[0]
		var s1: Array = buf[buf.size() - 1]
		for i in range(buf.size() - 1):
			if buf[i][0] <= rt and buf[i + 1][0] >= rt:
				s0 = buf[i]
				s1 = buf[i + 1]
				break
		var span: float = s1[0] - s0[0]
		var f := clampf((rt - s0[0]) / span, 0.0, 1.0) if span > 0.0001 else 1.0
		if rt > s1[0]:
			f = 1.0
		global_position = (s0[1] as Vector3).lerp(s1[1], f)
		yaw = lerp_angle(s0[2], s1[2], f)
		pitch = lerpf(s0[3], s1[3], f)
	else:
		var f2 := Engine.get_physics_interpolation_fraction()
		global_position = prev_pos.lerp(cur_pos, f2) + Vector3(0, a.step_smooth, 0)
		yaw = lerp_angle(prev_yaw, cur_yaw, f2)
	rotation = Vector3(0, yaw, 0)
	vis_pitch = lerpf(vis_pitch, pitch, minf(1.0, dt * 20.0))
	if a.vest_lvl != vest or a.helm_lvl != helm:
		vest = a.vest_lvl
		helm = a.helm_lvl
		CharacterBuilder.rebuild_mesh(parts, a.cosmetics, vest, helm)
	if hurt_flash > 0.0:
		hurt_flash -= dt
		(parts["mat"] as StandardMaterial3D).albedo_color = Color(1.0, 0.45, 0.45) if hurt_flash > 0.0 else Color.WHITE
	_animate(dt, now)

func _rot(b: int, e: Vector3) -> void:
	skel.set_bone_pose_rotation(b, Quaternion.from_euler(e))

func _animate(dt: float, now: float) -> void:
	var a := actor
	var mt: float = Match.time
	visible = a.state != Actor.St.PLANE and not (a.state == Actor.St.DEAD and death_t >= 0.0 and now - death_t > 3.5)
	chute.visible = a.state == Actor.St.PARACHUTE
	var hv := Vector2(a.vel.x, a.vel.z).length()
	walk_phase += hv * dt * 2.0
	var amp := clampf(hv / 6.0, 0.0, 1.0)
	var swing := sin(walk_phase) * amp * 0.85
	var root_rot := Vector3.ZERO
	var root_pos := Vector3.ZERO
	var hips := HIPS_REST
	var torso := Vector3.ZERO
	var head := Vector3(vis_pitch * 0.7, 0, 0)
	var arm_r := Vector3.ZERO
	var arm_l := Vector3.ZERO
	var leg_r := Vector3(swing, 0, 0)
	var leg_l := Vector3(-swing, 0, 0)
	var show_weapon := a.state == Actor.St.ALIVE and a.use_item == "" and a.emote == "" and cur_weapon != ""
	var wd := DB.weapon(cur_weapon)
	var cat: int = wd.get("cat", -1)
	if a.state == Actor.St.DEAD:
		if death_t < 0.0:
			death_t = now
		lying = minf(1.0, lying + dt * 3.0)
		root_rot = Vector3(-PI * 0.5 * lying, 0, 0)
		root_pos = Vector3(0, 0.12 * lying, 0)
		arm_r = Vector3(0.3, 0, 0.4)
		arm_l = Vector3(0.3, 0, -0.4)
		leg_r = Vector3(0.1, 0, 0.1)
		leg_l = Vector3(-0.1, 0, -0.1)
	else:
		death_t = -1.0
		lying = 0.0
	match a.state:
		Actor.St.KNOCKED:
			var crawl := sin(walk_phase * 1.5) * amp
			root_rot = Vector3(-1.35, 0, 0)
			root_pos = Vector3(0, 0.15, 0)
			arm_r = Vector3(PI * 0.8 + crawl * 0.6, 0, 0)
			arm_l = Vector3(PI * 0.8 - crawl * 0.6, 0, 0)
			leg_r = Vector3(crawl * 0.4, 0, 0)
			leg_l = Vector3(-crawl * 0.4, 0, 0)
			head = Vector3(1.0, 0, 0)
		Actor.St.SKYDIVE:
			root_rot = Vector3(-1.25, 0, 0)
			root_pos = Vector3(0, 0.9, 0)
			var flap := sin(now * 9.0) * 0.08
			arm_r = Vector3(0.2, 0, 1.3 + flap)
			arm_l = Vector3(0.2, 0, -1.3 - flap)
			leg_r = Vector3(-0.2, 0, 0.3)
			leg_l = Vector3(-0.2, 0, -0.3)
			head = Vector3(0.9, 0, 0)
		Actor.St.PARACHUTE:
			arm_r = Vector3(PI * 0.92, 0, -0.25)
			arm_l = Vector3(PI * 0.92, 0, 0.25)
			leg_r = Vector3(0.15 + sin(now * 2.0) * 0.1, 0, 0)
			leg_l = Vector3(0.05 - sin(now * 2.0) * 0.1, 0, 0)
		Actor.St.ALIVE:
			if not a.on_ground:
				leg_r = Vector3(0.45, 0, 0.05)
				leg_l = Vector3(-0.25, 0, -0.05)
			if a.crouch:
				hips = HIPS_REST - Vector3(0, 0.3, 0)
				torso = Vector3(-0.25, 0, 0)
				leg_r = Vector3(1.25 + swing * 0.3, 0, 0)
				leg_l = Vector3(-0.15 - swing * 0.3, 0, 0)
			# arms
			var aim_x := PI * 0.5 + vis_pitch
			if show_weapon and cat in [DB.Cat.AR, DB.Cat.SMG, DB.Cat.SG, DB.Cat.SR]:
				arm_r = Vector3(aim_x, 0.0, 0.0)
				arm_l = Vector3(aim_x + 0.15, 0.55, 0.0)
				torso.y = 0.12
			elif show_weapon and cat == DB.Cat.PISTOL:
				arm_r = Vector3(aim_x, -0.12, 0.0)
				arm_l = Vector3(aim_x, 0.42, 0.0)
			elif show_weapon and cat == DB.Cat.MELEE:
				arm_r = Vector3(0.7 + swing * 0.3, 0, 0.1)
				arm_l = Vector3(-swing * 0.8, 0, -0.05)
			elif show_weapon and cat == DB.Cat.THROW:
				arm_r = Vector3(1.2, 0, 0)
				arm_l = Vector3(-swing * 0.8, 0, -0.05)
			else:
				arm_r = Vector3(-swing * 0.8, 0, 0.05)
				arm_l = Vector3(swing * 0.8, 0, -0.05)
			if not show_weapon and a.use_item != "":
				arm_r = Vector3(1.0 + sin(now * 6.0) * 0.1, -0.3, 0)
				arm_l = Vector3(1.0 - sin(now * 6.0) * 0.1, 0.3, 0)
				head.x = -0.35
			# action layers
			var since_shot := now - a.shot_rt
			if show_weapon and since_shot < 0.3:
				if cat == DB.Cat.MELEE:
					var k := since_shot / 0.3
					arm_r = Vector3(PI * 0.5 + 1.2 - k * 2.4, 0, 0.2)
					torso.y = 0.4 - k * 0.8
				elif cat == DB.Cat.THROW:
					var k2 := since_shot / 0.3
					arm_r = Vector3(PI * 0.9 - k2 * 1.6, 0, 0)
				else:
					var kick := maxf(0.0, 1.0 - since_shot / 0.09) * 0.16
					arm_r.x += kick
					arm_l.x += kick
			flash.visible = show_weapon and since_shot < 0.05 and cat in [DB.Cat.AR, DB.Cat.SMG, DB.Cat.SG, DB.Cat.SR, DB.Cat.PISTOL]
			if a.reload_end > mt and show_weapon:
				var rl: float = maxf(0.2, float(wd.get("rel", 2.0)))
				var k3 := clampf(1.0 - (a.reload_end - mt) / rl, 0.0, 1.0)
				arm_l = Vector3(aim_x - sin(k3 * PI) * 1.1, 0.3, 0)
				arm_r.x -= sin(k3 * PI) * 0.35
			if a.emote != "":
				_emote_pose(a.emote, now, arm_r, arm_l, leg_r, leg_l, torso, head, root_rot)
				arm_r = _ep[0]
				arm_l = _ep[1]
				leg_r = _ep[2]
				leg_l = _ep[3]
				torso = _ep[4]
				head = _ep[5]
				root_rot = _ep[6]
	weapon_mi.visible = show_weapon
	_rot(B_ROOT, root_rot)
	skel.set_bone_pose_position(B_ROOT, root_pos)
	skel.set_bone_pose_position(B_HIPS, hips)
	_rot(B_TORSO, torso)
	_rot(B_HEAD, head)
	_rot(B_ARM_R, arm_r)
	_rot(B_ARM_L, arm_l)
	_rot(B_LEG_R, leg_r)
	_rot(B_LEG_L, leg_l)
	# footsteps
	if a.state == Actor.St.ALIVE and a.on_ground and hv > 1.5:
		step_acc += hv * dt
		if step_acc > 1.9:
			step_acc = 0.0
			if rel == 0 or global_position.distance_to(get_viewport().get_camera_3d().global_position if get_viewport().get_camera_3d() else global_position) < 22.0:
				Audio.play_3d("step", global_position, -14.0 if rel != 0 else -16.0, randf_range(0.9, 1.1))

var _ep: Array = []

func _emote_pose(id: String, now: float, ar: Vector3, al: Vector3, lr: Vector3, ll: Vector3, to: Vector3, he: Vector3, rr: Vector3) -> void:
	var anim: int = DB.COSMETICS.get(id, {}).get("anim", 0)
	var t := now * 1.0
	match anim:
		0:  # wave
			ar = Vector3(PI * 0.85, 0, -0.3 + sin(t * 10.0) * 0.35)
		1:  # cheer
			ar = Vector3(PI * 0.9 + sin(t * 8.0) * 0.15, 0, -0.3)
			al = Vector3(PI * 0.9 - sin(t * 8.0) * 0.15, 0, 0.3)
			rr = Vector3(0, 0, 0)
			to = Vector3(0, 0, 0)
		2:  # robot
			var st := floorf(t * 3.0)
			ar = Vector3(PI * 0.5 * fmod(st, 2.0), 0, 0)
			al = Vector3(PI * 0.5 * fmod(st + 1.0, 2.0), 0, 0)
			he = Vector3(0, 0.4 * (fmod(st, 3.0) - 1.0), 0)
		3:  # spin
			rr = Vector3(0, fmod(t * 8.0, TAU), 0)
			ar = Vector3(0, 0, 1.4)
			al = Vector3(0, 0, -1.4)
		4:  # salute
			ar = Vector3(PI * 0.75, -0.5, -1.0)
		5:  # flex
			ar = Vector3(PI * 0.5, 0, 1.4 + sin(t * 6.0) * 0.1)
			al = Vector3(PI * 0.5, 0, -1.4 - sin(t * 6.0) * 0.1)
			to = Vector3(0.1, 0, 0)
		6:  # shuffle dance
			var s := sin(t * 9.0)
			lr = Vector3(s * 0.6, 0, 0.2)
			ll = Vector3(-s * 0.6, 0, -0.2)
			ar = Vector3(1.2 + s * 0.8, 0, 0.3)
			al = Vector3(1.2 - s * 0.8, 0, -0.3)
			to = Vector3(0, s * 0.3, 0)
		7:  # laugh
			to = Vector3(-0.2 + sin(t * 18.0) * 0.06, 0, 0)
			he = Vector3(0.4, 0, 0)
			ar = Vector3(0.6, 0, 0.5)
			al = Vector3(0.6, 0, -0.5)
	_ep = [ar, al, lr, ll, to, he, rr]
