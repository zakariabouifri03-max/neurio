extends Node
## Entry scene. Starts the dedicated server (--server) or opens the main menu.

func _ready() -> void:
	if Game.dedicated:
		Engine.max_fps = 60
		Net.start_dedicated(Game.server_port)
		return
	get_tree().root.theme = UI.build_theme()
	call_deferred("_go")

func _go() -> void:
	if Game.autoplay.begins_with("match:"):
		Game.start_offline(Game.autoplay.substr(6))
		return
	get_tree().change_scene_to_file("res://scenes/main_menu.tscn")
