class_name RoadfallGame
extends Node

## Shared gameplay entry point. The exported Windows and Android builds both run
## this scene; only InputMap and renderer quality are platform-specific.

var quality: RoadfallQualityManager
var world: RoadfallWorldStream
var world_environment: WorldEnvironment
var sun: DirectionalLight3D
var camera: Camera3D
var match_root: Node3D
var match_director: RoadfallMatchDirector
var hud: RoadfallHUD
var menu: RoadfallMainMenu
var weather: RoadfallWeather
var audio: RoadfallAudioManager
var touch_state := {"left":false, "right":false, "throttle":false, "brake":false, "handbrake":false, "boost":false, "steer":0.0}
var match_paused := false
var booted := false
var camera_mode := 0
var camera_lerp := Vector3.ZERO
var camera_pitch := 0.22
var camera_yaw := 0.0
var _last_region := "city"

func _ready() -> void:
    _install_input_map()
    quality = RoadfallQualityManager.new()
    add_child(quality)
    quality.setup()
    quality.profile_changed.connect(_on_quality_changed)
    _build_world()
    menu = RoadfallMainMenu.new()
    add_child(menu)
    menu.configure(self)
    if RoadfallSave.profile.matches == 0 and str(RoadfallSave.profile.username) == "RIDER":
        menu.show_profile()
    else:
        menu.show_menu()
    booted = true

func _build_world() -> void:
    world = RoadfallWorldStream.new()
    world.name = "ROADFALL_12KM_WORLD"
    add_child(world)
    world.setup(quality.profile)
    world.region_changed.connect(_on_region_changed)
    world_environment = WorldEnvironment.new()
    var environment := Environment.new()
    environment.background_mode = Environment.BG_COLOR
    environment.background_color = Color("#08121d")
    environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
    environment.ambient_light_color = Color("#93b4c7")
    environment.ambient_light_energy = 0.72
    environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
    environment.fog_enabled = true
    environment.fog_light_color = Color("#506d7b")
    environment.fog_density = 0.004
    world_environment.environment = environment
    add_child(world_environment)
    sun = DirectionalLight3D.new()
    sun.name = "DynamicSun"
    sun.rotation_degrees = Vector3(-53, -28, 0)
    sun.light_energy = 1.25
    sun.shadow_enabled = true
    add_child(sun)
    camera = Camera3D.new()
    camera.name = "SharedChaseCamera"
    camera.current = true
    camera.fov = 68.0
    camera.position = Vector3(0, 12, 16)
    add_child(camera)
    weather = RoadfallWeather.new()
    weather.name = "WeatherAndAtmosphere"
    add_child(weather)
    weather.configure(world_environment)
    audio = RoadfallAudioManager.new()
    audio.name = "AdaptiveAudio"
    add_child(audio)
    audio.configure()
    world.set_weather("CLEAR")

func _process(delta: float) -> void:
    if not booted:
        return
    if match_director and match_director.player and is_instance_valid(match_director.player):
        world.update_streaming(match_director.player.global_position)
        weather.set_anchor(match_director.player.global_position)
        var drive_input := get_drive_input()
        audio.update_vehicle(match_director.player.rpm, float(drive_input.get("throttle", 0.0)), absf(match_director.player.drive_speed))
        _update_camera(delta)
    elif camera:
        camera.position = camera.position.lerp(Vector3(0, 12, 16), minf(1.0, delta * 2.0))
        camera.look_at(Vector3.ZERO, Vector3.UP)

func _update_camera(delta: float) -> void:
    var target := match_director.player
    if target == null:
        return
    var forward := target.forward_direction()
    var orbit_forward := forward.rotated(Vector3.UP, camera_yaw)
    var offset := Vector3(0, 4.8, 10.5)
    if camera_mode == 1:
        offset = Vector3(0, 2.4, 5.2)
    elif camera_mode == 2:
        offset = Vector3(0, 2.0, 1.0)
    elif camera_mode == 3:
        offset = Vector3(0, 1.8, -0.25)
    var desired := target.global_position - orbit_forward * offset.z + Vector3.UP * offset.y + Vector3.RIGHT * offset.x
    camera.global_position = camera.global_position.lerp(desired, minf(1.0, delta * 8.0))
    var look_at := target.global_position + Vector3.UP * (1.2 if camera_mode != 3 else 1.45) + orbit_forward * (3.0 if camera_mode == 0 else 8.0)
    camera.look_at(look_at, Vector3.UP)

func _install_input_map() -> void:
    _add_key_action("accelerate", KEY_W)
    _add_key_action("accelerate", KEY_UP)
    _add_key_action("brake", KEY_S)
    _add_key_action("brake", KEY_DOWN)
    _add_key_action("steer_left", KEY_A)
    _add_key_action("steer_left", KEY_LEFT)
    _add_key_action("steer_right", KEY_D)
    _add_key_action("steer_right", KEY_RIGHT)
    _add_key_action("handbrake", KEY_SPACE)
    _add_key_action("boost", KEY_SHIFT)
    _add_key_action("interact", KEY_E)
    _add_key_action("map", KEY_M)
    _add_key_action("minimap", KEY_TAB)
    _add_key_action("pause", KEY_ESCAPE)
    _add_key_action("camera", KEY_C)
    _add_key_action("inventory", KEY_I)
    _add_joy_action("accelerate", JOY_AXIS_TRIGGER_RIGHT, 1.0)
    _add_joy_action("brake", JOY_AXIS_TRIGGER_LEFT, 1.0)
    _add_joy_action("steer_left", JOY_AXIS_LEFT_X, -1.0)
    _add_joy_action("steer_right", JOY_AXIS_LEFT_X, 1.0)
    _add_button_action("handbrake", JOY_BUTTON_A)
    _add_button_action("boost", JOY_BUTTON_B)

func _add_key_action(action: String, key: int) -> void:
    if not InputMap.has_action(action):
        InputMap.add_action(action)
    var event := InputEventKey.new()
    event.physical_keycode = key
    InputMap.action_add_event(action, event)

func _add_joy_action(action: String, axis: int, axis_value: float) -> void:
    var event := InputEventJoypadMotion.new()
    event.axis = axis
    event.axis_value = axis_value
    InputMap.action_add_event(action, event)

func _add_button_action(action: String, button: int) -> void:
    var event := InputEventJoypadButton.new()
    event.button_index = button
    InputMap.action_add_event(action, event)

func get_drive_input() -> Dictionary:
    var steer := Input.get_action_strength("steer_right") - Input.get_action_strength("steer_left")
    if touch_state.left:
        steer -= 1.0
    if touch_state.right:
        steer += 1.0
    var touch_layout := str(RoadfallSave.get_setting("touch_layout", "BUTTONS"))
    if touch_layout == "WHEEL":
        steer += float(touch_state.steer)
    elif touch_layout == "TILT" and OS.has_feature("mobile"):
        steer += clampf(Input.get_accelerometer().x / 3.0, -1.0, 1.0)
    return {
        "throttle": 1.0 if Input.is_action_pressed("accelerate") or touch_state.throttle else 0.0,
        "brake": 1.0 if Input.is_action_pressed("brake") or touch_state.brake else 0.0,
        "steer": clampf(steer * float(RoadfallSave.get_setting("steering_sensitivity", 1.0)), -1.0, 1.0),
        "handbrake": Input.is_action_pressed("handbrake") or touch_state.handbrake,
        "boost": Input.is_action_pressed("boost") or touch_state.boost
    }

func set_touch_control(control: String, pressed: bool) -> void:
    if touch_state.has(control):
        touch_state[control] = pressed

func set_touch_steering(amount: float) -> void:
    touch_state.steer = clampf(amount, -1.0, 1.0)

func start_match() -> void:
    match_paused = false
    camera_yaw = 0.0
    camera_mode = 0
    if menu:
        menu.hide_menu()
    if match_root and is_instance_valid(match_root):
        match_root.queue_free()
    match_root = Node3D.new()
    match_root.name = "MatchActors"
    add_child(match_root)
    match_director = RoadfallMatchDirector.new()
    add_child(match_director)
    match_director.configure(self, world, match_root)
    match_director.destination_changed.connect(_on_destination_changed)
    match_director.match_event_changed.connect(_on_match_event)
    match_director.match_finished.connect(_on_match_finished)
    match_director.inventory_changed.connect(_on_inventory_changed)
    match_director.start_match()
    hud = RoadfallHUD.new()
    add_child(hud)
    hud.configure(self, match_director)
    hud.show_hud()

func quit_to_menu() -> void:
    match_paused = false
    if hud:
        hud.queue_free()
        hud = null
    if match_director:
        match_director.queue_free()
        match_director = null
    if match_root:
        match_root.queue_free()
        match_root = null
    menu.show_menu()

func toggle_pause() -> void:
    if not match_director or not hud:
        return
    match_paused = not match_paused
    hud.set_pause_visible(match_paused)

func toggle_map() -> void:
    if hud:
        hud.toggle_full_map()

func cycle_camera() -> void:
    camera_mode = (camera_mode + 1) % 4
    if hud:
        hud.push_notice(["CHASE CAM", "CLOSE CHASE", "HOOD CAM", "COCKPIT CAM"][camera_mode])

func add_inventory_item(item: Dictionary) -> bool:
    var inventory: Array = RoadfallSave.profile.inventory
    if inventory.size() >= 4:
        if hud:
            hud.push_notice("INVENTORY FULL", true)
        return false
    inventory.append(item.duplicate(true))
    RoadfallSave.save_profile()
    if hud:
        hud.refresh()
    return true

func open_settings() -> void:
    if menu:
        menu.show_settings()

func open_garage() -> void:
    if menu:
        menu.show_garage()

func open_shop() -> void:
    if menu:
        menu.show_shop()

func _on_quality_changed(profile_name: String) -> void:
    if world:
        world.update_quality(quality.profile)
    if sun:
        sun.shadow_enabled = profile_name != "LOW"
        sun.directional_shadow_max_distance = float(quality.profile.get("shadow_distance", 65.0))
    if hud:
        hud.push_notice("GRAPHICS: %s" % profile_name)

func _on_region_changed(region: Dictionary) -> void:
    _last_region = str(region.id)
    if hud:
        hud.push_region(str(region.name))

func _on_destination_changed(destination: Dictionary, index: int, total: int) -> void:
    if hud:
        hud.push_notice("DESTINATION %02d/%02d · %s" % [index + 1, total, destination.name])

func _on_match_event(next_weather: String, event_name: String) -> void:
    world.set_weather(next_weather)
    weather.set_weather(next_weather)
    audio.set_weather(next_weather)
    if hud:
        hud.set_event(next_weather, event_name)

func _on_inventory_changed() -> void:
    if hud:
        hud.refresh()

func _on_match_finished(result: Dictionary) -> void:
    match_paused = false
    if hud:
        hud.show_results(result)

func _input(event: InputEvent) -> void:
    if match_director and event is InputEventScreenDrag:
        var sensitivity := float(RoadfallSave.get_setting("camera_sensitivity", 1.0))
        camera_yaw = clampf(camera_yaw - event.relative.x * 0.004 * sensitivity, -1.1, 1.1)

func _unhandled_input(event: InputEvent) -> void:
    if event.is_action_pressed("pause"):
        toggle_pause()
    elif event.is_action_pressed("map") or event.is_action_pressed("minimap"):
        toggle_map()
    elif event.is_action_pressed("camera"):
        cycle_camera()
    elif event.is_action_pressed("inventory") and hud:
        hud.toggle_inventory()
    elif event.is_action_pressed("interact") and match_director:
        match_director.use_inventory_item(0)

func profile_line() -> String:
    return "%s  ·  %s  ·  %d XP" % [RoadfallSave.profile.username, RoadfallSave.profile.rank, int(RoadfallSave.profile.xp)]
