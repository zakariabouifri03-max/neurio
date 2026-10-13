class_name PlayerInput
extends RefCounted
## Device-independent intent for one character.
##
## Touch controls, keyboard/mouse and AI bots all write into this object; the
## character controller only ever reads from it. This keeps bots and human players
## on exactly the same movement and combat code path.

## Movement intent: x = strafe right, y = forward. Length is clamped to 1.
var move := Vector2.ZERO
## Camera look delta accumulated since the camera last consumed it (radians).
var look_delta := Vector2.ZERO
var fire_held := false
var aim_held := false
var sprint_held := false
var crouch_held := false

## Edge-triggered actions. Consumed by the controller via consume_*().
var _jump_pressed := false
var _reload_pressed := false
var _interact_pressed := false


func consume_look() -> Vector2:
	var v := look_delta
	look_delta = Vector2.ZERO
	return v


func request_jump() -> void:
	_jump_pressed = true


func request_reload() -> void:
	_reload_pressed = true


func request_interact() -> void:
	_interact_pressed = true


func consume_jump() -> bool:
	var v := _jump_pressed
	_jump_pressed = false
	return v


func consume_reload() -> bool:
	var v := _reload_pressed
	_reload_pressed = false
	return v


func consume_interact() -> bool:
	var v := _interact_pressed
	_interact_pressed = false
	return v


func clear_edges() -> void:
	_jump_pressed = false
	_reload_pressed = false
	_interact_pressed = false


func reset() -> void:
	move = Vector2.ZERO
	look_delta = Vector2.ZERO
	fire_held = false
	aim_held = false
	sprint_held = false
	crouch_held = false
	clear_edges()
