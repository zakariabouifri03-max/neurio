extends Node
## ContentDB - autoload that loads and indexes every JSON data file in res://data.
##
## Gameplay code never reads JSON directly; it asks ContentDB for typed records so
## that a malformed data file produces one clear error instead of scattered nulls.

const DATA_DIR := "res://data"

const FILES := {
	"weapons": "weapons.json",
	"items": "items.json",
	"loot": "loot_tables.json",
	"maps": "maps.json",
	"modes": "modes.json",
	"economy": "economy.json",
	"shop": "shop.json",
	"missions": "missions.json",
}

signal content_loaded
signal content_error(file: String, message: String)

var _raw: Dictionary = {}
var _weapons: Dictionary = {}
var _items: Dictionary = {}
var _modes: Dictionary = {}
var _maps: Dictionary = {}
var _shop_items: Dictionary = {}
var loaded: bool = false

func _ready() -> void:
	load_all()

func load_all() -> void:
	_raw.clear()
	_weapons.clear()
	_items.clear()
	_modes.clear()
	_maps.clear()
	_shop_items.clear()
	for key: String in FILES.keys():
		var path := "%s/%s" % [DATA_DIR, FILES[key]]
		var parsed: Variant = _read_json(path)
		if parsed == null:
			content_error.emit(path, "could not be parsed")
			continue
		_raw[key] = parsed
	_index()
	loaded = true
	content_loaded.emit()

func _read_json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		content_error.emit(path, "missing file")
		return null
	var text := FileAccess.get_file_as_string(path)
	var parsed: Variant = JSON.parse_string(text)
	if parsed == null:
		content_error.emit(path, "invalid JSON")
	return parsed

func _index() -> void:
	for entry: Variant in _list_of("weapons", "weapons"):
		_weapons[entry["id"]] = entry
	for entry: Variant in _list_of("items", "items"):
		_items[entry["id"]] = entry
	for entry: Variant in _list_of("modes", "modes"):
		_modes[entry["id"]] = entry
	for entry: Variant in _list_of("maps", "maps"):
		_maps[entry["id"]] = entry
	for entry: Variant in _list_of("shop", "items"):
		_shop_items[entry["id"]] = entry

func _list_of(section: String, key: String) -> Array:
	var blob: Variant = _raw.get(section)
	if typeof(blob) != TYPE_DICTIONARY:
		return []
	var list: Variant = (blob as Dictionary).get(key)
	if typeof(list) != TYPE_ARRAY:
		return []
	return list as Array

func section(name: String) -> Dictionary:
	var blob: Variant = _raw.get(name)
	return blob if typeof(blob) == TYPE_DICTIONARY else {}

# ------------------------------------------------------------------ weapons
func weapon_ids() -> Array:
	return _weapons.keys()

func weapon(id: String) -> Dictionary:
	return _weapons.get(id, {})

func has_weapon(id: String) -> bool:
	return _weapons.has(id)

func weapons_in_category(category: String) -> Array:
	var out: Array = []
	for id: String in _weapons.keys():
		if _weapons[id].get("category", "") == category:
			out.append(_weapons[id])
	return out

func weapons_for_rarity_zone(tier: String) -> Array:
	var pool: Array = section("loot").get("weapon_pool_by_zone", {}).get(tier, [])
	var out: Array = []
	for id: String in pool:
		if _weapons.has(id):
			out.append(_weapons[id])
	return out

# -------------------------------------------------------------------- items
func item(id: String) -> Dictionary:
	return _items.get(id, {})

func item_ids() -> Array:
	return _items.keys()

func items_of_kind(kind: String) -> Array:
	var out: Array = []
	for id: String in _items.keys():
		if _items[id].get("kind", "") == kind:
			out.append(_items[id])
	return out

func ammo_item_for_weapon(weapon_id: String) -> String:
	for id: String in _items.keys():
		var entry: Dictionary = _items[id]
		if entry.get("kind", "") == "ammo" and weapon_id in entry.get("weapons", []):
			return id
	return ""

# -------------------------------------------------------------------- modes
func mode(id: String) -> Dictionary:
	return _modes.get(id, {})

func mode_ids() -> Array:
	return _modes.keys()

func mode_variants(id: String) -> Array:
	return mode(id).get("variants", [])

func default_map_for_mode(mode_id: String) -> String:
	return section("maps").get("default_map_by_mode", {}).get(mode_id, "emerald_island")

# --------------------------------------------------------------------- maps
func map_data(id: String) -> Dictionary:
	return _maps.get(id, {})

func map_ids() -> Array:
	return _maps.keys()

func maps_for_mode(mode_id: String) -> Array:
	var out: Array = []
	for id: String in _maps.keys():
		if mode_id in _maps[id].get("mode_tags", []):
			out.append(_maps[id])
	return out

func place(map_id: String, place_id: String) -> Dictionary:
	for entry: Variant in map_data(map_id).get("places", []):
		if entry.get("id", "") == place_id:
			return entry
	return {}

## World-space position (in blocks) of a named place centre.
func place_center(map_id: String, place_id: String) -> Vector3:
	var entry: Dictionary = place(map_id, place_id)
	var center: Array = entry.get("center", [0, 0])
	if center.size() < 2:
		return Vector3.ZERO
	return Vector3(float(center[0]), 0.0, float(center[1]))

# --------------------------------------------------------------------- shop
func shop_item(id: String) -> Dictionary:
	return _shop_items.get(id, {})

func shop_item_ids() -> Array:
	return _shop_items.keys()

func shop_category(id: String) -> Array:
	var out: Array = []
	for key: String in _shop_items.keys():
		if _shop_items[key].get("category", "") == id:
			out.append(_shop_items[key])
	return out

func shop_categories() -> Array:
	return section("shop").get("meta", {}).get("categories", [])

func default_owned() -> Array:
	return section("shop").get("meta", {}).get("default_owned", [])

# ----------------------------------------------------------------- economy
func economy() -> Dictionary:
	return section("economy")

func currency_name(currency_id: String) -> String:
	return economy().get("currencies", {}).get(currency_id, {}).get("name", currency_id)

# ---------------------------------------------------------------- missions
func missions_section() -> Dictionary:
	return section("missions")

func daily_missions() -> Array:
	return missions_section().get("daily", [])

func weekly_missions() -> Array:
	return missions_section().get("weekly", [])

func achievements() -> Array:
	return missions_section().get("achievements", [])

func events() -> Array:
	return missions_section().get("events", [])

## Returns the currently running seasonal event, or an empty dictionary.
## Online play passes the server date so limited-time rewards cannot be unlocked
## by changing the device clock.
func active_event(now_date: String = "") -> Dictionary:
	var today := now_date
	if today.is_empty():
		today = Time.get_date_string_from_system()
	for entry: Variant in events():
		var event: Dictionary = entry
		var starts: String = str(event.get("starts", ""))
		var ends: String = str(event.get("ends", ""))
		if today >= starts and today <= ends:
			return event
	return {}

func loot_tables() -> Dictionary:
	return section("loot")

func armor_tier(tier: int) -> Dictionary:
	var tiers: Dictionary = section("items").get("armor_tiers", {})
	return tiers.get(str(tier), tiers.get("0", {"reduction": 0.0, "max": 0}))
