extends Area3D
## Lightweight collectible used by the prototype. Touching a pickup is enough on mobile;
## the interact button is also wired for deliberate collection at close range.

var pickup_type := "ammo"
var title := "AMMO"
var base_y := 1.0
var phase := 0.0
var collected := false

func setup(kind: String, label: String) -> void:
	pickup_type = kind
	title = label

func _ready() -> void:
	collision_layer = 4
	collision_mask = 2
	monitoring = true
	monitorable = true
	phase = float(get_instance_id() % 100) * 0.08
	base_y = position.y
	var color := Color("#ffd166")
	if pickup_type == "medkit":
		color = Color("#ff6b6b")
	elif pickup_type == "armor":
		color = Color("#63a4ff")
	BlockFactory.cube(self, Vector3.ZERO, Vector3(1.0, 1.0, 1.0), color, false, "PickupCube")
	BlockFactory.cube(self, Vector3(0, 0.12, 0), Vector3(0.65, 0.65, 0.65), color.lightened(0.24), false, "PickupCore")
	var shape := CollisionShape3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = 1.3
	shape.shape = sphere
	add_child(shape)
	BlockFactory.label_billboard(self, Vector3(0, 1.25, 0), title, Color("#effffb"))
	body_entered.connect(_on_body_entered)

func _process(delta: float) -> void:
	if collected:
		return
	phase += delta * 2.2
	position.y = base_y + sin(phase) * 0.18
	rotation.y += delta * 0.9

func _on_body_entered(body: Node3D) -> void:
	if body.has_method("collect_pickup"):
		body.collect_pickup(pickup_type)
		collected = true
		queue_free()
