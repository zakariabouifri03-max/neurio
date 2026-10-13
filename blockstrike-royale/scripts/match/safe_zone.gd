extends RefCounted
## Battle-royale shrinking safe zone. Pure functions of elapsed match time, so the
## whole timeline can be unit tested without a scene.

const CENTER := Vector2(56.0, 56.0)
const START_RADIUS := 80.0
## Each phase waits, then shrinks linearly to `radius` over `shrink` seconds.
## `dps` is the damage per second taken outside the zone during that phase.
const PHASES := [
	{"wait": 60.0, "shrink": 45.0, "radius": 52.0, "dps": 1.0},
	{"wait": 35.0, "shrink": 35.0, "radius": 30.0, "dps": 2.0},
	{"wait": 30.0, "shrink": 30.0, "radius": 15.0, "dps": 4.0},
	{"wait": 25.0, "shrink": 25.0, "radius": 4.0, "dps": 7.0},
]
const FINAL_DPS := 10.0


static func state_at(t: float) -> Dictionary:
	var r: float = START_RADIUS
	var elapsed: float = 0.0
	for i in PHASES.size():
		var p: Dictionary = PHASES[i]
		var wait_end: float = elapsed + float(p["wait"])
		if t < wait_end:
			return {"radius": r, "phase": i, "dps": float(p["dps"]), "shrinking": false,
				"next_in": wait_end - t}
		var shrink_end: float = wait_end + float(p["shrink"])
		if t < shrink_end:
			var k: float = (t - wait_end) / float(p["shrink"])
			return {"radius": lerpf(r, float(p["radius"]), k), "phase": i, "dps": float(p["dps"]),
				"shrinking": true, "next_in": shrink_end - t}
		r = float(p["radius"])
		elapsed = shrink_end
	return {"radius": r, "phase": PHASES.size(), "dps": FINAL_DPS, "shrinking": false, "next_in": 0.0}


static func contains(center: Vector2, radius: float, pos: Vector3) -> bool:
	return Vector2(pos.x - center.x, pos.z - center.y).length() <= radius


static func phase_name(phase: int) -> String:
	if phase >= PHASES.size():
		return "FINAL CIRCLE"
	return "ZONE %d" % (phase + 1)
