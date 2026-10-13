class_name MatchState
extends RefCounted
## Shared, read-only view of the active match settings.
##
## The match manager writes this once when a match starts; gameplay code (damage
## rules, HUD, bots, building) reads it instead of each holding its own copy,
## which keeps "friendly fire" and "is building allowed" consistent everywhere.

static var _settings: Dictionary = {}

static func set_settings(settings: Dictionary) -> void:
	_settings = settings.duplicate(true)

static func settings() -> Dictionary:
	return _settings

static func get_value(key: String, fallback: Variant = null) -> Variant:
	return _settings.get(key, fallback)

static func clear() -> void:
	_settings = {}

static func friendly_fire_enabled() -> bool:
	return bool(_settings.get("friendly_fire", false))

static func building_enabled() -> bool:
	var building: Dictionary = _settings.get("building", {})
	return bool(building.get("allowed", false))

static func max_blocks_per_player() -> int:
	var building: Dictionary = _settings.get("building", {})
	return int(building.get("max_blocks_per_player", 0))
