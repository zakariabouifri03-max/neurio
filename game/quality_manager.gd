class_name RoadfallQualityManager
extends Node

signal profile_changed(profile_name: String)

const PROFILES := {
    "LOW": {"label":"LOW", "target_fps":30, "cell_radius":1, "vegetation":0.25, "traffic":0.35, "shadow_distance":35.0, "resolution_scale":0.72, "particles":false, "lod_bias":2.0},
    "MEDIUM": {"label":"MEDIUM", "target_fps":45, "cell_radius":1, "vegetation":0.5, "traffic":0.65, "shadow_distance":65.0, "resolution_scale":0.86, "particles":true, "lod_bias":1.0},
    "HIGH": {"label":"HIGH", "target_fps":60, "cell_radius":1, "vegetation":0.82, "traffic":0.9, "shadow_distance":105.0, "resolution_scale":1.0, "particles":true, "lod_bias":0.0},
    "ULTRA": {"label":"ULTRA", "target_fps":120, "cell_radius":2, "vegetation":1.0, "traffic":1.0, "shadow_distance":180.0, "resolution_scale":1.0, "particles":true, "lod_bias":-0.4}
}

var active_name := "MEDIUM"
var mode := "BALANCED"
var profile: Dictionary = PROFILES.MEDIUM.duplicate(true)
var samples := 0
var elapsed := 0.0
var thermal_limiter := false

func setup() -> void:
    var requested := str(RoadfallSave.get_setting("quality", "AUTO"))
    mode = str(RoadfallSave.get_setting("performance_mode", "BALANCED"))
    if requested == "AUTO" or requested.is_empty():
        active_name = detect_recommended_profile()
    else:
        active_name = requested if PROFILES.has(requested) else detect_recommended_profile()
    apply_profile(active_name)

func detect_recommended_profile() -> String:
    if OS.has_feature("mobile"):
        var pixels := DisplayServer.screen_get_size().x * DisplayServer.screen_get_size().y
        var cores := OS.get_processor_count()
        if cores <= 4 or pixels < 1500000:
            return "LOW"
        if cores <= 6 or pixels < 2500000:
            return "MEDIUM"
        return "HIGH"
    var cores := OS.get_processor_count()
    if cores >= 12:
        return "ULTRA"
    if cores >= 6:
        return "HIGH"
    return "MEDIUM"

func apply_profile(profile_name: String) -> void:
    if not PROFILES.has(profile_name):
        profile_name = "MEDIUM"
    active_name = profile_name
    profile = PROFILES[profile_name].duplicate(true)
    if mode == "BATTERY SAVER":
        profile.traffic *= 0.6
        profile.vegetation *= 0.6
        profile.resolution_scale = minf(float(profile.resolution_scale), 0.76)
    elif mode == "PERFORMANCE":
        profile.resolution_scale = minf(float(profile.resolution_scale), 0.86)
        profile.particles = false
    RoadfallSave.set_setting("quality", active_name)
    profile_changed.emit(active_name)

func set_mode(new_mode: String) -> void:
    mode = new_mode
    RoadfallSave.set_setting("performance_mode", mode)
    apply_profile(active_name)

func _process(delta: float) -> void:
    elapsed += delta
    samples += 1
    if elapsed < 4.0:
        return
    var fps := float(samples) / elapsed
    if fps < 25.0 and active_name != "LOW":
        thermal_limiter = true
        profile.resolution_scale = maxf(0.65, float(profile.resolution_scale) - 0.08)
        profile.shadow_distance = maxf(28.0, float(profile.shadow_distance) - 15.0)
    elif fps > float(profile.target_fps) + 12.0 and not thermal_limiter and active_name == "MEDIUM":
        # Conservative promotion; never destabilize a mobile session.
        if not OS.has_feature("mobile"):
            apply_profile("HIGH")
    samples = 0
    elapsed = 0.0

func label() -> String:
    return "%s · %s · %d FPS" % [active_name, mode, int(profile.target_fps)]
