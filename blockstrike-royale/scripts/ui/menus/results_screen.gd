class_name ResultsScreen
extends Control
## End-of-match summary: outcome, placement, rewards and the way out.
##
## It shows the same numbers that were written to the save file, so what a player
## reads here is exactly what was stored - no decorative "fake" rewards.

signal rematch_requested()
signal menu_requested()

var _panel: PanelContainer
var _content: VBoxContainer
var _summary: Dictionary = {}

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	visible = false
	mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(UiKit.dim_overlay(0.42))
	_panel = UiKit.panel(UiKit.BG_PANEL, 22)
	UiKit.place(_panel, Control.PRESET_CENTER, Vector2(-340, -280), Vector2(680, 560))
	add_child(_panel)
	_content = UiKit.vbox(12)
	_panel.add_child(_content)

## Builds the screen for a match summary dictionary (see MatchManager.build_result).
func show_result(summary: Dictionary, rewards: Dictionary = {}) -> void:
	_summary = summary
	for child: Node in _content.get_children():
		child.queue_free()
	_content.add_child(UiKit.title(str(summary.get("outcome", "Match over")).capitalize(),
		UiKit.FONT_HUGE))
	var won := bool(summary.get("won", false))
	var banner := UiKit.text("VICTORY" if won else "DEFEAT", UiKit.FONT_TITLE,
		UiKit.SUCCESS if won else UiKit.DANGER, HORIZONTAL_ALIGNMENT_CENTER)
	_content.add_child(banner)
	var grid := UiKit.grid(2, 14)
	_row(grid, "Mode", str(ContentDB.mode(str(summary.get("mode", ""))).get("name",
		summary.get("mode", ""))))
	_row(grid, "Map", str(ContentDB.map_data(str(summary.get("map", ""))).get("name",
		summary.get("map", ""))))
	_row(grid, "Placement", "#%d of %d" % [int(summary.get("placement", 1)),
		int(summary.get("players", 1))])
	_row(grid, "Eliminations", str(int(summary.get("kills", 0))))
	_row(grid, "Damage dealt", str(int(summary.get("damage", 0))))
	var minutes := int(summary.get("duration", 0.0)) / 60
	var seconds := int(summary.get("duration", 0.0)) % 60
	_row(grid, "Duration", "%d:%02d" % [minutes, seconds])
	if not rewards.is_empty():
		_row(grid, "Coins earned", str(int(rewards.get("coins", 0))))
		_row(grid, "XP earned", str(int(rewards.get("xp", 0))))
		_row(grid, "Rank", Progression.current_rank().get("name", "Unranked"))
		if int(rewards.get("gems", 0)) > 0:
			_row(grid, "Gems earned", str(int(rewards.get("gems", 0))))
	_content.add_child(grid)
	var buttons := UiKit.hbox(12)
	buttons.add_child(UiKit.button("Rematch", func() -> void: rematch_requested.emit(), true, 220.0))
	buttons.add_child(UiKit.button("Main menu", func() -> void: menu_requested.emit(), false, 220.0))
	_content.add_child(buttons)
	visible = true

func _row(grid: GridContainer, label: String, value: String) -> void:
	grid.add_child(UiKit.text(label, UiKit.FONT_BODY, UiKit.TEXT_DIM))
	grid.add_child(UiKit.text(value, UiKit.FONT_BODY, UiKit.TEXT))

func hide_result() -> void:
	visible = false
