class_name GraphicsPresets
extends RefCounted
## Maps the user's graphics preset onto render scale, shadows, view distance and fog.
## Low settings avoid shadows and reduce internal resolution for weaker phones.

const PRESETS := {
	"low": {"render_scale": 0.7, "shadows": false, "view_distance": 85.0, "fog_density": 0.012, "shadow_distance": 0.0},
	"medium": {"render_scale": 0.85, "shadows": true, "view_distance": 130.0, "fog_density": 0.007, "shadow_distance": 45.0},
	"high": {"render_scale": 1.0, "shadows": true, "view_distance": 190.0, "fog_density": 0.004, "shadow_distance": 70.0},
}


static func current() -> Dictionary:
	var name := str(AppSettings.get_value("graphics_preset"))
	return PRESETS.get(name, PRESETS["medium"])


static func apply(viewport: Viewport, sun: DirectionalLight3D, env: Environment, world: VoxelWorld) -> void:
	var p := current()
	if viewport != null:
		viewport.scaling_3d_scale = float(p["render_scale"])
	if sun != null:
		sun.shadow_enabled = bool(p["shadows"])
		sun.directional_shadow_max_distance = maxf(float(p["shadow_distance"]), 1.0)
	if env != null:
		env.fog_density = float(p["fog_density"])
	if world != null:
		world.apply_quality(float(p["view_distance"]), bool(p["shadows"]))
