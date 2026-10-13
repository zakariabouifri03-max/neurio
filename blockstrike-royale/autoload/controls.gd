extends Node
## Unified input layer. Keyboard/mouse and the touch overlay both write into
## this singleton; gameplay scripts only read from here. Nothing else touches
## raw input for gameplay, which keeps desktop and Android behaviour identical.

## Joystick / keyboard movement: x = strafe right, y = forward.
var touch_move: Vector2 = Vector2.ZERO
var touch_sprint: bool = false
## Accumulated look movement (screen pixels) since the last consume_look().
var look_delta: Vector2 = Vector2.ZERO
var fire_held: bool = false
var aim_held: bool = false
## Gameplay input is ignored while menus / overlays are open.
var enabled: bool = false

var _pressed: Dictionary = {}


func press(action: String) -> void:
	_pressed[action] = true


func consume(action: String) -> bool:
	if _pressed.get(action, false):
		_pressed.erase(action)
		return true
	return false


func consume_look() -> Vector2:
	var d := look_delta
	look_delta = Vector2.ZERO
	return d


func move_vec() -> Vector2:
	if not enabled:
		return Vector2.ZERO
	var k := Vector2.ZERO
	if Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP):
		k.y += 1.0
	if Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN):
		k.y -= 1.0
	if Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT):
		k.x += 1.0
	if Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT):
		k.x -= 1.0
	if k.length() > 1.0:
		k = k.normalized()
	if k.length() > touch_move.length():
		return k
	return touch_move


func sprint_requested() -> bool:
	if not enabled:
		return false
	return touch_sprint or Input.is_physical_key_pressed(KEY_SHIFT)


func reset() -> void:
	touch_move = Vector2.ZERO
	touch_sprint = false
	look_delta = Vector2.ZERO
	fire_held = false
	aim_held = false
	_pressed.clear()


func _input(event: InputEvent) -> void:
	# Pause and inventory keys always work, even while gameplay input is disabled.
	if event is InputEventKey and event.pressed and not event.echo:
		if event.physical_keycode == KEY_ESCAPE:
			press("pause")
			return
		if event.physical_keycode == KEY_TAB or event.physical_keycode == KEY_I:
			press("bag")
			return
	if not enabled:
		return
	if event is InputEventMouseMotion:
		if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED or aim_held:
			look_delta += event.relative
	elif event is InputEventMouseButton:
		# On touch devices the touch overlay owns fire/aim; ignore emulated mouse.
		if DisplayServer.is_touchscreen_available():
			return
		if event.button_index == MOUSE_BUTTON_LEFT:
			fire_held = event.pressed
			if event.pressed:
				press("fire")
		elif event.button_index == MOUSE_BUTTON_RIGHT:
			aim_held = event.pressed
	elif event is InputEventKey and event.pressed and not event.echo:
		match event.physical_keycode:
			KEY_SPACE:
				press("jump")
			KEY_C:
				press("crouch")
			KEY_R:
				press("reload")
			KEY_Q:
				press("switch")
			KEY_E:
				press("use")
			KEY_F:
				press("heal")
			KEY_B:
				press("build")
			KEY_1:
				press("slot_0")
			KEY_2:
				press("slot_1")
			KEY_3:
				press("slot_2")
