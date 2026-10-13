extends Node
## Missions - daily, weekly, achievement and seasonal-event progress.
##
## Gameplay reports plain metrics ("eliminations", 1); Missions decides which
## missions that satisfies and pays out through Economy (which guarantees each
## reward can only be granted once).

signal mission_progressed(mission_id: String, current: int, target: int)
signal mission_completed(mission_id: String)
signal mission_claimed(mission_id: String, reward: Dictionary)

const SCOPES := ["daily", "weekly", "achievements", "events"]

var auto_claim: bool = true

func _ready() -> void:
	refresh_cycles()

func _state(scope: String) -> Dictionary:
	var state: Dictionary = SaveManager.data.mission_state
	if not state.has(scope) or typeof(state[scope]) != TYPE_DICTIONARY:
		state[scope] = {}
	return state[scope]

func _progress_map(scope: String) -> Dictionary:
	var scope_state := _state(scope)
	if not scope_state.has("progress") or typeof(scope_state["progress"]) != TYPE_DICTIONARY:
		scope_state["progress"] = {}
	return scope_state["progress"]

func _claimed_list(scope: String) -> Array:
	var scope_state := _state(scope)
	if not scope_state.has("claimed") or typeof(scope_state["claimed"]) != TYPE_ARRAY:
		scope_state["claimed"] = []
	return scope_state["claimed"]

## Rolls daily / weekly / event cycles when the calendar day or week changed.
## The server clock wins when the player is online so event rewards cannot be
## unlocked by changing the device date.
func refresh_cycles() -> void:
	var today := NetworkManager.authoritative_date()
	if today.is_empty():
		today = Time.get_date_string_from_system()
	var week := "%s-W%d" % [today.substr(0, 4), _iso_week_number()]
	var daily_state := _state("daily")
	if str(daily_state.get("date", "")) != today:
		daily_state["date"] = today
		daily_state["progress"] = {}
		daily_state["claimed"] = []
	var weekly_state := _state("weekly")
	if str(weekly_state.get("date", "")) != week:
		weekly_state["date"] = week
		weekly_state["progress"] = {}
		weekly_state["claimed"] = []
	SaveManager.mark_dirty()

func _iso_week_number() -> int:
	var date := Time.get_date_dict_from_system()
	var unix := int(Time.get_unix_time_from_datetime_dict(date))
	return int((unix / 604800.0)) % 53

## All definitions that are currently active, as {scope, definition} pairs.
func active_definitions() -> Array:
	var out: Array = []
	for entry: Variant in ContentDB.daily_missions():
		out.append({"scope": "daily", "def": entry})
	for entry: Variant in ContentDB.weekly_missions():
		out.append({"scope": "weekly", "def": entry})
	for entry: Variant in ContentDB.achievements():
		out.append({"scope": "achievements", "def": entry})
	var event: Dictionary = ContentDB.active_event(NetworkManager.authoritative_date())
	for entry: Variant in event.get("missions", []):
		out.append({"scope": "events", "def": entry})
	return out

func find_definition(mission_id: String) -> Dictionary:
	for pair: Variant in active_definitions():
		var entry: Dictionary = pair
		if str((entry["def"] as Dictionary).get("id", "")) == mission_id:
			return entry
	return {}

## Adds progress to every mission watching `metric`.
func report(metric: String, amount: int = 1, absolute: bool = false) -> void:
	if amount <= 0 and not absolute:
		return
	refresh_cycles()
	for pair: Variant in active_definitions():
		var entry: Dictionary = pair
		var definition: Dictionary = entry["def"]
		if str(definition.get("metric", "")) != metric:
			continue
		var scope: String = entry["scope"]
		var mission_id: String = str(definition.get("id", ""))
		if mission_id.is_empty():
			continue
		var progress := _progress_map(scope)
		var current: int = int(progress.get(mission_id, 0))
		var target: int = int(definition.get("target", 1))
		current = amount if absolute else current + amount
		progress[mission_id] = current
		mission_progressed.emit(mission_id, mini(current, target), target)
		if current >= target and not _claimed_list(scope).has(mission_id):
			mission_completed.emit(mission_id)
			if auto_claim:
				claim(mission_id)
	SaveManager.mark_dirty()

func progress(mission_id: String) -> int:
	var entry := find_definition(mission_id)
	if entry.is_empty():
		return 0
	return int(_progress_map(str(entry["scope"])).get(mission_id, 0))

func target(mission_id: String) -> int:
	var entry := find_definition(mission_id)
	if entry.is_empty():
		return 1
	return int((entry["def"] as Dictionary).get("target", 1))

func is_claimed(mission_id: String) -> bool:
	var entry := find_definition(mission_id)
	if entry.is_empty():
		return false
	return _claimed_list(str(entry["scope"])).has(mission_id)

func is_complete(mission_id: String) -> bool:
	return progress(mission_id) >= target(mission_id)

## Claims a finished mission exactly once and pays its reward.
func claim(mission_id: String) -> GameResult:
	var entry := find_definition(mission_id)
	if entry.is_empty():
		return GameResult.fail(GameResult.Code.INVALID, "unknown mission")
	var scope: String = entry["scope"]
	var definition: Dictionary = entry["def"]
	if not is_complete(mission_id):
		return GameResult.fail(GameResult.Code.NOT_READY, "mission not finished yet")
	var claimed := _claimed_list(scope)
	if claimed.has(mission_id):
		return GameResult.fail(GameResult.Code.DUPLICATE, "already claimed")
	var reward: Dictionary = definition.get("reward", {})
	var result := Economy.grant_mission_reward(mission_id, reward)
	if not result.succeeded():
		return result
	claimed.append(mission_id)
	Progression.add_xp(int(reward.get("xp", 0)))
	if scope == "daily":
		report("daily_missions_completed", 1)
	mission_claimed.emit(mission_id, reward)
	SaveManager.mark_dirty()
	return result

func claim_all_ready() -> int:
	var count := 0
	for pair: Variant in active_definitions():
		var mission_id: String = str(((pair as Dictionary)["def"] as Dictionary).get("id", ""))
		if mission_id.is_empty():
			continue
		if is_complete(mission_id) and not is_claimed(mission_id):
			if claim(mission_id).succeeded():
				count += 1
	return count

## Summary used by the missions screen.
func summary(scope: String) -> Array:
	var out: Array = []
	for pair: Variant in active_definitions():
		var entry: Dictionary = pair
		if str(entry["scope"]) != scope:
			continue
		var definition: Dictionary = entry["def"]
		var id: String = str(definition.get("id", ""))
		out.append({
			"id": id,
			"name": str(definition.get("name", id)),
			"description": str(definition.get("description", "")),
			"progress": progress(id),
			"target": target(id),
			"claimed": is_claimed(id),
			"reward": definition.get("reward", {}),
		})
	return out

func claimable_count() -> int:
	var count := 0
	for scope: String in SCOPES:
		for row: Variant in summary(scope):
			var entry: Dictionary = row
			if bool(entry["claimed"]) == false and int(entry["progress"]) >= int(entry["target"]):
				count += 1
	return count
