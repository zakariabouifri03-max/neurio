extends Node3D
## Procedural blocky soldier made of boxes on pivots, animated in code.
## Origin at the feet, forward is -Z. Total height is about 1.9 m (1 unit = 1 block).

const WM := preload("res://scripts/weapons/weapon_model.gd")
const WDB := preload("res://scripts/weapons/weapon_db.gd")

var outfit_color: Color = Color(0.22, 0.46, 0.92)
var helmet_color: Color = Color(0.25, 0.32, 0.2)
var backpack_color: Color = Color(0.35, 0.24, 0.14)
var skin_color: Color = Color(0.94, 0.74, 0.58)
var pants_color: Color = Color(0.22, 0.24, 0.2)
var weapon_tint: Color = Color(0, 0, 0, 0)
var name_text: String = ""
var name_color: Color = Color.WHITE
var show_name: bool = true

var body
var torso
var head
var arm_l
var arm_r
var leg_l
var leg_r
var weapon_anchor
var name_label: Label3D
var weapon_kind: String = ""
var weapon_id: String = ""

var _weapon = null
var _mats: Dictionary = {}
var _phase: float = 0.0
var _crouch: float = 0.0
var _move: float = 0.0
var _aim: float = 0.0
var _hold: float = 0.0
var _dead: float = 0.0
var _aim_pitch: float = 0.0
var _reload_t: float = 0.0
var _reload_dur: float = 1.0
var _swing_t: float = 0.0
var _kick: float = 0.0
var _built: bool = false


func _ready() -> void:
	build()


func build() -> void:
	if _built:
		return
	_built = true
	body = Node3D.new()
	body.name = "Body"
	add_child(body)
	var dark := Color(0.12, 0.1, 0.09)
	leg_l = _pivot(body, Vector3(-0.14, 0.8, 0))
	leg_r = _pivot(body, Vector3(0.14, 0.8, 0))
	for leg in [leg_l, leg_r]:
		_box(leg, Vector3(0.26, 0.8, 0.28), Vector3(0, -0.4, 0), pants_color)
		_box(leg, Vector3(0.28, 0.12, 0.32), Vector3(0, -0.78, -0.02), dark)

	torso = _pivot(body, Vector3(0, 0.8, 0))
	_box(torso, Vector3(0.6, 0.64, 0.36), Vector3(0, 0.32, 0), outfit_color)
	_box(torso, Vector3(0.62, 0.08, 0.38), Vector3(0, 0.03, 0), Color(0.15, 0.12, 0.08))
	_box(torso, Vector3(0.42, 0.44, 0.2), Vector3(0, 0.36, 0.27), backpack_color)
	_box(torso, Vector3(0.14, 0.12, 0.04), Vector3(0.18, 0.22, -0.2), Color(0.18, 0.2, 0.14))

	arm_l = _pivot(torso, Vector3(-0.39, 0.6, 0))
	arm_r = _pivot(torso, Vector3(0.39, 0.6, 0))
	for arm in [arm_l, arm_r]:
		_box(arm, Vector3(0.2, 0.6, 0.22), Vector3(0, -0.3, 0), outfit_color)
		_box(arm, Vector3(0.19, 0.16, 0.19), Vector3(0, -0.66, 0), skin_color)
	weapon_anchor = Node3D.new()
	weapon_anchor.name = "WeaponAnchor"
	weapon_anchor.position = Vector3(0, -0.62, 0)
	arm_r.add_child(weapon_anchor)

	head = _pivot(torso, Vector3(0, 0.66, 0))
	_box(head, Vector3(0.42, 0.42, 0.42), Vector3(0, 0.21, 0), skin_color)
	_box(head, Vector3(0.09, 0.07, 0.03), Vector3(-0.1, 0.25, -0.215), dark)
	_box(head, Vector3(0.09, 0.07, 0.03), Vector3(0.1, 0.25, -0.215), dark)
	_box(head, Vector3(0.5, 0.22, 0.5), Vector3(0, 0.36, 0), helmet_color)
	_box(head, Vector3(0.44, 0.07, 0.06), Vector3(0, 0.31, -0.26), Color(0.1, 0.12, 0.14))

	name_label = Label3D.new()
	name_label.text = name_text
	name_label.position = Vector3(0, 2.15, 0)
	name_label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	name_label.font_size = 40
	name_label.pixel_size = 0.0075
	name_label.outline_size = 10
	name_label.modulate = name_color
	name_label.visible = show_name
	name_label.no_depth_test = false
	add_child(name_label)


func apply_style(outfit: Color, helmet: Color, backpack: Color, tint: Color) -> void:
	outfit_color = outfit
	helmet_color = helmet
	backpack_color = backpack
	weapon_tint = tint


func _pivot(parent, pos: Vector3):
	var n := Node3D.new()
	n.position = pos
	parent.add_child(n)
	return n


func _mat(c: Color) -> StandardMaterial3D:
	var key := c.to_html()
	if _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = 0.85
	_mats[key] = m
	return m


func _box(parent, size: Vector3, pos: Vector3, c: Color) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = _mat(c)
	mi.position = pos
	parent.add_child(mi)
	return mi


func set_weapon(id: String) -> void:
	build()
	if _weapon:
		_weapon.queue_free()
		_weapon = null
	weapon_id = id
	weapon_kind = ""
	if id == "":
		return
	_weapon = WM.build(id, weapon_tint)
	weapon_anchor.add_child(_weapon)
	var def: Dictionary = WDB.get_def(id)
	weapon_kind = def.get("kind", "")


func muzzle_position() -> Vector3:
	if _weapon:
		var m = _weapon.get_node_or_null("Muzzle")
		if m:
			return m.global_position
	return weapon_anchor.global_position + global_basis.z * -0.6


func muzzle_forward() -> Vector3:
	return -weapon_anchor.global_basis.z if _weapon else -global_basis.z


func start_reload(duration: float) -> void:
	_reload_t = duration
	_reload_dur = maxf(duration, 0.1)


func swing() -> void:
	_swing_t = 0.32


func kick(amount: float) -> void:
	_kick = minf(_kick + amount, 0.5)


func set_aim_pitch(p: float) -> void:
	_aim_pitch = p


func set_name_visible(v: bool) -> void:
	show_name = v
	if name_label:
		name_label.visible = v


func animate(delta: float, horiz_speed: float, aiming: bool, crouched: bool, alive: bool) -> void:
	if not _built:
		return
	var moving: bool = horiz_speed > 0.3 and alive
	_move = lerpf(_move, clampf(horiz_speed / 6.0, 0.0, 1.0), minf(1.0, delta * 10.0))
	_phase += delta * (3.0 + horiz_speed * 1.8) if moving else delta * 1.6
	_crouch = lerpf(_crouch, 1.0 if crouched else 0.0, minf(1.0, delta * 10.0))
	_aim = lerpf(_aim, 1.0 if aiming else 0.0, minf(1.0, delta * 12.0))
	_hold = lerpf(_hold, 1.0 if _weapon else 0.0, minf(1.0, delta * 10.0))
	_dead = lerpf(_dead, 0.0 if alive else 1.0, minf(1.0, delta * 5.0))
	_kick = lerpf(_kick, 0.0, minf(1.0, delta * 12.0))
	_swing_t = maxf(0.0, _swing_t - delta)
	_reload_t = maxf(0.0, _reload_t - delta)

	var swing_amp: float = 0.75 * _move * (1.0 - _crouch * 0.3)
	var step: float = sin(_phase) * swing_amp
	leg_l.rotation.x = step + _crouch * 0.9
	leg_r.rotation.x = -step + _crouch * 0.9
	torso.rotation.x = _crouch * 0.28 + _aim * 0.03
	body.position.y = -_crouch * 0.42
	head.rotation.x = clampf(_aim_pitch * 0.6, -0.8, 0.8)

	var idle_bob: float = sin(_phase) * 0.03 * (1.0 - _move)
	var arm_walk_l: float = -step * 0.6 + idle_bob
	var arm_walk_r: float = step * 0.6 - idle_bob
	# holding pose: both arms forward, right arm aims with the camera pitch when aiming
	var hold_rot: float = lerpf(1.45, PI * 0.5 + _aim_pitch, _aim)
	var reload_p: float = 0.0
	if _reload_t > 0.0:
		reload_p = sin((1.0 - _reload_t / _reload_dur) * PI) * 0.45
	var swing_p: float = 0.0
	if _swing_t > 0.0:
		swing_p = sin((1.0 - _swing_t / 0.32) * PI) * 1.6
	arm_r.rotation.x = lerpf(arm_walk_r, hold_rot - reload_p - _kick + (-swing_p), _hold)
	arm_r.rotation.z = lerpf(0.0, -swing_p * 0.3, 1.0 if _swing_t > 0.0 else 0.0)
	arm_l.rotation.x = lerpf(arm_walk_l, hold_rot - 0.25 - _kick * 0.5, _hold)
	arm_l.rotation.z = 0.0
	if weapon_anchor and _weapon == null:
		weapon_anchor.rotation = Vector3.ZERO

	body.rotation.x = lerpf(0.0, -PI * 0.5, _dead)
	body.position.y = lerpf(-_crouch * 0.42, -0.5, _dead)
	if _dead > 0.98:
		body.position.y = -0.7
