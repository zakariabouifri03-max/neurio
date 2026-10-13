extends RefCounted
## Combat maths: damage falloff, headshots, armour reduction, weapon spread and
## the match rules that decide who wins.

func run(t: TestCase) -> void:
	var damage := DamageSystem.new()
	var weapon := ContentDB.weapon("vx7_ranger")
	t.ok(not weapon.is_empty(), "vx7_ranger exists")

	var in_range := damage.compute_damage(weapon, 5.0, false)
	var mid_range := damage.compute_damage(weapon, float(weapon.get("effective_range", 30.0)) + 20.0, false)
	var far_range := damage.compute_damage(weapon, float(weapon.get("effective_range", 30.0)) * 2.9, false)
	t.equal(in_range, float(weapon.get("damage", 0.0)), "full damage inside the effective range")
	t.less(mid_range, in_range, "damage falls off past the effective range")
	t.less(far_range, mid_range, "falloff keeps decreasing with distance")
	t.greater(far_range, 0.0, "damage never reaches zero")

	var headshot := damage.compute_damage(weapon, 5.0, true)
	t.greater(headshot, in_range, "headshots deal more damage")
	t.equal(headshot, in_range * float(weapon.get("headshot_multiplier", 1.5)),
		"headshot damage uses the weapon multiplier")

	# Shotguns: pellet count multiplies the potential damage, not the single pellet.
	var shotgun := ContentDB.weapon("boulder_sg")
	t.greater(float(shotgun.get("pellets", 1)), 1.0, "the shotgun fires several pellets")
	var per_pellet := damage.compute_damage(shotgun, 4.0, false)
	t.less(per_pellet, 40.0, "a single shotgun pellet is survivable")

	# Sniper rifles must be lethal to the head and dangerous to the body.
	var sniper := ContentDB.weapon("longspike")
	var sniper_head := damage.compute_damage(sniper, 20.0, true)
	t.greater(sniper_head, 100.0, "a sniper headshot kills a full-health player")

	# Melee must reach further than zero but stay close range.
	var melee := ContentDB.weapon("rebar_club")
	t.greater(float(melee.get("effective_range", 0.0)), 0.5, "melee has reach")
	t.less(float(melee.get("effective_range", 0.0)), 4.0, "melee is short range")

	# Throwable must have a fuse and a blast radius so the explosion code is sane.
	var grenade := ContentDB.weapon("fragshard")
	t.greater(float(grenade.get("blast_radius", 0.0)), 1.0, "frag grenade has a blast radius")
	t.greater(float(grenade.get("fuse_time", 0.0)), 0.5, "frag grenade has a fuse")

	# Armour tiers reduce damage and must be ordered.
	var tier1 := ContentDB.armor_tier(1)
	var tier3 := ContentDB.armor_tier(3)
	t.greater(float(tier1.get("max", 0.0)), 0.0, "tier 1 armour has capacity")
	t.greater(float(tier3.get("max", 0.0)), float(tier1.get("max", 0.0)),
		"higher tiers hold more armour")
	t.greater(float(tier3.get("reduction", 0.0)), float(tier1.get("reduction", 0.0)),
		"higher tiers reduce more damage")

	# Movement tuning must be self-consistent, because movement is shared.
	t.greater(float(GameConfig.PLAYER["sprint_speed"]), float(GameConfig.PLAYER["walk_speed"]),
		"sprint is faster than walking")
	t.less(float(GameConfig.PLAYER["crouch_speed"]), float(GameConfig.PLAYER["walk_speed"]),
		"crouching is slower than walking")
	t.greater(float(GameConfig.PLAYER["jump_velocity"]), 0.0, "jumping pushes upwards")
	t.less(float(GameConfig.PLAYER["gravity"]), 0.0, "gravity pulls downwards")
	t.less(float(GameConfig.CAMERA["ads_distance"]), float(GameConfig.CAMERA["distance"]),
		"aiming pulls the camera closer")
	t.less(float(GameConfig.CAMERA["pitch_min_deg"]), 0.0, "the camera can look up")
	t.greater(float(GameConfig.CAMERA["pitch_max_deg"]), 0.0, "the camera can look down")

	# Match configuration for every mode.
	for mode_id: String in ContentDB.mode_ids():
		var settings := MatchConfig.build(mode_id, "", "", 4, {"bots_allowed": true})
		var check := MatchConfig.validate(settings)
		t.ok(check.succeeded(), "match settings validate for %s (%s)" % [mode_id,
			check.error_text()])
		t.contains(settings, "map", "settings name a map for %s" % mode_id)
		t.contains(settings, "building", "settings describe building for %s" % mode_id)
	var br := MatchConfig.build("br", "squad", "emerald_island", 4, {})
	t.ok(bool((br.get("zones", {}) as Dictionary).get("enabled", false)),
		"battle royale enables the zone")
	var clash := MatchConfig.build("clash", "", "neon_yard", 8, {})
	t.equal(int(clash.get("rounds_to_win", 0)), 4, "clash squad is first to four")
	t.greater(float(clash.get("buy_time_s", 0.0)), 0.0, "clash squad has a buy phase")
	var training := MatchConfig.build("training", "", "training_base", 1, {})
	t.ok(bool(training.get("infinite_ammo", false)), "training ground has infinite ammo")
	t.ok(bool(training.get("respawn", false)), "training ground respawns")

	# Zone maths: the circle shrinks, stays on the map and hurts outside.
	var zone := ZoneManager.new()
	zone.set_bounds(Rect2(0, 0, 320, 320))
	zone.start(Vector2(160, 160), 160.0, 4242, true)
	t.less(zone.target_radius, zone.radius, "the next circle is smaller")
	t.greater(zone.target_radius, 0.0, "the next circle has a positive radius")
	t.between(zone.target_center.x, 0.0, 320.0, "the next circle centre is on the map")
	t.between(zone.target_center.y, 0.0, 320.0, "the next circle centre is on the map")
	t.greater(zone.damage_rate_for(Vector3(1000, 20, 1000), 1.0), 0.0, "outside the zone hurts")
	t.equal(zone.damage_rate_for(Vector3(160, 20, 160), 1.0), 0.0, "inside the zone is safe")
	t.ok(zone.is_inside(Vector3(160, 20, 160)), "is_inside reports the centre")
	t.ok(not zone.is_inside(Vector3(0, 20, 0)) or zone.radius >= 226.0,
		"is_inside reports a far corner")
	t.equal(zone.PHASES.size(), 7, "seven zone phases are defined")
	t.greater(zone.total_phases(), 4.0, "total_phases reports the phase count")
	zone.free()
