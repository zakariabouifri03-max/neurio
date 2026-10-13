class_name GameHud
extends Control
## In-match heads-up display.
##
## Everything the player needs mid-fight: health and armour, ammo and weapon,
## crosshair that opens with movement, hit markers and damage numbers, kill feed,
## zone timer with a minimap ring, inventory strip, interaction prompt, notices,
## scoreboard, buy-phase shop and the spectating banner.  It reads state from the
## match and never changes gameplay state itself.

signal buy_requested(weapon_id: String)
signal interact_pressed()
signal reload_pressed()
signal fire_started()
signal fire_stopped()

const FEED_LIFETIME := 5.0
const MAX_FEED_ROWS := 5
const DAMAGE_NUMBER_LIFETIME := 0.9

var match_ref: MatchManager = null
var player: PlayerController = null

var _health_bar: ProgressBar
var _armor_bar: ProgressBar
var _health_label: Label
var _armor_label: Label
var _ammo_label: Label
var _weapon_label: Label
var _reload_bar: ProgressBar
var _crosshair: Control
var _feed_box: VBoxContainer
var _notice_label: Label
var _prompt_label: Label
var _timer_label: Label
var _phase_label: Label
var _minimap: Control
var _inventory_row: HBoxContainer
var _scoreboard: PanelContainer
var _scoreboard_grid: GridContainer
var _buy_panel: PanelContainer
var _buy_grid: GridContainer
var _spectate_label: Label
var _hurt_overlay: ColorRect
var _build_label: Label
var _zone_ring: Control
var _feed_entries: Array = []
var _damage_numbers: Array = []
var _crosshair_spread: float = 12.0
var _hurt_timer: float = 0.0
var _scoreboard_visible: bool = false
var _buy_visible: bool = false

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build()
	set_process(true)

func _build() -> void:
	_hurt_overlay = ColorRect.new()
	_hurt_overlay.color = Color(0.7, 0.05, 0.05, 0.0)
	_hurt_overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	_hurt_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_hurt_overlay)

	_crosshair = Control.new()
	UiKit.place(_crosshair, Control.PRESET_CENTER, Vector2(-60, -60), Vector2(120, 120))
	_crosshair.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_crosshair.draw.connect(_draw_crosshair)
	add_child(_crosshair)

	_build_status_panel()
	_build_feed()
	_build_minimap()
	_build_bottom_bar()
	_build_prompt()
	_build_notice()
	_build_scoreboard()
	_build_buy_panel()

	_spectate_label = UiKit.text("SPECTATING", UiKit.FONT_TITLE, UiKit.ACCENT_WARM,
		HORIZONTAL_ALIGNMENT_CENTER)
	UiKit.place(_spectate_label, Control.PRESET_CENTER_TOP, Vector2(-160, 120), Vector2(320, 40))
	_spectate_label.visible = false
	add_child(_spectate_label)

func _build_status_panel() -> void:
	var panel := UiKit.panel()
	UiKit.place(panel, Control.PRESET_BOTTOM_LEFT, Vector2(24, -164), Vector2(360, 140))
	add_child(panel)
	var column := UiKit.vbox(8)
	panel.add_child(column)
	var health_row := UiKit.hbox(10)
	_health_bar = UiKit.bar(100.0, 100.0, UiKit.SUCCESS, Vector2(220, 22))
	_health_label = UiKit.text("100", UiKit.FONT_BODY, UiKit.TEXT)
	health_row.add_child(_health_bar)
	health_row.add_child(_health_label)
	column.add_child(health_row)
	var armor_row := UiKit.hbox(10)
	_armor_bar = UiKit.bar(0.0, 100.0, Color(0.42, 0.62, 0.95), Vector2(220, 14))
	_armor_label = UiKit.text("0", UiKit.FONT_SMALL, UiKit.TEXT_DIM)
	armor_row.add_child(_armor_bar)
	armor_row.add_child(_armor_label)
	column.add_child(armor_row)
	_inventory_row = UiKit.hbox(8)
	column.add_child(_inventory_row)

func _build_feed() -> void:
	_feed_box = UiKit.vbox(6)
	UiKit.place(_feed_box, Control.PRESET_TOP_RIGHT, Vector2(-420, 96), Vector2(400, 120))
	_feed_box.alignment = BoxContainer.ALIGNMENT_END
	add_child(_feed_box)

func _build_minimap() -> void:
	_minimap = Control.new()
	UiKit.place(_minimap, Control.PRESET_TOP_LEFT, Vector2(24, 96), Vector2(200, 200))
	_minimap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_minimap.draw.connect(_draw_minimap)
	add_child(_minimap)
	_timer_label = UiKit.text("", UiKit.FONT_BODY, UiKit.TEXT, HORIZONTAL_ALIGNMENT_CENTER)
	UiKit.place(_timer_label, Control.PRESET_TOP_LEFT, Vector2(24, 300), Vector2(200, 30))
	add_child(_timer_label)
	_phase_label = UiKit.text("", UiKit.FONT_SMALL, UiKit.TEXT_DIM, HORIZONTAL_ALIGNMENT_CENTER)
	UiKit.place(_phase_label, Control.PRESET_TOP_LEFT, Vector2(24, 328), Vector2(200, 26))
	add_child(_phase_label)

func _build_bottom_bar() -> void:
	var row := UiKit.hbox(14)
	UiKit.place(row, Control.PRESET_BOTTOM_RIGHT, Vector2(-430, -120), Vector2(406, 96))
	add_child(row)
	_weapon_label = UiKit.text("", UiKit.FONT_BODY, UiKit.TEXT, HORIZONTAL_ALIGNMENT_RIGHT)
	_weapon_label.custom_minimum_size = Vector2(260, 30)
	var column := UiKit.vbox(4)
	column.add_child(_weapon_label)
	_ammo_label = UiKit.text("", UiKit.FONT_TITLE, UiKit.TEXT, HORIZONTAL_ALIGNMENT_RIGHT)
	column.add_child(_ammo_label)
	_reload_bar = UiKit.bar(0.0, 1.0, UiKit.ACCENT_WARM, Vector2(240, 8))
	_reload_bar.visible = false
	column.add_child(_reload_bar)
	_build_label = UiKit.text("", UiKit.FONT_SMALL, UiKit.TEXT_DIM, HORIZONTAL_ALIGNMENT_RIGHT)
	column.add_child(_build_label)
	row.add_child(column)

func _build_prompt() -> void:
	_prompt_label = UiKit.text("", UiKit.FONT_BODY, UiKit.ACCENT, HORIZONTAL_ALIGNMENT_CENTER)
	UiKit.place(_prompt_label, Control.PRESET_CENTER, Vector2(-180, 60), Vector2(360, 34))
	_prompt_label.visible = false
	add_child(_prompt_label)

func _build_notice() -> void:
	_notice_label = UiKit.text("", UiKit.FONT_BODY, UiKit.TEXT, HORIZONTAL_ALIGNMENT_CENTER)
	UiKit.place(_notice_label, Control.PRESET_CENTER_TOP, Vector2(-280, 180), Vector2(560, 40))
	_notice_label.visible = false
	add_child(_notice_label)

func _build_scoreboard() -> void:
	_scoreboard = UiKit.panel()
	UiKit.place(_scoreboard, Control.PRESET_CENTER, Vector2(-260, -180), Vector2(520, 360))
	_scoreboard.visible = false
	add_child(_scoreboard)
	var column := UiKit.vbox(10)
	_scoreboard.add_child(column)
	column.add_child(UiKit.title("Scoreboard", UiKit.FONT_TITLE))
	_scoreboard_grid = UiKit.grid(4, 10)
	column.add_child(_scoreboard_grid)

func _build_buy_panel() -> void:
	_buy_panel = UiKit.panel()
	UiKit.place(_buy_panel, Control.PRESET_CENTER, Vector2(-300, -220), Vector2(600, 440))
	_buy_panel.visible = false
	add_child(_buy_panel)
	var column := UiKit.vbox(10)
	_buy_panel.add_child(column)
	column.add_child(UiKit.title("Buy Phase", UiKit.FONT_TITLE))
	_buy_grid = UiKit.grid(2, 10)
	var scroll := UiKit.scroll()
	scroll.custom_minimum_size = Vector2(560, 340)
	scroll.add_child(_buy_grid)
	column.add_child(scroll)

# ------------------------------------------------------------------- binding
func bind(match_manager: MatchManager, local_player: PlayerController) -> void:
	if match_ref != null:
		_disconnect_match()
	match_ref = match_manager
	player = local_player
	if match_ref != null:
		match_ref.kill_feed.connect(_on_kill_feed)
		match_ref.notice.connect(_on_notice)
		match_ref.buy_phase_changed.connect(_on_buy_phase)
		match_ref.spectate_target_changed.connect(_on_spectate_target)
	if player != null:
		player.health_changed.connect(_on_health_changed)
		player.weapons.ammo_changed.connect(_on_ammo_changed)
		player.weapons.reload_state_changed.connect(_on_reload_state)
		player.weapons.weapon_switched.connect(_on_weapon_switched)
		player.weapons.hit_confirmed.connect(_on_hit_confirmed)
		player.weapons.dry_fire.connect(_on_dry_fire)
		player.damaged.connect(_on_damaged)
		if player.inventory != null:
			player.inventory.changed.connect(_refresh_inventory)
		if player.interaction != null:
			player.interaction.target_changed.connect(_on_target_changed)
		_refresh_inventory()
		_on_health_changed(player.health, player.armor)
		_on_ammo_changed(player.weapons.current_magazine(), player.weapons.current_reserve())
		_on_weapon_switched(player.weapons.current_weapon_id(), player.weapons.active_slot)

func _disconnect_match() -> void:
	if match_ref.kill_feed.is_connected(_on_kill_feed):
		match_ref.kill_feed.disconnect(_on_kill_feed)
	if match_ref.notice.is_connected(_on_notice):
		match_ref.notice.disconnect(_on_notice)
	if match_ref.buy_phase_changed.is_connected(_on_buy_phase):
		match_ref.buy_phase_changed.disconnect(_on_buy_phase)

func _process(delta: float) -> void:
	_update_hurt(delta)
	_update_crosshair(delta)
	_update_feed(delta)
	_update_timer()
	if match != null and match_ref.zone != null:
		_minimap.queue_redraw()
	if Input.is_action_just_pressed("scoreboard"):
		_toggle_scoreboard()
	_refresh_damage_numbers(delta)

# ------------------------------------------------------------------- health
func _on_health_changed(health: float, armor: float) -> void:
	var maximum := float(GameConfig.PLAYER["max_health"])
	_health_bar.max_value = maximum
	_health_bar.value = health
	_health_bar.add_theme_stylebox_override("fill", UiKit.panel_box(
		_color_for_health(health / maximum), 6))
	_health_label.text = str(int(round(health)))
	var armor_max := maxf(1.0, float(ContentDB.armor_tier(maxi(1, player.armor_tier if player != null else 1))
		.get("max", 100)))
	_armor_bar.max_value = armor_max
	_armor_bar.value = armor
	_armor_label.text = str(int(round(armor)))
	_armor_label.visible = armor > 0.0

func _color_for_health(ratio: float) -> Color:
	if ratio > 0.6:
		return UiKit.SUCCESS
	if ratio > 0.3:
		return Color(0.95, 0.75, 0.25)
	return UiKit.DANGER

func _on_damaged(_amount: float, _attacker_id: String, _direction: Vector3) -> void:
	_hurt_timer = 0.45

func _update_hurt(delta: float) -> void:
	if _hurt_timer <= 0.0:
		return
	_hurt_timer = maxf(0.0, _hurt_timer - delta)
	_hurt_overlay.color = Color(0.7, 0.05, 0.05, 0.28 * (_hurt_timer / 0.45))

# ------------------------------------------------------------------- weapon
func _on_ammo_changed(magazine: int, reserve: int) -> void:
	_ammo_label.text = "%d / %d" % [magazine, reserve]

func _on_weapon_switched(weapon_id: String, slot: String) -> void:
	var weapon := ContentDB.weapon(weapon_id)
	_weapon_label.text = "%s [%s]" % [str(weapon.get("display_name", weapon_id)),
		slot.capitalize()]
	_weapon_label.add_theme_color_override("font_color", UiKit.rarity_color(
		str(weapon.get("rarity", "common"))))

func _on_reload_state(reloading: bool, progress: float) -> void:
	_reload_bar.visible = reloading
	_reload_bar.value = progress

func _on_dry_fire() -> void:
	_notice_label.text = "Reload!"
	_notice_label.add_theme_color_override("font_color", UiKit.DANGER)
	_notice_label.visible = true
	var timer := get_tree().create_timer(0.7)
	timer.timeout.connect(func() -> void:
		if _notice_label.text == "Reload!":
			_notice_label.visible = false)

func _on_hit_confirmed(_target: Node, damage: float, headshot: bool) -> void:
	_add_damage_number(damage, headshot)
	_crosshair_spread = maxf(4.0, _crosshair_spread * 0.9)

func _add_damage_number(damage: float, headshot: bool) -> void:
	var label := UiKit.text(str(int(round(damage))), UiKit.FONT_BODY,
		UiKit.DANGER if headshot else UiKit.TEXT, HORIZONTAL_ALIGNMENT_CENTER)
	label.position = _crosshair.size * 0.5 + Vector2(
		randf_range(-40.0, 40.0), randf_range(-60.0, -10.0))
	label.size = Vector2(90, 30)
	_crosshair.add_child(label)
	_damage_numbers.append({"node": label, "time": DAMAGE_NUMBER_LIFETIME})

func _refresh_damage_numbers(delta: float) -> void:
	var remaining: Array = []
	for entry: Variant in _damage_numbers:
		var data: Dictionary = entry
		var node: Label = data["node"]
		if not is_instance_valid(node):
			continue
		var time := float(data["time"]) - delta
		if time <= 0.0:
			node.queue_free()
			continue
		node.position.y -= delta * 30.0
		node.modulate.a = clampf(time / DAMAGE_NUMBER_LIFETIME, 0.0, 1.0)
		data["time"] = time
		remaining.append(data)
	_damage_numbers = remaining

# ------------------------------------------------------------------- crosshair
func _update_crosshair(delta: float) -> void:
	var target_spread := 12.0
	if player != null:
		target_spread += player.weapons.current_spread_degrees() * 3.2
		var speed := Vector2(player.velocity.x, player.velocity.z).length()
		target_spread += speed * 1.4
	_crosshair_spread = move_toward(_crosshair_spread, target_spread, delta * 60.0)
	_crosshair.queue_redraw()

func _draw_crosshair() -> void:
	if _crosshair == null:
		return
	var center := Vector2(_crosshair.size.x * 0.5, _crosshair.size.y * 0.5)
	var color := Color(1, 1, 1, 0.85)
	var gap := _crosshair_spread * 0.5
	var length := 9.0
	for direction: Vector2 in [Vector2.RIGHT, Vector2.LEFT, Vector2.UP, Vector2.DOWN]:
		var start := center + direction * gap
		var end := start + direction * length
		_crosshair.draw_line(start, end, color, 2.0)
	_crosshair.draw_arc(center, 2.0, 0.0, TAU, 12, Color(1, 1, 1, 0.6), 1.0)
	if player != null and player.weapons.reloading:
		_crosshair.draw_arc(center, gap + 6.0, -PI * 0.5,
			-PI * 0.5 + TAU * (1.0 - player.weapons.reload_remaining
			/ maxf(0.01, float(player.weapons.current_weapon().get("reload_time", 1.0)))),
			32, UiKit.ACCENT_WARM, 3.0)

# ------------------------------------------------------------------- feed
func _on_kill_feed(entry: Dictionary) -> void:
	var label := UiKit.text("", UiKit.FONT_SMALL, UiKit.TEXT, HORIZONTAL_ALIGNMENT_RIGHT)
	label.text = "%s  >  %s" % [str(entry.get("killer", "?")), str(entry.get("victim", "?"))]
	if bool(entry.get("headshot", false)):
		label.text = "%s  HEADSHOT  >  %s" % [str(entry.get("killer", "?")),
			str(entry.get("victim", "?"))]
		label.add_theme_color_override("font_color", UiKit.ACCENT_WARM)
	_feed_box.add_child(label)
	_feed_entries.append({"node": label, "time": FEED_LIFETIME})
	if _feed_entries.size() > MAX_FEED_ROWS:
		var oldest: Dictionary = _feed_entries.pop_front()
		var node: Node = oldest["node"]
		if is_instance_valid(node):
			node.queue_free()

func _update_feed(delta: float) -> void:
	var remaining: Array = []
	for entry: Variant in _feed_entries:
		var data: Dictionary = entry
		var node: Label = data["node"]
		if not is_instance_valid(node):
			continue
		var time := float(data["time"]) - delta
		if time <= 0.0:
			node.queue_free()
			continue
		node.modulate.a = clampf(time / FEED_LIFETIME, 0.0, 1.0)
		data["time"] = time
		remaining.append(data)
	_feed_entries = remaining

func _on_notice(text: String, color: Color) -> void:
	_notice_label.text = text
	_notice_label.add_theme_color_override("font_color", color)
	_notice_label.visible = true
	var timer := get_tree().create_timer(2.6)
	timer.timeout.connect(func() -> void:
		if _notice_label.text == text:
			_notice_label.visible = false)

# ------------------------------------------------------------------- minimap
func _draw_minimap() -> void:
	if _minimap == null or match == null or match_ref.zone == null:
		return
	var zone := match_ref.zone
	var map_size := zone.bounds.size
	var scale_factor := minf(_minimap.size.x / maxf(1.0, map_size.x),
		_minimap.size.y / maxf(1.0, map_size.y))
	var origin := Vector2(-zone.bounds.position.x * scale_factor,
		-zone.bounds.position.y * scale_factor)
	_minimap.draw_rect(Rect2(Vector2.ZERO, _minimap.size), Color(0.05, 0.08, 0.12, 0.72))
	var to_map := func(point: Vector2) -> Vector2:
		return origin + point * scale_factor
	# Playable area, current zone and the next circle.
	_minimap.draw_rect(Rect2(to_map.call(zone.bounds.position),
		map_size * scale_factor), Color(0.15, 0.35, 0.2, 0.35), false, 2.0)
	var current: Vector2 = to_map.call(zone.center)
	_minimap.draw_arc(current, zone.radius * scale_factor, 0.0, TAU, 64,
		Color(0.95, 0.95, 0.95, 0.9), 3.0, true)
	var next: Vector2 = to_map.call(zone.target_center)
	_minimap.draw_arc(next, zone.target_radius * scale_factor, 0.0, TAU, 64,
		UiKit.ACCENT, 2.0, true)
	for node: Node in get_tree().get_nodes_in_group("damageable"):
		var other := node as PlayerController
		if other == null or not other.alive:
			continue
		var point: Vector2 = to_map.call(Vector2(other.global_position.x, other.global_position.z))
		var is_friend := player != null and other.team == player.team and other.team > 0
		var visible_to_player := player != null and player.global_position.distance_to(
			other.global_position) < 45.0
		if other == player:
			_minimap.draw_circle(point, 4.0, Color(0.35, 0.95, 0.45))
		elif is_friend:
			_minimap.draw_circle(point, 3.5, Color(0.4, 0.7, 1.0))
		elif visible_to_player or (match_ref.zone != null and match_ref.mode_id == "training"):
			_minimap.draw_circle(point, 3.0, Color(1.0, 0.35, 0.35))

func _update_timer() -> void:
	if match == null or match_ref.zone == null or player == null:
		return
	var seconds := match_ref.zone.time_until_shrink()
	_timer_label.text = "%d:%02d" % [int(seconds) / 60, int(seconds) % 60]
	var mode := match_ref.mode_data
	if match_ref.mode_id == "clash" or match_ref.mode_id == "arena":
		_timer_label.text = "Round %d" % match_ref.round_number
		_phase_label.text = "Score %s" % str(match_ref.score.get(player.team, 0))
		return
	if not bool((mode.get("zones", {}) as Dictionary).get("enabled", false)):
		_timer_label.text = "%d:%02d" % [int(match_ref.phase_timer) / 60, int(match_ref.phase_timer) % 60]
		_phase_label.text = "Training"
		return
	_phase_label.text = "Zone %d / %d" % [match_ref.zone.phase + 1, match_ref.zone.total_phases()]
	if match_ref.zone.is_inside(player.global_position):
		_timer_label.add_theme_color_override("font_color", UiKit.TEXT)
	else:
		_timer_label.add_theme_color_override("font_color", UiKit.DANGER)

# ------------------------------------------------------------------- inventory
func _refresh_inventory() -> void:
	if _inventory_row == null or player == null or player.inventory == null:
		return
	for child: Node in _inventory_row.get_children():
		child.queue_free()
	var inventory := player.inventory
	_inventory_row.add_child(_item_chip("medkit", inventory.count("medkit")))
	_inventory_row.add_child(_item_chip("shield_cell", inventory.count("shield_cell")))
	_inventory_row.add_child(_item_chip("fragshard", inventory.count("fragshard")))
	_inventory_row.add_child(_item_chip("build_block", inventory.build_blocks))
	if _build_label != null:
		var building := player.building
		if building != null:
			_build_label.text = "Build: %s  %s  (%d)" % [building.current_material_name(),
				BuildingService.Piece.keys()[building.piece].capitalize(),
				building.blocks_available()]

func _item_chip(item_id: String, count: int) -> Control:
	var item := ContentDB.item(item_id)
	var row := UiKit.hbox(4)
	var color := UiKit.TEXT if count > 0 else Color(1, 1, 1, 0.25)
	row.add_child(UiKit.text(str(item.get("name", item_id)).substr(0, 3).to_upper(),
		UiKit.FONT_SMALL, color))
	row.add_child(UiKit.text("x%d" % count, UiKit.FONT_SMALL, color))
	if item_id == "fragshard":
		var weapons := player.weapons
		if weapons != null:
			row.add_child(UiKit.text("(%d)" % weapons.current_magazine(), UiKit.FONT_SMALL, color))
	return row

# ------------------------------------------------------------------- prompt
func _on_target_changed(target: Node) -> void:
	if target == null:
		_prompt_label.visible = false
		return
	var label := "Pick up"
	if target is LootPickup:
		var pickup := target as LootPickup
		label = "Pick up %s" % pickup.item_id
	elif target is LootContainer:
		var container := target as LootContainer
		label = "Open %s (%d left)" % [container.container_type.capitalize(),
			container.remaining_count()]
	_prompt_label.text = "%s  [INTERACT]" % label
	_prompt_label.visible = true

# ------------------------------------------------------------------- panels
func _toggle_scoreboard() -> void:
	_scoreboard_visible = not _scoreboard_visible
	_scoreboard.visible = _scoreboard_visible
	if _scoreboard_visible:
		_refresh_scoreboard()

func _refresh_scoreboard() -> void:
	if match == null or _scoreboard_grid == null:
		return
	for child: Node in _scoreboard_grid.get_children():
		child.queue_free()
	for header: String in ["Player", "Team", "Kills", "Status"]:
		_scoreboard_grid.add_child(UiKit.text(header, UiKit.FONT_SMALL, UiKit.ACCENT))
	for row: Variant in match_ref.scoreboard():
		var entry: Dictionary = row
		_scoreboard_grid.add_child(UiKit.text(str(entry.get("name", "?")), UiKit.FONT_SMALL,
			UiKit.ACCENT_WARM if bool(entry.get("is_local", false)) else UiKit.TEXT))
		_scoreboard_grid.add_child(UiKit.text(str(entry.get("team", 0)), UiKit.FONT_SMALL))
		_scoreboard_grid.add_child(UiKit.text(str(entry.get("kills", 0)), UiKit.FONT_SMALL))
		_scoreboard_grid.add_child(UiKit.text("Alive %d HP" % int(entry.get("health", 0))
			if bool(entry.get("alive", false)) else "Eliminated", UiKit.FONT_SMALL,
			UiKit.SUCCESS if bool(entry.get("alive", false)) else UiKit.DANGER))

func _on_buy_phase(active: bool, seconds_left: float) -> void:
	_buy_visible = active
	_buy_panel.visible = active
	if not active:
		return
	for child: Node in _buy_grid.get_children():
		child.queue_free()
	for option: Variant in match_ref.buy_options():
		var entry: Dictionary = option
		var button := UiKit.button("%s  %d" % [str(entry.get("name", "")),
			int(entry.get("price", 0))], func() -> void:
				buy_requested.emit(str(entry.get("id", ""))), false, 260.0)
		button.add_theme_color_override("font_color", UiKit.rarity_color(
			str(entry.get("rarity", "common"))))
		_buy_grid.add_child(button)
	_notice_label.text = "Buy phase: %d s" % int(seconds_left)
	_notice_label.visible = true

func _on_spectate_target(target: PlayerController) -> void:
	if target == null:
		_spectate_label.visible = false
		return
	_spectate_label.text = "SPECTATING %s" % target.display_name.to_upper()
	_spectate_label.visible = true

## Called by the match when the local player dies.
func set_dead(dead: bool) -> void:
	_spectate_label.visible = dead
	if dead:
		_spectate_label.text = "ELIMINATED - SPECTATING"

func set_zone_damage_warning(active: bool) -> void:
	_notice_label.text = "OUTSIDE THE ZONE" if active else ""
	_notice_label.add_theme_color_override("font_color", UiKit.DANGER)
	_notice_label.visible = active
