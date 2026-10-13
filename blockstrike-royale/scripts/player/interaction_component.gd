class_name InteractionComponent
extends Area3D
## Finds the nearest interactable (loot, doors, ammo crates) in front of the player.
##
## Uses a small Area3D sphere plus a facing test so the "Interact" button always
## targets what the player is looking at, and highlights it.

signal target_changed(target: Node)

const RADIUS := 3.0
const MIN_FACING_DOT := 0.35

var _target: Node = null
var _player: PlayerController = null

func _ready() -> void:
	var shape := SphereShape3D.new()
	shape.radius = RADIUS
	var collision := CollisionShape3D.new()
	collision.shape = shape
	add_child(collision)
	collision_layer = 0
	collision_mask = GameConfig.Layer.LOOT | GameConfig.Layer.PROP
	monitoring = true
	set_physics_process(true)
	var parent := get_parent()
	if parent is PlayerController:
		_player = parent as PlayerController

func _physics_process(_delta: float) -> void:
	if _player == null or not _player.alive:
		_clear()
		return
	var best: Node = null
	var best_score := -INF
	for area: Area3D in get_overlapping_areas():
		var candidate := _interactable_of(area)
		if candidate == null:
			continue
		var to_target := (candidate as Node3D).global_position - _player.global_position
		var distance := to_target.length()
		if distance > RADIUS + 1.0:
			continue
		var facing := _player.aim_direction().dot(to_target.normalized())
		if facing < MIN_FACING_DOT:
			continue
		var score := facing - distance * 0.1
		if score > best_score:
			best_score = score
			best = candidate
	for body: Node3D in get_overlapping_bodies():
		var candidate := _interactable_of(body)
		if candidate == null:
			continue
		var distance := _player.global_position.distance_to((candidate as Node3D).global_position)
		if distance > RADIUS + 1.5:
			continue
		var score := 0.5 - distance * 0.1
		if score > best_score:
			best_score = score
			best = candidate
	if best != _target:
		if _target != null and _target.has_method("set_highlight"):
			_target.call("set_highlight", false)
		_target = best
		if _target != null and _target.has_method("set_highlight"):
			_target.call("set_highlight", true)
		target_changed.emit(_target)

func _interactable_of(node: Node) -> Node:
	if node == null:
		return null
	if node.has_method("interact"):
		return node
	var parent := node.get_parent()
	while parent != null:
		if parent.has_method("interact"):
			return parent
		parent = parent.get_parent()
	return null

func has_target() -> bool:
	return _target != null and is_instance_valid(_target)

func current_target() -> Node:
	return _target

func _clear() -> void:
	if _target != null:
		if is_instance_valid(_target) and _target.has_method("set_highlight"):
			_target.call("set_highlight", false)
		_target = null
		target_changed.emit(null)
