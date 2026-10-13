extends RefCounted
## Player inventory: 3 weapon slots (primary, sidearm, melee), shared ammo pools
## and healing / armour items. Pure data + rules, so it can be unit tested.

const WDB := preload("res://scripts/weapons/weapon_db.gd")

const HEAL_ITEMS := {
	"bandage": {"name": "Bandage", "heal": 20.0, "cap": 75.0},
	"medkit": {"name": "Medkit", "heal": 60.0, "cap": 100.0},
}

var slots: Array = [null, null, null]   # each: {"id": String, "mag": int} or null
var active: int = 0
var ammo: Dictionary = {"light": 0, "medium": 0, "shell": 0, "heavy": 0}
var items: Dictionary = {"bandage": 0, "medkit": 0, "armor_plate": 0, "blocks": 0}
var unlimited_ammo: bool = false   # training ground: reserves never run out


func reset_loadout(weapon_ids: Array, start_ammo: Dictionary, start_items: Dictionary) -> void:
	slots = [null, null, null]
	active = 0
	for id in weapon_ids:
		add_weapon(id)
	ammo = start_ammo.duplicate()
	items = start_items.duplicate()


func current() -> Variant:
	return slots[active]


func current_id() -> String:
	var w: Variant = slots[active]
	return w["id"] if w != null else ""


## Adds a weapon to its slot. Returns the id of the weapon it replaced ("" if none).
func add_weapon(id: String) -> String:
	var def: Dictionary = WDB.get_def(id)
	if def.is_empty():
		return ""
	var s: int = int(def["slot"])
	var old: Variant = slots[s]
	slots[s] = {"id": id, "mag": int(def["magazine"])}
	if old == null and slots[active] == null:
		active = s
	return old["id"] if old != null else ""


func add_ammo(type: String, amount: int) -> void:
	ammo[type] = mini(int(ammo.get(type, 0)) + amount, 999)


func reserve_of(weapon_id: String) -> int:
	var def: Dictionary = WDB.get_def(weapon_id)
	var t: String = def.get("ammo", "")
	if t == "":
		return 0
	if unlimited_ammo:
		return 999
	return int(ammo.get(t, 0))


func take_reserve(weapon_id: String, amount: int) -> int:
	var def: Dictionary = WDB.get_def(weapon_id)
	var t: String = def.get("ammo", "")
	if t == "":
		return 0
	if unlimited_ammo:
		return amount
	var have: int = int(ammo.get(t, 0))
	var taken: int = mini(have, amount)
	ammo[t] = have - taken
	return taken


func add_item(item: String, amount: int) -> void:
	items[item] = int(items.get(item, 0)) + amount


## Uses the best healing item for the given state. Returns {"item", "amount"} or {}.
func use_heal(hp: float, armor: float) -> Dictionary:
	if int(items.get("medkit", 0)) > 0 and hp <= 70.0:
		items["medkit"] = int(items["medkit"]) - 1
		return {"item": "medkit", "amount": HEAL_ITEMS["medkit"]["heal"]}
	if int(items.get("bandage", 0)) > 0 and hp < 75.0:
		items["bandage"] = int(items["bandage"]) - 1
		return {"item": "bandage", "amount": HEAL_ITEMS["bandage"]["heal"]}
	if int(items.get("armor_plate", 0)) > 0 and armor < 60.0:
		items["armor_plate"] = int(items["armor_plate"]) - 1
		return {"item": "armor_plate", "amount": 35.0}
	return {}


## Everything that should drop as loot when the owner dies.
func drop_list() -> Array:
	var out: Array = []
	for s in slots:
		if s != null:
			out.append({"kind": "weapon", "item": s["id"], "amount": 1})
			var t: String = WDB.get_def(s["id"]).get("ammo", "")
			if t != "" and int(ammo.get(t, 0)) > 0:
				out.append({"kind": "ammo", "item": t, "amount": int(ammo[t]) / 2})
	for k in items.keys():
		var n: int = int(items[k])
		if n > 0:
			out.append({"kind": "item", "item": k, "amount": n})
	return out
