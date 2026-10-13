extends Node
## Starts the end-to-end flow test. The driver is added to the window root (not under
## the current scene) so it survives the scene changes it is testing.

func _ready() -> void:
	var driver := Node.new()
	driver.name = "FlowDriver"
	driver.set_script(load("res://tests/flow_driver.gd"))
	get_tree().root.add_child.call_deferred(driver)
	get_tree().change_scene_to_file.call_deferred("res://scenes/menus/main_menu.tscn")
