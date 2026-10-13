extends Node
## Autoload "GameState": scene navigation and the current match configuration.
##
## Only UI/navigation state lives here. Match rules and combat state belong to
## the match scripts so they can later run on a dedicated server unchanged.

signal scene_change_requested(path: String)

## Selected offline configuration, set by the main menu before entering a match.
var match_config: Dictionary = {
	"mode": "training",
	"map": "emerald_island",
	"bot_difficulty": "normal",
	"bot_count": 1,
}


func goto_scene(path: String) -> void:
	scene_change_requested.emit(path)
	var err := get_tree().change_scene_to_file(path)
	if err != OK:
		push_error("GameState: failed to change scene to %s (error %d)" % [path, err])


func goto_main_menu() -> void:
	goto_scene(GameConstants.SCENE_MAIN_MENU)


func start_training(difficulty: String = "normal") -> void:
	match_config = {
		"mode": "training",
		"map": "emerald_island",
		"bot_difficulty": difficulty,
		"bot_count": 1,
	}
	goto_scene(GameConstants.SCENE_TRAINING)
