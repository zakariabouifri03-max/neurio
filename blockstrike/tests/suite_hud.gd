extends Node
func run() -> bool:
	var tree := get_tree()
	get_parent().remove_child(self)
	tree.root.add_child.call_deferred(self)
	await tree.process_frame
	await tree.process_frame
	Game.start_offline("training", {"bot_count": 1})
	var t := 0.0
	while (Game.current_match == null or Game.current_match.loading) and t < 60.0:
		await get_tree().create_timer(0.2).timeout
		t += 0.2
	await get_tree().create_timer(1.0).timeout
	var hud: HUD = Game.current_match.hud
	var tc := hud.touch
	print("touch size=", tc.size, " visible=", tc.visible, " in_tree_vis=", tc.is_visible_in_tree(), " pos=", tc.position, " anchors=", [tc.anchor_left, tc.anchor_top, tc.anchor_right, tc.anchor_bottom])
	print("root size=", hud.root.size, " overlay size=", hud.overlay.size, " modal children=", hud.modal.get_child_count(), " slots=", tc.slots.size())
	print("buttons visible: ", tc.buttons.keys().filter(func(k): return tc.buttons[k]["visible"]))
	get_tree().quit(0)
	return true
