extends "res://scripts/characters/character_base.gd"
## The human-controlled soldier: third-person orbit camera, aim-down-sights,
## recoil, and translation of Controls input into character actions.

const CAM_DIST := 3.6
const ADS_DIST := 2.1
const CAM_FOV := 75.0
const RECOIL_STEP := 0.012

var yaw_node
var pitch_node
var spring: SpringArm3D
var camera: Camera3D
var _yaw: float = 0.0
var _pitch: float = 0.0
var _recoil: float = 0.0
var _aim_blend: float = 0.0
var _cam_enabled: bool = true
var _ads_fov: float = 58.0


func _ready() -> void:
	super._ready()
	add_to_group("player")
	model.set_name_visible(false)
	_build_camera()


func configure_model(m) -> void:
	m.outfit_color = Game.equipped_color("outfit", Color(0.22, 0.46, 0.92))
	m.helmet_color = Game.equipped_color("helmet", Color(0.25, 0.32, 0.2))
	m.backpack_color = Game.equipped_color("backpack", Color(0.35, 0.24, 0.14))
	m.weapon_tint = Game.equipped_color("weapon_skin", Color(0, 0, 0, 0))


func _build_camera() -> void:
	yaw_node = Node3D.new()
	yaw_node.name = "YawPivot"
	yaw_node.position = Vector3(0, 1.55, 0)
	add_child(yaw_node)
	pitch_node = Node3D.new()
	pitch_node.name = "PitchPivot"
	yaw_node.add_child(pitch_node)
	spring = SpringArm3D.new()
	spring.name = "SpringArm"
	spring.spring_length = CAM_DIST
	spring.margin = 0.3
	spring.collision_mask = 1
	pitch_node.add_child(spring)
	spring.add_excluded_object(get_rid())
	camera = Camera3D.new()
	camera.name = "Camera"
	camera.position = Vector3(0.6, 0.0, 0.0)
	camera.fov = CAM_FOV
	camera.near = 0.08
	camera.far = 320.0
	spring.add_child(camera)
	camera.make_current()


func set_camera_active(active: bool) -> void:
	_cam_enabled = active
	if active:
		camera.make_current()
	else:
		camera.current = false


func set_camera_far(far: float) -> void:
	if camera:
		camera.far = far


func aim_point() -> Vector3:
	var from: Vector3 = camera.global_position
	var fwd: Vector3 = -camera.global_basis.z
	var to: Vector3 = from + fwd * 400.0
	var hit: Dictionary = world.raycast(from, to, 3, [self]) if world else {}
	if hit.is_empty():
		return to
	return hit["position"]


func _physics_process(delta: float) -> void:
	if alive and Controls.enabled:
		_read_input()
	elif not alive:
		wish_dir = Vector3.ZERO
		is_aiming = false
		is_sprinting = false
	super._physics_process(delta)


func _read_input() -> void:
	is_aiming = Controls.aim_held and inv.current() != null and weapon_def().get("kind", "") != "melee"
	var mv: Vector2 = Controls.move_vec()
	var fwd := Vector3(-sin(_yaw), 0.0, -cos(_yaw))
	var right := Vector3(cos(_yaw), 0.0, -sin(_yaw))
	wish_dir = right * mv.x + fwd * mv.y
	if wish_dir.length() > 1.0:
		wish_dir = wish_dir.normalized()
	is_sprinting = Controls.sprint_requested() and mv.length() > 0.6 and not is_aiming and not is_crouched
	if Controls.consume("jump"):
		request_jump()
	if Controls.consume("crouch") and is_on_floor():
		is_crouched = not is_crouched
	if Controls.consume("reload"):
		request_reload()
	if Controls.consume("switch"):
		cycle_weapon(1)
	for i in 3:
		if Controls.consume("slot_%d" % i):
			equip_slot(i)
	if Controls.consume("heal"):
		use_heal()
	if Controls.consume("grenade") and alive:
		try_throw(aim_point())
	if Controls.consume("use") and arena:
		arena.try_interact(self)
	if Controls.consume("build") and arena:
		arena.request_build(self)
	if Controls.consume("bag") and arena:
		arena.toggle_inventory()
	if Controls.consume("pause") and arena:
		arena.toggle_pause()
	var w := weapon_def()
	var want_fire: bool = Controls.consume("fire")
	if Controls.fire_held and bool(w.get("auto", false)):
		want_fire = true
	if want_fire and not is_sprinting and alive:
		if try_fire(aim_point()):
			_recoil = minf(_recoil + float(w.get("recoil", 1.0)) * RECOIL_STEP, 0.35)
			_yaw += randf_range(-1.0, 1.0) * float(w.get("recoil", 1.0)) * 0.002


func _process(delta: float) -> void:
	if not alive:
		super._process(delta)
		return
	var look: Vector2 = Controls.consume_look() if Controls.enabled else Vector2.ZERO
	var sens: float = float(Game.settings["look_sensitivity"]) * 0.0026
	if is_aiming:
		sens *= float(Game.settings["ads_multiplier"])
	var y_sign: float = -1.0 if bool(Game.settings["invert_y"]) else 1.0
	_yaw -= look.x * sens
	_pitch = clampf(_pitch - look.y * sens * y_sign, -1.15, 0.95)
	_recoil = lerpf(_recoil, 0.0, minf(1.0, delta * 7.0))
	yaw_node.rotation.y = _yaw
	pitch_node.rotation.x = _pitch + _recoil
	_aim_blend = lerpf(_aim_blend, 1.0 if is_aiming else 0.0, minf(1.0, delta * 12.0))
	spring.spring_length = lerpf(CAM_DIST, ADS_DIST, _aim_blend)
	camera.position.x = lerpf(0.6, 0.38, _aim_blend)
	var ads_fov: float = float(weapon_def().get("ads_fov", 60.0))
	camera.fov = lerpf(CAM_FOV, ads_fov, _aim_blend)
	model.set_aim_pitch(_pitch + _recoil)
	# body faces the aim direction when aiming, otherwise the movement direction
	var target_yaw: float = model.rotation.y
	if is_aiming:
		target_yaw = _yaw
	elif wish_dir.length() > 0.1:
		target_yaw = atan2(-wish_dir.x, -wish_dir.z)
	model.rotation.y = lerp_angle(model.rotation.y, target_yaw, minf(1.0, delta * 12.0))
	super._process(delta)


func facing_yaw() -> float:
	return _yaw
