extends CharacterBody3D
## Shared character logic for players and AI bots: health, armour, inventory,
## movement physics, hitscan shooting, reloads, weapon switching and death.
## Subclasses (player.gd, bot.gd) decide *what* to do by setting wish_dir / calling try_fire().

const CharacterModel := preload("res://scripts/characters/character_model.gd")
const WDB := preload("res://scripts/weapons/weapon_db.gd")
const Inventory := preload("res://scripts/core/inventory.gd")

signal damaged(amount: float, attacker: Node)
signal died(victim: Node, killer: Node)
signal fired(weapon_id: String)
signal reload_finished(weapon_id: String)
signal hit_landed(target: Node, damage: float, headshot: bool)

const MAX_HP := 100.0
const GRAVITY := 24.0
const JUMP_SPEED := 7.4
const HEAD_HEIGHT := 1.45
const CROUCH_HEAD_HEIGHT := 1.0
const WALK_SPEED := 4.5
const SPRINT_SPEED := 7.0
const CROUCH_SPEED := 2.3
const AIM_SPEED := 2.9
const WATER_FACTOR := 0.55
const SWITCH_TIME := 0.35
const CHAR_LAYER := 2
const SHOT_MASK := 3
const WATER_ID := 5

var display_name: String = "Unit"
var team: int = 0
var hp: float = MAX_HP
var armor: float = 0.0
var alive: bool = true
var kills: int = 0
var headshots: int = 0
var placement: int = 0
var arena = null
var world = null
var fx = null
var inv: Inventory
var model

var wish_dir: Vector3 = Vector3.ZERO
var is_crouched: bool = false
var is_aiming: bool = false
var is_sprinting: bool = false
var in_water: bool = false
var fire_cd: float = 0.0
var reload_t: float = 0.0
var switch_t: float = 0.0
var last_attacker = null
var last_hit_head: bool = false
var spread_mult: float = 1.0
var _jump_req: bool = false
var _reload_request: bool = false


func _ready() -> void:
	inv = Inventory.new()
	model = CharacterModel.new()
	model.name_text = display_name
	model.name_color = Color(1, 1, 1) if team == 0 else Color(1.0, 0.55, 0.45)
	configure_model(model)
	add_child(model)
	if get_node_or_null("CollisionShape3D") == null:
		var cs := CollisionShape3D.new()
		cs.name = "CollisionShape3D"
		var cap := CapsuleShape3D.new()
		cap.radius = 0.36
		cap.height = 1.9
		cs.shape = cap
		cs.position = Vector3(0, 0.95, 0)
		add_child(cs)
	collision_layer = CHAR_LAYER
	collision_mask = 1
	up_direction = Vector3.UP
	floor_max_angle = deg_to_rad(50.0)
	floor_snap_length = 0.35
	hp = MAX_HP


## Hook for subclasses: style the model before it is built.
func configure_model(_m) -> void:
	pass


# ---------------------------------------------------------------- healing
func use_heal() -> bool:
	if not alive:
		return false
	var r: Dictionary = inv.use_heal(hp, armor)
	if r.is_empty():
		return false
	if r["item"] == "armor_plate":
		armor = minf(100.0, armor + float(r["amount"]))
	else:
		var cap: float = Inventory.HEAL_ITEMS[r["item"]]["cap"]
		hp = minf(cap, hp + float(r["amount"]))
	Sfx.play("heal", -4.0)
	return true


# ---------------------------------------------------------------- loadout
func setup_loadout(weapons: Array, start_ammo: Dictionary, start_items: Dictionary) -> void:
	inv.reset_loadout(weapons, start_ammo, start_items)
	_refresh_weapon_model()


func current_weapon_id() -> String:
	return inv.current_id()


func weapon_def() -> Dictionary:
	var id := current_weapon_id()
	return WDB.get_def(id) if id != "" else {}


func _refresh_weapon_model() -> void:
	model.set_weapon(current_weapon_id())


func equip_slot(slot: int) -> void:
	if slot == inv.active or slot < 0 or slot > 2 or inv.slots[slot] == null or not alive:
		return
	inv.active = slot
	reload_t = 0.0
	switch_t = SWITCH_TIME
	fire_cd = maxf(fire_cd, 0.15)
	_refresh_weapon_model()
	Sfx.play_at("switch", global_position, -6.0)


func cycle_weapon(dir: int) -> void:
	var n := 3
	for step in range(1, n + 1):
		var s: int = (inv.active + dir * step + n * 4) % n
		if inv.slots[s] != null:
			equip_slot(s)
			return


func request_jump() -> void:
	_jump_req = true


func request_reload() -> void:
	_reload_request = true


func start_reload() -> bool:
	var w: Variant = inv.current()
	if w == null or not alive:
		return false
	var def := weapon_def()
	if int(def.get("magazine", 0)) <= 0 or reload_t > 0.0:
		return false
	if int(w["mag"]) >= int(def["magazine"]) or inv.reserve_of(w["id"]) <= 0:
		return false
	reload_t = float(def["reload"])
	model.start_reload(reload_t)
	Sfx.play_at("reload", global_position, -4.0)
	return true


func _finish_reload() -> void:
	var w: Variant = inv.current()
	if w == null:
		return
	var def := weapon_def()
	var need: int = int(def["magazine"]) - int(w["mag"])
	var taken: int = inv.take_reserve(w["id"], need)
	w["mag"] = int(w["mag"]) + taken
	reload_finished.emit(w["id"])


func current_mag() -> int:
	var w: Variant = inv.current()
	return int(w["mag"]) if w != null else 0


func spread_factor() -> float:
	var f := 1.0
	var sp := Vector2(velocity.x, velocity.z).length()
	f += clampf(sp / SPRINT_SPEED, 0.0, 1.0) * 0.8
	if not is_on_floor():
		f += 1.0
	if is_crouched:
		f *= 0.7
	if is_aiming:
		f *= 0.6
	return f * spread_mult


# ---------------------------------------------------------------- shooting
## Fires the current weapon toward aim_point (world space). Returns true if a shot was taken.
func try_fire(aim_point: Vector3) -> bool:
	if not alive or reload_t > 0.0 or switch_t > 0.0 or fire_cd > 0.0:
		return false
	var w: Variant = inv.current()
	if w == null:
		return false
	var def := weapon_def()
	if def["kind"] == "melee":
		return _melee(def)
	if int(w["mag"]) <= 0:
		if fire_cd <= 0.0:
			Sfx.play_at("dry", global_position, -6.0)
			fire_cd = 0.25
		return false
	w["mag"] = int(w["mag"]) - 1
	fire_cd = float(def["interval"])
	var muzzle: Vector3 = model.muzzle_position()
	var base_dir: Vector3 = (aim_point - muzzle).normalized()
	if base_dir.length() < 0.5:
		base_dir = -global_basis.z
	var pellets: int = int(def["pellets"])
	var spread_deg: float = float(def["spread"]) * spread_factor()
	var pellet_hits: Dictionary = {}
	var max_range: float = float(def["range"])
	for p in pellets:
		var dir := _spread_dir(base_dir, spread_deg)
		var to := muzzle + dir * max_range
		var hit := _shot_ray(muzzle, to)
		var end_point := to
		if not hit.is_empty():
			end_point = hit["position"]
			var target = hit["collider"]
			if target and target != self and target.has_method("receive_damage"):
				var head_h: float = HEAD_HEIGHT if not target.get("is_crouched") else CROUCH_HEAD_HEIGHT
				var local_y: float = hit["position"].y - target.global_position.y
				var is_head: bool = local_y >= head_h
				var dmg: float = float(def["damage"]) * (float(def["headshot"]) if is_head else 1.0)
				pellet_hits[target] = pellet_hits.get(target, {"dmg": 0.0, "head": false})
				pellet_hits[target]["dmg"] += dmg
				pellet_hits[target]["head"] = pellet_hits[target]["head"] or is_head
			else:
				_impact_fx(end_point, hit["normal"], false)
		if fx:
			fx.tracer(muzzle, end_point)
	for target in pellet_hits.keys():
		var rec: Dictionary = pellet_hits[target]
		target.receive_damage(rec["dmg"], rec["head"], self)
		hit_landed.emit(target, rec["dmg"], rec["head"])
		_impact_fx(target.global_position + Vector3(0, 1.2, 0), Vector3.UP, true)
	if fx:
		fx.muzzle_flash(muzzle)
	Sfx.play_at(def["sound"], muzzle, 2.0)
	model.kick(float(def["recoil"]) * 0.02)
	fired.emit(current_weapon_id())
	return true


func _spread_dir(dir: Vector3, deg: float) -> Vector3:
	if deg <= 0.0:
		return dir
	var r := deg_to_rad(deg)
	var ang := randf() * TAU
	var rad := sqrt(randf()) * tan(r)
	var up := Vector3.UP if absf(dir.y) < 0.95 else Vector3.RIGHT
	var right := dir.cross(up).normalized()
	var upv := right.cross(dir).normalized()
	return (dir + right * cos(ang) * rad + upv * sin(ang) * rad).normalized()


func _shot_ray(from: Vector3, to: Vector3) -> Dictionary:
	if world == null:
		return {}
	return world.raycast(from, to, SHOT_MASK, [self])


func _impact_fx(pos: Vector3, normal: Vector3, flesh: bool) -> void:
	if fx == null:
		return
	if flesh:
		fx.burst(pos, Vector3.UP, "blood")
	else:
		fx.burst(pos, normal, "dust", Color(0.7, 0.66, 0.6))
		Sfx.play_at("hit", pos, -14.0, 1.6)


func _melee(def: Dictionary) -> bool:
	fire_cd = float(def["interval"])
	model.swing()
	var fwd := -global_basis.z
	var hit_any := false
	if arena and arena.has_method("characters_list"):
		for c in arena.characters_list():
			if c == self or not c.alive or c.team == team:
				continue
			var to: Vector3 = c.global_position - global_position
			if Vector2(to.x, to.z).length() <= float(def["range"]) and Vector2(to.x, to.z).normalized().dot(Vector2(fwd.x, fwd.z).normalized()) > 0.4:
				c.receive_damage(float(def["damage"]), false, self)
				hit_landed.emit(c, float(def["damage"]), false)
				_impact_fx(c.global_position + Vector3(0, 1.2, 0), Vector3.UP, true)
				hit_any = true
				break
	Sfx.play_at("switch", global_position, -2.0, 0.7)
	return hit_any


# ---------------------------------------------------------------- grenades
const GRENADE := preload("res://scripts/weapons/grenade.gd")
const THROW_COOLDOWN := 0.9
const THROW_SPEED := 15.0
var _throw_cd: float = 0.0


## Throws one grenade toward aim_point. Returns true if a grenade was thrown.
func try_throw(aim_point: Vector3) -> bool:
	if not alive or _throw_cd > 0.0 or reload_t > 0.0 or int(inv.items.get("grenade", 0)) <= 0:
		return false
	if arena == null or not arena.has_method("spawn_grenade"):
		return false
	inv.items["grenade"] = int(inv.items["grenade"]) - 1
	_throw_cd = THROW_COOLDOWN
	var from: Vector3 = global_position + Vector3(0, 1.5, 0) - global_basis.z * 0.4
	var dir: Vector3 = aim_point - from
	if dir.length() < 1.0:
		dir = -global_basis.z
	dir = dir.normalized()
	dir.y += 0.28   # lob the grenade slightly upward
	arena.spawn_grenade(from, dir.normalized() * THROW_SPEED, self)
	Sfx.play_at("switch", from, -4.0, 0.5)
	return true


# ---------------------------------------------------------------- damage & death
func receive_damage(amount: float, head: bool, attacker) -> void:
	if not alive or amount <= 0.0:
		return
	var dmg := amount
	var absorbed := minf(armor, dmg * 0.5)
	armor -= absorbed
	dmg -= absorbed
	hp = maxf(0.0, hp - dmg)
	last_hit_head = head
	if attacker and attacker != self:
		last_attacker = attacker
	damaged.emit(amount, attacker)
	if hp <= 0.0:
		die(attacker)


func die(killer) -> void:
	if not alive:
		return
	alive = false
	hp = 0.0
	velocity = Vector3.ZERO
	collision_layer = 0
	wish_dir = Vector3.ZERO
	if fx:
		fx.burst(global_position + Vector3(0, 1.0, 0), Vector3.UP, "blood")
		fx.burst(global_position + Vector3(0, 0.6, 0), Vector3.UP, "debris", Color(0.5, 0.3, 0.2))
	Sfx.play_at("hurt", global_position, -2.0, 0.7)
	if killer and killer != self and killer.has_method("register_kill"):
		killer.register_kill(self)
	died.emit(self, killer)


func register_kill(victim) -> void:
	kills += 1
	if victim.last_hit_head:
		headshots += 1


func respawn_at(pos: Vector3) -> void:
	alive = true
	hp = MAX_HP
	armor = 0.0
	placement = 0
	last_attacker = null
	collision_layer = CHAR_LAYER
	global_position = pos
	velocity = Vector3.ZERO
	reload_t = 0.0
	switch_t = 0.0
	is_crouched = false
	is_aiming = false
	model.body.rotation = Vector3.ZERO
	_refresh_weapon_model()


# ---------------------------------------------------------------- physics
func _physics_process(delta: float) -> void:
	fire_cd = maxf(0.0, fire_cd - delta)
	_throw_cd = maxf(0.0, _throw_cd - delta)
	switch_t = maxf(0.0, switch_t - delta)
	if reload_t > 0.0:
		reload_t -= delta
		if reload_t <= 0.0:
			reload_t = 0.0
			_finish_reload()
	if _reload_request:
		_reload_request = false
		start_reload()

	if world:
		in_water = world.block_at(global_position + Vector3(0, 0.6, 0)) == WATER_ID

	var speed := WALK_SPEED
	if is_crouched:
		speed = CROUCH_SPEED
	elif is_aiming:
		speed = AIM_SPEED
	elif is_sprinting:
		speed = SPRINT_SPEED
	if in_water:
		speed *= WATER_FACTOR
	var target := wish_dir * speed if alive else Vector3.ZERO
	var accel := 40.0 if is_on_floor() else 8.0
	velocity.x = move_toward(velocity.x, target.x, accel * delta)
	velocity.z = move_toward(velocity.z, target.z, accel * delta)
	if is_on_floor():
		if velocity.y < 0.0:
			velocity.y = 0.0
		if _jump_req and alive and not is_crouched:
			velocity.y = JUMP_SPEED
	else:
		velocity.y -= GRAVITY * delta
	_jump_req = false
	move_and_slide()
	if global_position.y < -20.0:
		die(null)


func _process(delta: float) -> void:
	var hv := Vector2(velocity.x, velocity.z).length()
	model.animate(delta, hv, is_aiming, is_crouched, alive)
