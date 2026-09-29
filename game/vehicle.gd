class_name RoadfallVehicle
extends CharacterBody3D

signal picked_up(vehicle: RoadfallVehicle, item: Dictionary)
signal vehicle_destroyed(vehicle: RoadfallVehicle)

var game: Node
var world: RoadfallWorldStream
var vehicle_data: Dictionary = {}
var vehicle_id := "street"
var player_controlled := false
var drive_speed := 0.0
var health := 100.0
var boost_left := 0.0
var boost_cooldown := 0.0
var damage_flash := 0.0
var gear := 1
var rpm := 800.0
var distance_driven := 0.0
var upgrade_stats := {"accel": 0.0, "grip": 0.0, "brake": 0.0, "armor": 0.0, "offroad": 0.0}
var visual_root: Node3D
var wheel_nodes: Array[Node3D] = []
var exhaust_light: OmniLight3D
var is_eliminated := false
var input_override := {"throttle":0.0, "brake":0.0, "steer":0.0, "handbrake":false, "boost":false}

func configure(owner_game: Node, owner_world: RoadfallWorldStream, data: Dictionary, is_player := false) -> void:
    game = owner_game
    world = owner_world
    vehicle_data = data.duplicate(true)
    vehicle_id = str(data.get("id", "street"))
    player_controlled = is_player
    var saved_upgrade := RoadfallSave.get_vehicle_upgrade(vehicle_id)
    for key in upgrade_stats.keys():
        upgrade_stats[key] = float(saved_upgrade.get(key, 0)) * 0.035
    _build_vehicle()
    collision_layer = 2
    collision_mask = 1
    if not is_player:
        collision_mask = 1

func _build_vehicle() -> void:
    visual_root = Node3D.new()
    visual_root.name = "VehicleVisual"
    add_child(visual_root)
    var body_color: Color = vehicle_data.get("color", Color("#e65050"))
    var body := MeshInstance3D.new()
    var body_mesh := BoxMesh.new()
    body_mesh.size = Vector3(2.05, 0.68, 4.15)
    body.mesh = body_mesh
    body.position.y = 1.1
    body.material_override = _material(body_color, 0.38)
    visual_root.add_child(body)
    var cabin := MeshInstance3D.new()
    var cabin_mesh := BoxMesh.new()
    cabin_mesh.size = Vector3(1.55, 0.62, 1.9)
    cabin.mesh = cabin_mesh
    cabin.position = Vector3(0, 1.62, 0.18)
    cabin.material_override = _material(Color("#142b3d"), 0.12, true)
    visual_root.add_child(cabin)
    var hood := MeshInstance3D.new()
    var hood_mesh := BoxMesh.new()
    hood_mesh.size = Vector3(1.82, 0.18, 1.1)
    hood.mesh = hood_mesh
    hood.position = Vector3(0, 1.45, -1.22)
    hood.material_override = _material(body_color.lightened(0.12), 0.34)
    visual_root.add_child(hood)
    for side in [-1.0, 1.0]:
        var headlight := MeshInstance3D.new()
        var light_mesh := BoxMesh.new()
        light_mesh.size = Vector3(0.48, 0.14, 0.08)
        headlight.mesh = light_mesh
        headlight.position = Vector3(0.58 * side, 1.22, -2.08)
        headlight.material_override = _material(Color("#d8f5ff"), 0.18, true, Color("#a6e9ff"))
        visual_root.add_child(headlight)
        _make_wheel(side, -1.32)
        _make_wheel(side, 1.33)
    var spoiler := MeshInstance3D.new()
    var spoiler_mesh := BoxMesh.new()
    spoiler_mesh.size = Vector3(1.55, 0.12, 0.18)
    spoiler.mesh = spoiler_mesh
    spoiler.position = Vector3(0, 1.62, 1.73)
    spoiler.material_override = _material(body_color.darkened(0.25), 0.42)
    visual_root.add_child(spoiler)
    exhaust_light = OmniLight3D.new()
    exhaust_light.light_color = Color("#ff873f")
    exhaust_light.omni_range = 4.0
    exhaust_light.light_energy = 0.0
    exhaust_light.position = Vector3(0, 0.82, 2.05)
    visual_root.add_child(exhaust_light)
    var shape := CollisionShape3D.new()
    var box := BoxShape3D.new()
    box.size = Vector3(1.85, 1.35, 3.8)
    shape.shape = box
    shape.position.y = 1.0
    add_child(shape)

func _make_wheel(side: float, z: float) -> void:
    var wheel := MeshInstance3D.new()
    var wheel_mesh := CylinderMesh.new()
    wheel_mesh.top_radius = 0.42
    wheel_mesh.bottom_radius = 0.42
    wheel_mesh.height = 0.24
    wheel.mesh = wheel_mesh
    wheel.rotation.z = PI * 0.5
    wheel.position = Vector3(1.03 * side, 0.62, z)
    wheel.material_override = _material(Color("#10151b"), 0.95)
    visual_root.add_child(wheel)
    wheel_nodes.append(wheel)

func _material(color: Color, roughness := 0.7, emission := false, emission_color := Color.BLACK) -> StandardMaterial3D:
    var material := StandardMaterial3D.new()
    material.albedo_color = color
    material.roughness = roughness
    if emission:
        material.emission_enabled = true
        material.emission = emission_color if emission_color != Color.BLACK else color
        material.emission_energy_multiplier = 1.8
    return material

func _physics_process(delta: float) -> void:
    if vehicle_data.is_empty() or is_eliminated:
        return
    if game != null and game.match_paused:
        return
    var controls := read_drive_input()
    _drive(controls, delta)

func read_drive_input() -> Dictionary:
    if player_controlled and game != null:
        return game.get_drive_input()
    return input_override

func _drive(controls: Dictionary, delta: float) -> void:
    var throttle := clampf(float(controls.get("throttle", 0.0)), 0.0, 1.0)
    var braking := clampf(float(controls.get("brake", 0.0)), 0.0, 1.0)
    var steer := clampf(float(controls.get("steer", 0.0)), -1.0, 1.0)
    var handbrake := bool(controls.get("handbrake", false))
    if bool(controls.get("boost", false)) and boost_left <= 0.0:
        trigger_boost()
    var surface := world.surface_at(global_position) if world != null else "asphalt"
    var friction := _surface_friction(surface)
    var grip := float(vehicle_data.get("grip", 1.0)) * (1.0 + upgrade_stats.grip)
    var power := float(vehicle_data.get("power", 160.0))
    var mass_factor := clampf(1600.0 / float(vehicle_data.get("mass", 1200.0)), 0.65, 1.25)
    var accel := 5.0 + power * 0.052 * mass_factor
    accel *= (1.0 + upgrade_stats.accel)
    if surface in ["sand", "mud", "snow", "rock"]:
        accel *= 0.76 + upgrade_stats.offroad
    if boost_left > 0.0:
        accel *= 2.1
        boost_left = maxf(0.0, boost_left - delta)
    boost_cooldown = maxf(0.0, boost_cooldown - delta)
    var max_speed := float(vehicle_data.get("top_speed", 50.0)) * (1.0 + upgrade_stats.accel * 0.22)
    if boost_left > 0.0:
        max_speed *= 1.32
    if throttle > 0.01:
        drive_speed = move_toward(drive_speed, max_speed * throttle, accel * delta)
    else:
        drive_speed = move_toward(drive_speed, 0.0, (1.6 + (1.0 - friction) * 3.0) * delta)
    if braking > 0.01:
        drive_speed = move_toward(drive_speed, -max_speed * 0.18 * braking, (13.0 + upgrade_stats.brake * 7.0) * delta)
    if handbrake:
        drive_speed = move_toward(drive_speed, drive_speed * 0.35, 11.0 * delta)
        grip *= 0.55
    var speed_ratio := clampf(absf(drive_speed) / maxf(max_speed, 1.0), 0.0, 1.0)
    var steering_rate := (0.95 + grip * 0.42) * (0.45 + speed_ratio * 0.95)
    if handbrake:
        steering_rate *= 1.3
    rotation.y -= steer * steering_rate * delta
    var forward := -global_transform.basis.z
    velocity.x = forward.x * drive_speed
    velocity.z = forward.z * drive_speed
    velocity.y = -1.2
    move_and_slide()
    if global_position.y < -6.0:
        global_position.y = 1.2
        drive_speed *= 0.25
    distance_driven += absf(drive_speed) * delta
    gear = clampi(int(absf(drive_speed) / 11.0) + 1, 1, 6)
    rpm = lerpf(900.0, 7200.0, speed_ratio)
    damage_flash = maxf(0.0, damage_flash - delta)
    if exhaust_light != null:
        exhaust_light.light_energy = 2.5 if boost_left > 0.0 else (0.45 if throttle > 0.1 else 0.0)
    for wheel in wheel_nodes:
        wheel.rotation.x -= drive_speed * delta * 0.8

func _surface_friction(surface: String) -> float:
    match surface:
        "wet asphalt": return 0.78
        "gravel": return 0.72
        "mud": return 0.57
        "sand": return 0.50 + upgrade_stats.offroad * 0.4
        "snow": return 0.44 + upgrade_stats.offroad * 0.55
        "ice": return 0.30
        "grass": return 0.63
        "rock": return 0.70
    return 1.0

func trigger_boost() -> void:
    if boost_cooldown > 0.0:
        return
    boost_left = 2.8
    boost_cooldown = 4.0

func collect_upgrade(item: Dictionary) -> void:
    if game != null and game.add_inventory_item(item):
        picked_up.emit(self, item)

func apply_damage(amount: float) -> void:
    var armour := float(upgrade_stats.armor)
    health -= maxf(1.0, amount * (1.0 - armour * 0.4))
    damage_flash = 0.25
    if health <= 0.0:
        health = 0.0
        is_eliminated = true
        vehicle_destroyed.emit(self)

func reset_health() -> void:
    health = 100.0
    is_eliminated = false

func speed_kmh() -> int:
    return int(absf(drive_speed) * 3.6)

func forward_direction() -> Vector3:
    return -global_transform.basis.z
