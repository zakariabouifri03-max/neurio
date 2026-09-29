class_name RoadfallTraffic
extends Node3D

var direction := Vector3.FORWARD
var speed := 8.0
var travel := 0.0
var limit := 600.0

func configure(position: Vector3, heading: Vector3, color: Color, traffic_speed: float) -> void:
    global_position = position + Vector3(0, 0.72, 0)
    direction = heading.normalized()
    speed = traffic_speed
    var body := MeshInstance3D.new()
    var mesh := BoxMesh.new()
    mesh.size = Vector3(1.45, 0.62, 2.8)
    body.mesh = mesh
    body.material_override = _material(color)
    add_child(body)
    var light := OmniLight3D.new()
    light.light_color = color
    light.light_energy = 0.35
    light.omni_range = 3.0
    add_child(light)

func _process(delta: float) -> void:
    global_position += direction * speed * delta
    travel += speed * delta
    if travel > limit:
        global_position -= direction * limit * 2.0
        travel = 0.0

func _material(color: Color) -> StandardMaterial3D:
    var material := StandardMaterial3D.new()
    material.albedo_color = color
    material.roughness = 0.55
    return material
