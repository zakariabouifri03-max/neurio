class_name SaveFile
extends RefCounted
## Versioned, atomic JSON persistence helper.
##
## - Writes go to "<path>.tmp" first, are re-parsed to verify, then the previous
##   file is kept as "<path>.bak" and the temp file is renamed into place.
## - Reads fall back to the ".bak" copy when the primary file is corrupt, and a
##   corrupt primary file is preserved as "<path>.corrupt" for debugging.
## - Callers never overwrite a valid save with an incomplete payload: the
##   write is only performed when the payload serialises and re-parses cleanly.

enum ReadStatus { OK, MISSING, CORRUPT_RECOVERED, CORRUPT_DEFAULTS }


static func read_json(path: String) -> Dictionary:
	## Returns { "status": ReadStatus, "data": Dictionary }.
	if not FileAccess.file_exists(path):
		var bak_only := _try_read(path + ".bak")
		if not bak_only.is_empty():
			return {"status": ReadStatus.CORRUPT_RECOVERED, "data": bak_only}
		return {"status": ReadStatus.MISSING, "data": {}}

	var primary := _try_read(path)
	if not primary.is_empty():
		return {"status": ReadStatus.OK, "data": primary}

	# Primary is unreadable; preserve it for inspection and try the backup.
	_preserve_corrupt(path)
	var backup := _try_read(path + ".bak")
	if not backup.is_empty():
		return {"status": ReadStatus.CORRUPT_RECOVERED, "data": backup}
	return {"status": ReadStatus.CORRUPT_DEFAULTS, "data": {}}


static func write_json(path: String, data: Dictionary) -> Error:
	var text := JSON.stringify(data, "\t")
	if text.is_empty() or _parse(text).is_empty():
		return ERR_INVALID_DATA
	var tmp_path := path + ".tmp"
	var f := FileAccess.open(tmp_path, FileAccess.WRITE)
	if f == null:
		return FileAccess.get_open_error()
	f.store_string(text)
	f.flush()
	f.close()
	# Verify what was actually written before touching the real save.
	var verify := _try_read(tmp_path)
	if verify.is_empty():
		var cleanup := DirAccess.open("user://")
		if cleanup != null:
			cleanup.remove(tmp_path.get_file())
		return ERR_FILE_CORRUPT
	var da := DirAccess.open("user://")
	if da == null:
		return ERR_CANT_OPEN
	var file_name := path.get_file()
	var tmp_name := tmp_path.get_file()
	var bak_name := file_name + ".bak"
	if da.file_exists(file_name):
		if da.file_exists(bak_name):
			da.remove(bak_name)
		da.rename(file_name, bak_name)
	return da.rename(tmp_name, file_name)


static func _try_read(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return {}
	var text := f.get_as_text()
	f.close()
	return _parse(text)


static func _parse(text: String) -> Dictionary:
	if text.strip_edges().is_empty():
		return {}
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		return {}
	return parsed


static func _preserve_corrupt(path: String) -> void:
	var da := DirAccess.open("user://")
	if da == null:
		return
	var target := path.get_file() + ".corrupt"
	if da.file_exists(target):
		da.remove(target)
	da.rename(path.get_file(), target)
