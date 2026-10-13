extends RefCounted
## Builds blocky weapon models from boxes. Origin = grip, barrel points toward -Z.
## Every model has a child Marker3D named "Muzzle" at the bullet origin.

const WDB := preload("res://scripts/weapons/weapon_db.gd")


static func build(id: String, skin_tint: Color = Color(0, 0, 0, 0)):
	var root := Node3D.new()
	root.name = "Weapon_" + id
	var def: Dictionary = WDB.get_def(id)
	if def.is_empty():
		return root
	var kind: String = def["kind"]
	var accent: Color = def["accent"]
	if skin_tint.a > 0.0:
		accent = skin_tint
	var metal := _mat(Color(0.17, 0.18, 0.2), 0.35)
	var dark := _mat(Color(0.09, 0.09, 0.1), 0.5)
	var wood := _mat(Color(0.45, 0.3, 0.18), 0.8)
	var acc := _mat(accent, 0.45)
	var muzzle_z := -0.8
	match kind:
		"rifle":
			_box(root, Vector3(0.09, 0.12, 0.42), Vector3(0, 0.02, -0.2), metal)
			_box(root, Vector3(0.035, 0.035, 0.4), Vector3(0, 0.03, -0.6), dark)
			_box(root, Vector3(0.07, 0.08, 0.22), Vector3(0, 0.0, -0.45), metal)
			_box(root, Vector3(0.07, 0.1, 0.24), Vector3(0, 0.0, 0.1), wood)
			_box(root, Vector3(0.06, 0.17, 0.08), Vector3(0, -0.14, -0.22), dark)
			_box(root, Vector3(0.05, 0.13, 0.06), Vector3(0, -0.1, 0.0), dark)
			_box(root, Vector3(0.03, 0.05, 0.1), Vector3(0, 0.1, -0.25), acc)
			muzzle_z = -0.82
		"smg":
			_box(root, Vector3(0.09, 0.13, 0.3), Vector3(0, 0.02, -0.14), metal)
			_box(root, Vector3(0.03, 0.03, 0.2), Vector3(0, 0.03, -0.4), dark)
			_box(root, Vector3(0.05, 0.2, 0.07), Vector3(0, -0.15, -0.12), dark)
			_box(root, Vector3(0.06, 0.08, 0.1), Vector3(0, 0.0, 0.1), metal)
			_box(root, Vector3(0.09, 0.03, 0.12), Vector3(0, 0.09, -0.2), acc)
			muzzle_z = -0.52
		"shotgun":
			_box(root, Vector3(0.1, 0.14, 0.5), Vector3(0, 0.02, -0.22), metal)
			_box(root, Vector3(0.04, 0.04, 0.55), Vector3(-0.03, 0.05, -0.6), dark)
			_box(root, Vector3(0.04, 0.04, 0.55), Vector3(0.03, 0.05, -0.6), dark)
			_box(root, Vector3(0.08, 0.07, 0.16), Vector3(0, -0.06, -0.38), wood)
			_box(root, Vector3(0.08, 0.14, 0.28), Vector3(0, 0.0, 0.14), wood)
			_box(root, Vector3(0.05, 0.12, 0.06), Vector3(0, -0.1, 0.0), dark)
			_box(root, Vector3(0.05, 0.06, 0.12), Vector3(0, -0.11, -0.22), acc)
			muzzle_z = -0.9
		"sniper":
			_box(root, Vector3(0.09, 0.13, 0.5), Vector3(0, 0.02, -0.25), metal)
			_box(root, Vector3(0.035, 0.035, 0.8), Vector3(0, 0.03, -0.82), dark)
			_box(root, Vector3(0.05, 0.07, 0.26), Vector3(0, 0.12, -0.25), dark)
			_box(root, Vector3(0.08, 0.12, 0.42), Vector3(0, 0.0, 0.14), wood)
			_box(root, Vector3(0.06, 0.16, 0.08), Vector3(0, -0.14, -0.2), dark)
			_box(root, Vector3(0.05, 0.12, 0.06), Vector3(0, -0.1, 0.02), dark)
			_box(root, Vector3(0.04, 0.04, 0.2), Vector3(0, 0.12, -0.25), acc)
			muzzle_z = -1.23
		"pistol":
			_box(root, Vector3(0.06, 0.08, 0.22), Vector3(0, 0.04, -0.12), metal)
			_box(root, Vector3(0.05, 0.14, 0.07), Vector3(0, -0.07, -0.02), dark)
			_box(root, Vector3(0.02, 0.02, 0.05), Vector3(0, 0.05, -0.27), acc)
			muzzle_z = -0.25
		"melee":
			_box(root, Vector3(0.03, 0.025, 0.24), Vector3(0, 0.0, -0.15), metal)
			_box(root, Vector3(0.035, 0.035, 0.12), Vector3(0, 0.0, 0.02), dark)
			_box(root, Vector3(0.04, 0.04, 0.03), Vector3(0, 0.0, -0.02), acc)
			muzzle_z = -0.28
	var m := Marker3D.new()
	m.name = "Muzzle"
	m.position = Vector3(0, 0.03, muzzle_z)
	root.add_child(m)
	return root


static func _mat(c: Color, rough: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	return m


static func _box(parent, size: Vector3, pos: Vector3, mat: Material) -> void:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	mi.position = pos
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
