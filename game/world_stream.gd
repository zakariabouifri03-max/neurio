class_name RoadfallWorldStream
extends Node3D

## 12 km x 12 km streamed world. Cells are deliberately simple, deterministic
## meshes so the same code scales from a phone to a desktop GPU.

signal region_changed(region: Dictionary)

var active_cells: Dictionary = {}
var _loading_cells: Dictionary = {}
var loaded_center := Vector2i(9999, 9999)
var quality: Dictionary = {}
var weather := "CLEAR"
var active_event := ""
var current_region := "city"
var _last_origin := Vector3.ZERO
var _materials: Dictionary = {}

func setup(quality_profile: Dictionary) -> void:
    quality = quality_profile.duplicate(true)
    _make_materials()
    update_streaming(Vector3.ZERO, true)

func update_quality(quality_profile: Dictionary) -> void:
    quality = quality_profile.duplicate(true)

func update_streaming(player_position: Vector3, force := false) -> void:
    var center := _cell_for(player_position)
    if not force and center == loaded_center and player_position.distance_squared_to(_last_origin) < 180.0 * 180.0:
        return
    loaded_center = center
    _last_origin = player_position
    var desired: Dictionary = {}
    var radius := int(quality.get("cell_radius", 1))
    for x in range(center.x - radius, center.x + radius + 1):
        for z in range(center.y - radius, center.y + radius + 1):
            if x >= 0 and x < 20 and z >= 0 and z < 20:
                desired[Vector2i(x, z)] = true
    for coord in desired.keys():
        if not active_cells.has(coord) and not _loading_cells.has(coord):
            _loading_cells[coord] = true
            call_deferred("_load_cell_deferred", coord)
    for coord in active_cells.keys().duplicate():
        if not desired.has(coord):
            var old: Node = active_cells[coord]
            old.queue_free()
            active_cells.erase(coord)
    var region := RoadfallData.region_for_position(player_position)
    if region.id != current_region:
        current_region = region.id
        region_changed.emit(region)

func _cell_for(pos: Vector3) -> Vector2i:
    return Vector2i(clampi(floori((pos.x + 6000.0) / RoadfallData.CELL_SIZE), 0, 19), clampi(floori((pos.z + 6000.0) / RoadfallData.CELL_SIZE), 0, 19))

func _make_materials() -> void:
    _materials["road"] = _mat(Color("#18232d"), 0.86)
    _materials["road_line"] = _mat(Color("#d3b664"), 0.62, true)
    _materials["sidewalk"] = _mat(Color("#56616a"), 0.95)
    _materials["metal"] = _mat(Color("#677885"), 0.55, true)
    _materials["window"] = _mat(Color("#142d43"), 0.18, true)
    _materials["neon"] = _mat(Color("#35d6ef"), 0.28, true, Color("#157caa"))
    _materials["sand"] = _mat(Color("#a87a4c"), 1.0)
    _materials["grass"] = _mat(Color("#466d45"), 1.0)

func _mat(color: Color, roughness := 0.8, emission := false, emission_color := Color.BLACK) -> StandardMaterial3D:
    var material := StandardMaterial3D.new()
    material.albedo_color = color
    material.roughness = roughness
    if emission:
        material.emission_enabled = true
        material.emission = emission_color if emission_color != Color.BLACK else color
        material.emission_energy_multiplier = 1.4
    return material

func _load_cell_deferred(coord: Vector2i) -> void:
    _loading_cells.erase(coord)
    if not active_cells.has(coord):
        _load_cell(coord)

func _load_cell(coord: Vector2i) -> void:
    var cell := Node3D.new()
    cell.name = "Cell_%d_%d" % [coord.x, coord.y]
    add_child(cell)
    active_cells[coord] = cell
    var origin := Vector3(coord.x * RoadfallData.CELL_SIZE - 5700.0, 0.0, coord.y * RoadfallData.CELL_SIZE - 5700.0)
    var center := origin + Vector3(300.0, 0.0, 300.0)
    var region := RoadfallData.region_for_position(center)
    _add_ground(cell, center, region)
    _add_roads(cell, center, region)
    _add_features(cell, center, region, coord)

func _add_ground(parent: Node3D, center: Vector3, region: Dictionary) -> void:
    var ground := MeshInstance3D.new()
    var mesh := BoxMesh.new()
    mesh.size = Vector3(RoadfallData.CELL_SIZE, 2.0, RoadfallData.CELL_SIZE)
    ground.mesh = mesh
    ground.position = center + Vector3(0, -1.2, 0)
    ground.material_override = _mat(region.color, 1.0)
    parent.add_child(ground)
    var body := StaticBody3D.new()
    body.position = ground.position
    var collision := CollisionShape3D.new()
    var shape := BoxShape3D.new()
    shape.size = mesh.size
    collision.shape = shape
    body.add_child(collision)
    parent.add_child(body)

func _add_roads(parent: Node3D, center: Vector3, region: Dictionary) -> void:
    # A continuous orthogonal highway grid plus local roads gives every region
    # fast, safe, off-road and risky-shortcut route choices.
    _road_box(parent, center + Vector3(0, 0.03, 0), Vector3(600, 0.12, 22), _materials.road)
    _road_box(parent, center + Vector3(0, 0.035, 0), Vector3(22, 0.13, 600), _materials.road)
    _road_box(parent, center + Vector3(0, 0.05, 210), Vector3(600, 0.14, 11), _materials.sidewalk)
    _road_box(parent, center + Vector3(210, 0.055, 0), Vector3(11, 0.15, 600), _materials.sidewalk)
    for offset in range(-270, 271, 45):
        _road_box(parent, center + Vector3(offset, 0.11, 0), Vector3(2.0, 0.035, 4.0), _materials.road_line)
        _road_box(parent, center + Vector3(0, 0.115, offset), Vector3(4.0, 0.035, 2.0), _materials.road_line)
    if region.id == "airport":
        _road_box(parent, center + Vector3(0, 0.12, 110), Vector3(550, 0.05, 56), _materials.road)
    if region.id == "coast":
        _road_box(parent, center + Vector3(0, 0.14, -230), Vector3(600, 0.05, 16), _materials.neon)

func _road_box(parent: Node3D, position: Vector3, size: Vector3, material: Material) -> void:
    var road := MeshInstance3D.new()
    var mesh := BoxMesh.new()
    mesh.size = size
    road.mesh = mesh
    road.position = position
    road.material_override = material
    parent.add_child(road)

func _add_features(parent: Node3D, center: Vector3, region: Dictionary, coord: Vector2i) -> void:
    var rng := RandomNumberGenerator.new()
    rng.seed = abs(hash("roadfall:%d:%d" % [coord.x, coord.y])) + 1
    var count := int(5.0 + 10.0 * float(quality.get("vegetation", 0.5)))
    for i in range(count):
        var px := center.x + rng.randf_range(-270.0, 270.0)
        var pz := center.z + rng.randf_range(-270.0, 270.0)
        if abs(px - center.x) < 24.0 or abs(pz - center.z) < 24.0:
            continue
        if region.id in ["forest", "farmland", "snow"]:
            _tree(parent, Vector3(px, 0, pz), region, rng.randf_range(0.7, 1.45))
        elif region.id == "desert":
            _rock(parent, Vector3(px, 0, pz), rng.randf_range(0.7, 2.1), region.accent)
        else:
            _building(parent, Vector3(px, 0, pz), region, rng)
    if region.id == "mountain":
        for i in range(3):
            _rock(parent, center + Vector3(rng.randf_range(-250, 250), rng.randf_range(10, 55), rng.randf_range(-250, 250)), rng.randf_range(3.0, 7.0), region.accent)
    if region.id == "industrial":
        _tank(parent, center + Vector3(-120, 0, 120), 18.0)
    if region.id == "airport":
        _hangar(parent, center + Vector3(-100, 0, -150))

func _tree(parent: Node3D, pos: Vector3, region: Dictionary, scale_value: float) -> void:
    var tree := Node3D.new()
    tree.position = pos
    tree.scale = Vector3.ONE * scale_value
    var trunk := MeshInstance3D.new()
    var trunk_mesh := CylinderMesh.new()
    trunk_mesh.top_radius = 0.22
    trunk_mesh.bottom_radius = 0.4
    trunk_mesh.height = 3.2
    trunk.mesh = trunk_mesh
    trunk.position.y = 1.6
    trunk.material_override = _mat(Color("#44362b"), 1.0)
    tree.add_child(trunk)
    var crown := MeshInstance3D.new()
    var crown_mesh := SphereMesh.new()
    crown_mesh.radius = 2.1
    crown_mesh.height = 4.4
    crown.mesh = crown_mesh
    crown.position.y = 4.3
    crown.material_override = _mat(region.accent.darkened(0.45), 1.0)
    tree.add_child(crown)
    parent.add_child(tree)

func _rock(parent: Node3D, pos: Vector3, scale_value: float, color: Color) -> void:
    var rock := MeshInstance3D.new()
    var mesh := SphereMesh.new()
    mesh.radius = 1.0
    mesh.height = 1.4
    rock.mesh = mesh
    rock.position = pos + Vector3(0, scale_value * 0.5, 0)
    rock.scale = Vector3(scale_value * 1.4, scale_value, scale_value * 0.8)
    rock.material_override = _mat(color.darkened(0.35), 1.0)
    parent.add_child(rock)

func _building(parent: Node3D, pos: Vector3, region: Dictionary, rng: RandomNumberGenerator) -> void:
    var building := MeshInstance3D.new()
    var mesh := BoxMesh.new()
    var h := rng.randf_range(5.0, 22.0) if region.id in ["city", "airport"] else rng.randf_range(2.5, 8.0)
    mesh.size = Vector3(rng.randf_range(8.0, 22.0), h, rng.randf_range(8.0, 22.0))
    building.mesh = mesh
    building.position = pos + Vector3(0, h * 0.5, 0)
    building.material_override = _mat(region.color.lightened(rng.randf_range(0.0, 0.22)), 0.84)
    parent.add_child(building)
    if region.id == "city":
        var strip := MeshInstance3D.new()
        var strip_mesh := BoxMesh.new()
        strip_mesh.size = Vector3(mesh.size.x * 0.75, 0.14, 0.08)
        strip.mesh = strip_mesh
        strip.position = building.position + Vector3(0, rng.randf_range(-h * 0.2, h * 0.3), mesh.size.z * 0.51)
        strip.material_override = _materials.neon
        parent.add_child(strip)

func _tank(parent: Node3D, pos: Vector3, radius: float) -> void:
    var tank := MeshInstance3D.new()
    var mesh := CylinderMesh.new()
    mesh.top_radius = radius
    mesh.bottom_radius = radius
    mesh.height = radius * 1.4
    tank.mesh = mesh
    tank.position = pos + Vector3(0, radius * 0.7, 0)
    tank.material_override = _materials.metal
    parent.add_child(tank)

func _hangar(parent: Node3D, pos: Vector3) -> void:
    var hangar := MeshInstance3D.new()
    var mesh := BoxMesh.new()
    mesh.size = Vector3(170, 28, 80)
    hangar.mesh = mesh
    hangar.position = pos + Vector3(0, 14, 0)
    hangar.material_override = _materials.metal
    parent.add_child(hangar)

func region_at(pos: Vector3) -> Dictionary:
    return RoadfallData.region_for_position(pos)

func surface_at(pos: Vector3) -> String:
    var region := region_at(pos)
    if weather == "SNOWSTORM" and region.surface == "asphalt":
        return "snow"
    if weather in ["RAIN", "HEAVY RAIN"] and region.surface == "asphalt":
        return "wet asphalt"
    return str(region.surface)

func set_weather(next_weather: String) -> void:
    weather = next_weather
    if weather == "SANDSTORM":
        _materials.road.albedo_color = Color("#38302c")
    else:
        _materials.road.albedo_color = Color("#18232d")

func set_event(event_name: String) -> void:
    active_event = event_name

func world_to_map(pos: Vector3) -> Vector2:
    return Vector2((pos.x + 6000.0) / RoadfallData.WORLD_SIZE, (pos.z + 6000.0) / RoadfallData.WORLD_SIZE)

func map_to_world(point: Vector2) -> Vector3:
    return Vector3(point.x * RoadfallData.WORLD_SIZE - 6000.0, 0.0, point.y * RoadfallData.WORLD_SIZE - 6000.0)
