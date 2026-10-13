extends Node
## Compiles every GDScript in the project and reports failures.
func run() -> bool:
	var ok := true
	var files := []
	_collect("res://scripts", files)
	_collect("res://tests", files)
	for f in files:
		var s = load(f)
		if s == null or not (s is GDScript) or not (s as GDScript).can_instantiate():
			print("PARSE FAIL: ", f)
			ok = false
	print("checked %d scripts" % files.size())
	await get_tree().process_frame
	return ok

func _collect(dir: String, out: Array) -> void:
	var d := DirAccess.open(dir)
	if d == null:
		return
	for f in d.get_files():
		if f.ends_with(".gd"):
			out.append(dir + "/" + f)
	for sub in d.get_directories():
		_collect(dir + "/" + sub, out)
