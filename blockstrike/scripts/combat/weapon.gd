class_name Weapon
extends Node3D
## One equipped firearm. Data comes from WeaponData (res://data/weapons.json).
##
## Responsibilities: ammunition, fire rate, reload, dry fire, spread, hitscan
## resolution and feedback events. Damage is computed here for offline play;
## online matches will recompute damage on the authoritative server.

signal fired(shot: Dictionary)
signal dry_fired
signal reload_started(duration: float)
signal reload_finished
signal ammo_changed(magazine: int, reserve: int)

## Heights (metres above feet) above which a capsule hit counts as a headshot.
const HEADSHOT_HEIGHT := 1.2
const DRY_FIRE_COOLDOWN := 0.25

var data: WeaponData
var magazine := 0
var reserve := 0
var reloading := false
var muzzle: Marker3D

var _cooldown := 0.0
var _reload_left := 0.0
var _shooter: Node
var _model: Node3D
var _kick := 0.0


func setup(weapon_data: WeaponData, shooter: Node) -> void:
	data = weapon_data
	_shooter = shooter
	if _model == null:
		_build_model()
	refill()


func refill() -> void:
	if data == null:
		return
	magazine = data.magazine
	reserve = data.reserve_ammo
	reloading = false
	_cooldown = 0.0
	ammo_changed.emit(magazine, reserve)


func tick(delta: float) -> void:
	_cooldown = maxf(_cooldown - delta, 0.0)
	if reloading:
		_reload_left -= delta
		if _reload_left <= 0.0:
			_finish_reload()
	_kick = move_toward(_kick, 0.0, delta * 9.0)
	if _model:
		_model.position.z = _kick * 0.05


func start_reload() -> bool:
	if data == null or reloading or magazine >= data.magazine or reserve <= 0:
		return false
	reloading = true
	_reload_left = data.reload_time
	reload_started.emit(data.reload_time)
	return true


func reload_progress() -> float:
	if not reloading or data == null:
		return 1.0
	return clampf(1.0 - _reload_left / data.reload_time, 0.0, 1.0)


func is_ready_to_fire() -> bool:
	return data != null and not reloading and _cooldown <= 0.0


func try_fire(origin: Vector3, direction: Vector3, extra_spread_deg: float,
		moving_factor: float, aiming: bool) -> Dictionary:
	## Returns { "fired": bool, "reason": String, ... shot details when fired }.
	if data == null:
		return {"fired": false, "reason": "no_weapon"}
	if reloading:
		return {"fired": false, "reason": "reloading"}
	if _cooldown > 0.0:
		return {"fired": false, "reason": "cooldown"}
	if magazine <= 0:
		dry_fired.emit()
		Sfx.play_3d("dry_click", origin)
		_cooldown = DRY_FIRE_COOLDOWN
		start_reload()
		return {"fired": false, "reason": "empty"}

	magazine -= 1
	_cooldown = data.seconds_per_shot()
	var spread := data.spread_deg + data.moving_spread_penalty_deg * clampf(moving_factor, 0.0, 1.0)
	spread += extra_spread_deg
	if aiming:
		spread *= data.aim_spread_multiplier
	var dir := _spread_direction(direction.normalized(), spread)
	var end := origin + dir * data.max_range

	var hit := ShotResolver.cast(get_world_3d(), origin, end, [_shooter])
	var muzzle_pos := muzzle.global_position if muzzle else origin
	var shot := {
		"fired": true,
		"reason": "",
		"hit": false,
		"damage": 0,
		"headshot": false,
		"target": null,
		"position": end,
		"normal": -dir,
		"distance": data.max_range,
		"direction": dir,
	}
	if not hit.is_empty():
		var pos: Vector3 = hit["position"]
		var collider: Object = hit["collider"]
		shot["hit"] = true
		shot["position"] = pos
		shot["normal"] = hit["normal"]
		shot["distance"] = hit["distance"]
		if collider.has_method("receive_hit"):
			var actor := collider as Node3D
			var headshot := (pos.y - actor.global_position.y) >= HEADSHOT_HEIGHT
			var dmg := data.damage_at_distance(float(hit["distance"]))
			if headshot:
				dmg *= data.headshot_multiplier
			var rounded := maxi(roundi(dmg), 1)
			shot["damage"] = rounded
			shot["headshot"] = headshot
			shot["target"] = collider
			collider.call("receive_hit", rounded, _shooter, headshot)
		else:
			ImpactFX.impact(get_tree().current_scene, pos, hit["normal"], data.accent_color)
			Sfx.play_3d("impact", pos, -8.0)

	ImpactFX.muzzle_flash(muzzle if muzzle else self, data.accent_color)
	ImpactFX.tracer(get_tree().current_scene, muzzle_pos, shot["position"], data.accent_color)
	Sfx.play_3d("gunshot", muzzle_pos)
	_kick = 1.0
	fired.emit(shot)
	ammo_changed.emit(magazine, reserve)
	return shot


func _finish_reload() -> void:
	var take := mini(data.magazine - magazine, reserve)
	magazine += take
	reserve -= take
	reloading = false
	_reload_left = 0.0
	reload_finished.emit()
	ammo_changed.emit(magazine, reserve)


func _spread_direction(dir: Vector3, spread_deg: float) -> Vector3:
	if spread_deg <= 0.0001:
		return dir
	var right := dir.cross(Vector3.UP)
	if right.length_squared() < 0.0001:
		right = Vector3.RIGHT
	right = right.normalized()
	var up := right.cross(dir).normalized()
	var radius := tan(deg_to_rad(spread_deg)) * sqrt(randf())
	var angle := randf() * TAU
	return (dir + (right * cos(angle) + up * sin(angle)) * radius).normalized()


func _build_model() -> void:
	_model = Node3D.new()
	_model.name = "Model"
	add_child(_model)
	var body := _mat(data.body_color if data else Color("#2c3440"))
	var dark := _mat(Color("#1d232b"))
	var wood := _mat(Color("#7a5330"))
	var accent := _mat(Color("#33e0ff"), true)
	var accent_color := data.accent_color if data else Color("#33e0ff")
	accent = _mat(accent_color, true)
	_box(Vector3(0.1, 0.12, 0.42), body, Vector3(0, 0, -0.05), _model)
	_box(Vector3(0.05, 0.05, 0.3), dark, Vector3(0, 0.01, -0.4), _model)
	_box(Vector3(0.105, 0.02, 0.2), accent, Vector3(0, 0.065, -0.1), _model)
	_box(Vector3(0.04, 0.05, 0.08), dark, Vector3(0, 0.1, -0.1), _model)
	_box(Vector3(0.08, 0.12, 0.22), wood, Vector3(0, -0.01, 0.22), _model)
	_box(Vector3(0.06, 0.16, 0.07), dark, Vector3(0, -0.13, 0.02), _model)
	_box(Vector3(0.06, 0.18, 0.1), dark, Vector3(0, -0.16, -0.1), _model)
	muzzle = Marker3D.new()
	muzzle.name = "Muzzle"
	muzzle.position = Vector3(0, 0.01, -0.58)
	_model.add_child(muzzle)


static func _mat(color: Color, emissive: bool = false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = 0.6
	if emissive:
		m.emission_enabled = true
		m.emission = color
		m.emission_energy_multiplier = 1.4
	return m


static func _box(size: Vector3, mat: Material, pos: Vector3, parent: Node3D) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = size
	mi.mesh = b
	mi.material_override = mat
	mi.position = pos
	parent.add_child(mi)
	return mi
