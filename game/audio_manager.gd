class_name RoadfallAudioManager
extends Node

## One lightweight generated bus keeps the slice asset-free while preserving the
## same adaptive audio API a production mixer can route to streamed OGG tracks.

var engine_player: AudioStreamPlayer
var engine_stream: AudioStreamGenerator
var phase := 0.0
var engine_rpm := 900.0
var engine_throttle := 0.0
var weather := "CLEAR"
var enabled := true

func configure() -> void:
    engine_stream = AudioStreamGenerator.new()
    engine_stream.mix_rate = 22050.0
    engine_stream.buffer_length = 0.18
    engine_player = AudioStreamPlayer.new()
    engine_player.stream = engine_stream
    engine_player.volume_db = -18.0
    add_child(engine_player)
    engine_player.play()

func update_vehicle(rpm: float, throttle: float, speed: float) -> void:
    engine_rpm = rpm
    engine_throttle = throttle
    if not enabled or engine_player == null:
        return
    var playback := engine_player.get_stream_playback() as AudioStreamGeneratorPlayback
    if playback == null:
        return
    var frames := mini(256, playback.get_frames_available())
    var frequency := 34.0 + engine_rpm * 0.018
    var gain := 0.025 + engine_throttle * 0.05 + minf(speed / 100.0, 0.025)
    for i in range(frames):
        phase += TAU * frequency / engine_stream.mix_rate
        var sample := sin(phase) * gain + sin(phase * 2.03) * gain * 0.22
        playback.push_frame(Vector2(sample, sample))

func play_ui_click() -> void:
    # UI audio is intentionally routed through the same generated bus.
    engine_throttle = minf(1.0, engine_throttle + 0.12)

func set_weather(next_weather: String) -> void:
    weather = next_weather
