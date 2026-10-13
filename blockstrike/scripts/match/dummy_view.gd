class_name DummyView
extends Node3D
## Training-ground target dummy (straw man on a post) with a floating HP readout.

var actor: Actor
var prev_pos := Vector3.ZERO
var cur_pos := Vector3.ZERO
var hurt_t := 0.0
var mi: MeshInstance3D
var label: Label3D
var flash: Node3D = null

func setup(a: Actor) -> void:
	actor = a
	mi = MeshInstance3D.new()
	mi.mesh = Models.dummy_mesh()
	mi.material_override = VoxelArt.prop_material()
	add_child(mi)
	label = Label3D.new()
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.font_size = 36
	label.pixel_size = 0.005
	label.outline_size = 8
	label.position = Vector3(0, 2.15, 0)
	add_child(label)
	snap_to(a.pos)

func tick_sync() -> void:
	prev_pos = cur_pos
	cur_pos = actor.pos

func push_sample(_t: float, p: Vector3, _yaw: float, _pitch: float) -> void:
	prev_pos = global_position
	cur_pos = p

func snap_to(p: Vector3) -> void:
	prev_pos = p
	cur_pos = p
	global_position = p

func hurt() -> void:
	hurt_t = 0.15

func set_weapon(_id: String, _wrap: String) -> void:
	pass

func _process(dt: float) -> void:
	if actor == null:
		return
	global_position = prev_pos.lerp(cur_pos, Engine.get_physics_interpolation_fraction())
	visible = actor.state != Actor.St.DEAD
	label.text = "%d HP" % int(actor.hp)
	if hurt_t > 0.0:
		hurt_t -= dt
		mi.rotation.x = sin(hurt_t * 40.0) * 0.08
	else:
		mi.rotation.x = 0.0
