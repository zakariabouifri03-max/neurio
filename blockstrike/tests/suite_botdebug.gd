extends Node
func run() -> bool:
	for mode in ["clash_squad", "br_solo"]:
		var m := Match.new()
		m.set_meta("hold", true)
		add_child(m)
		m.setup({"mode": mode, "net": "dedicated", "seed": 7, "players": [], "bots": true, "difficulty": 1})
		var by_weapon := {}
		var lines := 0
		for i in 30 * 400:
			m._server_tick(Match.TICK)
			for ev in m.events:
				pass
			if m.rules.ended:
				break
		# events are cleared each tick, so hook via kill tally on actors
		var dmg := [0.0, 0.0]
		for id in m.actors:
			var a: Actor = m.actors[id]
			if mode == "clash_squad":
				dmg[clampi(a.team, 0, 1)] += a.damage_dealt
				print("  %s team%d skill=%.2f kills=%d dmg=%d slots=%s money=%d" % [a.name, a.team, a.skill, a.kills, int(a.damage_dealt), str(a.slots), a.money])
		print(mode, " team damage: ", dmg, " score ", m.rules.score)
		m.queue_free()
		await get_tree().process_frame
	return true
