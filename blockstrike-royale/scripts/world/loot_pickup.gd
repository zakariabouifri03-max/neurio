extends Node3D
## A loot item lying on the ground: weapon, ammo, healing, armour plate or build blocks.

const WDB := preload("res://scripts/weapons/weapon_db.gd")
const WM := preload("res://scripts/weapons/weapon_model.gd")

var kind: String = "ammo"
var item: String = "light"
var amount: int = 1
var cooldown: float = 0.0   # seconds before a dropped item can be picked up again
var _t: float = 0.0
var _base_y: float = 0.0
var _spin
var _label: Label3D


func setup(p_kind: String, p_item: String, p_amount: int, at: Vector3) -> void:
	kind = p_kind
	item = p_item
	amount = p_amount
	global_position = at + Vector3(0, 0.55, 0)
	_base_y = global_position.y
	_spin = Node3D.new()
	add_child(_spin)
	match kind:
		"weapon":
			var w: Node3D = WM.build(item)
			w.scale = Vector3.ONE * 1.25
			_spin.add_child(w)
			w.rotation = Vector3(0, 0, 0)
		"ammo":
			_add_cube(Vector3(0.36, 0.26, 0.3), Color(0.95, 0.8, 0.2))
		"item":
			if item == "medkit" or item == "bandage":
				var c := Color(0.95, 0.95, 0.95) if item == "bandage" else Color(0.95, 0.35, 0.35)
				_add_cube(Vector3(0.4, 0.3, 0.3), c)
				_add_cube(Vector3(0.1, 0.34, 0.32), Color(0.9, 0.12, 0.12))
				_add_cube(Vector3(0.34, 0.1, 0.32), Color(0.9, 0.12, 0.12))
			elif item == "armor_plate":
				_add_cube(Vector3(0.36, 0.4, 0.12), Color(0.25, 0.5, 0.95))
			elif item == "grenade":
				_add_cube(Vector3(0.3, 0.34, 0.3), Color(0.22, 0.3, 0.18))
				_add_cube(Vector3(0.12, 0.08, 0.12), Color(0.6, 0.6, 0.6))
			else:
				_add_cube(Vector3(0.45, 0.45, 0.45), Color(0.7, 0.5, 0.3))
	_label = Label3D.new()
	_label.text = describe()
	_label.position = Vector3(0, 0.9, 0)
	_label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	_label.font_size = 36
	_label.pixel_size = 0.008
	_label.outline_size = 8
	_label.no_depth_test = true
	_label.visible = false
	add_child(_label)


func describe() -> String:
	match kind:
		"weapon":
			return WDB.get_def(item).get("name", item)
		"ammo":
			return "%s ammo x%d" % [item.capitalize(), amount]
		"item":
			match item:
				"bandage":
					return "Bandage x%d" % amount
				"medkit":
					return "Medkit x%d" % amount
				"armor_plate":
					return "Armor plate x%d" % amount
				"grenade":
					return "Grenade x%d" % amount
				_:
					return "Build blocks x%d" % amount
	return item


func show_label(v: bool) -> void:
	if _label:
		_label.visible = v


func _add_cube(size: Vector3, c: Color) -> void:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.emission_enabled = true
	m.emission = c * 0.35
	mi.material_override = m
	_spin.add_child(mi)


func _process(delta: float) -> void:
	_t += delta
	if cooldown > 0.0:
		cooldown -= delta
	global_position.y = _base_y + sin(_t * 2.2) * 0.08
	if _spin:
		_spin.rotation.y += delta * 1.3
