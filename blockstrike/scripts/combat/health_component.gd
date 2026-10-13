class_name HealthComponent
extends Node
## Health and armour for one actor. Server-agnostic: callers pass already-validated
## damage. Online matches will call this only from the authoritative server.

signal health_changed(current: int, maximum: int)
signal armor_changed(current: int)
signal damaged(amount: int, source: Node, headshot: bool)
signal died(killer: Node)

@export var max_health := 100
@export var max_armor := 100

var current := 100
var armor := 0
var alive := true


func _ready() -> void:
	current = max_health


func reset(health: int = -1) -> void:
	current = max_health if health < 0 else clampi(health, 1, max_health)
	armor = 0
	alive = true
	health_changed.emit(current, max_health)
	armor_changed.emit(armor)


func add_armor(amount: int) -> void:
	armor = clampi(armor + maxi(amount, 0), 0, max_armor)
	armor_changed.emit(armor)


func heal(amount: int) -> void:
	if not alive or amount <= 0:
		return
	current = mini(current + amount, max_health)
	health_changed.emit(current, max_health)


## Returns the health actually removed.
func apply_damage(amount: int, source: Node, headshot: bool = false) -> int:
	if not alive or amount <= 0:
		return 0
	var absorbed := 0
	if armor > 0:
		# Armour absorbs half the damage until it is depleted.
		absorbed = mini(armor, roundi(amount * 0.5))
		armor -= absorbed
		armor_changed.emit(armor)
	var dealt := amount - absorbed
	current = maxi(current - dealt, 0)
	damaged.emit(dealt, source, headshot)
	health_changed.emit(current, max_health)
	if current == 0:
		alive = false
		died.emit(source)
	return dealt
