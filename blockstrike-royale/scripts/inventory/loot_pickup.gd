class_name LootPickup
extends Area3D
## A single item lying on the ground (weapon, ammo, heal, armour, build blocks).
##
## Pickups are Area3D nodes in the LOOT layer: the player's InteractionComponent
## finds them, the HUD shows a prompt, and `interact()` transfers the contents.
## Contents are owned by the match (server-authoritative in online modes).

signal collected(by_player: PlayerController, item_id: String)

const SPIN_SPEED := 1.6
const BOB_SPEED := 2.2
const BOB_HEIGHT := 0.09

var item_id: String = ""
var weapon_id: String = ""
var amount: int = 1
var rarity: String = "common"
var magazine: int = 0
var reserve: int = 0
var pickup_sound: String = "pickup"
var _highlight: bool = false
var _base_y: float = 0.0
var _time: float = 0.0
var _label: Label3D
var _mesh: MeshInstance3D

func setup(item: Dictionary, weapon: Dictionary = {}, count: int = 1) -> void:
	item_id = str(item.get("id", ""))
	amount = count
	if not weapon.is_empty():
		weapon_id = str(weapon.get("id", ""))
		item_id = weapon_id
		rarity = str(weapon.get("rarity", "common"))
		magazine = int(weapon.get("magazine", 0))
		reserve = int(weapon.get("reserve_ammo", 0))
		pickup_sound = "weapon_switch"
	else:
		rarity = "common"

func _ready() -> void:
	collision_layer = GameConfig.Layer.LOOT
	collision_mask = 0
	monitoring = false
	var shape := SphereShape3D.new()
	shape.radius = 0.9
	var collision := CollisionShape3D.new()
	collision.shape = shape
	add_child(collision)

	var size := Vector3(0.4, 0.4, 0.4)
	var color := Color(0.85, 0.85, 0.85)
	if not weapon_id.is_empty():
		size = Vector3(0.75, 0.2, 0.2)
		color = Color(0.35, 0.38, 0.44)
	else:
		match item_id:
			"medkit", "bandage":
				color = Color(0.92, 0.92, 0.92)
				size = Vector3(0.45, 0.3, 0.35)
			"shield_cell":
				color = Color(0.5, 0.85, 0.95)
			"armor_plate":
				color = Color(0.4, 0.6, 0.95)
			"build_block":
				color = Color(0.45, 0.75, 0.45)
			"ammo_light", "ammo_heavy", "ammo_shell", "ammo_sniper":
				color = Color(0.85, 0.72, 0.35)
				size = Vector3(0.32, 0.28, 0.32)
			"credits_pack":
				color = Color(0.95, 0.8, 0.3)
				size = Vector3(0.3, 0.1, 0.42)
	var mesh := BoxMesh.new()
	mesh.size = size
	_mesh = MeshInstance3D.new()
	_mesh.mesh = mesh
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.emission_enabled = true
	material.emission = UiKit.rarity_color(rarity) * 0.4
	material.emission_energy_multiplier = 0.8
	_mesh.material_override = material
	add_child(_mesh)

	_label = Label3D.new()
	_label.text = _display_text()
	_label.font_size = 26
	_label.pixel_size = 0.004
	_label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	_label.modulate = UiKit.rarity_color(rarity)
	_label.outline_size = 8
	_label.position = Vector3(0, 0.42, 0)
	_label.visible = false
	add_child(_label)
	_base_y = global_position.y

func _display_text() -> String:
	if not weapon_id.is_empty():
		return str(ContentDB.weapon(weapon_id).get("display_name", weapon_id))
	var item := ContentDB.item(item_id)
	var name := str(item.get("name", item_id))
	return name if amount <= 1 else "%s x%d" % [name, amount]

func _process(delta: float) -> void:
	_time += delta
	rotate_y(delta * SPIN_SPEED)
	global_position.y = _base_y + sin(_time * BOB_SPEED) * BOB_HEIGHT

## Called by InteractionComponent: transfer contents to the player.
func interact(player: Node3D) -> void:
	var controller := player as PlayerController
	if controller == null:
		return
	var inventory := controller.inventory
	var stored := 0
	if not weapon_id.is_empty():
		var dropped := controller.weapons.pick_up_weapon(weapon_id)
		if not dropped.is_empty():
			_spawn_dropped(controller, dropped)
		stored = 1
	else:
		var item := ContentDB.item(item_id)
		match str(item.get("kind", "")):
			"build_block":
				stored = inventory.add("build_block", amount)
			_:
				stored = inventory.add(item_id, amount)
	if stored <= 0:
		return
	if pickup_sound == "weapon_switch":
		AudioDirector.play_sfx("weapon_switch", global_position, -6.0)
	else:
		AudioDirector.play_sfx(pickup_sound, global_position, -6.0)
	GameEffects.pickup_burst(get_parent(), global_position, UiKit.rarity_color(rarity))
	collected.emit(controller, item_id)
	amount -= stored
	if amount <= 0:
		queue_free()
	else:
		_label.text = _display_text()

## Drops the weapon that was replaced so it can be picked up again.
func _spawn_dropped(player: PlayerController, dropped: Dictionary) -> void:
	var weapon := ContentDB.weapon(str(dropped.get("weapon", "")))
	if weapon.is_empty():
		return
	var pickup := LootPickup.new()
	pickup.setup({}, weapon)
	pickup.magazine = int(dropped.get("magazine", 0))
	pickup.reserve = int(dropped.get("reserve", 0))
	var drop_position := player.global_position + Vector3(randf_range(-0.6, 0.6), 0.4,
		randf_range(-0.6, 0.6))
	var space := player.get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(drop_position + Vector3(0, 2, 0),
		drop_position - Vector3(0, 4, 0), GameConfig.Layer.WORLD | GameConfig.Layer.PROP)
	var hit := space.intersect_ray(query)
	if not hit.is_empty():
		drop_position.y = float(hit["position"].y) + 0.4
	var container := get_parent()
	if container == null:
		pickup.queue_free()
		return
	container.add_child(pickup)
	pickup.global_position = drop_position

func set_highlight(active: bool) -> void:
	_highlight = active
	if _label != null:
		_label.visible = active
	if _mesh != null and _mesh.material_override is StandardMaterial3D:
		var material := _mesh.material_override as StandardMaterial3D
		material.emission_energy_multiplier = 2.0 if active else 0.8

func is_highlighted() -> bool:
	return _highlight
