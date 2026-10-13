extends Node
## Persistent player profile: currencies, XP/levels, cosmetics, missions, achievements, ranked RP,
## seasons, friends and match history. Stored locally in user://profile.json.
## Gems and coins are earned by playing only - there are no real-money purchases in this build.

signal changed

const PATH := "user://profile.json"
const SEASON_DAYS := 28
const RP_PLACE := [45, 35, 28, 22, 18, 14, 10, 7, 4, 2, 0, -2, -4, -6, -8, -10]

var p := {}

func _ready() -> void:
	_load()
	_ensure()
	refresh_missions()
	check_season()
	save()

func _defaults() -> Dictionary:
	var r := RandomNumberGenerator.new()
	r.randomize()
	var chars := "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	var pid := ""
	for i in 8:
		pid += chars[r.randi() % chars.length()]
	return {
		"id": pid, "name": "Player%04d" % (r.randi() % 10000), "created": int(Time.get_unix_time_from_system()),
		"coins": 1500, "gems": 60, "xp": 0, "level": 1,
		"owned": DB.DEFAULT_OWNED.duplicate(), "equip": DB.DEFAULT_EQUIP.duplicate(),
		"stats": {"matches": 0, "wins": 0, "kills": 0, "damage": 0, "headshots": 0, "healed": 0, "blocks": 0, "loot": 0,
			"revives": 0, "supply": 0, "top10": 0, "rounds": 0, "survive": 0, "best_kills": 0},
		"daily": {"key": "", "list": []}, "weekly": {"key": "", "list": []},
		"ach": {}, "rank": {"rp": 0, "season": season_id(), "peak": 0, "matches": 0},
		"season_rewards": [], "friends": [], "recent": [], "history": [], "tutorial": false,
	}

func _ensure() -> void:
	var d := _defaults()
	for k in d:
		if not p.has(k):
			p[k] = d[k]
	for k in d["stats"]:
		if not p["stats"].has(k):
			p["stats"][k] = 0
	for k in DB.DEFAULT_EQUIP:
		if not p["equip"].has(k):
			p["equip"][k] = DB.DEFAULT_EQUIP[k]
	for id in DB.DEFAULT_OWNED:
		if not (id in p["owned"]):
			p["owned"].append(id)

func _load() -> void:
	if not FileAccess.file_exists(PATH):
		p = {}
		return
	var f := FileAccess.open(PATH, FileAccess.READ)
	var parsed = JSON.parse_string(f.get_as_text())
	p = parsed if parsed is Dictionary else {}

func save() -> void:
	var f := FileAccess.open(PATH, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(p))
	changed.emit()

# ------------------------------------------------------------------ basics
func player_name() -> String:
	return str(p.get("name", "Player"))

func set_player_name(n: String) -> void:
	n = n.strip_edges().substr(0, 16)
	if n.length() >= 3:
		p["name"] = n
		save()

func equip_dict() -> Dictionary:
	return (p["equip"] as Dictionary).duplicate()

func level() -> int:
	return int(p["level"])

func xp_progress() -> Vector2:
	return Vector2(int(p["xp"]), DB.xp_for_level(level()))

func owns(id: String) -> bool:
	return id in p["owned"]

func equip(type: String, id: String) -> void:
	if owns(id) and DB.COSMETICS.get(id, {}).get("type", "") == type:
		p["equip"][type] = id
		save()

## Returns "" on success or an error message.
func buy(id: String) -> String:
	var c: Dictionary = DB.COSMETICS.get(id, {})
	if c.is_empty():
		return "Unknown item"
	if owns(id):
		return "Already owned"
	var coins: int = price_of(id)["coins"]
	var gems: int = price_of(id)["gems"]
	if int(p["coins"]) < coins:
		return "Not enough coins"
	if int(p["gems"]) < gems:
		return "Not enough gems"
	p["coins"] = int(p["coins"]) - coins
	p["gems"] = int(p["gems"]) - gems
	p["owned"].append(id)
	save()
	return ""

func featured() -> Array:
	var r := RandomNumberGenerator.new()
	r.seed = hash(Time.get_date_string_from_system())
	var pool := []
	for id in DB.COSMETICS:
		var c: Dictionary = DB.COSMETICS[id]
		if int(c["coins"]) + int(c["gems"]) > 0:
			pool.append(id)
	var out := []
	while out.size() < 6 and pool.size() > 0:
		out.append(pool.pop_at(r.randi() % pool.size()))
	return out

func price_of(id: String) -> Dictionary:
	var c: Dictionary = DB.COSMETICS.get(id, {})
	var coins: int = int(c.get("coins", 0))
	var gems: int = int(c.get("gems", 0))
	if id in featured():
		coins = int(coins * 0.8)
		gems = int(gems * 0.8)
	return {"coins": coins, "gems": gems, "sale": id in featured()}

func add_currency(coins: int, gems: int) -> void:
	p["coins"] = int(p["coins"]) + coins
	p["gems"] = int(p["gems"]) + gems

func add_xp(xp: int) -> Array:
	var ups := []
	p["xp"] = int(p["xp"]) + xp
	while int(p["xp"]) >= DB.xp_for_level(level()):
		p["xp"] = int(p["xp"]) - DB.xp_for_level(level())
		p["level"] = level() + 1
		var gems := DB.LEVEL_REWARD_GEMS if level() % DB.LEVEL_REWARD_GEMS_EVERY == 0 else 0
		add_currency(DB.LEVEL_REWARD_COINS, gems)
		ups.append({"level": level(), "coins": DB.LEVEL_REWARD_COINS, "gems": gems})
	return ups

# ------------------------------------------------------------------ missions
func _day_key() -> String:
	return Time.get_date_string_from_system()

func _week_key() -> String:
	var days := int(Time.get_unix_time_from_system() / 86400.0)
	return "W%d" % int((days + 3) / 7)

func refresh_missions() -> void:
	var dk := _day_key()
	if p["daily"]["key"] != dk:
		p["daily"] = {"key": dk, "list": _pick(DB.DAILY_POOL, 3, dk)}
	var wk := _week_key()
	if p["weekly"]["key"] != wk:
		p["weekly"] = {"key": wk, "list": _pick(DB.WEEKLY_POOL, 3, wk)}

func _pick(pool: Array, n: int, key: String) -> Array:
	var r := RandomNumberGenerator.new()
	r.seed = hash(key + str(p.get("id", "")))
	var idx := range(pool.size())
	var out := []
	while out.size() < n and idx.size() > 0:
		var i: int = idx.pop_at(r.randi() % idx.size())
		out.append({"id": pool[i]["id"], "progress": 0, "claimed": false})
	return out

func mission_def(kind: String, id: String) -> Dictionary:
	for m in (DB.DAILY_POOL if kind == "daily" else DB.WEEKLY_POOL):
		if m["id"] == id:
			return m
	return {}

func claim_mission(kind: String, idx: int) -> bool:
	var list: Array = p[kind]["list"]
	if idx < 0 or idx >= list.size():
		return false
	var m: Dictionary = list[idx]
	var d := mission_def(kind, m["id"])
	if m["claimed"] or int(m["progress"]) < int(d["goal"]):
		return false
	m["claimed"] = true
	add_currency(int(d.get("coins", 0)), int(d.get("gems", 0)))
	add_xp(int(d.get("xp", 0)))
	save()
	return true

func achievement_progress(a: Dictionary) -> int:
	if a["stat"] == "owned":
		return (p["owned"] as Array).size()
	return int(p["stats"].get(a["stat"], 0))

func claim_achievement(id: String) -> bool:
	for a in DB.ACHIEVEMENTS:
		if a["id"] == id and not p["ach"].has(id) and achievement_progress(a) >= int(a["goal"]):
			p["ach"][id] = true
			add_currency(0, int(a["gems"]))
			save()
			return true
	return false

func claimable_count() -> int:
	var n := 0
	for kind in ["daily", "weekly"]:
		for m in p[kind]["list"]:
			var d := mission_def(kind, m["id"])
			if not m["claimed"] and not d.is_empty() and int(m["progress"]) >= int(d["goal"]):
				n += 1
	for a in DB.ACHIEVEMENTS:
		if not p["ach"].has(a["id"]) and achievement_progress(a) >= int(a["goal"]):
			n += 1
	return n

# ------------------------------------------------------------------ ranked & seasons
static func season_id() -> int:
	return int(Time.get_unix_time_from_system() / 86400.0) / SEASON_DAYS

func season_days_left() -> int:
	var days := int(Time.get_unix_time_from_system() / 86400.0)
	return SEASON_DAYS - (days % SEASON_DAYS)

func rp() -> int:
	return int(p["rank"]["rp"])

func check_season() -> void:
	var sid := season_id()
	var r: Dictionary = p["rank"]
	if int(r["season"]) != sid:
		var peak := DB.rank_index(int(r["peak"]))
		var reward: Dictionary = DB.SEASON_REWARDS[peak]
		add_currency(int(reward["coins"]), int(reward["gems"]))
		if reward.has("item") and not owns(reward["item"]):
			p["owned"].append(reward["item"])
		p["season_rewards"].append({"season": int(r["season"]), "rank": DB.RANKS[peak]["name"], "coins": reward["coins"], "gems": reward["gems"], "item": reward.get("item", "")})
		r["season"] = sid
		r["rp"] = int(int(r["rp"]) * 0.4)
		r["peak"] = r["rp"]
		r["matches"] = 0

func _rp_delta(res: Dictionary) -> int:
	var tier := DB.rank_index(rp())
	var kills: int = int(res.get("kills", 0))
	if res["kind"] == "br":
		var pl: int = clampi(int(res["placement"]) - 1, 0, RP_PLACE.size() - 1)
		return RP_PLACE[pl] + kills * 6 - tier * 3
	if res["kind"] in ["cs", "arena"]:
		return (30 if res["won"] else -18) + kills * 2 - tier
	return 0

# ------------------------------------------------------------------ match rewards
func record_match(res: Dictionary) -> Dictionary:
	if res.is_empty():
		return {}
	refresh_missions()
	var st: Dictionary = p["stats"]
	var training: bool = res.get("kind", "") == "training"
	var won: bool = res.get("won", false)
	var kills: int = int(res.get("kills", 0))
	var dmg: int = int(res.get("damage", 0))
	var placement: int = int(res.get("placement", 0))
	var players: int = int(res.get("players", 1))
	var top10: int = 1 if res.get("kind", "") == "br" and placement > 0 and placement <= 10 else 0
	var inc := {"matches": 1, "wins": 1 if won and not training else 0, "kills": kills, "damage": dmg, "headshots": int(res.get("headshots", 0)),
		"healed": int(res.get("healed", 0)), "blocks": int(res.get("blocks", 0)), "loot": int(res.get("loot", 0)), "revives": int(res.get("revives", 0)),
		"supply": int(res.get("supply", 0)), "top10": top10, "rounds": int(res.get("rounds", 0)), "survive": int(res.get("survive", 0))}
	if training:
		inc["matches"] = 0
	for k in inc:
		st[k] = int(st.get(k, 0)) + int(inc[k])
	st["best_kills"] = maxi(int(st.get("best_kills", 0)), kills)
	var xp := 0
	var coins := 0
	if training:
		xp = mini(120, 20 + kills * 5 + dmg / 40)
		coins = mini(60, 10 + kills * 2)
	else:
		xp = 80 + kills * 30 + dmg / 8 + int(res.get("survive", 0)) / 5 + (220 if won else 0)
		coins = 50 + kills * 18 + (160 if won else 0)
		if res.get("kind", "") == "br":
			xp += maxi(0, players - placement) * 4
			coins += maxi(0, 11 - placement) * 9 if placement > 0 else 0
		xp += int(res.get("rounds", 0)) * 25
	var mdone := []
	for kind in ["daily", "weekly"]:
		for m in p[kind]["list"]:
			var d := mission_def(kind, m["id"])
			if d.is_empty() or m["claimed"]:
				continue
			var before := int(m["progress"])
			var add: int = int(inc.get(d["stat"], 0))
			m["progress"] = mini(int(d["goal"]), before + add)
			if before < int(d["goal"]) and int(m["progress"]) >= int(d["goal"]):
				mdone.append(d["text"])
	var rp_delta := 0
	var rank_before := DB.rank_index(rp())
	if res.get("ranked", false) and not training:
		rp_delta = _rp_delta(res)
		var r: Dictionary = p["rank"]
		r["rp"] = maxi(0, int(r["rp"]) + rp_delta)
		r["peak"] = maxi(int(r["peak"]), int(r["rp"]))
		r["matches"] = int(r["matches"]) + 1
	add_currency(coins, 0)
	var ups := add_xp(xp)
	var hist: Array = p["history"]
	hist.push_front({"mode": res.get("mode", ""), "place": placement, "kills": kills, "dmg": dmg, "won": won, "t": int(Time.get_unix_time_from_system()), "rp": rp_delta})
	if hist.size() > 25:
		hist.resize(25)
	save()
	return {"xp": xp, "coins": coins, "levels": ups, "missions": mdone, "rp_delta": rp_delta, "rank_before": rank_before, "rank_after": DB.rank_index(rp())}

# ------------------------------------------------------------------ friends
func add_friend(code: String, nm := "") -> String:
	code = code.strip_edges().to_upper()
	if code.length() != 8:
		return "Friend codes have 8 characters"
	if code == p["id"]:
		return "That is your own code"
	for f in p["friends"]:
		if f["id"] == code:
			return "Already in your friend list"
	p["friends"].append({"id": code, "name": nm if nm != "" else "Friend " + code.substr(0, 4), "added": int(Time.get_unix_time_from_system())})
	save()
	return ""

func remove_friend(code: String) -> void:
	p["friends"] = (p["friends"] as Array).filter(func(f): return f["id"] != code)
	save()

func add_recent(names: Array, mode: String) -> void:
	var rec: Array = p["recent"]
	for n in names:
		rec.push_front({"name": n, "mode": mode, "t": int(Time.get_unix_time_from_system())})
	while rec.size() > 20:
		rec.pop_back()
	save()
