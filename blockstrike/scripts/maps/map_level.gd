class_name MapLevel
extends Node3D
## Map container: generates Emerald Island, builds its chunks, adds environment
## lighting and invisible boundary walls, then reports spawn points.

signal progress(fraction: float, label: String)
signal built(info: Dictionary)

const MAP_SEED := 20261013
const BOUNDARY_SEGMENTS := 48

var world: VoxelWorld
var info: Dictionary = {}
var sun: DirectionalLight3D
var environment: Environment
var world_env: WorldEnvironment


func build_map() -> void:
	progress.emit(0.02, "Shaping the island")
	await get_tree().process_frame
	world = VoxelWorld.new()
	world.name = "VoxelWorld"
	add_child(world)
	world.setup(MapGenerator.W, MapGenerator.H, MapGenerator.W)
	info = MapGenerator.generate(world, MAP_SEED)
	progress.emit(0.12, "Growing forests and villages")
	await get_tree().process_frame
	_build_environment()
	world.build_progress.connect(func(done: int, total: int) -> void:
		progress.emit(0.15 + 0.8 * float(done) / float(maxi(total, 1)),
			"Meshing voxel chunks %d / %d" % [done, total]))
	await world.build_all_async(1)
	_build_boundary()
	progress.emit(1.0, "Ready")
	built.emit(info)


func get_spawn_points() -> Array:
	return info.get("spawns", [])


func get_landmarks() -> Array:
	return info.get("landmarks", [])


func landmark_name_at(pos: Vector3, max_distance: float = 28.0) -> String:
	var best := ""
	var best_d := max_distance
	for lm in get_landmarks():
		var p: Vector3 = lm["position"]
		var d := Vector2(p.x - pos.x, p.z - pos.z).length()
		if d < best_d:
			best_d = d
			best = str(lm["name"])
	return best if not best.is_empty() else "Emerald Island"


func _build_environment() -> void:
	var sky_material := ProceduralSkyMaterial.new()
	sky_material.sky_top_color = Color("#2f7fd1")
	sky_material.sky_horizon_color = Color("#bfe6ff")
	sky_material.ground_horizon_color = Color("#bfe6ff")
	sky_material.ground_bottom_color = Color("#2b5d7a")
	var sky := Sky.new()
	sky.sky_material = sky_material

	environment = Environment.new()
	environment.background_mode = Environment.BG_SKY
	environment.sky = sky
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	environment.ambient_light_energy = 0.9
	environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	environment.fog_enabled = true
	environment.fog_light_color = Color("#cfe9ff")
	environment.fog_density = 0.006
	environment.fog_sky_affect = 0.4

	world_env = WorldEnvironment.new()
	world_env.environment = environment
	add_child(world_env)

	sun = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55.0, -35.0, 0.0)
	sun.light_energy = 1.05
	sun.light_color = Color("#fff3da")
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 70.0
	add_child(sun)


func _build_boundary() -> void:
	## Invisible wall ring just inside the coastline so players cannot wade out to sea.
	var radius := float(info.get("bounds_radius", 50.0))
	var center: Vector3 = info.get("center", Vector3(64, 0, 64))
	var body := StaticBody3D.new()
	body.name = "Boundary"
	body.collision_layer = GameConstants.LAYER_WORLD
	body.collision_mask = 0
	add_child(body)
	var seg_len := TAU * radius / BOUNDARY_SEGMENTS + 1.0
	for i in range(BOUNDARY_SEGMENTS):
		var a := TAU * float(i) / BOUNDARY_SEGMENTS
		var cs := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = Vector3(seg_len, 40.0, 1.0)
		cs.shape = box
		cs.position = center + Vector3(cos(a) * radius, 20.0, sin(a) * radius)
		cs.rotation.y = -a - PI * 0.5
		body.add_child(cs)
