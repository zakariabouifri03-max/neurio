extends Node
## Inventory (autoload name `Inventory`) - cosmetic ownership and loadout.
##
## Purchases are transactional: the currency is only debited after the item has
## been validated as purchasable and not owned, and a failure to record ownership
## after a successful debit refunds the player immediately.

signal item_owned(item_id: String)
signal item_equipped(slot: String, item_id: String)
signal purchase_failed(item_id: String, reason: String)

const SLOTS := ["skin", "headwear", "mask", "backpack", "weapon_skin", "emote", "glider",
				"banner", "victory_anim"]

func _ready() -> void:
	_ensure_defaults()

func _ensure_defaults() -> void:
	var owned: Array = SaveManager.data.cosmetics.get("owned", [])
	for item_id: Variant in ContentDB.default_owned():
		if not owned.has(item_id):
			owned.append(item_id)
	SaveManager.data.cosmetics["owned"] = owned
	var equipped: Dictionary = SaveManager.data.cosmetics.get("equipped", {})
	if not equipped.has("skin"):
		equipped["skin"] = "skin_recruit"
	if not equipped.has("banner"):
		equipped["banner"] = "banner_default"
	if not equipped.has("weapon_skin"):
		equipped["weapon_skin"] = "wpn_standard"
	if not equipped.has("emote"):
		equipped["emote"] = "emote_wave"
	if not equipped.has("glider"):
		equipped["glider"] = "glider_canvas"
	if not equipped.has("victory_anim"):
		equipped["victory_anim"] = "victory_salute"
	SaveManager.data.cosmetics["equipped"] = equipped

func owns(item_id: String) -> bool:
	return (SaveManager.data.cosmetics.get("owned", []) as Array).has(item_id)

func owned_count() -> int:
	return (SaveManager.data.cosmetics.get("owned", []) as Array).size()

func owned_items() -> Array:
	var out: Array = []
	for item_id: Variant in SaveManager.data.cosmetics.get("owned", []):
		var entry := ContentDB.shop_item(str(item_id))
		if not entry.is_empty():
			out.append(entry)
	return out

func equipped(slot: String, fallback: String = "") -> String:
	return str(SaveManager.data.cosmetics.get("equipped", {}).get(slot, fallback))

func loadout() -> Dictionary:
	var out: Dictionary = {}
	for slot: String in SLOTS:
		out[slot] = equipped(slot, "")
	return out

func equip(item_id: String) -> GameResult:
	if not owns(item_id):
		return GameResult.fail(GameResult.Code.NOT_OWNED, "you do not own this item")
	var entry := ContentDB.shop_item(item_id)
	if entry.is_empty():
		return GameResult.fail(GameResult.Code.INVALID, "unknown item")
	var slot: String = str(entry.get("equip_slot", ""))
	if slot.is_empty():
		return GameResult.fail(GameResult.Code.INVALID, "item cannot be equipped")
	SaveManager.data.cosmetics["equipped"][slot] = item_id
	SaveManager.mark_dirty()
	item_equipped.emit(slot, item_id)
	return GameResult.ok(item_id)

func unequip(slot: String) -> GameResult:
	if not SLOTS.has(slot):
		return GameResult.fail(GameResult.Code.INVALID, "unknown slot")
	SaveManager.data.cosmetics["equipped"].erase(slot)
	SaveManager.mark_dirty()
	item_equipped.emit(slot, "")
	return GameResult.ok()

## Validation used both by the shop UI and by tests.
func can_purchase(item_id: String) -> GameResult:
	var entry := ContentDB.shop_item(item_id)
	if entry.is_empty():
		return GameResult.fail(GameResult.Code.INVALID, "unknown item")
	if owns(item_id):
		return GameResult.fail(GameResult.Code.ALREADY_OWNED, "already owned")
	var currency: String = str(entry.get("currency", "coins"))
	var price: int = int(entry.get("price", 0))
	if price <= 0:
		return GameResult.ok(entry)
	if not Economy.can_afford(currency, price):
		return GameResult.fail(GameResult.Code.NOT_ENOUGH_FUNDS,
			"not enough %s" % ContentDB.currency_name(currency))
	return GameResult.ok(entry)

## Buys an item: validates, debits once, records ownership, equips cosmetics.
func purchase(item_id: String) -> GameResult:
	var check := can_purchase(item_id)
	if not check.succeeded():
		purchase_failed.emit(item_id, check.error_text())
		return check
	var entry: Dictionary = check.data
	var currency: String = str(entry.get("currency", "coins"))
	var price: int = int(entry.get("price", 0))
	if price > 0:
		var payment := Economy.spend(currency, price, "purchase:%s" % item_id,
			"purchase:%s:%s" % [item_id, SaveManager.data.profile.get("player_id", "")])
		if not payment.succeeded():
			purchase_failed.emit(item_id, payment.error_text())
			return payment
	var owned: Array = SaveManager.data.cosmetics.get("owned", [])
	if owned.has(item_id):
		if price > 0:
			Economy.refund(currency, price, "duplicate-purchase:%s" % item_id)
		return GameResult.fail(GameResult.Code.ALREADY_OWNED, "already owned")
	owned.append(item_id)
	SaveManager.data.cosmetics["owned"] = owned
	SaveManager.data.add_ledger({"key": "purchase:%s" % item_id, "reason": "shop_purchase",
								  "item": item_id, "at": int(Time.get_unix_time_from_system())})
	SaveManager.mark_dirty()
	item_owned.emit(item_id)
	if not str(entry.get("equip_slot", "")).is_empty():
		equip(item_id)
	Economy.purchase_completed.emit(item_id, price, currency)
	return GameResult.ok(entry)

## Shop listing with ownership / affordability flags for the UI.
func shop_listing(category: String) -> Array:
	var out: Array = []
	for entry: Variant in ContentDB.shop_category(category):
		var item: Dictionary = entry
		var item_id: String = str(item.get("id", ""))
		var currency: String = str(item.get("currency", "coins"))
		out.append({
			"item": item,
			"owned": owns(item_id),
			"equipped": equipped(str(item.get("equip_slot", "")), "") == item_id,
			"affordable": Economy.can_afford(currency, int(item.get("price", 0))),
		})
	return out

func equipped_palette() -> Dictionary:
	var skin := ContentDB.shop_item(equipped("skin", "skin_recruit"))
	return skin.get("palette", {"head": "#c98f5f", "torso": "#4a7a4a", "arms": "#4a7a4a",
								 "legs": "#37506b", "boots": "#2b2f36"})

func weapon_tint() -> Color:
	var skin := ContentDB.shop_item(equipped("weapon_skin", "wpn_standard"))
	return Color(str(skin.get("tint", "#3d434e")))
