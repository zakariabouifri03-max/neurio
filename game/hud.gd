class_name RoadfallHUD
extends CanvasLayer

var game: RoadfallGame
var match_director: RoadfallMatchDirector
var root: Control
var minimap: RoadfallMapView
var destination_label: Label
var timer_label: Label
var alive_label: Label
var speed_label: Label
var region_label: Label
var event_label: Label
var notice_label: Label
var inventory_panel: PanelContainer
var pause_panel: PanelContainer
var results_panel: PanelContainer
var map_close: Button
var steering_wheel: RoadfallTouchWheel
var notice_time := 0.0
var inventory_open := false
var full_map := false
var _built := false

func _init() -> void:
    layer = 30
    root = Control.new()
    root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    root.mouse_filter = Control.MOUSE_FILTER_IGNORE
    add_child(root)

func configure(owner_game: RoadfallGame, owner_match: RoadfallMatchDirector) -> void:
    game = owner_game
    match_director = owner_match
    _build()

func _build() -> void:
    if _built:
        return
    _built = true
    var top_left := PanelContainer.new()
    top_left.position = Vector2(24, 24)
    top_left.size = Vector2(290, 112)
    top_left.mouse_filter = Control.MOUSE_FILTER_IGNORE
    root.add_child(top_left)
    var tl := VBoxContainer.new()
    tl.add_theme_constant_override("separation", 2)
    top_left.add_child(tl)
    alive_label = _label("50  ALIVE", 20, Color("#effcff"))
    timer_label = _label("CHECKPOINT  1:45", 14, Color("#f4c85e"))
    region_label = _label("CITY", 12, Color("#42d8ff"))
    tl.add_child(alive_label)
    tl.add_child(timer_label)
    tl.add_child(region_label)
    var title := _label("ROADFALL // LIVE RUN", 11, Color("#7892a0"))
    title.position = Vector2(30, 138)
    title.size = Vector2(280, 24)
    root.add_child(title)
    destination_label = _label("DESTINATION  CITY", 22, Color("#ffffff"))
    destination_label.anchor_left = 0.5
    destination_label.anchor_right = 0.5
    destination_label.offset_left = -280
    destination_label.offset_right = 280
    destination_label.offset_top = 30
    destination_label.offset_bottom = 70
    destination_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    root.add_child(destination_label)
    event_label = _label("CLEAR", 13, Color("#8de5ee"))
    event_label.anchor_left = 0.5
    event_label.anchor_right = 0.5
    event_label.offset_left = -260
    event_label.offset_right = 260
    event_label.offset_top = 72
    event_label.offset_bottom = 100
    event_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    root.add_child(event_label)
    speed_label = _label("0 km/h", 30, Color("#effcff"))
    speed_label.anchor_left = 1.0
    speed_label.anchor_right = 1.0
    speed_label.offset_left = -260
    speed_label.offset_right = -28
    speed_label.offset_top = 650
    speed_label.offset_bottom = 700
    speed_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
    root.add_child(speed_label)
    notice_label = _label("", 15, Color("#ffffff"))
    notice_label.anchor_left = 0.5
    notice_label.anchor_right = 0.5
    notice_label.offset_left = -340
    notice_label.offset_right = 340
    notice_label.offset_top = 122
    notice_label.offset_bottom = 154
    notice_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    root.add_child(notice_label)
    minimap = RoadfallMapView.new()
    minimap.name = "LiveMinimap"
    minimap.position = Vector2(1640, 28)
    minimap.size = Vector2(245, 245)
    minimap.configure(game.world, match_director)
    root.add_child(minimap)
    var map_button := _button("MAP  M", 13)
    map_button.position = Vector2(1730, 282)
    map_button.size = Vector2(150, 42)
    map_button.pressed.connect(toggle_full_map)
    root.add_child(map_button)
    var inventory_button := _button("INVENTORY  I", 13)
    inventory_button.position = Vector2(1490, 282)
    inventory_button.size = Vector2(220, 42)
    inventory_button.pressed.connect(toggle_inventory)
    root.add_child(inventory_button)
    var camera_button := _button("CAM  C", 13)
    camera_button.position = Vector2(1325, 282)
    camera_button.size = Vector2(150, 42)
    camera_button.pressed.connect(game.cycle_camera)
    root.add_child(camera_button)
    _build_touch_controls()
    set_process(true)

func _build_touch_controls() -> void:
    var mobile := OS.has_feature("mobile")
    # Touch controls are also shown in an editor mobile preview. PC keyboard and
    # controller remain the only inputs used on desktop by default.
    if not mobile and not DisplayServer.is_touchscreen_available():
        return
    var touch_layout := str(RoadfallSave.get_setting("touch_layout", "BUTTONS"))
    var left_handed := bool(RoadfallSave.get_setting("left_handed", false))
    if touch_layout == "WHEEL":
        steering_wheel = RoadfallTouchWheel.new()
        steering_wheel.position = Vector2(1640 if left_handed else 22, 732)
        steering_wheel.size = Vector2(250, 250)
        steering_wheel.configure(game)
        root.add_child(steering_wheel)
    elif touch_layout == "TILT":
        var tilt_label := _label("TILT STEERING ACTIVE", 13, Color("#8de5ee"))
        tilt_label.position = Vector2(35, 790)
        tilt_label.size = Vector2(280, 32)
        root.add_child(tilt_label)
    else:
        var left := _button("◀", 28)
        left.position = Vector2(1630 if left_handed else 35, 820)
        left.size = Vector2(92, 92)
        left.button_down.connect(func(): game.set_touch_control("left", true))
        left.button_up.connect(func(): game.set_touch_control("left", false))
        root.add_child(left)
        var right := _button("▶", 28)
        right.position = Vector2(1732 if left_handed else 137, 820)
        right.size = Vector2(92, 92)
        right.button_down.connect(func(): game.set_touch_control("right", true))
        right.button_up.connect(func(): game.set_touch_control("right", false))
        root.add_child(right)
    var throttle := _button("ACCEL", 15)
    throttle.position = Vector2(35 if left_handed else 1690, 760)
    throttle.size = Vector2(180, 90)
    throttle.button_down.connect(func(): game.set_touch_control("throttle", true))
    throttle.button_up.connect(func(): game.set_touch_control("throttle", false))
    root.add_child(throttle)
    var brake := _button("BRAKE", 14)
    brake.position = Vector2(230 if left_handed else 1490, 825)
    brake.size = Vector2(170, 70)
    brake.button_down.connect(func(): game.set_touch_control("brake", true))
    brake.button_up.connect(func(): game.set_touch_control("brake", false))
    root.add_child(brake)
    var boost := _button("BOOST", 14)
    boost.position = Vector2(425 if left_handed else 1295, 825)
    boost.size = Vector2(170, 70)
    boost.button_down.connect(func(): game.set_touch_control("boost", true))
    boost.button_up.connect(func(): game.set_touch_control("boost", false))
    root.add_child(boost)
    var handbrake := _button("HANDBRAKE", 12)
    handbrake.position = Vector2(425 if left_handed else 1260, 735)
    handbrake.size = Vector2(170, 58)
    handbrake.button_down.connect(func(): game.set_touch_control("handbrake", true))
    handbrake.button_up.connect(func(): game.set_touch_control("handbrake", false))
    root.add_child(handbrake)

func _process(delta: float) -> void:
    if match_director == null or not is_instance_valid(match_director) or match_director.player == null:
        return
    notice_time = maxf(0.0, notice_time - delta)
    notice_label.visible = notice_time > 0.0
    alive_label.text = "%02d  ALIVE" % match_director.alive_count()
    timer_label.text = ("FINAL RUN  " if match_director.final_run else "CHECKPOINT  ") + _time_string(match_director.destination_time)
    destination_label.text = "DESTINATION  %s" % match_director.destination_name()
    speed_label.text = "%03d km/h" % match_director.player.speed_kmh()
    minimap.visible = not full_map
    if inventory_open:
        _refresh_inventory()

func _time_string(seconds: float) -> String:
    var total := maxi(0, int(seconds))
    return "%02d:%02d" % [total / 60, total % 60]

func refresh() -> void:
    if inventory_open:
        _refresh_inventory()

func push_notice(text: String, warning := false) -> void:
    notice_label.text = text
    notice_label.add_theme_color_override("font_color", Color("#ffb36b") if warning else Color("#ffffff"))
    notice_time = 3.2

func push_region(region_name: String) -> void:
    region_label.text = region_name

func set_event(next_weather: String, event_name: String) -> void:
    event_label.text = next_weather + ("  //  " + event_name if not event_name.is_empty() else "")
    push_notice(event_label.text)

func show_hud() -> void:
    visible = true

func set_pause_visible(is_visible: bool) -> void:
    if is_visible:
        if pause_panel:
            pause_panel.queue_free()
        pause_panel = _modal("PAUSED", "Your run is safe. Choose a route when ready.", [
            ["RESUME", func(): game.toggle_pause()],
            ["QUIT TO MENU", func(): game.quit_to_menu()]
        ])
    elif pause_panel:
        pause_panel.queue_free()
        pause_panel = null

func show_results(result: Dictionary) -> void:
    if results_panel:
        results_panel.queue_free()
    var headline := "WINNER" if result.won else ("FINAL RUN COMPLETE" if result.finished else "ELIMINATED")
    var detail := "%s  ·  %02d / %02d\n%s\n+%d CREDITS   +%d ROAD GEMS\n\nNEXT RUN IS READY." % [headline, result.place, result.total, result.winner if result.won else result.reason, result.reward.credits, result.reward.gems]
    results_panel = _modal("MATCH RESULTS", detail, [
        ["PLAY AGAIN", func(): game.start_match()],
        ["GARAGE", func(): _return_to_garage()]
    ])

func toggle_inventory() -> void:
    inventory_open = not inventory_open
    if inventory_open:
        inventory_panel = PanelContainer.new()
        inventory_panel.position = Vector2(28, 220)
        inventory_panel.size = Vector2(360, 300)
        root.add_child(inventory_panel)
        _refresh_inventory()
    elif inventory_panel:
        inventory_panel.queue_free()
        inventory_panel = null

func _refresh_inventory() -> void:
    if inventory_panel == null:
        return
    for child in inventory_panel.get_children():
        child.queue_free()
    var box := VBoxContainer.new()
    inventory_panel.add_child(box)
    var title := _label("IN-MATCH INVENTORY  ·  4 SLOTS", 16, Color("#45d4ef"))
    box.add_child(title)
    var inventory: Array = RoadfallSave.profile.inventory
    for i in range(4):
        if i < inventory.size():
            var item: Dictionary = inventory[i]
            var index := i
            var button := _button("[%d]  %s  ·  %s" % [i + 1, item.name, item.rarity], 13)
            button.pressed.connect(func(): _use_inventory(index))
            box.add_child(button)
        else:
            box.add_child(_label("[ ]  EMPTY", 13, Color("#637a86")))

func toggle_full_map() -> void:
    full_map = not full_map
    if full_map:
        minimap.set_full_screen(true)
        minimap.position = Vector2.ZERO
        minimap.size = get_viewport().get_visible_rect().size
        minimap.z_index = 4
        map_close = _button("CLOSE MAP  M", 16)
        map_close.position = Vector2(1680, 28)
        map_close.size = Vector2(190, 52)
        map_close.z_index = 5
        map_close.pressed.connect(toggle_full_map)
        root.add_child(map_close)
    else:
        if map_close:
            map_close.queue_free()
            map_close = null
        minimap.set_full_screen(false)
        minimap.position = Vector2(1640, 28)
        minimap.size = Vector2(245, 245)
        minimap.z_index = 0

func _modal(heading: String, body: String, actions: Array) -> PanelContainer:
    var panel := PanelContainer.new()
    panel.position = Vector2(620, 260)
    panel.size = Vector2(680, 430)
    panel.z_index = 10
    root.add_child(panel)
    var box := VBoxContainer.new()
    box.add_theme_constant_override("separation", 16)
    panel.add_child(box)
    var title := _label(heading, 32, Color("#45d4ef"))
    title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    box.add_child(title)
    var text := _label(body, 18, Color("#d7e8ee"))
    text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
    text.custom_minimum_size = Vector2(0, 160)
    box.add_child(text)
    for action in actions:
        var button := _button(str(action[0]), action[1], 18)
        button.custom_minimum_size.y = 54
        box.add_child(button)
    return panel

func _label(text: String, font_size: int, color: Color) -> Label:
    var label := Label.new()
    label.text = text
    label.add_theme_font_size_override("font_size", font_size)
    label.add_theme_color_override("font_color", color)
    return label

func _button(text: String, font_size: int, callback: Callable = Callable()) -> Button:
    var button := Button.new()
    button.text = text
    button.add_theme_font_size_override("font_size", font_size)
    button.add_theme_color_override("font_color", Color("#dcecf1"))
    button.add_theme_color_override("font_hover_color", Color("#ffffff"))
    if callback.is_valid():
        button.pressed.connect(callback)
    return button

func _return_to_garage() -> void:
    game.quit_to_menu()
    game.open_garage()

func _use_inventory(index: int) -> void:
    match_director.use_inventory_item(index)
    _refresh_inventory()
