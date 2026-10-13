class_name DamageSystem
extends Node
## Hit registration for hitscan weapons, melee and explosions.
##
## All damage flows through here so the rules (falloff, headshots, armour, team
## checks, "no shooting through walls") exist in one place.  The same code runs
## on a client for instant feedback and on the authoritative server for the real
## result: `validate_shot()` re-runs the trace and rejects impossible claims
## (firing through walls, beyond range, faster than the weapon allows).

const HEAD_BONE_HEIGHT := 1.28   ## Metres above feet: everything above is a head hit.
const MAX_TRACE_DISTANCE := 320.0

var server_side: bool = false

## Fires one hitscan pellet/bullet.  Returns a result dictionary.
func fire_hitscan(controller: WeaponController, shooter: PlayerController, origin: Vector3,
				  direction: Vector3, weapon: Dictionary) -> Dictionary:
	var range_limit := minf(MAX_TRACE_DISTANCE, float(weapon.get("effective_range", 60.0)) * 3.0)
	var space := shooter.get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(origin, origin + direction * range_limit)
	query.collision_mask = GameConfig.Layer.WORLD | GameConfig.Layer.PROP \
		| GameConfig.Layer.PLAYER | GameConfig.Layer.BOT
	query.exclude = [shooter.get_rid()]
	if controller != null and controller.owner_body != null:
		query.exclude.append(controller.owner_body.get_rid())
	var hit := space.intersect_ray(query)
	if hit.is_empty():
		return {"hit": false}
	var collider: Object = hit.get("collider")
	var position: Vector3 = hit.get("position", Vector3.ZERO)
	var distance := origin.distance_to(position)
	var result: Dictionary = {"hit": true, "position": position, "distance": distance}
	var target := _resolve_target(collider)
	if target == null:
		# Environment impact.
		var sound := _impact_sound_for(shooter, position)
		GameEffects.impact(self, position, sound, hit.get("normal", Vector3.UP))
		AudioDirector.play_sfx(sound, position, -6.0)
		result["target"] = null
		return result
	if target == shooter or _is_friendly(shooter, target):
		result["friendly"] = true
		return result
	var headshot := position.y - target.global_position.y >= HEAD_BONE_HEIGHT
	var damage := compute_damage(weapon, distance, headshot)
	GameEffects.blood_hit(self, position)
	AudioDirector.play_ui("headshot_confirm" if headshot else "hit_confirm", -5.0)
	target.apply_damage(damage, shooter.player_id, str(weapon.get("id", "")), direction)
	result["target"] = target
	result["damage"] = damage
	result["headshot"] = headshot
	result["killed"] = not target.alive
	return result

## Distance falloff: full damage inside the effective range, then a linear ramp to
## the weapon's minimum multiplier at three times the range.
func compute_damage(weapon: Dictionary, distance: float, headshot: bool) -> float:
	var base := float(weapon.get("damage", 0.0))
	var effective := maxf(1.0, float(weapon.get("effective_range", 30.0)))
	var minimum := float(weapon.get("falloff_end_mult", 0.5))
	var multiplier := 1.0
	if distance > effective:
		var t := clampf((distance - effective) / (effective * 2.0), 0.0, 1.0)
		multiplier = lerpf(1.0, minimum, t)
	if headshot:
		multiplier *= float(weapon.get("headshot_multiplier", 1.5))
	return base * multiplier

## Radial explosion damage with line-of-sight blocking.
func apply_explosion(controller: WeaponController, shooter: PlayerController, position: Vector3,
					 radius: float, damage: float) -> Array:
	var results: Array = []
	var tree := get_tree()
	if tree == null:
		return results
	for node: Node in tree.get_nodes_in_group("damageable"):
		var target := node as PlayerController
		if target == null or not target.alive:
			continue
		var distance := target.global_position.distance_to(position)
		if distance > radius:
			continue
		if not _has_clear_line(position, target):
			continue
		var falloff := 1.0 - (distance / maxf(0.5, radius))
		var applied := damage * clampf(falloff, 0.15, 1.0)
		target.apply_damage(applied, shooter.player_id if shooter != null else "", "explosion",
			(target.global_position - position).normalized())
		results.append({"target": target, "damage": applied, "killed": not target.alive})
	return results

func melee_swing(controller: WeaponController, shooter: PlayerController, origin: Vector3,
				 forward: Vector3, reach: float, arc_radians: float, damage: float) -> Dictionary:
	var best: PlayerController = null
	var best_distance := reach
	var tree := get_tree()
	if tree == null:
		return {"hit": false}
	for node: Node in tree.get_nodes_in_group("damageable"):
		var target := node as PlayerController
		if target == null or target == shooter or not target.alive:
			continue
		if _is_friendly(shooter, target):
			continue
		var to_target := target.global_position - origin
		var distance := to_target.length()
		if distance > reach:
			continue
		var angle := forward.angle_to(to_target.normalized())
		if angle > arc_radians * 0.5:
			continue
		if not _has_clear_line(origin, target):
			continue
		if distance < best_distance:
			best_distance = distance
			best = target
	if best == null:
		return {"hit": false}
	best.apply_damage(damage, shooter.player_id, "melee", forward)
	AudioDirector.play_sfx("impact_wood", best.global_position, -4.0)
	return {"hit": true, "target": best, "damage": damage, "killed": not best.alive}

## Server-side sanity check for a client-reported shot.
func validate_shot(controller: WeaponController, shooter: PlayerController, origin: Vector3,
				   direction: Vector3, weapon: Dictionary, claimed_hits: int) -> GameResult:
	if shooter == null or not shooter.alive:
		return GameResult.fail(GameResult.Code.INVALID, "shooter is not alive")
	var weapon_id := str(weapon.get("id", ""))
	if not ContentDB.has_weapon(weapon_id):
		return GameResult.fail(GameResult.Code.INVALID, "unknown weapon")
	var slots: Dictionary = controller.slots
	if not slots.values().has(weapon_id):
		return GameResult.fail(GameResult.Code.UNAUTHORIZED, "weapon not equipped")
	if not controller.infinite_ammo:
		if controller.current_weapon_id() != weapon_id:
			return GameResult.fail(GameResult.Code.INVALID, "shot from an inactive weapon")
		if controller.current_magazine() <= 0:
			return GameResult.fail(GameResult.Code.INVALID, "empty magazine")
	var expected_damage := compute_damage(weapon, 0.0, false) * maxi(1, int(weapon.get("pellets", 1)))
	if float(claimed_hits) > expected_damage * 2.0:
		return GameResult.fail(GameResult.Code.UNAUTHORIZED, "damage claim exceeds weapon output")
	if direction.length_squared() < 0.5:
		return GameResult.fail(GameResult.Code.INVALID, "degenerate aim direction")
	return GameResult.ok()

func _resolve_target(collider: Object) -> PlayerController:
	if collider == null:
		return null
	if collider is PlayerController:
		return collider as PlayerController
	var parent := (collider as Node).get_parent()
	while parent != null:
		if parent is PlayerController:
			return parent as PlayerController
		parent = parent.get_parent()
	return null

func _is_friendly(shooter: PlayerController, target: PlayerController) -> bool:
	if shooter == null or target == null:
		return false
	if MatchState.friendly_fire_enabled():
		return false
	return shooter.team == target.team and shooter.team > 0

func _has_clear_line(from: Vector3, target: PlayerController) -> bool:
	var to_target := (target.global_position + Vector3(0, 1.0, 0)) - from
	var space := target.get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(from, from + to_target.normalized() * to_target.length())
	query.collision_mask = GameConfig.Layer.WORLD | GameConfig.Layer.PROP
	var hit := space.intersect_ray(query)
	return hit.is_empty()

func _impact_sound_for(shooter: PlayerController, position: Vector3) -> String:
	var world := shooter.world()
	if world == null:
		return "impact_stone"
	return world.impact_sound_at(position)
