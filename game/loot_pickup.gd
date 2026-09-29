class_name RoadfallLootPickup
extends Area3D

var item: Dictionary = {}
var match_director: Node
var base_y := 0.8
var age := 0.0
var visual: Node3D

func configure(owner_match: Node, loot_item: Dictionary, position: Vector3) -> void:
    match_director = owner_match
    item = loot_item.duplicate(true)
    global_position = position + Vector3(0, 0.9, 0)
    base_y = global_position.y
    collision_layer = 4
    collision_mask = 2
    monitoring = true
    _build()
    body_entered.connect(_on_body_entered)

func _build() -> void:
    visual = Node3D.new()
    add_child(visual)
    var crate := MeshInstance3D.new()
    var mesh := BoxMesh.new()
    mesh.size = Vector3(0.85, 0.85, 0.85)
    crate.mesh = mesh
    var mat := StandardMaterial3D.new()
    mat.albedo_color = item.get("color", Color("#38bdf8"))
    mat.emission_enabled = true
    mat.emission = mat.albedo_color.darkened(0.25)
    mat.emission_energy_multiplier = 1.5
    crate.material_override = mat
    visual.add_child(crate)
    var ring := MeshInstance3D.new()
    var ring_mesh := TorusMesh.new()
    ring_mesh.inner_radius = 0.62
    ring_mesh.outer_radius = 0.7
    ring.mesh = ring_mesh
    ring.rotation.x = PI * 0.5
    ring.material_override = mat
    visual.add_child(ring)
    var shape := CollisionShape3D.new()
    var sphere := SphereShape3D.new()
    sphere.radius = 1.3
    shape.shape = sphere
    add_child(shape)

func _process(delta: float) -> void:
    age += delta
    if visual:
        visual.position.y = sin(age * 2.6) * 0.13
        visual.rotation.y = age * 1.2

func _on_body_entered(body: Node) -> void:
    if body is RoadfallVehicle and body.player_controlled:
        if match_director != null and match_director.collect_loot(self, body):
            queue_free()
