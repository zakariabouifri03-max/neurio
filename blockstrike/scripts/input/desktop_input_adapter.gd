class_name DesktopInputAdapter
extends Node
## Maps keyboard and mouse onto PlayerInput for desktop testing.
## Android gameplay uses TouchControls; this exists so the game is also playable
## with a keyboard during development. Mouse capture is only used in-match.

var input: PlayerInput
var enabled := true
var _mouse_sensitivity := 0.0025


func _unhandled_input(event: InputEvent) -> void:
	if not enabled or input == null:
		return
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var m := event as InputEventMouseMotion
		# Radians per pixel; the camera applies the user's sensitivity on top.
		input.look_delta += m.relative * _mouse_sensitivity
	elif event is InputEventKey:
		var k := event as InputEventKey
		if not k.pressed or k.echo:
			return
		if k.physical_keycode == KEY_SPACE:
			input.request_jump()
		elif k.physical_keycode == KEY_R:
			input.request_reload()
		elif k.physical_keycode == KEY_E:
			input.request_interact()


func poll() -> void:
	## Call once per physics frame before the controller reads its input.
	if not enabled or input == null:
		return
	var x := 0.0
	var y := 0.0
	if Input.is_physical_key_pressed(KEY_D):
		x += 1.0
	if Input.is_physical_key_pressed(KEY_A):
		x -= 1.0
	if Input.is_physical_key_pressed(KEY_W):
		y += 1.0
	if Input.is_physical_key_pressed(KEY_S):
		y -= 1.0
	input.move = Vector2(x, y).limit_length(1.0)
	input.sprint_held = Input.is_physical_key_pressed(KEY_SHIFT)
	input.crouch_held = Input.is_physical_key_pressed(KEY_C) or Input.is_physical_key_pressed(KEY_CTRL)
	input.fire_held = Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)
	input.aim_held = Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT)
