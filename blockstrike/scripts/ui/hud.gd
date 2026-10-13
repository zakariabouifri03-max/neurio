class_name HUD
extends Control
## In-match heads-up display: health/armour, ammo, crosshair, hit markers,
## messages, location name and the elimination overlay. Pure presentation:
## it receives values from the match and never reads gameplay state itself.

var _health_bar: ProgressBar
var _health_label: Label
var _armor_label: Label
var _ammo_label: Label
var _weapon_label: Label
var _reload_bar: ProgressBar
var _match_label: Label
var _location_label: Label
var _message_label: Label
var _fps_label: Label
var _damage_flash: ColorRect
var _eliminated_panel: PanelContainer
var _eliminated_label: Label
var _hit_marker_timer := 0.0
var _hit_headshot := false
var _spread_px := 10.0
var _aiming := false
var _message_timer := 0.0
var _flash_timer := 0.0


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	process_mode = Node.PROCESS_MODE_PAUSABLE
	_build()


func _build() -> void:
	_damage_flash = ColorRect.new()
	_damage_flash.color = Color(0.9, 0.05, 0.05, 0.0)
	_damage_flash.set_anchors_preset(Control.PRESET_FULL_RECT)
	_damage_flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_damage_flash)

	_match_label = _make_label(HORIZONTAL_ALIGNMENT_LEFT, 18)
	_match_label.position = Vector2(20, 14)
	_health_label = _make_label(HORIZONTAL_ALIGNMENT_LEFT, 20)
	_health_label.position = Vector2(20, 58)
	_health_bar = ProgressBar.new()
	_health_bar.position = Vector2(20, 86)
	_health_bar.size = Vector2(240, 16)
	_health_bar.show_percentage = false
	_health_bar.max_value = 100.0
	add_child(_health_bar)
	_armor_label = _make_label(HORIZONTAL_ALIGNMENT_LEFT, 16)
	_armor_label.position = Vector2(20, 108)
	_armor_label.modulate = Color(0.6, 0.85, 1.0)

	_location_label = _make_label(HORIZONTAL_ALIGNMENT_CENTER, 18)
	_location_label.set_anchors_preset(Control.PRESET_TOP_WIDE)
	_location_label.offset_top = 14
	_location_label.offset_bottom = 40

	_message_label = _make_label(HORIZONTAL_ALIGNMENT_CENTER, 22)
	_message_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_message_label.position = Vector2(-420, 52)
	_message_label.size = Vector2(840, 40)
	_message_label.modulate.a = 0.0

	_weapon_label = _make_label(HORIZONTAL_ALIGNMENT_RIGHT, 18)
	_weapon_label.anchor_left = 1.0
	_weapon_label.anchor_right = 1.0
	_weapon_label.position = Vector2(-340, 440)
	_weapon_label.size = Vector2(320, 26)
	_ammo_label = _make_label(HORIZONTAL_ALIGNMENT_RIGHT, 36)
	_ammo_label.anchor_left = 1.0
	_ammo_label.anchor_right = 1.0
	_ammo_label.position = Vector2(-340, 470)
	_ammo_label.size = Vector2(320, 46)
	_reload_bar = ProgressBar.new()
	_reload_bar.anchor_left = 1.0
	_reload_bar.anchor_right = 1.0
	_reload_bar.position = Vector2(-260, 420)
	_reload_bar.size = Vector2(240, 10)
	_reload_bar.show_percentage = false
	_reload_bar.visible = false
	add_child(_reload_bar)

	_fps_label = _make_label(HORIZONTAL_ALIGNMENT_RIGHT, 14)
	_fps_label.anchor_left = 1.0
	_fps_label.anchor_right = 1.0
	_fps_label.position = Vector2(-160, 14)
	_fps_label.size = Vector2(140, 20)
	_fps_label.visible = bool(AppSettings.get_value("show_fps"))

	_eliminated_panel = PanelContainer.new()
	_eliminated_panel.set_anchors_preset(Control.PRESET_CENTER)
	_eliminated_panel.position = Vector2(-220, -60)
	_eliminated_panel.size = Vector2(440, 120)
	_eliminated_panel.visible = false
	add_child(_eliminated_panel)
	_eliminated_label = _make_label(HORIZONTAL_ALIGNMENT_CENTER, 24, _eliminated_panel)
	_eliminated_label.autowrap_mode = TextServer.AUTOWRAP_WORD

	AppSettings.changed.connect(_on_setting_changed)
	set_health(100, 100)
	set_armor(0)
	set_ammo(0, 0)
	set_weapon_name("")


func _make_label(align: HorizontalAlignment, font_size: int, parent: Control = null) -> Label:
	var l := Label.new()
	l.horizontal_alignment = align
	l.add_theme_font_size_override("font_size", font_size)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.9))
	l.add_theme_constant_override("outline_size", 6)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if parent == null:
		add_child(l)
	else:
		parent.add_child(l)
	return l


func _on_setting_changed(key: String, value: Variant) -> void:
	if key == "show_fps" or key == "":
		_fps_label.visible = bool(AppSettings.get_value("show_fps"))


func set_match_text(text: String) -> void:
	_match_label.text = text


func set_health(current: int, maximum: int) -> void:
	_health_bar.max_value = maximum
	_health_bar.value = current
	_health_label.text = "HP %d" % current


func set_armor(value: int) -> void:
	_armor_label.text = "ARMOR %d" % value
	_armor_label.visible = value > 0


func set_weapon_name(text: String) -> void:
	_weapon_label.text = text


func set_ammo(magazine: int, reserve: int) -> void:
	_ammo_label.text = "%d / %d" % [magazine, reserve]


func set_reload_progress(fraction: float) -> void:
	_reload_bar.visible = fraction > 0.0 and fraction < 1.0
	_reload_bar.value = fraction * 100.0


func set_location(text: String) -> void:
	_location_label.text = text


func set_crosshair(spread_px: float, aiming: bool) -> void:
	var new_spread := maxf(spread_px, 4.0)
	if absf(new_spread - _spread_px) > 0.2 or aiming != _aiming:
		_spread_px = new_spread
		_aiming = aiming
		queue_redraw()


func show_message(text: String, seconds: float = 2.5) -> void:
	_message_label.text = text
	_message_label.modulate.a = 1.0
	_message_timer = seconds


func show_eliminated(text: String) -> void:
	_eliminated_label.text = text
	_eliminated_panel.visible = true


func hide_eliminated() -> void:
	_eliminated_panel.visible = false


func flash_hit(headshot: bool) -> void:
	_hit_marker_timer = 0.25
	_hit_headshot = headshot
	queue_redraw()


func flash_damage() -> void:
	_flash_timer = 0.35


func _process(delta: float) -> void:
	if _message_timer > 0.0:
		_message_timer -= delta
		if _message_timer <= 0.0:
			_message_label.modulate.a = 0.0
	if _hit_marker_timer > 0.0:
		_hit_marker_timer -= delta
		queue_redraw()
	if _flash_timer > 0.0:
		_flash_timer = maxf(_flash_timer - delta, 0.0)
		_damage_flash.color.a = 0.32 * (_flash_timer / 0.35)
	elif _damage_flash.color.a > 0.0:
		_damage_flash.color.a = 0.0
	if _fps_label.visible:
		_fps_label.text = "%d FPS" % Engine.get_frames_per_second()


func _draw() -> void:
	var c := get_viewport_rect().size * 0.5
	var g := Color(1, 1, 1, 0.9)
	var gap := _spread_px + (0.0 if _aiming else 4.0)
	var len := 9.0
	draw_line(c + Vector2(-gap - len, 0), c + Vector2(-gap, 0), g, 2.0)
	draw_line(c + Vector2(gap, 0), c + Vector2(gap + len, 0), g, 2.0)
	draw_line(c + Vector2(0, -gap - len), c + Vector2(0, -gap), g, 2.0)
	draw_line(c + Vector2(0, gap), c + Vector2(0, gap + len), g, 2.0)
	draw_circle(c, 1.5, g)
	if _hit_marker_timer > 0.0:
		var hc := Color(1.0, 0.25, 0.2, 1.0) if _hit_headshot else Color(1, 1, 1, 1)
		var s := 12.0
		draw_line(c + Vector2(-s, -s), c + Vector2(-s * 0.4, -s * 0.4), hc, 3.0)
		draw_line(c + Vector2(s, -s), c + Vector2(s * 0.4, -s * 0.4), hc, 3.0)
		draw_line(c + Vector2(-s, s), c + Vector2(-s * 0.4, s * 0.4), hc, 3.0)
		draw_line(c + Vector2(s, s), c + Vector2(s * 0.4, s * 0.4), hc, 3.0)
