extends Node
## Progression - XP, levels, ranks and lifetime statistics.
##
## Stats recorded here are *local* records of what happened in matches the player
## played.  Ranked rating only moves when a match summary carries
## `server_validated = true`, which offline and bot matches never set.

signal xp_gained(amount: int, total: int)
signal level_up(new_level: int)
signal rank_changed(rank: String, previous: String)
signal stats_changed()

var _last_rank: String = ""

func _ready() -> void:
	_last_rank = current_rank()
	stats_changed.connect(_noop)

func _noop() -> void:
	pass

func level() -> int:
	return int(SaveManager.data.progress.get("level", 1))

func xp() -> int:
	return int(SaveManager.data.progress.get("xp", 0))

func rating() -> int:
	return int(SaveManager.data.progress.get("rating", 1000))

func stats() -> Dictionary:
	return SaveManager.data.progress

func xp_needed_for(level_value: int) -> int:
	var curve: Dictionary = ContentDB.economy().get("xp_curve", {})
	var base: float = float(curve.get("base", 400))
	var growth: float = float(curve.get("growth", 1.18))
	return int(round(base * pow(growth, maxf(0.0, float(level_value - 1)))))

func xp_progress_ratio() -> float:
	var need := xp_needed_for(level())
	if need <= 0:
		return 0.0
	return clampf(float(xp()) / float(need), 0.0, 1.0)

## Adds XP, carrying surplus into the next level (possibly several levels).
func add_xp(amount: int) -> int:
	if amount <= 0:
		return 0
	var progress: Dictionary = SaveManager.data.progress
	progress["xp"] = int(progress.get("xp", 0)) + amount
	progress["total_xp"] = int(progress.get("total_xp", 0)) + amount
	var levels := 0
	var max_level: int = int(ContentDB.economy().get("xp_curve", {}).get("max_level", 60))
	while int(progress["xp"]) >= xp_needed_for(int(progress["level"])) and int(progress["level"]) < max_level:
		progress["xp"] = int(progress["xp"]) - xp_needed_for(int(progress["level"]))
		progress["level"] = int(progress["level"]) + 1
		levels += 1
		level_up.emit(int(progress["level"]))
	SaveManager.mark_dirty()
	xp_gained.emit(amount, int(progress["xp"]))
	_check_rank()
	return levels

func current_rank() -> String:
	var level_value := level()
	var rating_value := rating()
	var best := "Bronze"
	for entry: Variant in ContentDB.economy().get("rank_thresholds", []):
		var row: Dictionary = entry
		if rating_value >= int(row.get("min_rating", 0)) and level_value >= int(row.get("min_level", 1)):
			best = str(row.get("rank", "Bronze"))
	return best

func rank_progress() -> Dictionary:
	var thresholds: Array = ContentDB.economy().get("rank_thresholds", [])
	var current := current_rank()
	for i: int in thresholds.size():
		var row: Dictionary = thresholds[i]
		if str(row.get("rank", "")) == current:
			var next_rating: int = 99999
			var next_level: int = 99
			if i + 1 < thresholds.size():
				next_rating = int((thresholds[i + 1] as Dictionary).get("min_rating", 99999))
				next_level = int((thresholds[i + 1] as Dictionary).get("min_level", 99))
			return {"rank": current, "rating": rating(), "next_rating": next_rating,
					"level": level(), "next_level": next_level}
	return {"rank": current, "rating": rating(), "next_rating": 99999, "level": level(),
			"next_level": 99}

func _check_rank() -> void:
	var rank_name := current_rank()
	if rank_name != _last_rank:
		rank_changed.emit(rank_name, _last_rank)
		_last_rank = rank_name

## Records a finished match.  `summary` is produced by the match manager and
## carries only facts about what happened (no currencies).
func record_match(mode_id: String, summary: Dictionary, server_validated: bool) -> void:
	var progress: Dictionary = SaveManager.data.progress
	progress["matches"] = int(progress.get("matches", 0)) + 1
	progress["eliminations"] = int(progress.get("eliminations", 0)) + int(summary.get("eliminations", 0))
	progress["deaths"] = int(progress.get("deaths", 0)) + int(summary.get("deaths", 0))
	progress["headshots"] = int(progress.get("headshots", 0)) + int(summary.get("headshot_elims", 0))
	progress["assists"] = int(progress.get("assists", 0)) + int(summary.get("assists", 0))
	progress["damage_dealt"] = float(progress.get("damage_dealt", 0.0)) + float(summary.get("damage", 0.0))
	if bool(summary.get("victory", false)):
		progress["wins"] = int(progress.get("wins", 0)) + 1
	if mode_id == "br":
		progress["br_matches"] = int(progress.get("br_matches", 0)) + 1
		var placement: int = int(summary.get("placement", 0))
		if placement > 0:
			var best: int = int(progress.get("best_placement", 0))
			if best == 0 or placement < best:
				progress["best_placement"] = placement
		if placement > 0 and placement <= 3:
			progress["top3_finishes"] = int(progress.get("top3_finishes", 0)) + 1
		if placement > 0 and placement <= 10:
			progress["top10_finishes"] = int(progress.get("top10_finishes", 0)) + 1
	if mode_id == "clash" and bool(summary.get("victory", false)):
		progress["clash_wins"] = int(progress.get("clash_wins", 0)) + 1
	for place_id: Variant in summary.get("places_visited", []):
		var visited: Array = progress.get("places_visited", [])
		if not visited.has(place_id):
			visited.append(place_id)
		progress["places_visited"] = visited
	for category: Variant in summary.get("weapon_categories", []):
		var used: Array = progress.get("weapon_categories_used", [])
		if not used.has(category):
			used.append(category)
		progress["weapon_categories_used"] = used
	var history: Array = progress.get("history", [])
	history.insert(0, {
		"mode": mode_id,
		"place": int(summary.get("placement", 0)),
		"eliminations": int(summary.get("eliminations", 0)),
		"victory": bool(summary.get("victory", false)),
		"duration": float(summary.get("duration", 0.0)),
		"at": int(Time.get_unix_time_from_system()),
	})
	progress["history"] = history.slice(0, 30)
	if server_validated and not mode_id == "training":
		_apply_rating(mode_id, summary)
	SaveManager.mark_dirty()
	_check_rank()
	stats_changed.emit()

## Ranked rating.  Placement, team result and eliminations all contribute, and
## abandonment is penalised - raw elimination farming alone is not rewarded.
func _apply_rating(mode_id: String, summary: Dictionary) -> void:
	var ranked: Dictionary = ContentDB.economy().get("ranked", {})
	if ranked.is_empty() or not bool(ranked.get("enabled", false)):
		return
	var progress: Dictionary = SaveManager.data.progress
	var delta: int = 0
	var placement: int = int(summary.get("placement", 0))
	var curve: Array = ranked.get("placement_gain", [40, 30, 20, 10, 0, -10])
	if mode_id == "br" and placement > 0:
		var index: int = clampi(placement - 1, 0, curve.size() - 1)
		delta += int(curve[index])
	delta += int(ranked.get("per_elimination", 4)) * int(summary.get("eliminations", 0))
	if bool(summary.get("abandoned", false)):
		delta -= int(ranked.get("abandon_penalty", 25))
	progress["rating"] = clampi(int(progress.get("rating", 1000)) + delta, 0, 6000)

func ranked_available() -> bool:
	var ranked: Dictionary = ContentDB.economy().get("ranked", {})
	if not bool(ranked.get("enabled", false)):
		return false
	if bool(ranked.get("require_server", true)) and not NetworkManager.is_authoritative_session():
		return false
	return true

## True only when the profile is backed by a validated online account.
func has_verified_account() -> bool:
	return NetworkManager.account_verified
