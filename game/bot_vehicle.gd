class_name RoadfallBotVehicle
extends RoadfallVehicle

var bot_index := 0
var skill := 0.5
var route_style := "FAST"
var target := Vector3.ZERO
var think_time := 0.0
var mistake_time := 0.0
var destination_index := 0
var bot_rng := RandomNumberGenerator.new()

func configure_bot(owner_game: Node, owner_world: RoadfallWorldStream, data: Dictionary, index: int, skill_value: float) -> void:
    bot_index = index
    skill = skill_value
    bot_rng.seed = 1000 + index * 931
    route_style = ["FAST", "SAFE", "OFF-ROAD", "RISKY SHORTCUT"][bot_rng.randi_range(0, 3)]
    super.configure(owner_game, owner_world, data, false)

func set_target(position: Vector3, checkpoint_index: int) -> void:
    target = position
    destination_index = checkpoint_index

func _process(delta: float) -> void:
    if is_eliminated or target == Vector3.ZERO or game == null or game.match_paused:
        return
    think_time -= delta
    mistake_time = maxf(0.0, mistake_time - delta)
    if think_time <= 0.0:
        think_time = 0.18 + bot_rng.randf_range(0.0, 0.25)
        var desired := target - global_position
        desired.y = 0.0
        if desired.length_squared() > 4.0:
            var desired_yaw := atan2(-desired.x, -desired.z)
            var diff := wrapf(desired_yaw - rotation.y, -PI, PI)
            var steer := clampf(diff * 1.75, -1.0, 1.0)
            var throttle := 1.0
            if absf(diff) > 0.8:
                throttle = 0.55
            if route_style == "SAFE":
                throttle *= 0.91
            elif route_style == "RISKY SHORTCUT":
                throttle *= 1.06
            if mistake_time > 0.0:
                steer *= -0.45
                throttle = 0.35
            input_override = {"throttle":clampf(throttle, 0.0, 1.0), "brake":0.0, "steer":steer, "handbrake":absf(diff) > 1.45, "boost":drive_speed > 18.0 and bot_rng.randf() > 0.96}
            if bot_rng.randf() < (0.012 - skill * 0.006) * 0.25:
                mistake_time = bot_rng.randf_range(0.6, 2.0)

func bot_progress_score() -> float:
    if target == Vector3.ZERO:
        return 0.0
    var distance := global_position.distance_to(target)
    return float(destination_index) * 100000.0 - distance + drive_speed * skill * 12.0
