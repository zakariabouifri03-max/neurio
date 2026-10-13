class_name GameRouter
extends Node
## Tiny static router between the app root and the screens it hosts.
##
## The app root (scenes/app.tscn) is the only node that survives a screen change;
## it registers itself here so a match can ask to return to the menu or start a
## rematch without any of the game code depending on the scene layout.  Keeping it
## static avoids adding an autoload for what is one function call in each
## direction; if the root is gone (headless tests, tools) the calls are no-ops.

static var _root: Node = null

static func register(root: Node) -> void:
	_root = root

static func is_available() -> bool:
	return _root != null and is_instance_valid(_root)

static func goto_menu() -> void:
	if is_available() and _root.has_method("goto_menu"):
		_root.call("goto_menu")

static func goto_match(settings: Dictionary) -> void:
	if is_available() and _root.has_method("goto_match"):
		_root.call("goto_match", settings)

static func goto(path: String) -> void:
	if is_available() and _root.has_method("goto"):
		_root.call("goto", path)
