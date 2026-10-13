class_name SaveData
extends RefCounted
## Versioned, validated save payload.
##
## The save file is plain JSON so it stays debuggable and editable by players,
## which is fine because local progression is explicitly *not* authoritative for
## online rewards (the server validates anything persistent).

const CURRENT_VERSION := 3

var version: int = CURRENT_VERSION
var profile: Dictionary = {}
var progress: Dictionary = {}
var wallet: Dictionary = {}
var cosmetics: Dictionary = {}
var mission_state: Dictionary = {}
var settings: Dictionary = {}
var controls: Dictionary = {}
var flags: Dictionary = {}
var ledger: Array = []

static func defaults() -> SaveData:
	var data := SaveData.new()
	data.profile = {
		"player_id": "",
		"display_name": "Player",
		"created_at": 0,
		"icon": 0,
		"banner_id": "banner_default",
	}
	data.progress = {
		"level": 1,
		"xp": 0,
		"total_xp": 0,
		"rating": 1000,
		"ranked_unlocked": false,
		"matches": 0,
		"wins": 0,
		"eliminations": 0,
		"deaths": 0,
		"headshots": 0,
		"assists": 0,
		"best_placement": 0,
		"top3_finishes": 0,
		"top10_finishes": 0,
		"damage_dealt": 0.0,
		"clash_wins": 0,
		"br_matches": 0,
		"places_visited": [],
		"weapon_categories_used": [],
		"history": [],
	}
	data.wallet = {"coins": 500, "gems": 50}
	data.cosmetics = {"owned": [], "equipped": {}, "seen": []}
	data.mission_state = {"daily": {}, "weekly": {}, "achievements": {}, "events": {}}
	data.settings = {}
	data.controls = {}
	data.flags = {
		"first_match_bonus_claimed": false,
		"last_login_date": "",
		"login_streak": 0,
		"tutorial_done": false,
		"selected_mode": "br",
		"selected_variant": "squad",
		"selected_map": "emerald_island",
		"training_bot_difficulty": "normal",
	}
	data.ledger = []
	return data

## Builds SaveData from an untrusted dictionary, repairing anything invalid.
static func from_dict(raw: Dictionary) -> SaveData:
	var data := SaveData.defaults()
	var source: Dictionary = raw
	if int(source.get("version", 1)) < CURRENT_VERSION:
		source = migrate(source)
	var kept: Dictionary = {}
	for key: String in ["profile", "progress", "wallet", "cosmetics", "mission_state",
						"settings", "controls", "flags"]:
		var value: Variant = source.get(key, {})
		kept[key] = value if typeof(value) == TYPE_DICTIONARY else {}
	data.version = CURRENT_VERSION
	data.profile = _merge(data.profile, kept.get("profile", {}))
	data.progress = _merge(data.progress, kept.get("progress", {}))
	data.wallet = _merge(data.wallet, kept.get("wallet", {}))
	data.cosmetics = _merge(data.cosmetics, kept.get("cosmetics", {}))
	data.mission_state = _merge(data.mission_state, kept.get("mission_state", {}))
	data.settings = kept.get("settings", {})
	data.controls = kept.get("controls", {})
	data.flags = _merge(data.flags, kept.get("flags", {}))
	var raw_ledger: Variant = source.get("ledger", [])
	data.ledger = raw_ledger if typeof(raw_ledger) == TYPE_ARRAY else []
	data.sanitize()
	return data

## Field-by-field overlay: unknown keys from the file are ignored, new defaults survive.
static func _merge(base: Dictionary, overlay: Variant) -> Dictionary:
	if typeof(overlay) != TYPE_DICTIONARY:
		return base
	var source: Dictionary = overlay
	var out: Dictionary = base.duplicate(true)
	for key: Variant in source.keys():
		if out.has(key):
			out[key] = source[key]
	return out

## Upgrades older payloads.  Each step is small and explicit so nothing is lost.
static func migrate(raw: Dictionary) -> Dictionary:
	var data: Dictionary = raw.duplicate(true)
	var version := int(data.get("version", 1))
	if version < 2:
		# v2 introduced the cosmetics block and the currency rename to coins/gems.
		var wallet: Dictionary = data.get("wallet", {})
		if typeof(wallet) != TYPE_DICTIONARY:
			wallet = {}
		if wallet.has("gold") and not wallet.has("coins"):
			wallet["coins"] = wallet["gold"]
		if wallet.has("premium") and not wallet.has("gems"):
			wallet["gems"] = wallet["premium"]
		wallet.erase("gold")
		wallet.erase("premium")
		data["wallet"] = wallet
		if not data.has("cosmetics"):
			data["cosmetics"] = {"owned": [], "equipped": {}, "seen": []}
		version = 2
	if version < 3:
		# v3 introduced mission_state and the progression statistics block.
		var progress: Dictionary = data.get("progress", {})
		if typeof(progress) != TYPE_DICTIONARY:
			progress = {}
		progress["places_visited"] = progress.get("places_visited", [])
		progress["weapon_categories_used"] = progress.get("weapon_categories_used", [])
		progress["history"] = progress.get("history", [])
		data["progress"] = progress
		if not data.has("mission_state"):
			data["mission_state"] = {"daily": {}, "weekly": {}, "achievements": {}, "events": {}}
		version = 3
	data["version"] = version
	return data

## Clamps and repairs values that would break gameplay (negative balances etc).
func sanitize() -> void:
	wallet["coins"] = maxi(0, int(wallet.get("coins", 0)))
	wallet["gems"] = maxi(0, int(wallet.get("gems", 0)))
	progress["level"] = clampi(int(progress.get("level", 1)), 1, 999)
	progress["xp"] = maxi(0, int(progress.get("xp", 0)))
	progress["total_xp"] = maxi(int(progress.get("total_xp", 0)), int(progress["xp"]))
	progress["rating"] = clampi(int(progress.get("rating", 1000)), 0, 6000)
	for key: String in ["matches", "wins", "eliminations", "deaths", "headshots", "assists",
						"top3_finishes", "top10_finishes", "clash_wins", "br_matches"]:
		progress[key] = maxi(0, int(progress.get(key, 0)))
	if progress["wins"] > progress["matches"]:
		progress["wins"] = progress["matches"]
	var owned: Variant = cosmetics.get("owned", [])
	cosmetics["owned"] = owned if typeof(owned) == TYPE_ARRAY else []
	var equipped: Variant = cosmetics.get("equipped", {})
	cosmetics["equipped"] = equipped if typeof(equipped) == TYPE_DICTIONARY else {}
	var history: Variant = progress.get("history", [])
	progress["history"] = (history as Array).slice(0, 30) if typeof(history) == TYPE_ARRAY else []
	if profile.get("player_id", "") == "":
		profile["player_id"] = _make_id()
	var name: String = str(profile.get("display_name", "Player")).strip_edges()
	profile["display_name"] = "Player" if name.is_empty() else name.left(18)
	if int(profile.get("created_at", 0)) == 0:
		profile["created_at"] = int(Time.get_unix_time_from_system())

static func _make_id() -> String:
	var rng := RandomNumberGenerator.new()
	rng.randomize()
	return "bsr-%08x%04x" % [rng.randi(), rng.randi() & 0xFFFF]

func add_ledger(entry: Dictionary) -> void:
	ledger.append(entry)
	if ledger.size() > 60:
		ledger = ledger.slice(ledger.size() - 60, ledger.size())

func to_dict() -> Dictionary:
	return {
		"version": CURRENT_VERSION,
		"profile": profile,
		"progress": progress,
		"wallet": wallet,
		"cosmetics": cosmetics,
		"mission_state": mission_state,
		"settings": settings,
		"controls": controls,
		"flags": flags,
		"ledger": ledger,
	}
