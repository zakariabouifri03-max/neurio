class_name UiKit
extends RefCounted
## Declarative UI builder.
##
## The menus and HUD are built from code through this kit so every screen shares
## one visual language (palette, spacing, touch target sizing) and stays readable
## on small phones.  No scene file has to be hand authored for a new panel.

const BG_DEEP := Color(0.055, 0.075, 0.125)
const BG_PANEL := Color(0.10, 0.13, 0.19, 0.94)
const BG_PANEL_SOFT := Color(0.14, 0.18, 0.25, 0.86)
const ACCENT := Color(0.28, 0.72, 1.0)
const ACCENT_WARM := Color(1.0, 0.72, 0.28)
const DANGER := Color(1.0, 0.36, 0.34)
const SUCCESS := Color(0.42, 0.86, 0.44)
const TEXT := Color(0.94, 0.96, 1.0)
const TEXT_DIM := Color(0.68, 0.74, 0.84)

const RARITY_COLORS := {
	"common": Color(0.75, 0.78, 0.84),
	"uncommon": Color(0.45, 0.86, 0.5),
	"rare": Color(0.35, 0.65, 1.0),
	"epic": Color(0.72, 0.45, 1.0),
	"legendary": Color(1.0, 0.72, 0.25),
}

const UI_ICON_DIR := "res://assets/icons/ui/"

static var _theme: Theme = null

## Touch target sizes: Android guidance is >= 48 dp; we keep the minimum at 56 px
## of the design viewport so scaled buttons stay comfortable.
const TOUCH_MIN := 84
const FONT_BODY := 22
const FONT_SMALL := 18
const FONT_TITLE := 40
const FONT_HUGE := 64

static func theme() -> Theme:
	if _theme != null:
		return _theme
	var ui := Theme.new()
	ui.default_font_size = FONT_BODY
	ui.set_stylebox("panel", "Panel", panel_box(BG_PANEL, 18))
	ui.set_stylebox("panel", "PanelContainer", panel_box(BG_PANEL_SOFT, 16))
	ui.set_color("font_color", "Label", TEXT)
	ui.set_font_size("font_size", "Label", FONT_BODY)
	style_button(ui, "Button", BG_PANEL_SOFT, BG_PANEL_SOFT.lightened(0.12))
	style_button(ui, "OptionButton", BG_PANEL_SOFT, BG_PANEL_SOFT.lightened(0.12))
	style_button(ui, "CheckButton", Color(0, 0, 0, 0), Color(0, 0, 0, 0))
	ui.set_stylebox("panel", "PopupPanel", panel_box(BG_PANEL, 14))
	ui.set_stylebox("panel", "TabContainer", panel_box(BG_PANEL, 14))
	ui.set_stylebox("panel", "ProgressBar", panel_box(Color(0.06, 0.08, 0.12, 0.9), 8))
	ui.set_stylebox("fill", "ProgressBar", panel_box(ACCENT, 8))
	ui.set_color("font_color", "ProgressBar", TEXT)
	_theme = ui
	return ui

static func style_button(ui: Theme, type_name: String, normal: Color, hover: Color) -> void:
	ui.set_stylebox("normal", type_name, panel_box(normal, 14))
	ui.set_stylebox("hover", type_name, panel_box(hover, 14))
	ui.set_stylebox("pressed", type_name, panel_box(normal.darkened(0.25), 14))
	ui.set_stylebox("disabled", type_name, panel_box(normal.darkened(0.35), 14))
	ui.set_stylebox("focus", type_name, panel_box(Color(0, 0, 0, 0), 14,
		{"border": ACCENT, "width": 3}))
	ui.set_color("font_color", type_name, TEXT)
	ui.set_color("font_hover_color", type_name, Color.WHITE)
	ui.set_color("font_disabled_color", type_name, TEXT_DIM.darkened(0.2))
	ui.set_font_size("font_size", type_name, FONT_BODY)
	ui.set_constant("h_separation", type_name, 10)

static func panel_box(color: Color, radius: int, extra: Dictionary = {}) -> StyleBoxFlat:
	var box := StyleBoxFlat.new()
	box.bg_color = color
	box.set_corner_radius_all(radius)
	var border: Color = extra.get("border", Color(1, 1, 1, 0.07))
	var width: int = int(extra.get("width", 2))
	box.border_color = border
	box.set_border_width_all(width)
	box.content_margin_left = 14.0
	box.content_margin_right = 14.0
	box.content_margin_top = 10.0
	box.content_margin_bottom = 10.0
	return box

static func text(content: String, size: int = FONT_BODY, color: Color = TEXT,
				 align: int = HORIZONTAL_ALIGNMENT_LEFT) -> Label:
	var label := Label.new()
	label.text = content
	label.horizontal_alignment = align
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", color)
	label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.6))
	label.add_theme_constant_override("shadow_offset_x", 1)
	label.add_theme_constant_override("shadow_offset_y", 2)
	return label

static func title(content: String, size: int = FONT_TITLE) -> Label:
	return text(content, size, TEXT)

## A button that always has a handler; `on_pressed` receives no arguments.
static func button(content: String, on_pressed: Callable, accent: bool = false,
				   min_width: float = 0.0) -> Button:
	var node := Button.new()
	node.text = content
	node.custom_minimum_size = Vector2(maxf(min_width, TOUCH_MIN), TOUCH_MIN * 0.62)
	node.focus_mode = Control.FOCUS_ALL
	if accent:
		node.add_theme_stylebox_override("normal", panel_box(ACCENT.darkened(0.25), 14))
		node.add_theme_stylebox_override("hover", panel_box(ACCENT.darkened(0.1), 14))
		node.add_theme_stylebox_override("pressed", panel_box(ACCENT.darkened(0.4), 14))
	if on_pressed.is_valid():
		node.pressed.connect(on_pressed)
	node.pressed.connect(_play_click)
	return node

static func _play_click() -> void:
	AudioDirector.play_ui("ui_click", -4.0)

static func icon_button(icon_name: String, on_pressed: Callable, size: float = 84.0) -> Button:
	var node := Button.new()
	node.custom_minimum_size = Vector2(size, size)
	var texture := icon(icon_name)
	if texture != null:
		node.icon = texture
		node.expand_icon = true
		node.add_theme_constant_override("icon_max_width", int(size * 0.6))
	node.add_theme_stylebox_override("normal", panel_box(BG_PANEL_SOFT, 14))
	node.add_theme_stylebox_override("hover", panel_box(BG_PANEL_SOFT.lightened(0.14), 14))
	node.add_theme_stylebox_override("pressed", panel_box(BG_PANEL_SOFT.darkened(0.2), 14))
	if on_pressed.is_valid():
		node.pressed.connect(on_pressed)
	node.pressed.connect(_play_click)
	return node

static func icon(icon_name: String) -> Texture2D:
	var path := UI_ICON_DIR + icon_name + ".png"
	if not ResourceLoader.exists(path):
		return null
	return load(path) as Texture2D

static func icon_rect(icon_name: String, size: float = 40.0) -> TextureRect:
	var rect := TextureRect.new()
	rect.texture = icon(icon_name)
	rect.custom_minimum_size = Vector2(size, size)
	rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	return rect

static func panel(color: Color = BG_PANEL, radius: int = 18) -> PanelContainer:
	var node := PanelContainer.new()
	node.add_theme_stylebox_override("panel", panel_box(color, radius))
	return node

static func vbox(separation: int = 12) -> VBoxContainer:
	var node := VBoxContainer.new()
	node.add_theme_constant_override("separation", separation)
	return node

static func hbox(separation: int = 12) -> HBoxContainer:
	var node := HBoxContainer.new()
	node.add_theme_constant_override("separation", separation)
	return node

static func grid(columns: int = 2, separation: int = 12) -> GridContainer:
	var node := GridContainer.new()
	node.columns = columns
	node.add_theme_constant_override("h_separation", separation)
	node.add_theme_constant_override("v_separation", separation)
	return node

static func margin(all: int = 16) -> MarginContainer:
	var node := MarginContainer.new()
	node.add_theme_constant_override("margin_left", all)
	node.add_theme_constant_override("margin_right", all)
	node.add_theme_constant_override("margin_top", all)
	node.add_theme_constant_override("margin_bottom", all)
	return node

static func spacer(size: float = 0.0, vertical: bool = true) -> Control:
	var node := Control.new()
	if vertical:
		node.custom_minimum_size = Vector2(0, size)
	else:
		node.custom_minimum_size = Vector2(size, 0)
	node.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	node.size_flags_vertical = Control.SIZE_EXPAND_FILL
	return node

static func separator() -> HSeparator:
	return HSeparator.new()

static func scroll() -> ScrollContainer:
	var node := ScrollContainer.new()
	node.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	node.size_flags_vertical = Control.SIZE_EXPAND_FILL
	return node

static func slider(minimum: float, maximum: float, step: float, value: float,
				   on_changed: Callable) -> HSlider:
	var node := HSlider.new()
	node.min_value = minimum
	node.max_value = maximum
	node.step = step
	node.value = value
	node.custom_minimum_size = Vector2(240, 48)
	if on_changed.is_valid():
		node.value_changed.connect(on_changed)
	return node

static func check(text_content: String, value: bool, on_toggled: Callable) -> CheckButton:
	var node := CheckButton.new()
	node.text = text_content
	node.button_pressed = value
	node.custom_minimum_size = Vector2(TOUCH_MIN, 56)
	if on_toggled.is_valid():
		node.toggled.connect(on_toggled)
	return node

static func option(items: Array, selected_index: int, on_selected: Callable) -> OptionButton:
	var node := OptionButton.new()
	for i: int in items.size():
		node.add_item(str(items[i]), i)
	node.selected = clampi(selected_index, 0, maxi(0, items.size() - 1))
	node.custom_minimum_size = Vector2(TOUCH_MIN * 2, 60)
	if on_selected.is_valid():
		node.item_selected.connect(on_selected)
	return node

static func field(placeholder: String, value: String = "") -> LineEdit:
	var node := LineEdit.new()
	node.placeholder_text = placeholder
	node.text = value
	node.custom_minimum_size = Vector2(TOUCH_MIN * 2, 64)
	return node

static func bar(value: float, maximum: float, color: Color, size: Vector2) -> ProgressBar:
	var node := ProgressBar.new()
	node.max_value = maxf(1.0, maximum)
	node.value = clampf(value, 0.0, maximum)
	node.show_percentage = false
	node.custom_minimum_size = size
	node.add_theme_stylebox_override("background", panel_box(Color(0.03, 0.05, 0.08, 0.85), 6))
	var fill := panel_box(color, 6)
	fill.content_margin_left = 0.0
	fill.content_margin_right = 0.0
	fill.content_margin_top = 0.0
	fill.content_margin_bottom = 0.0
	node.add_theme_stylebox_override("fill", fill)
	return node

static func rarity_color(rarity: String) -> Color:
	return RARITY_COLORS.get(rarity, TEXT)

static func currency_label(amount: int, currency: String) -> Control:
	var row := hbox(8)
	row.add_child(icon_rect("icon_coin" if currency == "coins" else "icon_gem", 34.0))
	row.add_child(text(str(amount), FONT_BODY, TEXT))
	return row

## Places a floating widget by anchoring it to a screen edge or the centre and
## giving it an explicit size in design units (1280x720 base, scaled by the
## stretch mode).  Offsets are measured from the anchor, so passing
## PRESET_BOTTOM_LEFT with `offset = Vector2(24, -164)` and
## `widget_size = Vector2(360, 140)` pins a 360x140 panel to the bottom-left
## corner on every aspect ratio - which is what the HUD and the modal menus need.
static func place(control: Control, preset: int, offset: Vector2,
				  widget_size: Vector2 = Vector2.ZERO) -> Control:
	control.set_anchors_preset(preset)
	var width := widget_size.x if widget_size.x > 0.0 else control.get_combined_minimum_size().x
	var height := widget_size.y if widget_size.y > 0.0 else control.get_combined_minimum_size().y
	control.offset_left = offset.x
	control.offset_top = offset.y
	control.offset_right = offset.x + width
	control.offset_bottom = offset.y + height
	if widget_size.x > 0.0 and widget_size.y > 0.0:
		control.custom_minimum_size = widget_size
	return control

static func dim_overlay(alpha: float = 0.55) -> ColorRect:
	var rect := ColorRect.new()
	rect.color = Color(0.02, 0.03, 0.06, alpha)
	rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	rect.mouse_filter = Control.MOUSE_FILTER_STOP
	return rect

static func apply_theme(root: Control) -> void:
	root.theme = theme()
