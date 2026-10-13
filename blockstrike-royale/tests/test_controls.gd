extends RefCounted
## Touch controls and HUD layout: the layout stores real numbers, survives a save
## round trip, mirrors for left-handed play and never leaves a button off screen.

func run(t: TestCase) -> void:
	var touch := TouchControls.new()
	t.equal(touch.DEFAULT_LAYOUT.size(), 14, "the default layout defines 14 controls")
	for id: String in touch.DEFAULT_LAYOUT.keys():
		var entry: Dictionary = touch.DEFAULT_LAYOUT[id]
		var pos: Array = entry.get("pos", [])
		t.equal(pos.size(), 2, "control %s has a 2D position" % id)
		t.between(float(pos[0]), 0.0, 1.0, "control %s x is a screen ratio" % id)
		t.between(float(pos[1]), 0.0, 1.0, "control %s y is a screen ratio" % id)
		t.greater(float(entry.get("size", 0.0)), 60.0, "control %s is at least finger sized" % id)
		t.ok(UiKit.icon(str(entry.get("icon", ""))) != null,
			"control %s icon asset exists" % id)

	# Layout editing: moving a button updates the stored ratio, and saving keeps it.
	touch.load_layout()
	touch.layout["fire"]["pos"] = [0.5, 0.5]
	touch.layout["fire"]["size"] = 100.0
	touch.layout["map"]["hidden"] = true
	touch.save_layout()
	var stored: Dictionary = Settings.controls.get("touch_layout", {})
	t.contains(stored, "fire", "saving stores the fire button")
	t.equal(stored["fire"]["pos"], [0.5, 0.5], "the moved position is stored")
	t.contains(touch.hidden_ids(), "map", "hidden buttons are reported")
	var reloaded := TouchControls.new()
	reloaded.load_layout()
	t.equal(reloaded.layout["fire"]["pos"], [0.5, 0.5], "the layout reloads from settings")
	t.ok(bool(reloaded.layout["map"].get("hidden", false)), "hidden state reloads")
	reloaded.set_scale(1.4)
	t.between(reloaded.scale_value(), 0.7, 1.6, "control scale is clamped to a usable range")
	reloaded.set_left_handed(true)
	t.equal(reloaded.layout["fire"]["pos"][0], 0.5, "mirroring keeps centred controls centred")
	t.not_equal(reloaded.layout["map"]["pos"][0], touch.DEFAULT_LAYOUT["map"]["pos"][0],
		"mirroring moves side controls to the other side")
	t.greater(float(reloaded.layout_summary().size()), 8.0, "the layout summary lists controls")

	# Input routing: movement vectors must never exceed unit length.
	touch.move_vector = Vector2(3.0, 4.0)
	t.less(touch.movement().length(), 1.01, "diagonal movement is clamped")
	touch.look_delta = Vector2(100, 0)
	var look := touch.consume_look()
	t.greater(look.x, 0.0, "look delta converts to radians")
	t.equal(touch.consume_look(), Vector2.ZERO, "the look delta is consumed once")
	t.greater(TouchControls.LOOK_SENSITIVITY_REFERENCE, 0.0, "look sensitivity is positive")

	# HUD helpers the player sees every match.
	t.ok(UiKit.rarity_color("legendary") != UiKit.rarity_color("common"),
		"rarity colours are distinct")
	t.greater(UiKit.TOUCH_MIN, 60.0, "minimum touch target is finger sized")
	t.ok(UiKit.icon("icon_fire") != null, "HUD icons are present")
	var theme := UiKit.theme()
	t.ok(theme != null, "a UI theme is built")
	# Clean up the test's own settings so a developer machine keeps its layout.
	Settings.controls.erase("touch_layout")
	Settings.controls["touch_scale"] = 1.0
	Settings.controls["left_handed"] = false
	Settings.persist()
