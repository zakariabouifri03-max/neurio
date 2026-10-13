class_name AppRoot
extends Node
## Application root: owns the screen stack and is the only node that survives a
## scene change.
##
## Screens are instantiated as children of `Screen` instead of using
## `change_scene_to_file`, so autoloads, the audio director and the router keep
## their state and a rematch is instant.  The root also applies graphics settings
## and the current theme on start-up, and it is what Lobby/GameRouter talk to.

const MENU_SCENE := "res://scenes/menus/main_menu.tscn"
const MATCH_SCENE := "res://scenes/match.tscn"

var current_screen: Node = null
var last_match_settings: Dictionary = {}

@onready var screen_holder: Node = $Screen

func _ready() -> void:
	GameRouter.register(self)
	Lobby.set_router(self)
	UiKit.apply_theme(self)
	Settings.apply_graphics()
	AudioDirector.apply_audio_settings()
	AudioDirector.play_music("music_menu")
	_ensure_input()
	goto_menu()

func _ensure_input() -> void:
	# Touch emulation from the mouse keeps the game testable on desktop.
	if GameConfig.is_mobile:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

# ------------------------------------------------------------------ navigation
func goto_menu() -> void:
	_swap_screen(MENU_SCENE, Callable())

func goto(path: String) -> void:
	_swap_screen(path, Callable())

func goto_match(settings: Dictionary) -> void:
	last_match_settings = settings.duplicate(true)
	_swap_screen(MATCH_SCENE, func(screen: Node) -> void:
		var match_scene := screen as MatchScene
		if match_scene == null:
			return
		var result := match_scene.start_with(settings)
		if not result.succeeded():
			push_error("Match failed to start: %s" % result.error_text())
			goto_menu())

func _swap_screen(path: String, configure: Callable) -> void:
	if current_screen != null and is_instance_valid(current_screen):
		current_screen.queue_free()
	current_screen = null
	var packed: PackedScene = load(path)
	if packed == null:
		push_error("AppRoot: missing scene %s" % path)
		return
	var screen := packed.instantiate()
	screen_holder.add_child(screen)
	current_screen = screen
	if configure.is_valid():
		configure.call(screen)

func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		Settings.persist()
		SaveManager.save_game()
		get_tree().quit()
