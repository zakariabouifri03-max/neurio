class_name WeaponModel
extends Node3D
## Builds a voxel weapon mesh from a data-driven part list.
##
## Every weapon in data/weapons.json describes its own boxes (position, size,
## colour, optional atlas tile), so new weapons need no modelling work and the
## art style stays consistent.  Cosmetic weapon skins recolour the receiver.

var parts: Node3D
var muzzle: Node3D
var base_colors: Array = []
var skin_tint: Color = Color.WHITE

func build(weapon: Dictionary) -> void:
	parts = Node3D.new()
	parts.name = "Parts"
	add_child(parts)
	var model: Dictionary = weapon.get("models", {})
	var part_list: Array = model.get("parts", [])
	for entry: Variant in part_list:
		var part: Dictionary = entry
		var size: Array = part.get("s", [1, 1, 1])
		var position: Array = part.get("p", [0, 0, 0])
		var color := Color(str(part.get("c", "#808080")))
		var mesh := BoxMesh.new()
		mesh.size = Vector3(float(size[0]), float(size[1]), float(size[2]))
		var instance := MeshInstance3D.new()
		instance.mesh = mesh
		instance.position = Vector3(float(position[0]), float(position[1]), float(position[2]))
		var material := StandardMaterial3D.new()
		material.albedo_color = color
		material.roughness = 0.7
		material.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
		instance.material_override = material
		parts.add_child(instance)
		base_colors.append(color)
	muzzle = Node3D.new()
	muzzle.name = "Muzzle"
	var muzzle_position: Array = model.get("muzzle", [0.5, 0, 0])
	muzzle.position = Vector3(float(muzzle_position[0]), float(muzzle_position[1]),
		float(muzzle_position[2]))
	parts.add_child(muzzle)
	var scale_factor := float(model.get("scale", 1.0))
	parts.scale = Vector3.ONE * scale_factor

## Applies a cosmetic skin colour to every part that is not a grip/stock accent.
func apply_skin(tint: Color) -> void:
	skin_tint = tint
	if parts == null:
		return
	var index := 0
	for child: Node in parts.get_children():
		if child is MeshInstance3D and index < base_colors.size():
			var instance := child as MeshInstance3D
			var material := instance.material_override as StandardMaterial3D
			if material != null:
				var base: Color = base_colors[index]
				# Blend so shading differences between parts are preserved.
				material.albedo_color = base.lerp(tint, 0.65)
		index += 1

func muzzle_position() -> Vector3:
	return muzzle.global_position if muzzle != null else global_position

func muzzle_direction() -> Vector3:
	return -global_transform.basis.z
