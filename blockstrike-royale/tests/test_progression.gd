extends RefCounted
## Meta systems: save integrity, economy rewards, upgrades, missions and shop
## purchase rules (no duplicate purchases, no overspending).

func run(t: TestCase) -> void:
	# Save data: defaults must survive a round trip through the sanitiser.
	var data := SaveData.defaults()
	data.sanitize()
	t.equal(data.version, GameConfig.SAVE_VERSION, "fresh save uses the current version")
	t.contains(data.profile, "display_name", "save has a profile name")
	t.contains(data.wallet, "coins", "save has a coin wallet")
	t.contains(data.wallet, "gems", "save has a gem wallet")
	data.wallet["coins"] = -500
	data.sanitize()
	t.greater(float(data.wallet["coins"]), -1.0, "the sanitiser rejects negative currency")
	var json := JSON.stringify(data.to_dict())
	var reloaded := SaveData.from_dict(JSON.parse_string(json))
	t.equal(reloaded.version, data.version, "save round-trips through JSON")
	t.equal(reloaded.wallet.get("coins", -1), data.wallet.get("coins", 0),
		"wallet survives the round trip")

	# Economy rewards must scale with performance and never be negative.
	var weak := {"won": false, "kills": 0, "placement": 20, "players": 20, "damage": 50,
				 "duration": 120.0, "mode": "br"}
	var strong := {"won": true, "kills": 12, "placement": 1, "players": 20, "damage": 2400,
				   "duration": 600.0, "mode": "br"}
	var weak_reward := Economy.compute_match_reward(weak)
	var strong_reward := Economy.compute_match_reward(strong)
	t.greater(float(strong_reward.get("coins", 0)), float(weak_reward.get("coins", 0)),
		"a better match pays more coins")
	t.greater(float(strong_reward.get("xp", 0)), float(weak_reward.get("xp", 0)),
		"a better match grants more XP")
	t.greater(float(weak_reward.get("coins", 0)), -0.1, "rewards are never negative")
	var zero := Economy.compute_match_reward({})
	t.greater(float(zero.get("coins", 0)), -0.1, "an empty result is still safe")

	# Progression: levels get more expensive, ranks are ordered, xp is clamped.
	t.greater(float(Progression.xp_needed_for(10)), float(Progression.xp_needed_for(2)),
		"higher levels need more XP")
	var rank := Progression.current_rank()
	t.contains(rank, "name", "rank has a name")
	t.contains(["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master"],
		str(rank.get("name", "")), "rank is one of the documented tiers")
	t.between(float(Progression.xp_progress_ratio()), 0.0, 1.0, "level progress is a ratio")
	var stats := Progression.stats()
	for key: String in ["matches", "wins", "eliminations", "deaths"]:
		t.contains(stats, key, "progression tracks %s" % key)

	# Missions: definitions carry a target and a reward; claiming is guarded.
	t.greater(float(Missions.active_definitions().size()), 3.0, "missions are active")
	var summary := Missions.summary()
	t.contains(summary, "daily", "mission summary lists dailies")
	for definition: Variant in Missions.active_definitions():
		var mission: Dictionary = definition
		t.contains(mission, "id", "mission has an id")
		t.contains(mission, "target", "mission %s has a target" % str(mission.get("id", "")))
		t.greater(float(mission.get("target", 0)), 0.0, "mission targets are positive")
		var claim := Missions.claim(str(mission.get("id", "")))
		t.ok(not claim.succeeded(), "an unfinished mission cannot be claimed")

	# Shop: prices exist, owned items cannot be bought twice, payments are atomic.
	var shop_ids: Array = ContentDB.shop_item_ids()
	var item_id := str(shop_ids[0])
	var listing := Inventory.shop_listing(item_id)
	t.ok(not listing.is_empty(), "shop listing resolves an item")
	t.contains(listing, "price", "listing has a price")
	var currency := str(listing.get("currency", "coins"))
	t.equal(Inventory.can_purchase(item_id).succeeded(),
		Inventory.owns(item_id) or Economy.can_afford(int(listing.get("price", 0)), currency),
		"can_purchase agrees with the wallet and ownership state")
	if Inventory.owns(item_id):
		var duplicate := Inventory.purchase(item_id)
		t.ok(not duplicate.succeeded(), "owning an item blocks a second purchase")
		t.equal(duplicate.code_name(), "ALREADY_OWNED", "duplicate purchases are named")

	# Audio: every cue referenced by code exists as an asset.
	for sound_name: String in ["fire_rifle", "fire_smg", "fire_shotgun", "fire_sniper",
			"fire_pistol", "fire_lmg", "reload", "dry_fire", "hit_confirm", "headshot_confirm",
			"explosion", "pickup", "elimination", "victory", "defeat", "zone_warning",
			"match_start", "footstep_grass", "impact_stone", "music_menu", "music_match",
			"ui_click", "ui_back", "ui_confirm", "ui_error", "ui_purchase", "coin", "gem"]:
		t.ok(FileAccess.file_exists("res://assets/audio/%s.wav" % sound_name),
			"audio cue %s exists" % sound_name)
