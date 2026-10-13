extends Node
## SaveManager - versioned, atomic, corruption tolerant persistence.
##
## Writes go to a temporary file first and are then renamed, so a crash mid-save
## can never destroy a good save.  A checksum detects truncated or hand-edited
## files; a damaged file is preserved as `savegame.corrupt.json` for support.

const SAVE_PATH := "user://savegame.json"
const BACKUP_PATH := "user://savegame.backup.json"
const CORRUPT_PATH := "user://savegame.corrupt.json"
const AUTOSAVE_INTERVAL := 20.0

signal saved()
signal loaded()
signal save_failed(reason: String)
signal save_recovered(backup_path: String)

var data: SaveData = SaveData.defaults()
var dirty: bool = false
var _accum: float = 0.0
var _write_count: int = 0

func _ready() -> void:
	set_process(true)
	load_game()

func _process(delta: float) -> void:
	if not dirty:
		return
	_accum += delta
	if _accum >= 2.0:
		_accum = 0.0
		save_game()

func load_game() -> bool:
	if not FileAccess.file_exists(SAVE_PATH):
		data = SaveData.defaults()
		data.sanitize()
		save_game()
		loaded.emit()
		return true
	var raw: Variant = _read_json(SAVE_PATH)
	if raw == null or not _verify(raw):
		if FileAccess.file_exists(BACKUP_PATH):
			var backup: Variant = _read_json(BACKUP_PATH)
			if backup != null and _verify(backup):
				data = SaveData.from_dict(backup)
				_preserve_corrupt(SAVE_PATH)
				save_recovered.emit(BACKUP_PATH)
				saved.emit()
				loaded.emit()
				return true
		_preserve_corrupt(SAVE_PATH)
		data = SaveData.defaults()
		data.sanitize()
		save_game()
		loaded.emit()
		return false
	data = SaveData.from_dict(raw)
	loaded.emit()
	return true

func save_game() -> bool:
	if FileAccess.file_exists(SAVE_PATH):
		var existing := FileAccess.get_file_as_string(SAVE_PATH)
		if not existing.is_empty():
			var backup := FileAccess.open(BACKUP_PATH, FileAccess.WRITE)
			if backup != null:
				backup.store_string(existing)
				backup.close()
	var payload := data.to_dict()
	payload["checksum"] = _checksum(payload)
	var text := JSON.stringify(payload, " ")
	var file := FileAccess.open(SAVE_PATH + ".tmp", FileAccess.WRITE)
	if file == null:
		save_failed.emit("cannot open save file for writing")
		return false
	file.store_string(text)
	file.close()
	var dir := DirAccess.open("user://")
	if dir == null:
		save_failed.emit("user dir unavailable")
		return false
	if FileAccess.file_exists(SAVE_PATH):
		dir.remove("savegame.json")
	var err := dir.rename("savegame.json.tmp", "savegame.json")
	if err != OK:
		save_failed.emit("rename failed (%d)" % err)
		return false
	dirty = false
	_write_count += 1
	saved.emit()
	return true

func mark_dirty() -> void:
	dirty = true
	_accum = 0.0

func write_count() -> int:
	return _write_count

func reset_progress() -> void:
	var keep_settings: Dictionary = data.settings.duplicate(true)
	var keep_controls: Dictionary = data.controls.duplicate(true)
	data = SaveData.defaults()
	data.settings = keep_settings
	data.controls = keep_controls
	data.sanitize()
	save_game()

func _read_json(path: String) -> Variant:
	var text := FileAccess.get_file_as_string(path)
	if text.is_empty():
		return null
	return JSON.parse_string(text)

func _verify(raw: Variant) -> bool:
	if typeof(raw) != TYPE_DICTIONARY:
		return false
	var payload: Dictionary = raw
	if not payload.has("checksum") or not payload.has("version"):
		return false
	var expected: String = str(payload["checksum"])
	var copy := payload.duplicate(true)
	copy.erase("checksum")
	return _checksum(copy) == expected

## FNV-1a over the canonical JSON form: detects truncation and accidental edits.
func _checksum(payload: Dictionary) -> String:
	var text := JSON.stringify(payload, "", true)
	var hash_val: int = 0x811C9DC5
	for i in text.length():
		hash_val = (hash_val ^ text.unicode_at(i)) & 0xFFFFFFFF
		hash_val = (hash_val * 16777619) & 0xFFFFFFFF
	return "%08x" % hash_val

func _preserve_corrupt(path: String) -> void:
	var text := FileAccess.get_file_as_string(path)
	if text.is_empty():
		return
	var file := FileAccess.open(CORRUPT_PATH, FileAccess.WRITE)
	if file != null:
		file.store_string(text)
		file.close()
