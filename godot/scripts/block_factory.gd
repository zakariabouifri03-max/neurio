class_name BlockFactory
extends RefCounted
## Small procedural art kit. Every shape is authored in code, so the prototype ships without
## external assets and stays crisp at low Android texture budgets.

static func material(color: Color, roughness: float = 0.82, emission: Color = Color.TRANSPARENT) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.roughness = roughness
	mat.metallic = 0.0
	if emission.a > 0.0:
		mat.emission_enabled = true
		mat.emission = emission
		mat.emission_energy_multiplier = 1.7
	return mat

static func transparent_material(color: Color, alpha: float, emission: Color = Color.TRANSPARENT) -> StandardMaterial3D:
	var mat := material(color, 0.45, emission)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.albedo_color.a = alpha
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return mat

static func cube(parent: Node, position: Vector3, size: Vector3, color: Color, collision: bool = false, node_name: String = "Block") -> MeshInstance3D:
	var mesh_instance := MeshInstance3D.new()
	mesh_instance.name = node_name
	var mesh := BoxMesh.new()
	mesh.size = size
	mesh_instance.mesh = mesh
	mesh_instance.material_override = material(color)
	mesh_instance.position = position
	parent.add_child(mesh_instance)
	if collision:
		var body := StaticBody3D.new()
		body.name = "%sCollision" % node_name
		body.position = position
		body.collision_layer = 1
		body.collision_mask = 1 | 2 | 4 | 8
		var shape := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = size
		shape.shape = box
		body.add_child(shape)
		parent.add_child(body)
	return mesh_instance

static func cylinder(parent: Node, position: Vector3, radius: float, height: float, color: Color, collision: bool = false, node_name: String = "Cylinder") -> MeshInstance3D:
	var mesh_instance := MeshInstance3D.new()
	mesh_instance.name = node_name
	var mesh := CylinderMesh.new()
	mesh.top_radius = radius
	mesh.bottom_radius = radius
	mesh.height = height
	mesh.radial_segments = 12
	mesh_instance.mesh = mesh
	mesh_instance.material_override = material(color)
	mesh_instance.position = position
	parent.add_child(mesh_instance)
	if collision:
		var body := StaticBody3D.new()
		body.name = "%sCollision" % node_name
		body.position = position
		var shape := CollisionShape3D.new()
		var cylinder_shape := CylinderShape3D.new()
		cylinder_shape.radius = radius
		cylinder_shape.height = height
		shape.shape = cylinder_shape
		body.add_child(shape)
		parent.add_child(body)
	return mesh_instance

static func label_billboard(parent: Node, position: Vector3, text: String, color: Color) -> Label3D:
	var label := Label3D.new()
	label.text = text
	label.position = position
	label.modulate = color
	label.font_size = 32
	label.outline_size = 8
	label.outline_modulate = Color(0.02, 0.04, 0.08, 0.9)
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	parent.add_child(label)
	return label
