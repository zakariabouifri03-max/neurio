extends Node
## End-to-end flow test: title screen -> Training Ground -> Escape pauses -> Escape resumes
## -> Return to main menu -> title screen again. Uses real button signals and real
## key events, not internal calls.

const MENU := "res://scenes/menus/main_menu.tscn"
const TRAINING := "res://scenes/match/training_ground.tscn"

var _passed := 0
var _failed := 0
var _lines: PackedStringArray = []


func _ready() -> void:
	_run()


func _run() -> void:
	var on_menu := await _wait_for_scene(MENU, 600)
	_check("title screen loads at startup", on_menu)
	if not on_menu:
		_finish()
		return
	var training_btn := _find_button(get_tree().current_scene, "Training Ground")
	_check("title screen has a Training Ground button", training_btn != null)
	training_btn.pressed.emit()
	await get_tree().process_frame
	var normal_btn := _find_button(get_tree().current_scene, "Normal bot")
	_check("difficulty picker offers a Normal bot", normal_btn != null)
	if normal_btn == null:
		_finish()
		return
	normal_btn.pressed.emit()

	var in_training := await _wait_for_scene(TRAINING, 600)
	_check("starting Training Ground loads the match scene", in_training)
	if not in_training:
		_finish()
		return
	var match_scene := get_tree().current_scene
	var running := await _wait_for_flag(match_scene, "_running", 3600)
	_check("match finishes building the island and starts", running)
	if not running:
		_finish()
		return

	_press_key(KEY_ESCAPE)
	await get_tree().process_frame
	_check("Escape pauses the match", bool(match_scene.get("_paused")) and get_tree().paused)
	_check("pause menu is visible while paused", match_scene.get("_pause").visible)

	_press_key(KEY_ESCAPE)
	await get_tree().process_frame
	_check("Escape resumes the match", not bool(match_scene.get("_paused")) and not get_tree().paused)

	_press_key(KEY_ESCAPE)
	await get_tree().process_frame
	var resume_btn := _find_button(match_scene, "Resume")
	_check("pause menu has a Resume button", resume_btn != null)
	if resume_btn != null:
		resume_btn.pressed.emit()
	await get_tree().process_frame
	_check("Resume button unpauses", not get_tree().paused)

	_press_key(KEY_ESCAPE)
	await get_tree().process_frame
	var back_btn := _find_button(match_scene, "Return to main menu")
	_check("pause menu has a Return to main menu button", back_btn != null)
	if back_btn != null:
		back_btn.pressed.emit()
	var back_on_menu := await _wait_for_scene(MENU, 600)
	_check("Return to main menu goes back to the title screen", back_on_menu)
	_check("game is not left paused on the title screen", not get_tree().paused)
	_finish()


func _press_key(keycode: Key) -> void:
	var ev := InputEventKey.new()
	ev.keycode = keycode
	ev.physical_keycode = keycode
	ev.pressed = true
	get_viewport().push_input(ev)


func _wait_for_scene(path: String, max_frames: int) -> bool:
	for i in range(max_frames):
		var scene := get_tree().current_scene
		if scene != null and scene.scene_file_path == path:
			await get_tree().process_frame
			return true
		await get_tree().process_frame
	return false


func _wait_for_flag(node: Node, flag: String, max_frames: int) -> bool:
	for i in range(max_frames):
		if bool(node.get(flag)):
			return true
		await get_tree().process_frame
	return false


func _find_button(root: Node, text: String) -> Button:
	if root == null:
		return null
	if root is Button and (root as Button).text.begins_with(text):
		return root as Button
	for child in root.get_children():
		var found := _find_button(child, text)
		if found != null:
			return found
	return null


func _check(name: String, ok: bool) -> void:
	if ok:
		_passed += 1
		_lines.append("PASS  %s" % name)
	else:
		_failed += 1
		_lines.append("FAIL  %s" % name)


func _finish() -> void:
	print("")
	for line in _lines:
		print(line)
	print("")
	print("FLOW RESULT: %d passed, %d failed" % [_passed, _failed])
	get_tree().quit(0 if _failed == 0 else 1)
