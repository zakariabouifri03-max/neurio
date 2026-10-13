class_name BlockDB
extends RefCounted
## Data-driven block definitions loaded from res://data/blocks.json.

const DATA_PATH := "res://data/blocks.json"

static var _loaded := false
static var _colors := PackedColorArray()
static var _solid := PackedByteArray()
static var _names: PackedStringArray = PackedStringArray()


static func ensure_loaded() -> void:
	if _loaded:
		return
	_loaded = true
	var text := FileAccess.get_file_as_string(DATA_PATH)
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY or not parsed.has("blocks"):
		push_error("BlockDB: could not parse %s" % DATA_PATH)
		return
	var entries: Array = parsed["blocks"]
	var max_id := 0
	for e in entries:
		max_id = maxi(max_id, int(e["id"]))
	_colors.resize(max_id + 1)
	_solid.resize(max_id + 1)
	_names.resize(max_id + 1)
	for e in entries:
		var id := int(e["id"])
		_colors[id] = Color.html(str(e["color"]))
		_solid[id] = 1 if bool(e["solid"]) else 0
		_names[id] = str(e["name"])


static func color_of(id: int) -> Color:
	ensure_loaded()
	if id < 0 or id >= _colors.size():
		return Color.MAGENTA
	return _colors[id]


static func is_solid(id: int) -> bool:
	ensure_loaded()
	if id < 0 or id >= _solid.size():
		return false
	return _solid[id] == 1


static func name_of(id: int) -> String:
	ensure_loaded()
	if id < 0 or id >= _names.size():
		return "Unknown"
	return _names[id]


static func color_table() -> PackedColorArray:
	ensure_loaded()
	return _colors
