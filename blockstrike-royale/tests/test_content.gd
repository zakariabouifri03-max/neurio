extends RefCounted
## Data integrity: every JSON table the game depends on must be complete and
## self-consistent, because every other system trusts these values.

func run(t: TestCase) -> void:
	var weapons: Array = ContentDB.weapon_ids()
	t.greater(float(weapons.size()), 8.0, "weapon table is populated")
	var required := ["id", "display_name", "category", "damage", "fire_rate", "magazine",
		"reserve_ammo", "effective_range", "reload_time", "rarity", "audio"]
	var categories: Array = ["ar", "smg", "shotgun", "sniper", "pistol", "melee", "throwable", "lmg"]
	var rarities: Array = ["common", "uncommon", "rare", "epic", "legendary"]
	for weapon_id: String in weapons:
		var weapon := ContentDB.weapon(weapon_id)
		for key: String in required:
			t.contains(weapon, key, "weapon %s has %s" % [weapon_id, key])
		t.contains(categories, str(weapon.get("category", "")),
			"weapon %s category is known" % weapon_id)
		t.contains(rarities, str(weapon.get("rarity", "")),
			"weapon %s rarity is known" % weapon_id)
		var audio: Dictionary = weapon.get("audio", {})
		for cue: String in audio.keys():
			var path := "res://assets/audio/%s.wav" % str(audio[cue])
			t.ok(ResourceLoader.exists(path) or FileAccess.file_exists(path),
				"weapon %s audio %s exists (%s)" % [weapon_id, cue, path])
		if str(weapon.get("category", "")) != "melee" \
				and str(weapon.get("category", "")) != "throwable":
			t.greater(float(weapon.get("damage", 0.0)), 0.0, "%s deals damage" % weapon_id)
			t.greater(float(weapon.get("fire_rate", 0.0)), 0.0, "%s has a fire rate" % weapon_id)
	var loadout: Dictionary = ContentDB.section("weapons").get("default_loadout", {})
	for slot: String in loadout.keys():
		t.ok(ContentDB.has_weapon(str(loadout[slot])),
			"default loadout slot %s points at a real weapon" % slot)

	var items: Array = ContentDB.item_ids()
	t.greater(float(items.size()), 4.0, "item table is populated")
	for item_id: String in items:
		var item := ContentDB.item(item_id)
		t.contains(item, "name", "item %s has a name" % item_id)
		t.contains(item, "kind", "item %s has a kind" % item_id)

	var modes: Array = ContentDB.mode_ids()
	t.equal(modes.size(), 4, "four modes are defined")
	for mode_id: String in modes:
		var mode := ContentDB.mode(mode_id)
		t.contains(mode, "map", "mode %s names a map" % mode_id)
		t.ok(not ContentDB.map_data(str(mode.get("map", ""))).is_empty(),
			"mode %s default map exists" % mode_id)

	for map_id: String in ContentDB.map_ids():
		var map_data := ContentDB.map_data(map_id)
		var size: Dictionary = map_data.get("size_blocks", {})
		t.greater(float(size.get("x", 0)), 32.0, "map %s has a sane width" % map_id)
		t.greater(float(size.get("z", 0)), 32.0, "map %s has a sane depth" % map_id)
		var places: Array = map_data.get("places", [])
		t.greater(float(places.size()), 0.0, "map %s has named places" % map_id)
		for entry: Variant in places:
			var place: Dictionary = entry
			t.contains(place, "center", "place %s has a centre" % str(place.get("id", "?")))
			var center: Array = place.get("center", [0, 0])
			t.between(float(center[0]), 0.0, float(size.get("x", 0)),
				"place %s centre is inside the map" % str(place.get("id", "?")))

	var economy := ContentDB.economy()
	t.greater(float(economy.get("starting_coins", 0)), 0.0, "economy has starting coins")
	t.greater(float(economy.get("gems_earned_per_hour", 0)), 0.0, "economy grants gems over time")

	var shop_items: Array = ContentDB.shop_item_ids()
	t.greater(float(shop_items.size()), 20.0, "shop has items")
	for item_id: String in shop_items:
		var entry := ContentDB.shop_item(item_id)
		t.contains(entry, "price", "shop item %s has a price" % item_id)
		t.contains(entry, "slot", "shop item %s has a slot" % item_id)
	var defaults: Array = ContentDB.default_owned()
	for item_id: Variant in defaults:
		t.ok(ContentDB.shop_item(str(item_id)).size() > 0,
			"default owned item %s exists" % str(item_id))

	var missions: Dictionary = ContentDB.missions_section()
	t.greater(float(ContentDB.daily_missions().size()), 2.0, "daily missions defined")
	t.greater(float(ContentDB.weekly_missions().size()), 2.0, "weekly missions defined")
	t.greater(float(ContentDB.achievements().size()), 4.0, "achievements defined")
	t.ok(not missions.is_empty(), "missions file parsed")
