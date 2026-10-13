extends Node
## Persistent progression and content data shared by the offline prototype.
## Combat stats are intentionally authored per weapon; cosmetics never modify them.

signal profile_changed
signal toast_requested(message: String, good: bool)

const SAVE_PATH := "user://blockstrike_royale.json"
const SAVE_VERSION := 1

const MODES := {
	"battle_royale": {"label": "Battle Royale", "subtitle": "Solo • 32 survivors", "teams": 1, "target": 32},
	"clash_squad": {"label": "Clash Squad", "subtitle": "4v4 • best of 7", "teams": 2, "target": 8},
	"arena_2v2": {"label": "2v2 Arena", "subtitle": "Fast rounds • 4 players", "teams": 2, "target": 4},
	"training": {"label": "Training Ground", "subtitle": "Offline bots • free practice", "teams": 1, "target": 8},
	"custom": {"label": "Custom Room", "subtitle": "Private rules • room code", "teams": 2, "target": 32},
}

const WEAPONS := {
	"pulse_rifle": {
		"name": "AR-7 Pulse", "category": "Assault Rifle", "damage": 22.0, "fire_rate": 0.105,
		"range": 90.0, "magazine": 30, "reload": 1.55, "spread": 0.018, "recoil": 0.055,
		"color": Color("#39d6c2")
	},
	"vector_smg": {
		"name": "Vector-9", "category": "SMG", "damage": 14.0, "fire_rate": 0.065,
		"range": 52.0, "magazine": 36, "reload": 1.35, "spread": 0.035, "recoil": 0.07,
		"color": Color("#ff9f68")
	},
	"cinder_shotgun": {
		"name": "Cinder-12", "category": "Shotgun", "damage": 9.0, "pellets": 8, "fire_rate": 0.72,
		"range": 32.0, "magazine": 6, "reload": 1.9, "spread": 0.12, "recoil": 0.18,
		"color": Color("#f06449")
	},
	"longshot": {
		"name": "Longshot", "category": "Sniper Rifle", "damage": 85.0, "fire_rate": 1.25,
		"range": 180.0, "magazine": 5, "reload": 2.2, "spread": 0.003, "recoil": 0.25,
		"color": Color("#b497ff")
	},
	"sidekick": {
		"name": "Sidekick", "category": "Pistol", "damage": 28.0, "fire_rate": 0.32,
		"range": 65.0, "magazine": 12, "reload": 1.1, "spread": 0.025, "recoil": 0.08,
		"color": Color("#ffd166")
	},
}

const COSMETICS := [
	{"id": "starter_scout", "name": "Scout Nova", "kind": "outfit", "rarity": "Starter", "price": 0, "currency": "coins", "color": "#39d6c2"},
	{"id": "ember_guard", "name": "Ember Guard", "kind": "outfit", "rarity": "Rare", "price": 600, "currency": "coins", "color": "#ff6b5e"},
	{"id": "night_runner", "name": "Night Runner", "kind": "outfit", "rarity": "Epic", "price": 8, "currency": "gems", "color": "#8d7bff"},
	{"id": "cobalt_helmet", "name": "Cobalt Helmet", "kind": "helmet", "rarity": "Rare", "price": 450, "currency": "coins", "color": "#3987ff"},
	{"id": "mint_pack", "name": "Mint Pack", "kind": "backpack", "rarity": "Uncommon", "price": 320, "currency": "coins", "color": "#6fe7bd"},
	{"id": "sunset_pulse", "name": "Sunset Pulse", "kind": "weapon_skin", "rarity": "Epic", "price": 12, "currency": "gems", "color": "#ff9f68"},
	{"id": "victory_spark", "name": "Victory Spark", "kind": "victory", "rarity": "Rare", "price": 700, "currency": "coins", "color": "#ffd166"},
]

var profile: Dictionary = {
	"version": SAVE_VERSION,
	"coins": 1200,
	"gems": 12,
	"xp": 0,
	"level": 1,
	"matches": 0,
	"wins": 0,
	"eliminations": 0,
	"equipped_cosmetics": ["starter_scout"],
	"owned_cosmetics": ["starter_scout"],
	"owned_weapons": ["pulse_rifle", "sidekick"],
	"missions": {"matches": 0, "eliminations": 0, "damage": 0},
	"settings": {"quality": "Medium", "sensitivity": 1.0, "show_fps": false},
}

func _ready() -> void:
	load_profile()

func load_profile() -> void:
	if not FileAccess.file_exists(SAVE_PATH):
		return
	var file := FileAccess.open(SAVE_PATH, FileAccess.READ)
	if file == null:
		return
	var parsed = JSON.parse_string(file.get_as_text())
	if parsed is Dictionary:
		for key in profile.keys():
			if parsed.has(key):
				profile[key] = parsed[key]
	file.close()

func save_profile() -> void:
	var file := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if file == null:
		return
	file.store_string(JSON.stringify(profile))
	file.close()
	profile_changed.emit()

func get_weapon(id: String) -> Dictionary:
	return WEAPONS.get(id, WEAPONS["pulse_rifle"]).duplicate(true)

func get_mode(id: String) -> Dictionary:
	return MODES.get(id, MODES["training"]).duplicate(true)

func add_xp(amount: int) -> void:
	profile.xp += amount
	var needed: int = int(profile.level) * 500
	while profile.xp >= needed:
		profile.xp -= needed
		profile.level += 1
		profile.coins += 250
		toast_requested.emit("LEVEL %d  +250 COINS" % profile.level, true)
		needed = profile.level * 500
	save_profile()

func grant_match_rewards(won: bool, eliminations: int, mode_id: String) -> Dictionary:
	var coins := 80 + eliminations * 35
	var xp := 120 + eliminations * 75
	if won:
		coins += 280
		xp += 220
	profile.coins += coins
	profile.xp += xp
	profile.matches += 1
	profile.eliminations += eliminations
	profile.missions.matches += 1
	profile.missions.eliminations += eliminations
	if won:
		profile.wins += 1
	add_xp(0)
	toast_requested.emit("+%d COINS  +%d XP" % [coins, xp], true)
	return {"coins": coins, "xp": xp, "mode": mode_id}

func buy_cosmetic(item_id: String) -> bool:
	var item := get_cosmetic(item_id)
	if item.is_empty() or item_id in profile.owned_cosmetics:
		return false
	var currency: String = item.currency
	var price: int = item.price
	if profile.get(currency, 0) < price:
		toast_requested.emit("Not enough %s" % currency.capitalize(), false)
		return false
	profile[currency] -= price
	profile.owned_cosmetics.append(item_id)
	save_profile()
	toast_requested.emit("Unlocked %s" % item.name, true)
	return true

func equip_cosmetic(item_id: String) -> bool:
	if not item_id in profile.owned_cosmetics:
		return false
	profile.equipped_cosmetics = [item_id]
	save_profile()
	return true

func get_cosmetic(item_id: String) -> Dictionary:
	for item in COSMETICS:
		if item.id == item_id:
			return item.duplicate(true)
	return {}

func quality_index() -> int:
	return ["Low", "Medium", "High"].find(profile.settings.quality)

func set_quality(value: String) -> void:
	profile.settings.quality = value
	save_profile()
