class_name EnvironmentBuilder
extends RefCounted
## Sky, sun and fog for a map, plus the frame-cost knobs that follow the graphics
## preset (shadow distance, fog density, ambient energy).
##
## Each map has its own sky palette so the five maps genuinely look different:
## Emerald Island is a bright mid-day archipelago, Neon Yard is a purple night,
## Dust Canyon is a hot dusty noon, Training Base is a clean overcast morning and
## Frost Frontier is a cold blue afternoon.

const SKIES := {
	"emerald_island": {
		"top": Color(0.24, 0.52, 0.92), "horizon": Color(0.68, 0.85, 0.95),
		"sun_color": Color(1.0, 0.96, 0.88), "sun_energy": 1.15,
		"sun_rotation": Vector3(-52.0, 38.0, 0.0), "ambient": 0.55,
		"fog_color": Color(0.72, 0.85, 0.92), "fog_density": 0.0016,
	},
	"neon_yard": {
		"top": Color(0.06, 0.05, 0.16), "horizon": Color(0.35, 0.1, 0.45),
		"sun_color": Color(0.75, 0.62, 1.0), "sun_energy": 0.55,
		"sun_rotation": Vector3(-34.0, 210.0, 0.0), "ambient": 0.35,
		"fog_color": Color(0.16, 0.08, 0.28), "fog_density": 0.0042,
	},
	"dust_canyon": {
		"top": Color(0.42, 0.6, 0.88), "horizon": Color(0.92, 0.78, 0.58),
		"sun_color": Color(1.0, 0.9, 0.74), "sun_energy": 1.35,
		"sun_rotation": Vector3(-72.0, 120.0, 0.0), "ambient": 0.6,
		"fog_color": Color(0.85, 0.72, 0.55), "fog_density": 0.0035,
	},
	"training_base": {
		"top": Color(0.5, 0.62, 0.78), "horizon": Color(0.85, 0.88, 0.9),
		"sun_color": Color(0.98, 0.98, 0.95), "sun_energy": 0.95,
		"sun_rotation": Vector3(-60.0, 20.0, 0.0), "ambient": 0.7,
		"fog_color": Color(0.82, 0.86, 0.88), "fog_density": 0.0012,
	},
	"frost_frontier": {
		"top": Color(0.36, 0.55, 0.82), "horizon": Color(0.86, 0.93, 1.0),
		"sun_color": Color(0.92, 0.96, 1.0), "sun_energy": 0.85,
		"sun_rotation": Vector3(-28.0, 300.0, 0.0), "ambient": 0.62,
		"fog_color": Color(0.85, 0.92, 1.0), "fog_density": 0.0055,
	},
}

## Builds the environment under `parent`.  Returns the sun light so callers can
## keep a reference (the settings service also finds it through its group).
static func build(parent: Node3D, map_id: String, graphics: Dictionary) -> DirectionalLight3D:
	var palette: Dictionary = SKIES.get(map_id, SKIES["training_base"])
	var environment := Environment.new()
	var sky := Sky.new()
	var sky_material := ProceduralSkyMaterial.new()
	sky_material.sky_top_color = palette["top"]
	sky_material.sky_horizon_color = palette["horizon"]
	sky_material.ground_bottom_color = palette["top"].darkened(0.55)
	sky_material.ground_horizon_color = palette["horizon"].darkened(0.25)
	sky_material.sun_angle_max = 8.0
	sky.sky_material = sky_material
	environment.sky = sky
	environment.background_mode = Environment.BG_SKY
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	var ambient := float(palette.get("ambient", 0.5))
	environment.ambient_light_sky_contribution = 1.0
	environment.ambient_light_energy = ambient
	var fog_density := float(palette.get("fog_density", 0.002))
	var quality := str(graphics.get("preset", "medium"))
	if quality == "low":
		fog_density *= 0.6
	elif quality == "ultra":
		fog_density *= 1.2
	environment.fog_enabled = true
	environment.fog_light_color = palette["fog_color"]
	environment.fog_density = fog_density
	environment.fog_sky_affect = 0.35
	environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	environment.adjustment_enabled = true
	if quality == "low":
		environment.glow_enabled = false
	else:
		environment.glow_enabled = true
		environment.glow_intensity = 0.35 if quality == "ultra" else 0.22
		environment.glow_bloom = 0.05
	var world_environment := WorldEnvironment.new()
	world_environment.name = "WorldEnvironment"
	world_environment.environment = environment
	parent.add_child(world_environment)

	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	sun.light_color = palette["sun_color"]
	sun.light_energy = float(palette.get("sun_energy", 1.0))
	var rotation: Vector3 = palette["sun_rotation"]
	sun.rotation_degrees = rotation
	sun.shadow_enabled = int(graphics.get("shadow_quality", 1)) > 0
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_max_distance = 90.0
	sun.shadow_bias = 0.06
	sun.add_to_group("quality_lights")
	parent.add_child(sun)
	return sun

## Applies a new graphics preset to an existing environment/sun pair.
static func apply_preset(environment_node: WorldEnvironment, sun: DirectionalLight3D,
						 graphics: Dictionary) -> void:
	if sun != null:
		var shadows := int(graphics.get("shadow_quality", 1))
		sun.shadow_enabled = shadows > 0
		sun.directional_shadow_max_distance = 60.0 if shadows == 1 else (90.0 if shadows == 2 else 140.0)
	if environment_node != null and environment_node.environment != null:
		var environment := environment_node.environment
		environment.glow_enabled = str(graphics.get("preset", "medium")) != "low"
		environment.ambient_light_energy = clampf(float(graphics.get("ambient_multiplier", 1.0)),
			0.2, 1.5)
