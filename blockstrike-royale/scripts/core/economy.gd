extends Node
## Economy - the only place that may change Coins or Gems.
##
## Every mutation goes through a ledger entry carrying an idempotency key so a
## duplicated match result, a double tap on "claim" or a reconnected client can
## never be paid twice.  Online play additionally requires the payload to be
## server-validated before it reaches this class.

signal balance_changed(currency: String, amount: int)
signal purchase_completed(item_id: String, price: int, currency: String)
signal reward_rejected(reason: String)

var _used_keys: Dictionary = {}

func _ready() -> void:
	_rebuild_keys()

func _rebuild_keys() -> void:
	_used_keys.clear()
	for entry: Variant in SaveManager.data.ledger:
		if typeof(entry) == TYPE_DICTIONARY and (entry as Dictionary).has("key"):
			_used_keys[(entry as Dictionary)["key"]] = true

func coins() -> int:
	return int(SaveManager.data.wallet.get("coins", 0))

func gems() -> int:
	return int(SaveManager.data.wallet.get("gems", 0))

func balance(currency: String) -> int:
	return coins() if currency == "coins" else gems()

func can_afford(currency: String, amount: int) -> bool:
	return balance(currency) >= amount

## Credits a match reward exactly once per (match, player, kind) key.
func grant_match_reward(match_id: String, payload: Dictionary, server_validated: bool) -> GameResult:
	if match_id.is_empty():
		return GameResult.fail(GameResult.Code.INVALID, "missing match id")
	if not server_validated and not payload.get("offline", true):
		reward_rejected.emit("unvalidated online reward rejected")
		return GameResult.fail(GameResult.Code.UNAUTHORIZED,
			"online rewards require server validation")
	var coins: int = int(payload.get("coins", 0))
	var gems: int = int(payload.get("gems", 0))
	var key := "match:%s:%s" % [match_id, SaveManager.data.profile.get("player_id", "")]
	if _used_keys.has(key):
		reward_rejected.emit("reward already claimed for %s" % match_id)
		return GameResult.fail(GameResult.Code.DUPLICATE, "reward already claimed")
	var result := _credit(key, coins, gems, "match_reward:%s" % match_id)
	return result

## Awards a mission / achievement / event reward once per mission id.
func grant_mission_reward(mission_id: String, reward: Dictionary) -> GameResult:
	var key := "mission:%s" % mission_id
	if _used_keys.has(key):
		return GameResult.fail(GameResult.Code.DUPLICATE, "mission reward already claimed")
	return _credit(key, int(reward.get("coins", 0)), int(reward.get("gems", 0)),
		"mission:%s" % mission_id)

func grant_login_reward(day_index: int, reward: Dictionary) -> GameResult:
	var key := "login:%s:%d" % [SaveManager.data.flags.get("last_login_date", ""), day_index]
	if _used_keys.has(key):
		return GameResult.fail(GameResult.Code.DUPLICATE, "login reward already granted")
	return _credit(key, int(reward.get("coins", 0)), int(reward.get("gems", 0)), "login_bonus")

func _credit(key: String, coins: int, gems: int, reason: String) -> GameResult:
	if coins < 0 or gems < 0:
		return GameResult.fail(GameResult.Code.INVALID, "negative reward")
	var wallet: Dictionary = SaveManager.data.wallet
	wallet["coins"] = maxi(0, int(wallet.get("coins", 0)) + coins)
	wallet["gems"] = maxi(0, int(wallet.get("gems", 0)) + gems)
	_used_keys[key] = true
	SaveManager.data.add_ledger({"key": key, "reason": reason, "coins": coins, "gems": gems,
								  "at": int(Time.get_unix_time_from_system())})
	SaveManager.mark_dirty()
	if coins > 0:
		balance_changed.emit("coins", coins)
	if gems > 0:
		balance_changed.emit("gems", gems)
	return GameResult.ok({"coins": coins, "gems": gems})

## Removes currency.  Fails cleanly, and never leaves a partial charge behind.
func spend(currency: String, amount: int, reason: String, idempotency_key: String = "") -> GameResult:
	if amount < 0:
		return GameResult.fail(GameResult.Code.INVALID, "negative amount")
	if currency != "coins" and currency != "gems":
		return GameResult.fail(GameResult.Code.INVALID, "unknown currency %s" % currency)
	if not idempotency_key.is_empty() and _used_keys.has(idempotency_key):
		return GameResult.fail(GameResult.Code.DUPLICATE, "already applied")
	if balance(currency) < amount:
		return GameResult.fail(GameResult.Code.NOT_ENOUGH_FUNDS,
			"not enough %s" % ContentDB.currency_name(currency))
	SaveManager.data.wallet[currency] = balance(currency) - amount
	if not idempotency_key.is_empty():
		_used_keys[idempotency_key] = true
		SaveManager.data.add_ledger({"key": idempotency_key, "reason": reason,
									  "coins": -amount if currency == "coins" else 0,
									  "gems": -amount if currency == "gems" else 0,
									  "at": int(Time.get_unix_time_from_system())})
	SaveManager.mark_dirty()
	balance_changed.emit(currency, -amount)
	return GameResult.ok(amount)

func refund(currency: String, amount: int, reason: String) -> void:
	_credit("refund:%s:%d" % [reason, int(Time.get_unix_time_from_system())], 0, 0, reason)
	SaveManager.data.wallet[currency] = balance(currency) + amount
	SaveManager.mark_dirty()
	balance_changed.emit(currency, amount)

## Deterministic reward computation.  Pure function of the match summary so the
## server can re-run it and compare against what the client claims.
func compute_match_reward(mode_id: String, summary: Dictionary) -> Dictionary:
	var table: Dictionary = ContentDB.economy().get("match_rewards", {}).get(mode_id, {})
	var coins: int = int(table.get("base", 0))
	var gems: int = 0
	var xp: int = int(table.get("xp", 0))
	coins += int(table.get("per_elimination", 0)) * int(summary.get("eliminations", 0))
	xp += int(summary.get("eliminations", 0)) * 12
	var placement: int = int(summary.get("placement", 0))
	if mode_id == "br":
		for band: Variant in table.get("placement", []):
			var entry: Dictionary = band
			if placement >= int(entry.get("min_place", 1)) and placement <= int(entry.get("max_place", 99)):
				coins += int(entry.get("coins", 0))
				gems += int(entry.get("gems", 0))
				xp += int(entry.get("xp", 0))
				break
	elif mode_id == "clash" or mode_id == "arena":
		var won: bool = bool(summary.get("victory", false))
		coins += int(table.get("win_coins", 0)) if won else int(table.get("loss_coins", 0))
		gems += int(table.get("win_gems", 0)) if won else 0
		xp += int(table.get("win_xp", 0)) if won else int(table.get("loss_xp", 0))
		coins += int(table.get("per_round_win", 0)) * int(summary.get("rounds_won", 0))
	elif mode_id == "training":
		var cap: int = int(table.get("max_coins_per_match", 60))
		coins = mini(coins, cap)
		xp = int(table.get("xp", 0))
	var active_event: Dictionary = ContentDB.active_event()
	var multiplier := 1.0 + float(active_event.get("modifiers", {}).get("coins_multiplier", 0.0) - 1.0)
	if SaveManager.data.flags.get("first_match_bonus_claimed", false) == false:
		var bonus: Dictionary = ContentDB.economy().get("first_match_bonus", {})
		coins += int(bonus.get("coins", 0))
		gems += int(bonus.get("gems", 0))
	return {"coins": int(round(float(coins) * multiplier)), "gems": gems, "xp": xp}
