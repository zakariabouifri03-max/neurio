class_name LootContainer
extends StaticBody3D
## Openable crate / supply drop with rolled contents.
##
## Contents are rolled once when the container is spawned (from the loot tables by
## zone tier) and handed out one item at a time, so a container can be partially
## looted by several players.  In online matches the host rolls and owns contents.

signal opened(container: LootContainer)
signal emptied(container: LootContainer)

var container_type: String = "crate_wood"
var tier: String = "low"
var contents: Array = []
var opened_once: bool = false
var _highlight: bool = false
var _label: Label3D
var _lid: MeshInstance3D
var _open_anim: float = 0.0
var _rng := RandomNumberGenerator.new()
var _seed_value: int = 0
var _prompt: bool = false

func setup(type_id: String, tier_id: String, seed_value: int = 0) -> void:
	container_type = type_id
	tier = tier_id
	_seed_value = seed_value
	contents = roll_contents()

## Rolls the container's items from data/loot_tables.json.
func roll_contents() -> Array:
	_rng.seed = _seed_value if _seed_value != 0 else int(Time.get_ticks_usec())
	var table: Dictionary = ContentDB.loot_tables().get("containers", {}).get(container_type, {})
	var rolls := int(table.get("rolls", 2))
	var ammo_only := bool(table.get("ammo_only", false))
	var heal_only := bool(table.get("heal_only", false))
	var rolled: Array = []
	var weights: Dictionary = ContentDB.loot_tables().get("rarity_weights_by_zone", {}).get(tier, {})
	for i: int in rolls:
		var kind := _roll_kind(weights, ammo_only, heal_only)
		match kind:
			"weapon":
				var pool: Array = ContentDB.weapons_for_rarity_zone(tier)
				if pool.is_empty():
					continue
				var weapon: Dictionary = pool[_rng.randi_range(0, pool.size() - 1)]
				if _is_duplicate(rolled, str(weapon.get("id", ""))):
					continue
				rolled.append({"kind": "weapon", "weapon": weapon})
			"ammo":
				var ammo_pool: Array = ContentDB.items_of_kind("ammo")
				if ammo_pool.is_empty():
					continue
				var entry: Dictionary = ammo_pool[_rng.randi_range(0, ammo_pool.size() - 1)]
				rolled.append({"kind": "item", "item": entry,
					"amount": int(entry.get("pickup_amount", 20))})
			"heal":
				var heal_pool: Array = ContentDB.items_of_kind("heal")
				if heal_pool.is_empty():
					continue
				var heal: Dictionary = heal_pool[_rng.randi_range(0, heal_pool.size() - 1)]
				rolled.append({"kind": "item", "item": heal, "amount": 1})
			"armor":
				var armor_pool: Array = ContentDB.items_of_kind("armor")
				if armor_pool.is_empty():
					continue
				var armor: Dictionary = armor_pool[_rng.randi_range(0, armor_pool.size() - 1)]
				rolled.append({"kind": "item", "item": armor, "amount": 1})
			_:
				var utility: Array = ContentDB.items_of_kind("build")
				if utility.is_empty():
					continue
				var util: Dictionary = utility[_rng.randi_range(0, utility.size() - 1)]
				rolled.append({"kind": "item", "item": util,
					"amount": int(util.get("pickup_amount", 4))})
	return rolled

func _roll_kind(weights: Dictionary, ammo_only: bool, heal_only: bool) -> String:
	if ammo_only:
		return "ammo"
	if heal_only:
		return "heal"
	var pool: Dictionary = ContentDB.loot_tables().get("ground_loot_weights", {})
	if weights.is_empty() or pool.is_empty():
		return "item"
	var keys: Array = pool.keys()
	var total := 0.0
	for key: String in keys:
		total += float(pool[key])
	var target := _rng.randf() * total
	var running := 0.0
	for key: String in keys:
		running += float(pool[key])
		if target <= running:
			return key
	return "ammo"

func _is_duplicate(rolled: Array, weapon_id: String) -> bool:
	for entry: Variant in rolled:
		var data: Dictionary = entry
		if data.get("kind", "") == "weapon" \
				and str((data.get("weapon", {}) as Dictionary).get("id", "")) == weapon_id:
			return true
	return false

func _ready() -> void:
	collision_layer = GameConfig.Layer.PROP
	collision_mask = 0
	var mesh := BoxMesh.new()
	var box_size := Vector3(0.9, 0.9, 0.9)
	if container_type == "supply_drop":
		box_size = Vector3(1.2, 1.2, 1.2)
	elif container_type == "ammo_box":
		box_size = Vector3(0.8, 0.5, 0.6)
	elif container_type == "med_box":
		box_size = Vector3(0.7, 0.6, 0.6)
	mesh.size = box_size
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = box_size
	collision.shape = shape
	add_child(collision)
	var instance := MeshInstance3D.new()
	instance.mesh = mesh
	var material := StandardMaterial3D.new()
	material.albedo_color = _container_color()
	material.roughness = 0.8
	instance.material_override = material
	add_child(instance)
	_lid = instance

	_label = Label3D.new()
	_label.text = _container_name()
	_label.font_size = 26
	_label.pixel_size = 0.004
	_label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	_label.modulate = Color(1, 1, 1, 0.85)
	_label.outline_size = 8
	_label.position = Vector3(0, 0.8, 0)
	_label.visible = false
	add_child(_label)
	set_physics_process(true)

func _container_color() -> Color:
	match container_type:
		"crate_metal":
			return Color(0.45, 0.5, 0.55)
		"supply_drop":
			return Color(0.8, 0.35, 0.3)
		"ammo_box":
			return Color(0.6, 0.55, 0.35)
		"med_box":
			return Color(0.85, 0.86, 0.88)
	return Color(0.55, 0.42, 0.28)

func _container_name() -> String:
	match container_type:
		"crate_metal":
			return "Metal Crate"
		"supply_drop":
			return "Supply Drop"
		"ammo_box":
			return "Ammo Box"
		"med_box":
			return "Med Box"
	return "Supply Crate"

func _physics_process(delta: float) -> void:
	if _open_anim > 0.0:
		_open_anim = maxf(0.0, _open_anim - delta * 2.0)
		if _lid != null:
			_lid.position.y = _open_anim * 0.25
			_lid.rotation.x = _open_anim * 0.4

## Called by the player's InteractionComponent.
func interact(player: Node3D) -> void:
	var controller := player as PlayerController
	if controller == null:
		return
	if contents.is_empty():
		if _label != null:
			_label.text = "Empty"
			_label.visible = true
		return
	var entry: Dictionary = contents[0]
	var parent := get_parent()
	if str(entry.get("kind", "")) == "weapon":
		if parent == null:
			return
		var weapon: Dictionary = entry.get("weapon", {})
		var pickup := LootPickup.new()
		pickup.setup({}, weapon)
		parent.add_child(pickup)
		pickup.global_position = global_position + Vector3(0, 0.9, 0)
		contents.pop_front()
	else:
		var item: Dictionary = entry.get("item", {})
		var amount := int(entry.get("amount", 1))
		var stored := 0
		if str(item.get("kind", "")) == "build":
			stored = controller.inventory.add("build_block", amount)
		else:
			stored = controller.inventory.add(str(item.get("id", "")), amount)
		if stored > 0:
			AudioDirector.play_sfx("pickup", global_position, -6.0)
			contents.pop_front()
		else:
			if _label != null:
				_label.text = "Inventory full"
	var opened_now := false
	if not opened_once:
		opened_once = true
		opened_now = true
		_open_anim = 1.0
		AudioDirector.play_sfx(str(ContentDB.loot_tables().get("containers", {})
			.get(container_type, {}).get("sfx", "impact_wood")), global_position, -4.0)
	if not contents.is_empty():
		return
	if opened_now:
		opened.emit(self)
	emptied.emit(self)
	if _label != null:
		_label.text = "Empty"
		_label.visible = _highlight

func set_highlight(active: bool) -> void:
	_highlight = active
	if _label != null:
		_label.visible = active

func remaining_count() -> int:
	return contents.size()

func is_empty() -> bool:
	return contents.is_empty()
