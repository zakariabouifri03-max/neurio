extends Control
## In-match HUD: minimap, health and ammo, kill feed, banners, prompts and the
## pause / inventory / results overlays. Everything here is driven by plain
## dictionaries from match_manager.gd, so the HUD holds no gameplay state.

const Minimap := preload("res://scripts/ui/minimap.gd")
const WDB := preload("res://scripts/weapons/weapon_db.gd")
const Inventory := preload("res://scripts/core/inventory.gd")

signal resume_pressed
signal quit_pressed
signal edit_layout_pressed
signal slot_pressed(index: int)
signal use_heal_pressed
signal drop_slot_pressed(index: int)
signal again_pressed
signal lobby_pressed
signal spectate_next_pressed

var _loading_bg: ColorRect
var _loading_label: Label
var _minimap
var _mode_label: Label
var _time_label: Label
var _alive_label: Label
var _zone_label: Label
var _hp_bar: ProgressBar
var _armor_bar: ProgressBar
var _stats_label: Label
var _weapon_label: Label
var _ammo_label: Label
var _slot_labels: Array = []
var _banner: Label
var _banner_t: float = 0.0
var _feed_box: VBoxContainer
var _prompt: Label
var _notify_label: Label
var _notify_t: float = 0.0
var _red_flash: ColorRect
var _zone_tint: ColorRect
var _crosshair
var _hit_t: float = 0.0
var _hit_head: bool = false
var _flash_t: float = 0.0
var _spectate_box: HBoxContainer
var _spectate_label: Label
var _fps_label: Label
var _pause_panel: PanelContainer
var _inv_panel: PanelContainer
var _inv_rows: Label
var _inv_heal_btn: Button
var _inv_slot_btns: Array = []
var _results_panel: PanelContainer
var _results_label: Label
var _last: Dictionary = {}
var _inv_open: bool = false
var _inv_refresh_t: float = 0.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build_gameplay()
	_build_pause()
	_build_inventory()
	_build_results()
	_build_loading()


# ---------------------------------------------------------------- building
func _place(c, ax: float, ay: float, ox: float, oy: float, w: float, h: float) -> void:
	c.anchor_left = ax
	c.anchor_right = ax
	c.anchor_top = ay
	c.anchor_bottom = ay
	c.offset_left = ox
	c.offset_top = oy
	c.offset_right = ox + w
	c.offset_bottom = oy + h


func _label(text: String, font_size: int, color: Color = Color.WHITE) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", font_size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.9))
	l.add_theme_constant_override("outline_size", 6)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


func _button(text: String, cb: Callable, w: float = 260.0) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(w, 46)
	b.add_theme_font_size_override("font_size", 20)
	b.pressed.connect(cb)
	return b


func _panel(bg: Color = Color(0.04, 0.06, 0.08, 0.92)) -> PanelContainer:
	var p := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.set_corner_radius_all(10)
	sb.set_content_margin_all(18)
	p.add_theme_stylebox_override("panel", sb)
	p.visible = false
	return p


func _build_gameplay() -> void:
	_red_flash = ColorRect.new()
	_red_flash.color = Color(0.9, 0.05, 0.05, 0.0)
	_red_flash.set_anchors_preset(Control.PRESET_FULL_RECT)
	_red_flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_red_flash)

	_zone_tint = ColorRect.new()
	_zone_tint.color = Color(0.9, 0.1, 0.05, 0.0)
	_zone_tint.set_anchors_preset(Control.PRESET_FULL_RECT)
	_zone_tint.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_zone_tint)

	_minimap = Minimap.new()
	_minimap.custom_minimum_size = Vector2(190, 190)
	_place(_minimap, 0, 0, 14, 14, 190, 190)
	add_child(_minimap)

	_mode_label = _label("", 15, Color(0.85, 0.92, 1.0))
	_place(_mode_label, 0, 0, 214, 14, 360, 26)
	add_child(_mode_label)

	_time_label = _label("00:00", 26)
	_time_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_place(_time_label, 0.5, 0, -110, 10, 220, 36)
	add_child(_time_label)

	_alive_label = _label("", 18, Color(1, 0.95, 0.7))
	_alive_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_place(_alive_label, 0.5, 0, -150, 46, 300, 28)
	add_child(_alive_label)

	_zone_label = _label("", 16, Color(1, 0.6, 0.55))
	_zone_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_place(_zone_label, 0.5, 0, -220, 74, 440, 26)
	add_child(_zone_label)

	_spectate_box = HBoxContainer.new()
	_spectate_box.add_theme_constant_override("separation", 14)
	_place(_spectate_box, 0.5, 0, -260, 104, 520, 44)
	_spectate_label = _label("", 18, Color(0.8, 0.95, 1.0))
	_spectate_box.add_child(_spectate_label)
	var nb := _button("NEXT", func() -> void: spectate_next_pressed.emit(), 110)
	_spectate_box.add_child(nb)
	_spectate_box.visible = false
	add_child(_spectate_box)

	var hp_box := VBoxContainer.new()
	hp_box.add_theme_constant_override("separation", 4)
	_place(hp_box, 0, 1, 14, -170, 300, 110)
	add_child(hp_box)
	_hp_bar = _bar(Color(0.25, 0.9, 0.35))
	hp_box.add_child(_hp_bar)
	_armor_bar = _bar(Color(0.35, 0.65, 1.0))
	_armor_bar.max_value = 100.0
	hp_box.add_child(_armor_bar)
	_stats_label = _label("", 15, Color(0.9, 0.95, 1.0))
	hp_box.add_child(_stats_label)

	var weap := VBoxContainer.new()
	_place(weap, 1, 0, -300, 14, 286, 140)
	add_child(weap)
	_weapon_label = _label("", 18, Color(1, 0.95, 0.8))
	_weapon_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	weap.add_child(_weapon_label)
	_ammo_label = _label("", 34)
	_ammo_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	weap.add_child(_ammo_label)
	var slots := HBoxContainer.new()
	slots.alignment = BoxContainer.ALIGNMENT_END
	weap.add_child(slots)
	for i in 3:
		var sl := _label("", 14)
		sl.custom_minimum_size = Vector2(88, 22)
		slots.add_child(sl)
		_slot_labels.append(sl)

	_feed_box = VBoxContainer.new()
	_feed_box.alignment = BoxContainer.ALIGNMENT_BEGIN
	_feed_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_place(_feed_box, 1, 0, -420, 150, 406, 150)
	add_child(_feed_box)

	_banner = _label("", 44, Color(1, 1, 1))
	_banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_place(_banner, 0.5, 0.36, -400, 0, 800, 70)
	add_child(_banner)

	_prompt = _label("", 18, Color(1, 0.95, 0.6))
	_prompt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_place(_prompt, 0.5, 0.62, -300, 0, 600, 30)
	add_child(_prompt)

	_notify_label = _label("", 18, Color(0.95, 0.98, 1.0))
	_notify_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_place(_notify_label, 0.5, 0.7, -300, 0, 600, 30)
	add_child(_notify_label)

	_crosshair = _Crosshair.new()
	_crosshair.set_anchors_preset(Control.PRESET_FULL_RECT)
	_crosshair.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_crosshair)

	_fps_label = _label("", 13, Color(0.7, 1, 0.7))
	_place(_fps_label, 0, 0, 14, 210, 120, 22)
	_fps_label.visible = false
	add_child(_fps_label)


func _bar(c: Color) -> ProgressBar:
	var b := ProgressBar.new()
	b.show_percentage = false
	b.max_value = 100.0
	b.custom_minimum_size = Vector2(300, 14)
	var fg := StyleBoxFlat.new()
	fg.bg_color = c
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(0, 0, 0, 0.55)
	b.add_theme_stylebox_override("fill", fg)
	b.add_theme_stylebox_override("background", bg)
	return b


func _build_pause() -> void:
	_pause_panel = _panel()
	_place(_pause_panel, 0.5, 0.5, -170, -160, 340, 320)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	_pause_panel.add_child(v)
	v.add_child(_label("PAUSED", 30))
	v.add_child(_button("Resume", func() -> void: resume_pressed.emit()))
	v.add_child(_button("Edit touch layout", func() -> void: edit_layout_pressed.emit()))
	v.add_child(_button("Quit to menu", func() -> void: quit_pressed.emit()))
	_pause_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_pause_panel)


func _build_inventory() -> void:
	_inv_panel = _panel()
	_place(_inv_panel, 0.5, 0.5, -330, -210, 660, 420)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	_inv_panel.add_child(v)
	v.add_child(_label("INVENTORY", 28))
	_inv_rows = _label("", 17)
	_inv_rows.autowrap_mode = TextServer.AUTOWRAP_WORD
	_inv_rows.custom_minimum_size = Vector2(600, 180)
	v.add_child(_inv_rows)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	v.add_child(row)
	for i in 3:
		var eq := _button("Equip %d" % (i + 1), func() -> void: slot_pressed.emit(i), 120)
		row.add_child(eq)
		_inv_slot_btns.append(eq)
	for i in 3:
		row.add_child(_button("Drop %d" % (i + 1), func() -> void: drop_slot_pressed.emit(i), 110))
	_inv_heal_btn = _button("Use healing", func() -> void: use_heal_pressed.emit(), 260)
	v.add_child(_inv_heal_btn)
	v.add_child(_label("Press TAB or I to close", 14, Color(0.7, 0.75, 0.8)))
	_inv_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_inv_panel)


func _build_results() -> void:
	_results_panel = _panel(Color(0.03, 0.05, 0.08, 0.96))
	_place(_results_panel, 0.5, 0.5, -270, -170, 540, 340)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	_results_panel.add_child(v)
	_results_label = _label("", 20)
	_results_label.autowrap_mode = TextServer.AUTOWRAP_WORD
	_results_label.custom_minimum_size = Vector2(480, 190)
	v.add_child(_results_label)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	v.add_child(row)
	row.add_child(_button("Play again", func() -> void: again_pressed.emit(), 230))
	row.add_child(_button("Lobby", func() -> void: lobby_pressed.emit(), 230))
	add_child(_results_panel)


func _build_loading() -> void:
	_loading_bg = ColorRect.new()
	_loading_bg.color = Color(0.02, 0.03, 0.05, 1.0)
	_loading_bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_loading_bg)
	_loading_label = _label("", 26)
	_loading_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_loading_label.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_loading_label)


# ---------------------------------------------------------------- public API
func set_loading(text: String) -> void:
	_loading_label.text = text
	_loading_bg.visible = text != ""
	_loading_label.visible = text != ""


func set_minimap(tex: Texture2D, map_size: Vector2) -> void:
	_minimap.set_map(tex, map_size)


func set_mode_name(text: String) -> void:
	_mode_label.text = text


func set_banner(text: String, time: float) -> void:
	_banner.text = text
	_banner_t = maxf(_banner_t, time)


func add_feed(text: String, color: Color = Color.WHITE) -> void:
	var l := _label(text, 16, color)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_feed_box.add_child(l)
	# queue_free() keeps the node in the container until the frame ends, so detach it first
	while _feed_box.get_child_count() > 5:
		var old: Node = _feed_box.get_child(0)
		_feed_box.remove_child(old)
		old.queue_free()
	var tw := create_tween()
	tw.tween_interval(6.0)
	tw.tween_callback(l.queue_free)


func hit_marker(_target, _damage: float, headshot: bool) -> void:
	_hit_t = 0.22
	_hit_head = headshot


func damage_flash(amount: float, _attacker) -> void:
	_flash_t = clampf(0.25 + amount / 60.0, 0.25, 0.7)


func set_prompt(text: String) -> void:
	_prompt.text = text


func notify(text: String) -> void:
	_notify_label.text = text
	_notify_t = 2.2


func set_spectating(on: bool) -> void:
	_spectate_box.visible = on


func set_spectate_target(name_text: String) -> void:
	_spectate_label.text = "Spectating  %s" % name_text


func set_pause_open(on: bool) -> void:
	_pause_panel.visible = on


func set_inventory_open(on: bool) -> void:
	_inv_open = on
	_inv_panel.visible = on
	if on:
		_refresh_inventory()


func show_results(r: Dictionary) -> void:
	var rw: Dictionary = r["rewards"]
	var title := "VICTORY ROYALE" if bool(r["won"]) else "ELIMINATED"
	var lines := []
	lines.append(title)
	lines.append("Placement: #%d" % int(r["placement"]))
	lines.append("Kills: %d   Headshots: %d" % [int(r["kills"]), int(r["headshots"])])
	lines.append("Survived: %s" % _fmt_time(float(r["time"])))
	lines.append("Rewards: +%d XP   +%d coins   +%d rank pts" % [int(rw["xp"]), int(rw["coins"]), int(rw["rank_points"])])
	if int(rw["level_after"]) > int(rw["level_before"]):
		lines.append("LEVEL UP!  Level %d" % int(rw["level_after"]))
	_results_label.text = "\n".join(lines)
	_results_panel.visible = true
	_spectate_box.visible = false


func update_state(s: Dictionary) -> void:
	_last = s
	var st: String = s["state"]
	if st == "countdown":
		_time_label.text = "00:00"
	else:
		_time_label.text = _fmt_time(float(s["time"]))
	_alive_label.text = "Alive  %d / %d" % [int(s["alive_count"]), int(s["total"])]
	if bool(s["br"]):
		var zone_txt := ""
		if bool(s["zone_shrinking"]):
			zone_txt = "ZONE CLOSING  %ds" % ceili(float(s["zone_next_in"]))
		elif int(s["zone_phase"]) >= 4:
			zone_txt = "FINAL CIRCLE"
		else:
			zone_txt = "ZONE %d  -  next in %ds" % [int(s["zone_phase"]) + 1, ceili(float(s["zone_next_in"]))]
		_zone_label.text = zone_txt
		_minimap.set_state(s["zone_center"], float(s["zone_radius"]), Vector2(s["player_pos"].x, s["player_pos"].z),
			float(s["player_yaw"]), s["supply"])
	else:
		_zone_label.text = ""
		_minimap.set_state(Vector2(56, 56), 999.0, Vector2(s["player_pos"].x, s["player_pos"].z),
			float(s["player_yaw"]), [])
	_minimap.visible = bool(s["br"])

	var alive: bool = s["alive"]
	_hp_bar.value = float(s["hp"]) if alive else 0.0
	_armor_bar.value = float(s["armor"])
	var items: Dictionary = s["items"]
	_stats_label.text = "HP %d   Armor %d   Kills %d   Bandage %d  Medkit %d  Plates %d  Blocks %d" % [
		int(s["hp"]), int(s["armor"]), int(s["kills"]), int(items.get("bandage", 0)), int(items.get("medkit", 0)),
		int(items.get("armor_plate", 0)), int(items.get("blocks", 0))]
	_weapon_label.text = str(s["weapon_name"])
	if bool(s["reloading"]):
		_ammo_label.text = "RELOADING"
	else:
		_ammo_label.text = "%d / %d" % [int(s["mag"]), int(s["reserve"])]
	var names: Array = s["slot_names"]
	for i in 3:
		var txt: String = names[i] if i < names.size() else ""
		_slot_labels[i].text = "[%d] %s" % [i + 1, txt if txt != "" else "-"]
		_slot_labels[i].add_theme_color_override("font_color",
			Color(1, 0.9, 0.3) if i == int(s["active"]) else Color(0.7, 0.75, 0.8))

	_fps_label.visible = bool(s["show_fps"])
	_fps_label.text = "%d FPS" % int(s["fps"])
	_zone_tint.color.a = lerpf(_zone_tint.color.a, 0.22 if bool(s["outside"]) else 0.0, 0.2)

	_tick(s)
	if _inv_open:
		_inv_refresh_t -= 0.1
		if _inv_refresh_t <= 0.0:
			_inv_refresh_t = 0.5
			_refresh_inventory()


func _tick(_s: Dictionary) -> void:
	var dt := get_process_delta_time()
	_banner_t = maxf(0.0, _banner_t - dt)
	if _banner_t <= 0.0 and _banner.text != "":
		_banner.text = ""
	_notify_t = maxf(0.0, _notify_t - dt)
	if _notify_t <= 0.0 and _notify_label.text != "":
		_notify_label.text = ""
	_hit_t = maxf(0.0, _hit_t - dt)
	_flash_t = maxf(0.0, _flash_t - dt)
	_red_flash.color.a = clampf(_flash_t * 1.8, 0.0, 0.55)
	_crosshair.set_hit(_hit_t, _hit_head)


func _refresh_inventory() -> void:
	if _last.is_empty():
		return
	var names: Array = _last["slot_names"]
	var ids: Array = _last["slot_ids"]
	var ammo: Dictionary = _last["ammo"]
	var items: Dictionary = _last["items"]
	var lines := []
	for i in 3:
		var nm: String = names[i] if i < names.size() else ""
		var wid: String = ids[i] if i < ids.size() else ""
		var line := "Slot %d:  %s" % [i + 1, nm if nm != "" else "(empty)"]
		if wid != "":
			line += "   [%s]" % WDB.get_def(wid)["kind"]
		lines.append(line)
		_inv_slot_btns[i].disabled = wid == ""
	lines.append("")
	lines.append("Ammo:  light %d   medium %d   shell %d   heavy %d" % [
		int(ammo.get("light", 0)), int(ammo.get("medium", 0)), int(ammo.get("shell", 0)), int(ammo.get("heavy", 0))])
	lines.append("Items: bandage %d   medkit %d   armor plates %d   grenades %d   build blocks %d" % [
		int(items.get("bandage", 0)), int(items.get("medkit", 0)), int(items.get("armor_plate", 0)), int(items.get("grenade", 0)), int(items.get("blocks", 0))])
	_inv_rows.text = "\n".join(lines)
	var can_heal := int(items.get("bandage", 0)) + int(items.get("medkit", 0)) + int(items.get("armor_plate", 0)) > 0
	_inv_heal_btn.disabled = not can_heal


static func _fmt_time(sec: float) -> String:
	var s := int(sec)
	return "%02d:%02d" % [s / 60, s % 60]


## Centre crosshair with a hit marker that flashes when a shot lands.
class _Crosshair:
	extends Control
	var _hit: float = 0.0
	var _head: bool = false

	func set_hit(t: float, head: bool) -> void:
		if t != _hit or head != _head:
			_hit = t
			_head = head
			queue_redraw()

	func _draw() -> void:
		var c := size * 0.5
		var col := Color(1, 1, 1, 0.85)
		draw_line(c + Vector2(-9, 0), c + Vector2(-4, 0), col, 2.0)
		draw_line(c + Vector2(4, 0), c + Vector2(9, 0), col, 2.0)
		draw_line(c + Vector2(0, -9), c + Vector2(0, -4), col, 2.0)
		draw_line(c + Vector2(0, 4), c + Vector2(0, 9), col, 2.0)
		if _hit > 0.0:
			var hc := Color(1.0, 0.25, 0.2) if _head else Color(1, 1, 1)
			draw_line(c + Vector2(-14, -14), c + Vector2(-7, -7), hc, 2.5)
			draw_line(c + Vector2(14, -14), c + Vector2(7, -7), hc, 2.5)
			draw_line(c + Vector2(-14, 14), c + Vector2(-7, 7), hc, 2.5)
			draw_line(c + Vector2(14, 14), c + Vector2(7, 7), hc, 2.5)
