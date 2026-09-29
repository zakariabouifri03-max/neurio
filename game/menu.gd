class_name RoadfallMainMenu
extends CanvasLayer

var game: RoadfallGame
var root: Control
var background: ColorRect
var content: Control
var title: Label
var subtitle: Label

func _init() -> void:
    layer = 20
    root = Control.new()
    root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    add_child(root)
    background = ColorRect.new()
    background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    background.color = Color(0.02, 0.045, 0.07, 0.96)
    background.mouse_filter = Control.MOUSE_FILTER_IGNORE
    root.add_child(background)
    content = Control.new()
    content.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    root.add_child(content)

func configure(owner_game: RoadfallGame) -> void:
    game = owner_game

func _base() -> VBoxContainer:
    for child in content.get_children():
        child.queue_free()
    var column := VBoxContainer.new()
    column.position = Vector2(52, 42)
    column.size = Vector2(530, 780)
    column.add_theme_constant_override("separation", 10)
    content.add_child(column)
    return column

func show_menu() -> void:
    visible = true
    var column := _base()
    var brand := Label.new()
    brand.text = "ROADFALL"
    brand.add_theme_font_size_override("font_size", 58)
    brand.add_theme_color_override("font_color", Color("#eaf8ff"))
    column.add_child(brand)
    var line := Label.new()
    line.text = "OPEN-ROAD BATTLE ROYALE  //  12 KM LIVE WORLD"
    line.add_theme_font_size_override("font_size", 13)
    line.add_theme_color_override("font_color", Color("#42d8ff"))
    column.add_child(line)
    var profile := Label.new()
    profile.text = game.profile_line()
    profile.add_theme_font_size_override("font_size", 15)
    profile.add_theme_color_override("font_color", Color("#a8bfca"))
    column.add_child(profile)
    var separator := HSeparator.new()
    column.add_child(separator)
    var play := _button("▶   PLAY  ·  50 COMPETITOR RUN", func(): game.start_match())
    play.custom_minimum_size = Vector2(0, 68)
    play.add_theme_font_size_override("font_size", 22)
    column.add_child(play)
    _add_menu_button(column, "RANKED", "DESTINATION LADDER", func(): game.start_match())
    _add_menu_button(column, "GARAGE", "VEHICLES / UPGRADES / COSMETICS", func(): show_garage())
    _add_menu_button(column, "SHOP", "VEHICLES / WHEELS / DECALS / SEASONAL", func(): show_shop())
    _add_menu_button(column, "EVENTS", "LIVE WORLD EVENTS", func(): show_panel("EVENTS", "RAIN · TRAIN CROSSING · SUPPLY CONVOY\nBRIDGE CLOSURE · POLICE PURSUIT · RARE LOOT\n\nEvery run changes the road.") )
    _add_menu_button(column, "CHALLENGES", "DAILY / WEEKLY OBJECTIVES", func(): show_panel("CHALLENGES", "DRIVE 20 KM       0 / 20\nREACH 3 DESTINATIONS  0 / 3\nCOLLECT 10 LOOT      0 / 10\n\nRewards are cosmetic-first.") )
    var lower := HBoxContainer.new()
    lower.add_theme_constant_override("separation", 8)
    column.add_child(lower)
    for entry in [["LEADERBOARD", func(): show_panel("LEADERBOARD", "GLOBAL  #4,812\nREGIONAL #238\nFRIENDS  #1\nSEASON 01  ·  LIVE")], ["PROFILE", func(): show_profile()], ["SETTINGS", func(): show_settings()]]:
        var b := _button(str(entry[0]), entry[1])
        b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
        lower.add_child(b)
    var hint := Label.new()
    hint.text = "WASD / CONTROLLER   ·   ESC PAUSE   ·   M MAP\nANDROID: BUTTONS, WHEEL OR TILT STEERING"
    hint.add_theme_font_size_override("font_size", 12)
    hint.add_theme_color_override("font_color", Color("#7892a0"))
    hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    column.add_child(hint)
    var right := Label.new()
    right.text = "LIVE BUILD  0.1\nANDROID ARM64  /  WINDOWS 64"
    right.position = Vector2(1420, 780)
    right.size = Vector2(430, 80)
    right.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
    right.add_theme_color_override("font_color", Color("#527482"))
    right.add_theme_font_size_override("font_size", 13)
    content.add_child(right)

func hide_menu() -> void:
    visible = false

func _add_menu_button(column: VBoxContainer, label: String, caption: String, callback: Callable) -> void:
    var row := HBoxContainer.new()
    row.custom_minimum_size = Vector2(0, 42)
    var button := _button(label, callback)
    button.custom_minimum_size = Vector2(190, 42)
    row.add_child(button)
    var text := Label.new()
    text.text = caption
    text.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
    text.add_theme_font_size_override("font_size", 12)
    text.add_theme_color_override("font_color", Color("#7f99a5"))
    row.add_child(text)
    column.add_child(row)

func _button(label_text: String, callback: Callable) -> Button:
    var button := Button.new()
    button.text = label_text
    button.focus_mode = Control.FOCUS_ALL
    button.add_theme_font_size_override("font_size", 16)
    button.add_theme_color_override("font_color", Color("#dcecf1"))
    button.add_theme_color_override("font_hover_color", Color("#ffffff"))
    button.pressed.connect(callback)
    return button

func show_panel(panel_title: String, body: String) -> void:
    var column := _base()
    var heading := Label.new()
    heading.text = panel_title
    heading.add_theme_font_size_override("font_size", 34)
    heading.add_theme_color_override("font_color", Color("#45d4ef"))
    column.add_child(heading)
    var text := Label.new()
    text.text = body
    text.add_theme_font_size_override("font_size", 18)
    text.add_theme_color_override("font_color", Color("#bdd2db"))
    text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    text.custom_minimum_size = Vector2(460, 250)
    column.add_child(text)
    column.add_child(_button("‹  BACK", func(): show_menu()))

func show_profile() -> void:
    var column := _base()
    var heading := Label.new()
    heading.text = "PROFILE"
    heading.add_theme_font_size_override("font_size", 34)
    heading.add_theme_color_override("font_color", Color("#45d4ef"))
    column.add_child(heading)
    var name_edit := LineEdit.new()
    name_edit.text = str(RoadfallSave.profile.username)
    name_edit.placeholder_text = "RIDER NAME"
    name_edit.custom_minimum_size.y = 48
    column.add_child(name_edit)
    column.add_child(_button("SAVE PROFILE", func(): _save_profile_name(name_edit)))
    var stats := Label.new()
    stats.text = "RANK     %s\nXP       %d\nMATCHES  %d\nWINS     %d\nBEST RUN #%d\n\nCREDITS  %d\nROAD GEMS %d" % [RoadfallSave.profile.rank, RoadfallSave.profile.xp, RoadfallSave.profile.matches, RoadfallSave.profile.wins, RoadfallSave.profile.best_place, RoadfallSave.profile.credits, RoadfallSave.profile.road_gems]
    stats.add_theme_font_size_override("font_size", 18)
    stats.add_theme_color_override("font_color", Color("#bdd2db"))
    column.add_child(stats)
    column.add_child(_button("‹  BACK", func(): show_menu()))

func show_garage() -> void:
    var column := _base()
    var heading := Label.new()
    heading.text = "GARAGE"
    heading.add_theme_font_size_override("font_size", 34)
    heading.add_theme_color_override("font_color", Color("#45d4ef"))
    column.add_child(heading)
    var info := Label.new()
    info.text = "SELECT A LOADOUT  ·  PAINT / WHEELS / DECALS / LIGHTS"
    info.add_theme_font_size_override("font_size", 12)
    info.add_theme_color_override("font_color", Color("#7f99a5"))
    column.add_child(info)
    for vehicle in RoadfallData.VEHICLES:
        if RoadfallSave.own_vehicle(vehicle.id):
            var button := _button(("✓  " if RoadfallSave.profile.selected_vehicle == vehicle.id else "    ") + str(vehicle.name) + "   [" + str(vehicle.get("class", "LOADOUT")) + "]", func():
                RoadfallSave.profile.selected_vehicle = vehicle.id
                RoadfallSave.save_profile()
                show_garage())
            column.add_child(button)
    column.add_child(_button("‹  BACK", func(): show_menu()))

func show_shop() -> void:
    var column := _base()
    var heading := Label.new()
    heading.text = "ROADFALL SHOP"
    heading.add_theme_font_size_override("font_size", 34)
    heading.add_theme_color_override("font_color", Color("#45d4ef"))
    column.add_child(heading)
    var balance := Label.new()
    balance.text = "CREDITS  %d     ROAD GEMS  %d\nCOSMETICS ONLY · DAILY ROTATION" % [RoadfallSave.profile.credits, RoadfallSave.profile.road_gems]
    balance.add_theme_color_override("font_color", Color("#f4c85e"))
    column.add_child(balance)
    for vehicle in RoadfallData.VEHICLES:
        if RoadfallSave.own_vehicle(vehicle.id):
            continue
        var id := str(vehicle.id)
        column.add_child(_button("BUY  %s   ·   %d CREDITS" % [vehicle.name, vehicle.price], func():
            if RoadfallSave.buy_vehicle(id):
                show_shop()
            else:
                show_panel("SHOP", "NOT ENOUGH CREDITS\n\nPlay matches, finish destinations and\ncome back for the next rotation.")))
    column.add_child(_button("FEATURED COSMETICS", func(): show_panel("FEATURED", "AURORA PAINT   ·   60 GEMS\nNIGHT RUNNER WHEELS  ·  40 GEMS\nCHROME TRAIL EFFECT  ·  80 GEMS\n\nPremium currency stays cosmetic.")))
    column.add_child(_button("‹  BACK", func(): show_menu()))

func show_settings() -> void:
    var column := _base()
    var heading := Label.new()
    heading.text = "SETTINGS"
    heading.add_theme_font_size_override("font_size", 34)
    heading.add_theme_color_override("font_color", Color("#45d4ef"))
    column.add_child(heading)
    var quality_text := Label.new()
    quality_text.text = "GRAPHICS: %s" % game.quality.label()
    quality_text.add_theme_color_override("font_color", Color("#bdd2db"))
    column.add_child(quality_text)
    for level in ["LOW", "MEDIUM", "HIGH", "ULTRA"]:
        column.add_child(_button("GRAPHICS  " + level, func(): _set_quality(level)))
    for performance_mode in ["BATTERY SAVER", "BALANCED", "PERFORMANCE", "QUALITY"]:
        column.add_child(_button("MODE  " + performance_mode, func(): _set_performance_mode(performance_mode)))
    column.add_child(_button("STEERING SENSITIVITY  %.1f" % float(RoadfallSave.get_setting("steering_sensitivity", 1.0)), func(): _cycle_setting("steering_sensitivity", [0.7, 1.0, 1.3])))
    column.add_child(_button("CAMERA SENSITIVITY  %.1f" % float(RoadfallSave.get_setting("camera_sensitivity", 1.0)), func(): _cycle_setting("camera_sensitivity", [0.7, 1.0, 1.3])))
    column.add_child(_button("VIBRATION  %.1f" % float(RoadfallSave.get_setting("vibration", 0.8)), func(): _cycle_setting("vibration", [0.0, 0.5, 0.8, 1.0])))
    column.add_child(_button("LEFT-HANDED LAYOUT: " + ("ON" if RoadfallSave.get_setting("left_handed", false) else "OFF"), func(): _toggle_left_handed()))
    column.add_child(_button("TOUCH: BUTTONS / WHEEL / TILT", func(): _cycle_touch_layout()))
    column.add_child(_button("‹  BACK", func(): show_menu()))

func _save_profile_name(name_edit: LineEdit) -> void:
    var entered := name_edit.text.strip_edges().to_upper()
    RoadfallSave.profile.username = entered.substr(0, 14) if not entered.is_empty() else "RIDER"
    RoadfallSave.save_profile()
    if RoadfallSave.profile.matches == 0:
        show_tutorial()
    else:
        show_menu()

func show_tutorial() -> void:
    var column := _base()
    var heading := Label.new()
    heading.text = "FIRST RUN // QUICK TUTORIAL"
    heading.add_theme_font_size_override("font_size", 30)
    heading.add_theme_color_override("font_color", Color("#45d4ef"))
    column.add_child(heading)
    var body := Label.new()
    body.text = "DRIVE      W A S D  /  TOUCH BUTTONS\nBRAKE      S  /  BRAKE\nBOOST      SHIFT  /  BOOST\nMAP        M  /  MAP\nLOOT       DRIVE INTO CRATES\nUPGRADE    OPEN INVENTORY WITH I\nDESTINATION  FOLLOW THE LIVE ROUTE\n\nReach the next destination before the timer expires.\nThe first run is a live 50-competitor practice match."
    body.add_theme_font_size_override("font_size", 17)
    body.add_theme_color_override("font_color", Color("#bdd2db"))
    body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    body.custom_minimum_size = Vector2(460, 300)
    column.add_child(body)
    column.add_child(_button("▶  START TUTORIAL RUN", func(): game.start_match()))
    column.add_child(_button("MAIN MENU", func(): show_menu()))

func _set_quality(level: String) -> void:
    game.quality.apply_profile(level)
    show_settings()

func _set_performance_mode(performance_mode: String) -> void:
    game.quality.set_mode(performance_mode)
    show_settings()

func _cycle_touch_layout() -> void:
    var current := str(RoadfallSave.get_setting("touch_layout", "BUTTONS"))
    var next := "WHEEL" if current == "BUTTONS" else ("TILT" if current == "WHEEL" else "BUTTONS")
    RoadfallSave.set_setting("touch_layout", next)
    show_settings()

func _cycle_setting(setting_name: String, values: Array) -> void:
    var current = RoadfallSave.get_setting(setting_name, values[0])
    var next_index := 0
    for i in range(values.size()):
        if is_equal_approx(float(current), float(values[i])):
            next_index = (i + 1) % values.size()
            break
    RoadfallSave.set_setting(setting_name, values[next_index])
    show_settings()

func _toggle_left_handed() -> void:
    RoadfallSave.set_setting("left_handed", not bool(RoadfallSave.get_setting("left_handed", false)))
    show_settings()
