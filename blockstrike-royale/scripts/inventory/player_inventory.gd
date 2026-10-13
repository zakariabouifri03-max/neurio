class_name PlayerInventory
extends Node
## Per-match inventory: healing items, armour, throwables, ammo, build blocks.
##
## Limits are enforced here (stack sizes from data/items.json) so pickup logic,
## the HUD and the server all agree on what "full" means.  Weapons live in
## WeaponController because they carry state (magazine, reserve), everything
## else lives in this simple counted store.

signal changed()
signal armor_changed(amount: float, tier: int)
signal item_used(item_id: String, result: Dictionary)
signal pickup_rejected(item_id: String, reason: String)

var items: Dictionary = {}          ## item_id -> count
var build_blocks: int = 0
var credits: int = 0
var owner_body: PlayerController = null

var _use_timer: float = 0.0
var _using_item: String = ""

func _ready() -> void:
	set_process(true)

func bind(body: PlayerController) -> void:
	owner_body = body
	armor_changed.connect(func(_amount: float, _tier: int) -> void: changed.emit())

func _process(delta: float) -> void:
	if _use_timer > 0.0:
		_use_timer = maxf(0.0, _use_timer - delta)
		if _use_timer <= 0.0:
			_complete_use()

func max_stack(item_id: String) -> int:
	var info := ContentDB.item(item_id)
	return maxi(1, int(info.get("stack", 1)))

func count(item_id: String) -> int:
	if item_id == "build_block":
		return build_blocks
	return int(items.get(item_id, 0))

func has_room(item_id: String) -> bool:
	return count(item_id) < max_stack(item_id)

## Adds items up to the stack limit.  Returns how many were actually stored.
func add(item_id: String, amount: int = 1) -> int:
	var info := ContentDB.item(item_id)
	if info.is_empty() or amount <= 0:
		pickup_rejected.emit(item_id, "unknown item")
		return 0
	var space := max_stack(item_id) - count(item_id)
	var stored := mini(amount, maxi(0, space))
	if stored <= 0:
		pickup_rejected.emit(item_id, "full")
		return 0
	if item_id == "build_block":
		build_blocks += stored
	else:
		items[item_id] = count(item_id) + stored
	changed.emit()
	return stored

func remove(item_id: String, amount: int = 1) -> bool:
	if count(item_id) < amount:
		return false
	if item_id == "build_block":
		build_blocks -= amount
	else:
		items[item_id] = count(item_id) - amount
		if int(items[item_id]) <= 0:
			items.erase(item_id)
	changed.emit()
	return true

func clear() -> void:
	items.clear()
	build_blocks = 0
	credits = 0
	changed.emit()

## Ammo for a weapon: the item that feeds it and how much is stored.
func ammo_for(weapon_id: String) -> int:
	var item_id := ContentDB.ammo_item_for_weapon(weapon_id)
	if item_id.is_empty():
		return 0
	return count(item_id)

func take_ammo_for(weapon_id: String, amount: int) -> int:
	var item_id := ContentDB.ammo_item_for_weapon(weapon_id)
	if item_id.is_empty():
		return 0
	var available := count(item_id)
	var taken := mini(available, amount)
	if taken > 0:
		remove(item_id, taken)
	return taken

# ------------------------------------------------------------------- healing
func use_heal(item_id: String = "") -> GameResult:
	if owner_body == null or not owner_body.alive:
		return GameResult.fail(GameResult.Code.INVALID, "not available")
	if _use_timer > 0.0:
		return GameResult.fail(GameResult.Code.NOT_READY, "already using an item")
	var chosen := item_id
	if chosen.is_empty():
		chosen = _best_heal_item()
	if chosen.is_empty():
		return GameResult.fail(GameResult.Code.INVALID, "no healing items")
	var info := ContentDB.item(chosen)
	if info.is_empty() or str(info.get("kind", "")) != "heal":
		return GameResult.fail(GameResult.Code.INVALID, "not a healing item")
	if owner_body.health >= GameConfig.PLAYER["max_health"]:
		return GameResult.fail(GameResult.Code.NOT_READY, "health is already full")
	if count(chosen) <= 0:
		return GameResult.fail(GameResult.Code.NOT_READY, "none left")
	_using_item = chosen
	_use_timer = float(info.get("use_time", 2.0))
	return GameResult.ok({"item": chosen, "duration": _use_timer})

func _best_heal_item() -> String:
	for candidate: String in ["medkit", "bandage"]:
		if count(candidate) > 0:
			return candidate
	return ""

## Applies armour/energy items that are used instantly (shield cells, plates).
func use_armor(item_id: String) -> GameResult:
	if owner_body == null or not owner_body.alive:
		return GameResult.fail(GameResult.Code.INVALID, "not available")
	if _use_timer > 0.0:
		return GameResult.fail(GameResult.Code.NOT_READY, "already using an item")
	var info := ContentDB.item(item_id)
	if info.is_empty() or str(info.get("kind", "")) != "armor":
		return GameResult.fail(GameResult.Code.INVALID, "not an armor item")
	if count(item_id) <= 0:
		return GameResult.fail(GameResult.Code.NOT_READY, "none left")
	var tier := maxi(1, int(info.get("armor_tier", 1)))
	var max_armor := float(ContentDB.armor_tier(tier).get("max", 50))
	if owner_body.armor >= max_armor and owner_body.armor_tier >= tier:
		return GameResult.fail(GameResult.Code.NOT_READY, "armor is already full")
	_using_item = item_id
	_use_timer = float(info.get("use_time", 2.0))
	return GameResult.ok({"item": item_id, "duration": _use_timer})

func _complete_use() -> void:
	var item_id := _using_item
	_using_item = ""
	if item_id.is_empty() or owner_body == null or not owner_body.alive:
		return
	if not remove(item_id, 1):
		return
	var info := ContentDB.item(item_id)
	var result: Dictionary = {"item": item_id}
	match str(info.get("kind", "")):
		"heal":
			result["healed"] = owner_body.heal(float(info.get("heal_amount", 25.0)))
			AudioDirector.play_sfx("pickup", owner_body.global_position, -6.0)
		"armor":
			var tier := maxi(1, int(info.get("armor_tier", 1)))
			owner_body.add_armor(float(info.get("armor_amount", 50.0)), tier)
			result["armor"] = owner_body.armor
			armor_changed.emit(owner_body.armor, owner_body.armor_tier)
			AudioDirector.play_sfx("pickup", owner_body.global_position, -6.0)
	item_used.emit(item_id, result)
	changed.emit()

func is_using_item() -> bool:
	return _use_timer > 0.0

func use_progress() -> float:
	return 0.0 if _use_timer <= 0.0 else 1.0

func cancel_use() -> void:
	_use_timer = 0.0
	_using_item = ""

# ------------------------------------------------------------------- credits
func add_credits(amount: int) -> void:
	credits = maxi(0, credits + amount)
	changed.emit()

func spend_credits(amount: int) -> GameResult:
	if amount <= 0:
		return GameResult.fail(GameResult.Code.INVALID, "invalid amount")
	if credits < amount:
		return GameResult.fail(GameResult.Code.NOT_ENOUGH_FUNDS, "not enough credits")
	credits -= amount
	changed.emit()
	return GameResult.ok(credits)

## Snapshot used by the HUD and by network replication.
func snapshot() -> Dictionary:
	return {"items": items.duplicate(), "build_blocks": build_blocks, "credits": credits}

func apply_snapshot(snapshot: Dictionary) -> void:
	items = snapshot.get("items", {})
	build_blocks = int(snapshot.get("build_blocks", 0))
	credits = int(snapshot.get("credits", credits))
	changed.emit()
