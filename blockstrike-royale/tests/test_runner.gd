extends SceneTree
## Headless unit tests for the pure gameplay logic.
## Run with:  godot --headless --path . --script res://tests/test_runner.gd
## Exit code 0 = all passed, 1 = at least one failure.

const SafeZone := preload("res://scripts/match/safe_zone.gd")
const GameModes := preload("res://scripts/match/game_modes.gd")
const WDB := preload("res://scripts/weapons/weapon_db.gd")
const Inventory := preload("res://scripts/core/inventory.gd")
const MapGen := preload("res://scripts/world/map_generator.gd")
const BD := preload("res://scripts/world/block_defs.gd")

var _passed := 0
var _failed := 0
var _section := ""


func _init() -> void:
	_test_safe_zone()
	_test_weapons()
	_test_game_modes()
	_test_inventory()
	_test_block_defs()
	_test_map()
	print("")
	print("RESULT: %d passed, %d failed" % [_passed, _failed])
	quit(1 if _failed > 0 else 0)


func _check(cond: bool, msg: String) -> void:
	if cond:
		_passed += 1
	else:
		_failed += 1
		printerr("  FAIL [%s]: %s" % [_section, msg])


func _test_safe_zone() -> void:
	_section = "safe_zone"
	var prev_r := 1.0e9
	var monotonic := true
	var t := 0.0
	while t < 400.0:
		var s: Dictionary = SafeZone.state_at(t)
		if float(s["radius"]) > prev_r + 0.0001:
			monotonic = false
		prev_r = float(s["radius"])
		t += 1.0
	_check(monotonic, "zone radius never grows")
	_check(is_equal_approx(float(SafeZone.state_at(0.0)["radius"]), SafeZone.START_RADIUS), "starts at START_RADIUS")
	var final_r: float = SafeZone.state_at(1000.0)["radius"]
	_check(final_r <= 4.0 + 0.001, "final circle radius is 4 or less (got %f)" % final_r)
	_check(float(SafeZone.state_at(1000.0)["dps"]) == SafeZone.FINAL_DPS, "final dps applies after last phase")
	_check(SafeZone.contains(Vector2(0, 0), 10.0, Vector3(3, 0, 4)), "point 5m away is inside radius 10")
	_check(not SafeZone.contains(Vector2(0, 0), 10.0, Vector3(9, 0, 9)), "point 12.7m away is outside radius 10")
	_check(SafeZone.state_at(10.0)["shrinking"] == false, "no shrink during first wait")
	_check(SafeZone.state_at(70.0)["shrinking"] == true, "shrinking after first wait")


func _test_weapons() -> void:
	_section = "weapons"
	var required := ["damage", "interval", "auto", "magazine", "reload", "range", "spread", "recoil",
		"headshot", "ammo", "pellets", "slot", "sound", "kind", "name"]
	for id in WDB.WEAPONS.keys():
		var d: Dictionary = WDB.WEAPONS[id]
		var missing := []
		for k in required:
			if not d.has(k):
				missing.append(k)
		_check(missing.is_empty(), "%s missing fields %s" % [id, str(missing)])
		_check(float(d["damage"]) > 0.0 or d["kind"] == "melee", "%s has damage" % id)
	var ar: Dictionary = WDB.get_def("ar")
	var sn: Dictionary = WDB.get_def("sniper")
	_check(float(sn["damage"]) > float(ar["damage"]), "sniper hits harder than rifle per shot")
	_check(float(sn["interval"]) > float(ar["interval"]), "sniper is slower than rifle")
	_check(int(WDB.get_def("shotgun")["pellets"]) > 1, "shotgun fires multiple pellets")
	_check(WDB.get_def("knife")["kind"] == "melee", "knife is melee")


func _test_game_modes() -> void:
	_section = "game_modes"
	_check(GameModes.get_mode("br_solo")["playable"] == true, "br_solo playable")
	_check(GameModes.get_mode("br_squad")["team_size"] == 4, "squad team size 4")
	_check(GameModes.get_mode("br_duo")["team_size"] == 2, "duo team size 2")
	_check(GameModes.get_mode("training")["br"] == false, "training is not battle royale")
	_check(GameModes.get_mode("unknown_mode")["name"] == GameModes.get_mode("br_solo")["name"], "unknown mode falls back")
	_check(GameModes.get_mode("clash")["playable"] == false, "clash is honestly marked not playable")


func _test_inventory() -> void:
	_section = "inventory"
	var inv: Inventory = Inventory.new()
	inv.reset_loadout(["pistol", "knife"], {"light": 24, "medium": 0, "shell": 0, "heavy": 0},
		{"bandage": 1, "medkit": 0, "armor_plate": 0, "blocks": 5})
	_check(inv.slots[1] != null and inv.slots[1]["id"] == "pistol", "pistol lives in slot 1 (its def slot)")
	_check(inv.slots[2] != null and inv.slots[2]["id"] == "knife", "knife in slot 2")
	_check(inv.slots[0] == null, "slot 0 empty")
	_check(inv.current_id() == "pistol", "first weapon becomes active")
	var replaced: String = inv.add_weapon("ar")
	_check(replaced == "" or replaced == "pistol", "add_weapon returns replaced id or empty (got '%s')" % replaced)
	_check(inv.current_id() == "ar" or inv.slots[0] != null and inv.slots[0]["id"] == "ar" or inv.slots[1] != null and inv.slots[1]["id"] == "ar", "rifle placed in a slot")
	inv.add_ammo("medium", 30)
	_check(inv.reserve_of("ar") == 30, "medium ammo feeds rifle reserve (got %d)" % inv.reserve_of("ar"))
	var got: int = inv.take_reserve("ar", 100)
	_check(got == 30, "take_reserve caps at available (got %d)" % got)
	inv.add_item("bandage", 2)
	var r: Dictionary = inv.use_heal(40.0, 0.0)
	_check(not r.is_empty(), "use_heal returns something when healing items exist")
	var drops: Array = inv.drop_list()
	_check(drops.size() > 0, "drop_list includes loot")
	for d in drops:
		_check(d.has("kind") and d.has("item") and d.has("amount"), "drop entry has kind/item/amount")
	# unlimited reserves (training ground)
	inv.add_weapon("ar")
	inv.ammo["light"] = 0
	_check(inv.take_reserve("ar", 30) == 0, "limited ammo: empty reserve gives nothing")
	inv.unlimited_ammo = true
	_check(inv.take_reserve("ar", 30) == 30, "unlimited ammo: reserve gives the full amount")
	_check(inv.reserve_of("ar") == 999, "unlimited ammo: reserve reports 999")
	inv.unlimited_ammo = false


func _test_block_defs() -> void:
	_section = "block_defs"
	_check(BD.is_solid(BD.STONE), "stone is solid")
	_check(not BD.is_solid(BD.AIR), "air is not solid")
	_check(not BD.is_solid(BD.WATER), "water is not solid")
	_check(BD.is_opaque(BD.STONE) and not BD.is_opaque(BD.GLASS), "glass is transparent")
	_check(BD.COUNT == 18, "block count is 18")


func _test_map() -> void:
	_section = "map"
	var gen = MapGen.new()
	gen.generate(20261013)
	_check(gen.spawn_points.size() >= 16, "at least 16 spawn points (got %d)" % gen.spawn_points.size())
	_check(gen.loot_points.size() >= 100, "at least 100 loot points (got %d)" % gen.loot_points.size())
	_check(gen.tree_count > 0, "trees generated")
	var solid_spawns := 0
	for p in gen.spawn_points:
		var x := int(p.x)
		var z := int(p.z)
		var y := int(p.y)
		if BD.is_solid(gen.get_block(x, y - 1, z)) and gen.get_block(x, y, z) == BD.AIR:
			solid_spawns += 1
	_check(solid_spawns == gen.spawn_points.size(), "every spawn point stands on solid ground with air above")
	var img: Image = gen.build_minimap()
	_check(img.get_width() == MapGen.SIZE.x and img.get_height() == MapGen.SIZE.z, "minimap matches map size")
