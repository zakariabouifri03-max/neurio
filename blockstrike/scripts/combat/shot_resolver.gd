class_name ShotResolver
extends RefCounted
## Physics queries used for hitscan shots and line-of-sight checks.
## Shots are resolved against world geometry first, so solid terrain and buildings
## always stop bullets (no penetration rules exist yet).

static func cast(world: World3D, origin: Vector3, to: Vector3, exclude: Array) -> Dictionary:
	## Returns {} on miss, otherwise {position, normal, collider, distance, headshot_height}.
	if world == null:
		return {}
	var query := PhysicsRayQueryParameters3D.create(origin, to,
		GameConstants.LAYER_WORLD | GameConstants.LAYER_ACTORS, _rids(exclude))
	query.collide_with_areas = false
	query.collide_with_bodies = true
	var hit := world.direct_space_state.intersect_ray(query)
	if hit.is_empty():
		return {}
	var pos: Vector3 = hit["position"]
	return {
		"position": pos,
		"normal": hit["normal"],
		"collider": hit["collider"],
		"distance": origin.distance_to(pos),
	}


static func line_of_sight(world: World3D, from: Vector3, to: Vector3, exclude: Array) -> bool:
	## True when no world geometry blocks the segment (actors are ignored).
	if world == null:
		return false
	var query := PhysicsRayQueryParameters3D.create(from, to, GameConstants.LAYER_WORLD, _rids(exclude))
	query.collide_with_areas = false
	return world.direct_space_state.intersect_ray(query).is_empty()


static func _rids(objects: Array) -> Array[RID]:
	var out: Array[RID] = []
	for o in objects:
		if o is CollisionObject3D:
			out.append((o as CollisionObject3D).get_rid())
	return out
