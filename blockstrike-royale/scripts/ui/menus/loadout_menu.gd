class_name LoadoutMenu
extends Control
## Loadout screen: pick the primary, secondary, melee and throwable carried into
## a match.
##
## Weapons come from data/weapons.json, and the choice is stored in the save file
## (`flags.loadout`) and merged into the match settings by the lobby, so what is
## shown here is exactly what spawns in the match.  Training Ground additionally
## allows anything, because practising with locked weapons is the point.

var _slots: Dictionary = {}       ## slot -> weapon_id
var _slot_rows: Dictionary = {}   ## slot -> OptionButton
var _stats_label: Label
var _training_note: Label
var _slot_options: Dictionary = {}

const SLOT_ORDER := ["primary", "secondary", "melee", "throwable"]
const SLOT_CATEGORIES := {
	"primary": ["ar", "smg", "shotgun", "sniper", "lmg"],
	"secondary": ["pistol"],
	"melee": ["melee"],
	"throwable": ["throwable"],
}

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	UiKit.apply_theme(self)
	_load_current()
	_build()

func _load_current() -> void:
	var saved: Dictionary = SaveManager.data.flags.get("loadout", {})
	var defaults: Dictionary = ContentDB.section("weapons").get("default_loadout", {})
	for slot: String in SLOT_ORDER:
		var weapon_id := str(saved.get(slot, defaults.get(slot, "")))
		if not ContentDB.has_weapon(weapon_id):
			weapon_id = str(defaults.get(slot, ""))
		_slots[slot] = weapon_id

func _build() -> void:
	var root := UiKit.vbox(14)
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.offset_left = 40
	root.offset_top = 32
	root.offset_right = -40
	root.offset_bottom = -32
	add_child(root)
	var header := UiKit.hbox(16)
	header.add_child(UiKit.button("Back", func() -> void: GameRouter.goto_menu(), false, 140.0))
	header.add_child(UiKit.title("Loadout", UiKit.FONT_TITLE))
	root.add_child(header)
	root.add_child(UiKit.text("Training Ground allows every weapon. Battle Royale uses the " \
		+ "map's loot; Clash Squad and Arena use the mode's buy list.", UiKit.FONT_SMALL,
		UiKit.TEXT_DIM))

	var columns := UiKit.hbox(24)
	root.add_child(columns)
	var left := UiKit.vbox(12)
	left.custom_minimum_size = Vector2(560, 0)
	columns.add_child(left)
	for slot: String in SLOT_ORDER:
		left.add_child(_slot_row(slot))

	var right := UiKit.vbox(10)
	right.custom_minimum_size = Vector2(520, 0)
	columns.add_child(right)
	_stats_label = UiKit.text("", UiKit.FONT_BODY, UiKit.TEXT)
	right.add_child(_stats_label)

	var buttons := UiKit.hbox(12)
	buttons.add_child(UiKit.button("Save loadout", _save, true, 240.0))
	buttons.add_child(UiKit.button("Reset to default", _reset, false, 240.0))
	right.add_child(buttons)
	_training_note = UiKit.text("", UiKit.FONT_SMALL, UiKit.TEXT_DIM)
	right.add_child(_training_note)
	_refresh()

func _slot_row(slot: String) -> Control:
	var panel := UiKit.panel(UiKit.BG_PANEL_SOFT)
	var column := UiKit.vbox(6)
	panel.add_child(column)
	column.add_child(UiKit.title(slot.capitalize(), UiKit.FONT_BODY))
	var options := _weapons_for_slot(slot)
	var names: Array = []
	for entry: Dictionary in options:
		names.append("%s  (%s)" % [str(entry.get("display_name", entry.get("id", ""))),
			str(entry.get("category", "")).to_upper()])
	if names.is_empty():
		names.append("None")
	var option := UiKit.option(names, 0, func(index: int) -> void:
		if index >= 0 and index < options.size():
			_slots[slot] = str((options[index] as Dictionary).get("id", ""))
			_refresh())
	column.add_child(option)
	_slot_rows[slot] = option
	_slot_options[slot] = options
	return panel

func _weapons_for_slot(slot: String) -> Array:
	var out: Array = []
	var categories: Array = SLOT_CATEGORIES.get(slot, [])
	for weapon_id: String in ContentDB.weapon_ids():
		var weapon := ContentDB.weapon(weapon_id)
		if not categories.has(str(weapon.get("category", ""))):
			continue
		out.append(weapon)
	out.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return float(a.get("damage", 0.0)) > float(b.get("damage", 0.0)))
	return out

func _refresh() -> void:
	for slot: String in SLOT_ORDER:
		var option: OptionButton = _slot_rows.get(slot)
		if option == null:
			continue
		var options: Array = _slot_options.get(slot, [])
		var index := 0
		for i: int in options.size():
			if str((options[i] as Dictionary).get("id", "")) == str(_slots.get(slot, "")):
				index = i
				break
		option.selected = index
	if _stats_label == null:
		return
	var text := ""
	for slot: String in SLOT_ORDER:
		var weapon := ContentDB.weapon(str(_slots.get(slot, "")))
		if weapon.is_empty():
			continue
		text += "%s: %s\n" % [slot.capitalize(), str(weapon.get("display_name", ""))]
		text += "   damage %.0f  range %.0f m  rpm %.0f  mag %d\n" % [
			float(weapon.get("damage", 0.0)), float(weapon.get("effective_range", 0.0)),
			float(weapon.get("fire_rate", 0.0)) * 60.0, int(weapon.get("magazine", 0))]
	_stats_label.text = text
	if _training_note != null:
		_training_note.text = "Saved loadouts apply to Training Ground and offline modes."

func _save() -> void:
	SaveManager.data.flags["loadout"] = _slots.duplicate()
	SaveManager.mark_dirty()
	AudioDirector.play_ui("ui_confirm", -4.0)
	if _training_note != null:
		_training_note.text = "Loadout saved."

func _reset() -> void:
	SaveManager.data.flags.erase("loadout")
	SaveManager.mark_dirty()
	_load_current()
	_refresh()
