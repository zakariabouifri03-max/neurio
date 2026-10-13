class_name ThirdPersonCamera
extends Node3D
## Third-person orbit camera.
##
## Node layout (built in _ready):
##   ThirdPersonCamera (top level, follows the target)
##     └ PitchPivot (rotation.x = pitch)
##         └ SpringArm3D (collision-aware boom, extends along local +Z)
##             └ Camera3D (shoulder offset)
##
## Yaw is kept on this node. The owning character copies yaw/pitch so its body
## faces the camera direction and aim rays come from the reticle.

const MIN_PITCH := -1.1
const MAX_PITCH := 0.85
## Radians per unit of look input at sensitivity 1.0 (touch converts pixels to radians).
const LOOK_GAIN := 1.0

var yaw := 0.0
var pitch := -0.12
var look_sensitivity := 1.0
var aim_sensitivity := 0.7
var invert_y := false
var base_distance := 3.6
var base_fov := 75.0
var aim_distance := 2.2
var aim_fov := 55.0
var shoulder_offset := 0.6
var head_height := 1.5
var aiming := false
## Multiplier from aim assist (1.0 = no assist, <1 slows turning near targets).
var assist_factor := 1.0

var _target: PlayerController
var _pitch_pivot: Node3D
var _arm: SpringArm3D
var _camera: Camera3D


func _ready() -> void:
	top_level = true
	_pitch_pivot = Node3D.new()
	_pitch_pivot.name = "PitchPivot"
	add_child(_pitch_pivot)
	_arm = SpringArm3D.new()
	_arm.name = "SpringArm"
	_arm.spring_length = base_distance
	_arm.margin = 0.25
	_arm.collision_mask = GameConstants.LAYER_WORLD
	_pitch_pivot.add_child(_arm)
	_camera = Camera3D.new()
	_camera.name = "Camera"
	_camera.position = Vector3(shoulder_offset, 0.0, 0.0)
	_camera.fov = base_fov
	_camera.near = 0.05
	_camera.far = 400.0
	_arm.add_child(_camera)
	_camera.current = true


func follow(target: PlayerController) -> void:
	_target = target
	if _arm and is_instance_valid(target):
		_arm.clear_excluded_objects()
		_arm.add_excluded_object(target.get_rid())


func get_camera() -> Camera3D:
	return _camera


func apply_settings(distance: float, fov: float) -> void:
	base_distance = distance
	base_fov = fov


func apply_look(look: Vector2) -> void:
	## look: radians of input (x = yaw, y = pitch). Positive y drags the view down.
	var aim_mult := aim_sensitivity if aiming else 1.0
	var k := LOOK_GAIN * look_sensitivity * aim_mult * assist_factor
	yaw -= look.x * k
	var py := look.y * k
	# Dragging down looks down (pitch decreases) unless Y is inverted.
	pitch += py if invert_y else -py
	pitch = clampf(pitch, MIN_PITCH, MAX_PITCH)


func apply_recoil(pitch_kick: float, yaw_kick: float) -> void:
	pitch = clampf(pitch + pitch_kick, MIN_PITCH, MAX_PITCH)
	yaw += yaw_kick


func get_aim_origin() -> Vector3:
	return _camera.global_position


func get_aim_direction() -> Vector3:
	return -_camera.global_transform.basis.z


func _process(delta: float) -> void:
	if _target == null or not is_instance_valid(_target):
		return
	global_position = _target.global_position + Vector3(0.0, head_height, 0.0)
	rotation.y = yaw
	_pitch_pivot.rotation.x = pitch
	var t := clampf(delta * 12.0, 0.0, 1.0)
	var want_len := aim_distance if aiming else base_distance
	var want_fov := aim_fov if aiming else base_fov
	_arm.spring_length = lerpf(_arm.spring_length, want_len, t)
	_camera.fov = lerpf(_camera.fov, want_fov, t)
	_camera.position.x = lerpf(_camera.position.x, shoulder_offset * (0.9 if aiming else 1.0), t)
	_target.look_yaw = yaw
	_target.look_pitch = pitch
