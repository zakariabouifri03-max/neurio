class_name InputRouter
extends Node
## Feeds one PlayerController from whatever input device is in use.
##
## On Android the touch layer owns movement, look and actions; on desktop the
## keyboard/mouse mapping does, and a connected gamepad works through the same
## actions.  Both paths write the same fields on the player, so gameplay code
## never needs to know which device is active, and a device can be swapped
## mid-match (phone docked to a keyboard, for example).

signal action_fired(action: String)

const LOOK_SCALE := 0.0022

var player: PlayerController = null
var touch: TouchControls = null
var mouse_captured: bool = false
var last_device: String = "touch"

var _mouse_look: Vector2 = Vector2.ZERO

func bind(target: PlayerController, touch_controls: TouchControls) -> void:
	player = target
	touch = touch_controls
	if touch != null:
		touch.action.connect(_on_touch_action)
		last_device = "touch" if GameConfig.is_mobile else "keyboard"
	set_process(true)

func _input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and mouse_captured:
		_mouse_look += (event as InputEventMouseMotion).relative
		last_device = "keyboard"
	elif event is InputEventKey and (event as InputEventKey).pressed:
		last_device = "keyboard"
	elif event is InputEventJoypadButton and (event as InputEventJoypadButton).pressed:
		last_device = "gamepad"

func _process(_delta: float) -> void:
	if player == null or not is_instance_valid(player):
		return
	if not player.alive:
		player.move_input = Vector2.ZERO
		player.weapons.trigger_held = false
		return
	var use_touch := touch != null and touch.enabled and last_device == "touch"
	var move := Vector2.ZERO
	var look := Vector2.ZERO
	if use_touch:
		move = touch.movement()
		look = touch.consume_look()
		player.sprint_held = touch.sprint_held \
			or Input.is_action_pressed("sprint") or move.length() > 0.94
		player.aim_held = touch.aim_held
		player.crouch_held = touch.crouch_held or Input.is_action_pressed("crouch")
		player.weapons.trigger_held = touch.fire_held or Input.is_action_pressed("fire")
	else:
		move = Input.get_vector("move_left", "move_right", "move_forward", "move_back")
		# Keyboard reports forward as -1 in Y, which is exactly what MoveLogic wants.
		look = _mouse_look * LOOK_SCALE / maxf(0.2, float(Settings.control_value(
			"sensitivity", GameConfig.CAMERA["default_sensitivity"])) * 55.0)
		player.sprint_held = Input.is_action_pressed("sprint")
		player.aim_held = Input.is_action_pressed("aim")
		player.crouch_held = Input.is_action_pressed("crouch")
		player.weapons.trigger_held = Input.is_action_pressed("fire")
	_mouse_look = Vector2.ZERO
	if touch != null:
		touch.mouse_input_enabled = not mouse_captured
	player.move_input = move
	player.look_delta = look
	if Input.is_action_just_pressed("jump"):
		player.jump_queued = true
	if Input.is_action_just_pressed("reload"):
		player.weapons.start_reload()
	if Input.is_action_just_pressed("interact"):
		player.interact()
	if Input.is_action_just_pressed("weapon_next"):
		player.weapons.next_slot()
	if Input.is_action_just_pressed("weapon_prev"):
		player.weapons.previous_slot()
	if Input.is_action_just_pressed("slot_primary"):
		player.weapons.switch_to(WeaponController.SLOT_PRIMARY)
	if Input.is_action_just_pressed("slot_secondary"):
		player.weapons.switch_to(WeaponController.SLOT_SECONDARY)
	if Input.is_action_just_pressed("slot_melee"):
		player.weapons.switch_to(WeaponController.SLOT_MELEE)
	if Input.is_action_just_pressed("slot_throwable"):
		player.weapons.switch_to(WeaponController.SLOT_THROWABLE)
	if Input.is_action_just_pressed("use_heal"):
		player.inventory.use_heal()
	if Input.is_action_just_pressed("toggle_build") and player.building != null:
		player.building.cycle_piece()
	# Hold-to-build on both devices.
	if player.building != null:
		var build_held := Input.is_action_pressed("toggle_build") \
			or (use_touch and touch != null and touch.is_build_held())
		player.building.tick_hold(get_process_delta_time(), build_held)

## Touch buttons that are not continuous state arrive as discrete actions.
func _on_touch_action(action: String) -> void:
	if player == null or not is_instance_valid(player):
		return
	# Touching the screen switches control back from keyboard to touch.
	last_device = "touch"
	if action.ends_with("_repeat") or action.contains("_repeat:"):
		_handle_repeat(action)
		return
	match action:
		"jump":
			player.jump_queued = true
		"reload":
			player.weapons.start_reload()
		"interact":
			player.interact()
		"heal":
			var result := player.inventory.use_heal()
			if not result.succeeded():
				player.inventory.use_armor("shield_cell")
		"weapon":
			player.weapons.next_slot()
		"melee":
			player.weapons.switch_to(WeaponController.SLOT_MELEE)
			player.weapons.try_fire()
			player.weapons.switch_to(WeaponController.SLOT_SECONDARY)
		"grenade":
			player.weapons.switch_to(WeaponController.SLOT_THROWABLE)
			player.weapons.try_fire()
		"build":
			var building := player.building
			if building != null:
				building.try_place()
		"tap_fire":
			player.weapons.try_fire()
	action_fired.emit(action)

func _handle_repeat(action: String) -> void:
	var id := action.split(":")[0].replace("_repeat", "")
	match id:
		"build":
			if player.building != null:
				player.building.cycle_material()
		"weapon":
			player.weapons.next_slot()
