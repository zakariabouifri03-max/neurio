class_name WeaponController
extends Node3D
## Weapon handling: switching, firing, ammo, reloading, recoil and effects.
##
## Firing is rate-limited by the weapon's own fire rate, ammo is consumed from
## the magazine and only ever moved between magazine/reserve, and every shot is
## routed through `DamageSystem` so hit registration is identical for player,
## bot and (later) server-authoritative paths.

signal fired(weapon_id: String)
signal reload_state_changed(reloading: bool, progress: float)
signal ammo_changed(magazine: int, reserve: int)
signal weapon_switched(weapon_id: String, slot: String)
signal dry_fire()
signal hit_confirmed(target: Node, damage: float, was_headshot: bool)
signal killed(target: Node, weapon_id: String)

const SLOT_PRIMARY := "primary"
const SLOT_SECONDARY := "secondary"
const SLOT_MELEE := "melee"
const SLOT_THROWABLE := "throwable"

var owner_body: PlayerController
var animator: CharacterAnimator
var slots: Dictionary = {"primary": "", "secondary": "", "melee": "rebar_club",
						 "throwable": "fragshard"}
var magazines: Dictionary = {}      ## weapon_id -> rounds in magazine
var reserves: Dictionary = {}       ## weapon_id -> reserve rounds
var active_slot: String = SLOT_SECONDARY
var reloading: bool = false
var reload_remaining: float = 0.0
var fire_cooldown: float = 0.0
var trigger_held: bool = false
var spread_state: float = 0.0
var recoil_offset: Vector2 = Vector2.ZERO
var shots_fired: int = 0
var infinite_ammo: bool = false
var last_hit_was_headshot: bool = false

var _model: WeaponModel = null
var _world: VoxelWorld = null
var _damage_system: DamageSystem = null
var _muzzle_flash: MeshInstance3D = null
var _flash_timer: float = 0.0
var _throwables_in_flight: int = 0
var _hooks: Callable = Callable()

func setup(body: PlayerController, character_animator: CharacterAnimator) -> void:
	owner_body = body
	animator = character_animator
	_world = body.world()
	_damage_system = DamageSystem.new()
	_damage_system.name = "DamageSystem"
	add_child(_damage_system)

func equip_from_loadout(loadout: Dictionary) -> void:
	for slot: String in ["primary", "secondary", "melee", "throwable"]:
		var weapon_id := str(loadout.get(slot, slots.get(slot, "")))
		if weapon_id.is_empty() or not ContentDB.has_weapon(weapon_id):
			continue
		slots[slot] = weapon_id
		if not magazines.has(weapon_id):
			var weapon := ContentDB.weapon(weapon_id)
			magazines[weapon_id] = int(weapon.get("magazine", 1))
			reserves[weapon_id] = int(weapon.get("reserve_ammo", 0))
	if slots[SLOT_PRIMARY].is_empty() and not slots[SLOT_SECONDARY].is_empty():
		active_slot = SLOT_SECONDARY
	else:
		active_slot = SLOT_PRIMARY if not slots[SLOT_PRIMARY].is_empty() else SLOT_SECONDARY
	_equip_model(current_weapon_id())
	weapon_switched.emit(current_weapon_id(), active_slot)

func current_weapon_id() -> String:
	return str(slots.get(active_slot, ""))

func current_weapon() -> Dictionary:
	return ContentDB.weapon(current_weapon_id())

func current_magazine() -> int:
	return int(magazines.get(current_weapon_id(), 0))

func current_reserve() -> int:
	return int(reserves.get(current_weapon_id(), 0))

func is_melee() -> bool:
	return str(current_weapon().get("category", "")) == "melee"

func is_throwable() -> bool:
	return str(current_weapon().get("category", "")) == "throwable"

func _equip_model(weapon_id: String) -> void:
	if _model != null:
		_model.queue_free()
		_model = null
	if weapon_id.is_empty() or animator == null:
		return
	var weapon := ContentDB.weapon(weapon_id)
	if weapon.is_empty():
		return
	_model = WeaponModel.new()
	_model.name = "WeaponModel"
	animator.weapon_mount.add_child(_model)
	_model.build(weapon)
	_model.apply_skin(Inventory.weapon_tint())
	# Muzzle flash: a small emissive cube toggled for a couple of frames.
	var flash_mesh := BoxMesh.new()
	flash_mesh.size = Vector3(0.22, 0.22, 0.22)
	_muzzle_flash = MeshInstance3D.new()
	_muzzle_flash.name = "MuzzleFlash"
	_muzzle_flash.mesh = flash_mesh
	_muzzle_flash.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var flash_material := StandardMaterial3D.new()
	flash_material.albedo_color = Color(1.0, 0.85, 0.45)
	flash_material.emission_enabled = true
	flash_material.emission = Color(1.0, 0.8, 0.4)
	flash_material.emission_energy_multiplier = 2.5
	flash_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_muzzle_flash.material_override = flash_material
	_muzzle_flash.visible = false
	_model.muzzle.add_child(_muzzle_flash)

func switch_to(slot: String) -> void:
	if not slots.has(slot) or str(slots.get(slot, "")).is_empty() or slot == active_slot:
		return
	if reloading:
		_cancel_reload()
	active_slot = slot
	_equip_model(current_weapon_id())
	AudioDirector.play_sfx("weapon_switch", owner_body.global_position, -8.0)
	weapon_switched.emit(current_weapon_id(), active_slot)
	_emit_ammo()

func next_slot() -> void:
	var order: Array = [SLOT_PRIMARY, SLOT_SECONDARY, SLOT_MELEE, SLOT_THROWABLE]
	var index: int = order.find(active_slot)
	for i: int in order.size():
		var candidate: String = order[(index + i + 1) % order.size()]
		if not str(slots.get(candidate, "")).is_empty():
			switch_to(candidate)
			return

func previous_slot() -> void:
	var order: Array = [SLOT_PRIMARY, SLOT_SECONDARY, SLOT_MELEE, SLOT_THROWABLE]
	var index: int = order.find(active_slot)
	for i: int in order.size():
		var candidate: String = order[(index - i - 1 + order.size() * 2) % order.size()]
		if not str(slots.get(candidate, "")).is_empty():
			switch_to(candidate)
			return

## Adds a weapon, replacing the slot when full (drops what was there).
func pick_up_weapon(weapon_id: String) -> Dictionary:
	var weapon := ContentDB.weapon(weapon_id)
	if weapon.is_empty():
		return {}
	var slot := _slot_for_category(str(weapon.get("category", "")))
	var replaced := str(slots.get(slot, ""))
	var dropped: Dictionary = {}
	if not replaced.is_empty() and replaced != weapon_id:
		dropped = {"weapon": replaced, "magazine": magazines.get(replaced, 0),
				   "reserve": reserves.get(replaced, 0)}
	slots[slot] = weapon_id
	if not magazines.has(weapon_id):
		magazines[weapon_id] = int(weapon.get("magazine", 1))
		reserves[weapon_id] = int(weapon.get("reserve_ammo", 0))
	switch_to(slot)
	_emit_ammo()
	return dropped

static func _slot_for_category(category: String) -> String:
	match category:
		"melee":
			return SLOT_MELEE
		"throwable":
			return SLOT_THROWABLE
		"pistol":
			return SLOT_SECONDARY
		_:
			return SLOT_PRIMARY

func add_ammo(weapon_id: String, amount: int) -> int:
	if amount <= 0:
		return 0
	var weapon := ContentDB.weapon(weapon_id)
	var capacity := int(weapon.get("reserve_ammo", 0)) * 2
	var current := int(reserves.get(weapon_id, 0))
	var added := mini(amount, maxi(0, capacity - current))
	reserves[weapon_id] = current + added
	if weapon_id == current_weapon_id():
		_emit_ammo()
	return added

func refill_all() -> void:
	for weapon_id: String in slots.values():
		var weapon := ContentDB.weapon(str(weapon_id))
		if weapon.is_empty():
			continue
		magazines[weapon_id] = int(weapon.get("magazine", 1))
		reserves[weapon_id] = int(weapon.get("reserve_ammo", 0))
	_emit_ammo()

func set_infinite_ammo(value: bool) -> void:
	infinite_ammo = value
	_emit_ammo()

func stop_all() -> void:
	trigger_held = false
	_cancel_reload()
	if _muzzle_flash != null:
		_muzzle_flash.visible = false

func start_reload() -> void:
	var weapon := current_weapon()
	if weapon.is_empty() or reloading or is_melee() or is_throwable():
		return
	if infinite_ammo:
		return
	var magazine_size := int(weapon.get("magazine", 1))
	if current_magazine() >= magazine_size:
		return
	if current_reserve() <= 0:
		AudioDirector.play_sfx("dry_fire", owner_body.global_position, -10.0)
		dry_fire.emit()
		return
	reloading = true
	reload_remaining = float(weapon.get("reload_time", 2.0))
	AudioDirector.play_sfx("reload", owner_body.global_position, -4.0)
	if animator != null:
		animator.trigger_reload(reload_remaining)
	reload_state_changed.emit(true, 0.0)
	reload_started.emit(reload_remaining)

func _cancel_reload() -> void:
	reloading = false
	reload_remaining = 0.0
	reload_state_changed.emit(false, 0.0)

func _finish_reload() -> void:
	reloading = false
	var weapon_id := current_weapon_id()
	var weapon := ContentDB.weapon(weapon_id)
	var magazine_size := int(weapon.get("magazine", 1))
	var needed := magazine_size - current_magazine()
	var available := current_reserve()
	var loaded := mini(needed, available)
	magazines[weapon_id] = current_magazine() + loaded
	reserves[weapon_id] = available - loaded
	if animator != null and animator.state == CharacterAnimator.State.RELOAD:
		animator.set_state(CharacterAnimator.State.IDLE)
	_emit_ammo()
	reload_state_changed.emit(false, 1.0)

func _emit_ammo() -> void:
	ammo_changed.emit(current_magazine(), current_reserve())

func _process(delta: float) -> void:
	if fire_cooldown > 0.0:
		fire_cooldown = maxf(0.0, fire_cooldown - delta)
	if reloading:
		var previous := reload_remaining
		reload_remaining = maxf(0.0, reload_remaining - delta)
		var weapon := current_weapon()
		var total := maxf(0.01, float(weapon.get("reload_time", 1.0)))
		reload_state_changed.emit(true, 1.0 - (reload_remaining / total))
		if previous > 0.0 and reload_remaining <= 0.0:
			_finish_reload()
	if _flash_timer > 0.0:
		_flash_timer -= delta
		if _flash_timer <= 0.0 and _muzzle_flash != null:
			_muzzle_flash.visible = false
	if recoil_offset.length_squared() > 0.0001:
		recoil_offset = recoil_offset.lerp(Vector2.ZERO, minf(1.0, delta * 8.0))
	spread_state = maxf(0.0, spread_state - delta * 3.0)
	if trigger_held and can_fire():
		try_fire()

func can_fire() -> bool:
	if owner_body == null or not owner_body.alive or reloading or fire_cooldown > 0.0:
		return false
	var weapon := current_weapon()
	if weapon.is_empty():
		return false
	if is_melee():
		return true
	if is_throwable():
		return current_magazine() > 0 and _throwables_in_flight < 2
	return infinite_ammo or current_magazine() > 0

## Fires one shot (or one pellet group).  Returns true when a shot left the barrel.
func try_fire() -> bool:
	var weapon := current_weapon()
	if weapon.is_empty():
		return false
	if not can_fire():
		if not reloading and not is_melee() and not is_throwable() and current_magazine() <= 0 \
				and not infinite_ammo:
			AudioDirector.play_sfx("dry_fire", owner_body.global_position, -8.0)
			dry_fire.emit()
			start_reload()
		return false
	var fire_rate := maxf(0.05, float(weapon.get("fire_rate", 1.0)))
	fire_cooldown = 1.0 / fire_rate
	shots_fired += 1
	if is_throwable():
		_throw_throwable(weapon)
	elif is_melee():
		_melee_swing(weapon)
	else:
		_fire_hitscan(weapon)
	if not infinite_ammo and not is_melee():
		magazines[current_weapon_id()] = maxi(0, current_magazine() - 1)
	_emit_ammo()
	fired.emit(current_weapon_id())
	return true

func _fire_hitscan(weapon: Dictionary) -> void:
	var weapon_id := str(weapon.get("id", ""))
	var pellets := maxi(1, int(weapon.get("pellets", 1)))
	var spread := _current_spread(weapon)
	var origin := owner_body.muzzle_origin()
	var direction := owner_body.aim_direction()
	GameEffects.muzzle_flash(self, origin, direction)
	AudioDirector.play_sfx(str(weapon.get("audio", {}).get("fire", "fire_rifle")),
		origin, -2.0, true, randf_range(0.94, 1.06))
	recoil_offset.y -= float(weapon.get("recoil", 1.0)) * 0.01
	spread_state = minf(4.0, spread_state + 0.35)
	if animator != null:
		animator.trigger_shoot()
	for pellet: int in pellets:
		var shot_direction := _apply_spread(direction, spread)
		var result := _damage_system.fire_hitscan(self, owner_body, origin, shot_direction, weapon)
		if result.get("hit", false):
			last_hit_was_headshot = bool(result.get("headshot", false))
			hit_confirmed.emit(result.get("target"), float(result.get("damage", 0.0)),
				last_hit_was_headshot)
			if bool(result.get("killed", false)):
				killed.emit(result.get("target"), weapon_id)

func _throw_throwable(weapon: Dictionary) -> void:
	var origin := owner_body.muzzle_origin() + owner_body.aim_direction() * 0.5
	var direction := (owner_body.aim_direction() + Vector3.UP * 0.25).normalized()
	var projectile := ThrowableProjectile.new()
	projectile.setup(weapon, owner_body, origin, direction)
	projectile.exploded.connect(_on_throwable_exploded)
	get_tree().current_scene.add_child(projectile)
	_throwables_in_flight += 1
	AudioDirector.play_sfx("grenade_throw", origin, -2.0)

func _on_throwable_exploded(position: Vector3, weapon_id: String, owner_body_ref: Node) -> void:
	_throwables_in_flight = maxi(0, _throwables_in_flight - 1)
	var weapon := ContentDB.weapon(weapon_id)
	var radius := float(weapon.get("blast_radius", 5.0))
	var damage := float(weapon.get("damage", 0.0))
	if damage <= 0.0:
		GameEffects.smoke_puff(self, position, radius)
		return
	GameEffects.explosion(self, position, radius)
	AudioDirector.play_sfx("explosion", position, 0.0)
	if _damage_system != null:
		var hits := _damage_system.apply_explosion(self, owner_body_ref, position, radius, damage)
		for hit: Variant in hits:
			var entry: Dictionary = hit
			hit_confirmed.emit(entry.get("target"), float(entry.get("damage", 0.0)), false)

func _melee_swing(weapon: Dictionary) -> void:
	if animator != null:
		animator.trigger_melee(0.35)
	var origin := owner_body.global_position + Vector3(0, 1.0, 0)
	var forward := owner_body.aim_direction()
	AudioDirector.play_sfx("weapon_switch", origin, -6.0)
	var result := _damage_system.melee_swing(self, owner_body, origin, forward,
		float(weapon.get("effective_range", 2.5)),
		deg_to_rad(float(weapon.get("swing_arc_deg", 60.0))),
		float(weapon.get("damage", 20.0)))
	if result.get("hit", false):
		hit_confirmed.emit(result.get("target"), float(result.get("damage", 0.0)), false)
		if bool(result.get("killed", false)):
			killed.emit(result.get("target"), str(weapon.get("id", "")))

func _current_spread(weapon: Dictionary) -> float:
	var spread: Dictionary = weapon.get("spread_deg", {})
	var base := float(spread.get("base", 1.0))
	var speed := Vector2(owner_body.velocity.x, owner_body.velocity.z).length()
	if not owner_body.is_on_floor():
		base = float(spread.get("air", base))
	elif speed > 0.5:
		base = lerpf(base, float(spread.get("moving", base)),
			clampf(speed / GameConfig.PLAYER["sprint_speed"], 0.0, 1.0))
	if owner_body.aim_held:
		base *= 0.45
	var recoil_penalty := spread_state * float(weapon.get("recoil", 1.0)) * 0.25
	return deg_to_rad(base + recoil_penalty)

func _apply_spread(direction: Vector3, spread_radians: float) -> Vector3:
	if spread_radians <= 0.0:
		return direction
	var basis := Basis.looking_at(direction, Vector3.UP) if absf(direction.dot(Vector3.UP)) < 0.98 \
		else Basis.looking_at(direction, Vector3.RIGHT)
	var angle := randf() * TAU
	var radius := sqrt(randf()) * spread_radians
	var offset := basis.x * cos(angle) * radius + basis.y * sin(angle) * radius
	return (direction + offset).normalized()

## Current accuracy in degrees, used by the UI (and by tests).
func current_spread_degrees() -> float:
	return rad_to_deg(_current_spread(current_weapon()))

## Damage preview used by the HUD and by the balance tests.
func effective_damage_at(distance: float) -> float:
	var weapon := current_weapon()
	if weapon.is_empty():
		return 0.0
	return _damage_system.compute_damage(weapon, distance, false)
