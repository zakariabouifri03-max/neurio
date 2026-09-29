class_name RoadfallWeather
extends Node3D

var weather := "CLEAR"
var particles: GPUParticles3D
var environment: WorldEnvironment
var tint: ColorRect

func configure(world_environment: WorldEnvironment) -> void:
    environment = world_environment
    particles = GPUParticles3D.new()
    particles.amount = 700
    particles.lifetime = 1.3
    particles.visibility_aabb = AABB(Vector3(-80, -10, -80), Vector3(160, 90, 160))
    var process_material := ParticleProcessMaterial.new()
    process_material.direction = Vector3(0, -1, 0)
    process_material.initial_velocity_min = 28.0
    process_material.initial_velocity_max = 42.0
    process_material.gravity = Vector3(0, -14, 0)
    particles.process_material = process_material
    var quad := QuadMesh.new()
    quad.size = Vector2(0.035, 0.55)
    var material := StandardMaterial3D.new()
    material.albedo_color = Color(0.45, 0.75, 1.0, 0.7)
    material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
    material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
    quad.material = material
    particles.draw_pass_1 = quad
    add_child(particles)
    particles.emitting = false

func set_weather(next_weather: String) -> void:
    weather = next_weather
    if particles == null:
        return
    particles.emitting = next_weather in ["RAIN", "HEAVY RAIN", "SNOWSTORM"]
    var process_material := particles.process_material as ParticleProcessMaterial
    if process_material:
        process_material.initial_velocity_min = 18.0 if next_weather == "SNOWSTORM" else 28.0
        process_material.initial_velocity_max = 27.0 if next_weather == "SNOWSTORM" else 42.0
        process_material.gravity = Vector3(0, -4, 0) if next_weather == "SNOWSTORM" else Vector3(0, -18, 0)
    if environment and environment.environment:
        if next_weather == "FOG":
            environment.environment.fog_enabled = true
            environment.environment.fog_light_color = Color("#7d8c98")
            environment.environment.fog_density = 0.018
        elif next_weather == "SANDSTORM":
            environment.environment.fog_enabled = true
            environment.environment.fog_light_color = Color("#c9925e")
            environment.environment.fog_density = 0.012
        else:
            environment.environment.fog_enabled = next_weather in ["HEAVY RAIN", "SNOWSTORM"]
            environment.environment.fog_density = 0.006

func set_anchor(position: Vector3) -> void:
    global_position = position + Vector3(0, 34, 0)
