extends Node
## Headless test runner: godot --headless --path . res://tests/test_runner.tscn -- --suite=<name>
func _ready() -> void:
	var suite := "world"
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--suite="):
			suite = a.substr(8)
	var t = load("res://tests/suite_%s.gd" % suite)
	if t == null or not (t is GDScript) or not (t as GDScript).can_instantiate():
		push_error("missing suite " + suite)
		get_tree().quit(2)
		return
	var s: Node = t.new()
	add_child(s)
	var ok: bool = await s.run()
	print("SUITE %s: %s" % [suite, "PASS" if ok else "FAIL"])
	get_tree().quit(0 if ok else 1)
