class_name UI
extends RefCounted
## Theme builder, widget factories and vector icons drawn in code.

const BG := Color(0.07, 0.085, 0.14, 0.94)
const BG2 := Color(0.12, 0.145, 0.22, 0.96)
const LINE := Color(0.3, 0.38, 0.55, 0.9)
const ACCENT := Color(1.0, 0.62, 0.12)
const ACCENT2 := Color(0.22, 0.74, 1.0)
const GOOD := Color(0.3, 0.85, 0.45)
const BAD := Color(0.95, 0.3, 0.28)
const TEXT := Color(0.96, 0.97, 1.0)
const DIM := Color(0.68, 0.73, 0.84)
const GOLD := Color(1.0, 0.82, 0.25)
const GEM := Color(0.45, 0.85, 1.0)

static var font: Font
static var theme: Theme

static func build_theme() -> Theme:
	if theme:
		return theme
	# load() uses the imported font resource (exported builds do not contain the raw .woff2 file)
	var f = load("res://assets/fonts/LilitaOne-Regular.woff2") if ResourceLoader.exists("res://assets/fonts/LilitaOne-Regular.woff2") else null
	font = f if f is Font else ThemeDB.fallback_font
	theme = Theme.new()
	theme.default_font = font
	theme.default_font_size = 22
	theme.set_stylebox("normal", "Button", _box(Color(0.16, 0.2, 0.3), 12, LINE, 2))
	theme.set_stylebox("hover", "Button", _box(Color(0.2, 0.25, 0.37), 12, ACCENT2, 2))
	theme.set_stylebox("pressed", "Button", _box(Color(0.1, 0.13, 0.2), 12, ACCENT, 2))
	theme.set_stylebox("disabled", "Button", _box(Color(0.12, 0.13, 0.17, 0.7), 12, Color(0.25, 0.27, 0.32), 2))
	theme.set_stylebox("focus", "Button", StyleBoxEmpty.new())
	theme.set_color("font_color", "Button", TEXT)
	theme.set_color("font_hover_color", "Button", Color.WHITE)
	theme.set_color("font_pressed_color", "Button", ACCENT)
	theme.set_color("font_disabled_color", "Button", Color(0.5, 0.52, 0.58))
	theme.set_constant("outline_size", "Button", 0)
	theme.set_stylebox("panel", "PanelContainer", _box(BG, 16, LINE, 2))
	theme.set_stylebox("panel", "Panel", _box(BG, 16, LINE, 2))
	theme.set_color("font_color", "Label", TEXT)
	theme.set_color("font_outline_color", "Label", Color(0, 0, 0, 0.85))
	theme.set_constant("outline_size", "Label", 0)
	var le := _box(Color(0.05, 0.06, 0.1), 10, LINE, 2)
	le.content_margin_left = 12
	theme.set_stylebox("normal", "LineEdit", le)
	theme.set_stylebox("focus", "LineEdit", _box(Color(0.05, 0.06, 0.1), 10, ACCENT2, 2))
	theme.set_color("font_color", "LineEdit", TEXT)
	theme.set_stylebox("slider", "HSlider", _box(Color(0.05, 0.06, 0.1), 6, LINE, 1, 4))
	theme.set_stylebox("grabber_area", "HSlider", _box(ACCENT2, 6, Color(0, 0, 0, 0), 0, 4))
	theme.set_stylebox("grabber_area_highlight", "HSlider", _box(ACCENT, 6, Color(0, 0, 0, 0), 0, 4))
	theme.set_stylebox("background", "ProgressBar", _box(Color(0.05, 0.06, 0.1, 0.9), 6, Color(0, 0, 0, 0), 0, 0))
	theme.set_stylebox("fill", "ProgressBar", _box(ACCENT2, 6, Color(0, 0, 0, 0), 0, 0))
	theme.set_color("font_color", "CheckButton", TEXT)
	theme.set_color("font_color", "CheckBox", TEXT)
	theme.set_stylebox("panel", "PopupMenu", _box(BG2, 10, LINE, 2))
	theme.set_stylebox("normal", "OptionButton", _box(Color(0.16, 0.2, 0.3), 10, LINE, 2))
	theme.set_stylebox("hover", "OptionButton", _box(Color(0.2, 0.25, 0.37), 10, ACCENT2, 2))
	theme.set_stylebox("pressed", "OptionButton", _box(Color(0.1, 0.13, 0.2), 10, ACCENT, 2))
	theme.set_stylebox("panel", "TooltipPanel", _box(BG2, 8, LINE, 1))
	theme.set_stylebox("scroll", "VScrollBar", _box(Color(0, 0, 0, 0.25), 4, Color(0, 0, 0, 0), 0, 0))
	theme.set_stylebox("grabber", "VScrollBar", _box(Color(0.4, 0.48, 0.65, 0.8), 4, Color(0, 0, 0, 0), 0, 0))
	return theme

static func _box(bg: Color, radius: int, border: Color, bw: int, margin := 10) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.set_corner_radius_all(radius)
	s.border_color = border
	s.set_border_width_all(bw)
	s.content_margin_left = margin + 4
	s.content_margin_right = margin + 4
	s.content_margin_top = margin
	s.content_margin_bottom = margin
	s.anti_aliasing = true
	return s

static func box(bg: Color, radius := 14, border := Color(0, 0, 0, 0), bw := 0, margin := 10) -> StyleBoxFlat:
	return _box(bg, radius, border, bw, margin)

# ------------------------------------------------------------------ factories
static func label(text: String, size := 22, col := TEXT, outline := 0) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", col)
	if outline > 0:
		l.add_theme_constant_override("outline_size", outline)
		l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.9))
	return l

static func button(text: String, cb: Callable, style := "normal", min_size := Vector2(0, 54), fsize := 24) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = min_size
	b.add_theme_font_size_override("font_size", fsize)
	b.focus_mode = Control.FOCUS_NONE
	match style:
		"primary":
			b.add_theme_stylebox_override("normal", _box(ACCENT, 14, Color(1, 0.85, 0.5), 3))
			b.add_theme_stylebox_override("hover", _box(ACCENT.lightened(0.12), 14, Color(1, 0.9, 0.6), 3))
			b.add_theme_stylebox_override("pressed", _box(ACCENT.darkened(0.2), 14, Color(1, 0.85, 0.5), 3))
			b.add_theme_color_override("font_color", Color(0.15, 0.08, 0.0))
			b.add_theme_color_override("font_hover_color", Color(0.1, 0.05, 0.0))
			b.add_theme_color_override("font_pressed_color", Color(0.1, 0.05, 0.0))
		"good":
			b.add_theme_stylebox_override("normal", _box(Color(0.18, 0.62, 0.32), 12, GOOD, 2))
			b.add_theme_stylebox_override("hover", _box(Color(0.22, 0.7, 0.38), 12, GOOD.lightened(0.3), 2))
		"danger":
			b.add_theme_stylebox_override("normal", _box(Color(0.6, 0.16, 0.15), 12, BAD, 2))
			b.add_theme_stylebox_override("hover", _box(Color(0.7, 0.2, 0.18), 12, BAD.lightened(0.3), 2))
		"blue":
			b.add_theme_stylebox_override("normal", _box(Color(0.12, 0.42, 0.75), 12, ACCENT2, 2))
			b.add_theme_stylebox_override("hover", _box(Color(0.16, 0.5, 0.85), 12, ACCENT2.lightened(0.3), 2))
		"ghost":
			b.add_theme_stylebox_override("normal", _box(Color(1, 1, 1, 0.06), 12, Color(1, 1, 1, 0.15), 1))
			b.add_theme_stylebox_override("hover", _box(Color(1, 1, 1, 0.12), 12, ACCENT2, 1))
	b.pressed.connect(func():
		Audio.click()
		cb.call())
	return b

static func vbox(sep := 10) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", sep)
	return v

static func hbox(sep := 10) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", sep)
	return h

static func margin(c: Control, m: int) -> MarginContainer:
	var mc := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		mc.add_theme_constant_override("margin_" + side, m)
	mc.add_child(c)
	return mc

static func panel(bg := BG, radius := 16, border := LINE) -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", _box(bg, radius, border, 2, 14))
	return p

static func spacer(w := 0, h := 0, expand := false) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(w, h)
	if expand:
		c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		c.size_flags_vertical = Control.SIZE_EXPAND_FILL
	return c

static func slider(min_v: float, max_v: float, step: float, value: float, cb: Callable) -> HSlider:
	var s := HSlider.new()
	s.min_value = min_v
	s.max_value = max_v
	s.step = step
	s.value = value
	s.custom_minimum_size = Vector2(260, 34)
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.value_changed.connect(cb)
	return s

static func check(text: String, on: bool, cb: Callable) -> CheckButton:
	var c := CheckButton.new()
	c.text = text
	c.button_pressed = on
	c.focus_mode = Control.FOCUS_NONE
	c.add_theme_font_size_override("font_size", 22)
	c.toggled.connect(func(v):
		Audio.click()
		cb.call(v))
	return c

static func options(items: Array, selected: int, cb: Callable) -> OptionButton:
	var o := OptionButton.new()
	for it in items:
		o.add_item(str(it))
	o.selected = clampi(selected, 0, maxi(0, items.size() - 1))
	o.focus_mode = Control.FOCUS_NONE
	o.add_theme_font_size_override("font_size", 22)
	o.custom_minimum_size = Vector2(200, 46)
	o.item_selected.connect(cb)
	return o

static func progress(v: float, max_v: float, col := ACCENT2, h := 14) -> ProgressBar:
	var p := ProgressBar.new()
	p.max_value = max_v
	p.value = v
	p.show_percentage = false
	p.custom_minimum_size = Vector2(120, h)
	p.add_theme_stylebox_override("fill", _box(col, 6, Color(0, 0, 0, 0), 0, 0))
	return p

static func fmt_time(sec: float) -> String:
	var s := int(maxf(0.0, sec))
	return "%d:%02d" % [s / 60, s % 60]

# ------------------------------------------------------------------ vector icons
static func draw_icon(ci: CanvasItem, name: String, c: Vector2, r: float, col: Color) -> void:
	var w := maxf(2.0, r * 0.14)
	match name:
		"fire":
			ci.draw_arc(c, r * 0.62, 0, TAU, 28, col, w, true)
			ci.draw_line(c + Vector2(-r * 0.9, 0), c + Vector2(-r * 0.3, 0), col, w, true)
			ci.draw_line(c + Vector2(r * 0.3, 0), c + Vector2(r * 0.9, 0), col, w, true)
			ci.draw_line(c + Vector2(0, -r * 0.9), c + Vector2(0, -r * 0.3), col, w, true)
			ci.draw_line(c + Vector2(0, r * 0.3), c + Vector2(0, r * 0.9), col, w, true)
			ci.draw_circle(c, r * 0.12, col)
		"aim":
			ci.draw_arc(c, r * 0.7, 0, TAU, 28, col, w, true)
			ci.draw_arc(c, r * 0.3, 0, TAU, 20, col, w * 0.8, true)
			ci.draw_line(c + Vector2(-r, 0), c + Vector2(r, 0), col, w * 0.6, true)
			ci.draw_line(c + Vector2(0, -r), c + Vector2(0, r), col, w * 0.6, true)
		"jump":
			ci.draw_colored_polygon(PackedVector2Array([c + Vector2(0, -r * 0.8), c + Vector2(r * 0.65, 0), c + Vector2(r * 0.25, 0),
				c + Vector2(r * 0.25, r * 0.7), c + Vector2(-r * 0.25, r * 0.7), c + Vector2(-r * 0.25, 0), c + Vector2(-r * 0.65, 0)]), col)
		"crouch":
			for k in 2:
				var y := -r * 0.35 + k * r * 0.45
				ci.draw_polyline(PackedVector2Array([c + Vector2(-r * 0.6, y), c + Vector2(0, y + r * 0.4), c + Vector2(r * 0.6, y)]), col, w * 1.2, true)
		"reload":
			ci.draw_arc(c, r * 0.6, -PI * 0.15, PI * 1.45, 24, col, w * 1.2, true)
			var tip := c + Vector2(cos(-PI * 0.15), sin(-PI * 0.15)) * r * 0.6
			ci.draw_colored_polygon(PackedVector2Array([tip + Vector2(-r * 0.32, -r * 0.05), tip + Vector2(r * 0.18, -r * 0.3), tip + Vector2(r * 0.12, r * 0.25)]), col)
		"heal":
			ci.draw_rect(Rect2(c - Vector2(r * 0.2, r * 0.65), Vector2(r * 0.4, r * 1.3)), col)
			ci.draw_rect(Rect2(c - Vector2(r * 0.65, r * 0.2), Vector2(r * 1.3, r * 0.4)), col)
		"build":
			var pts := PackedVector2Array([c + Vector2(0, -r * 0.7), c + Vector2(r * 0.65, -r * 0.35), c + Vector2(0, 0), c + Vector2(-r * 0.65, -r * 0.35)])
			ci.draw_colored_polygon(pts, col)
			ci.draw_colored_polygon(PackedVector2Array([c + Vector2(-r * 0.65, -r * 0.3), c + Vector2(-r * 0.03, 0.05 * r), c + Vector2(-r * 0.03, r * 0.75), c + Vector2(-r * 0.65, r * 0.4)]), col.darkened(0.25))
			ci.draw_colored_polygon(PackedVector2Array([c + Vector2(r * 0.65, -r * 0.3), c + Vector2(r * 0.03, 0.05 * r), c + Vector2(r * 0.03, r * 0.75), c + Vector2(r * 0.65, r * 0.4)]), col.darkened(0.45))
		"throw":
			ci.draw_rect(Rect2(c - Vector2(r * 0.45, r * 0.3), Vector2(r * 0.9, r * 0.9)), col)
			ci.draw_rect(Rect2(c - Vector2(r * 0.15, r * 0.6), Vector2(r * 0.3, r * 0.3)), col.darkened(0.3))
			ci.draw_arc(c + Vector2(r * 0.35, -r * 0.55), r * 0.2, 0, TAU, 12, col, w * 0.7, true)
		"interact":
			ci.draw_arc(c, r * 0.7, 0, TAU, 24, col, w, true)
			ci.draw_polyline(PackedVector2Array([c + Vector2(-r * 0.35, r * 0.05), c + Vector2(-r * 0.05, r * 0.35), c + Vector2(r * 0.4, -r * 0.3)]), col, w * 1.3, true)
		"map":
			ci.draw_rect(Rect2(c - Vector2(r * 0.7, r * 0.55), Vector2(r * 1.4, r * 1.1)), col, false, w)
			ci.draw_line(c + Vector2(-r * 0.23, -r * 0.55), c + Vector2(-r * 0.23, r * 0.55), col, w * 0.7)
			ci.draw_line(c + Vector2(r * 0.23, -r * 0.55), c + Vector2(r * 0.23, r * 0.55), col, w * 0.7)
		"bag":
			ci.draw_rect(Rect2(c - Vector2(r * 0.55, r * 0.4), Vector2(r * 1.1, r * 1.05)), col)
			ci.draw_arc(c + Vector2(0, -r * 0.4), r * 0.3, PI, TAU, 12, col, w, true)
			ci.draw_rect(Rect2(c - Vector2(r * 0.3, r * 0.05), Vector2(r * 0.6, r * 0.3)), col.darkened(0.35))
		"gear":
			for k in 8:
				var a := k * TAU / 8.0
				ci.draw_line(c + Vector2(cos(a), sin(a)) * r * 0.45, c + Vector2(cos(a), sin(a)) * r * 0.85, col, w * 1.8)
			ci.draw_circle(c, r * 0.55, col)
			ci.draw_circle(c, r * 0.22, Color(0.1, 0.12, 0.18))
		"emote":
			ci.draw_arc(c, r * 0.7, 0, TAU, 24, col, w, true)
			ci.draw_circle(c + Vector2(-r * 0.25, -r * 0.15), r * 0.09, col)
			ci.draw_circle(c + Vector2(r * 0.25, -r * 0.15), r * 0.09, col)
			ci.draw_arc(c + Vector2(0, r * 0.05), r * 0.35, 0.3, PI - 0.3, 12, col, w, true)
		"swap":
			ci.draw_line(c + Vector2(-r * 0.6, -r * 0.25), c + Vector2(r * 0.6, -r * 0.25), col, w)
			ci.draw_colored_polygon(PackedVector2Array([c + Vector2(r * 0.7, -r * 0.25), c + Vector2(r * 0.35, -r * 0.5), c + Vector2(r * 0.35, 0)]), col)
			ci.draw_line(c + Vector2(r * 0.6, r * 0.3), c + Vector2(-r * 0.6, r * 0.3), col, w)
			ci.draw_colored_polygon(PackedVector2Array([c + Vector2(-r * 0.7, r * 0.3), c + Vector2(-r * 0.35, r * 0.05), c + Vector2(-r * 0.35, r * 0.55)]), col)
		"pause":
			ci.draw_rect(Rect2(c - Vector2(r * 0.4, r * 0.5), Vector2(r * 0.28, r)), col)
			ci.draw_rect(Rect2(c + Vector2(r * 0.12, -r * 0.5), Vector2(r * 0.28, r)), col)
		"coin":
			ci.draw_circle(c, r, GOLD)
			ci.draw_arc(c, r * 0.7, 0, TAU, 20, GOLD.darkened(0.3), maxf(1.5, r * 0.15), true)
		"gem":
			ci.draw_colored_polygon(PackedVector2Array([c + Vector2(0, -r), c + Vector2(r * 0.85, -r * 0.2), c + Vector2(0, r), c + Vector2(-r * 0.85, -r * 0.2)]), GEM)
			ci.draw_colored_polygon(PackedVector2Array([c + Vector2(0, -r), c + Vector2(r * 0.85, -r * 0.2), c + Vector2(0, -r * 0.05)]), GEM.lightened(0.4))
		"chute":
			ci.draw_arc(c + Vector2(0, r * 0.1), r * 0.75, PI, TAU, 16, col, w * 1.5, true)
			ci.draw_line(c + Vector2(-r * 0.75, r * 0.1), c + Vector2(0, r * 0.8), col, w * 0.6)
			ci.draw_line(c + Vector2(r * 0.75, r * 0.1), c + Vector2(0, r * 0.8), col, w * 0.6)
		"skull":
			ci.draw_circle(c + Vector2(0, -r * 0.1), r * 0.6, col)
			ci.draw_rect(Rect2(c + Vector2(-r * 0.35, r * 0.3), Vector2(r * 0.7, r * 0.4)), col)
			ci.draw_circle(c + Vector2(-r * 0.22, -r * 0.1), r * 0.15, Color(0.1, 0.1, 0.12))
			ci.draw_circle(c + Vector2(r * 0.22, -r * 0.1), r * 0.15, Color(0.1, 0.1, 0.12))
		"person":
			ci.draw_circle(c + Vector2(0, -r * 0.45), r * 0.3, col)
			ci.draw_rect(Rect2(c + Vector2(-r * 0.4, -r * 0.08), Vector2(r * 0.8, r * 0.85)), col)
		_:
			ci.draw_circle(c, r * 0.4, col)
