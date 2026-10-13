extends Node
## Tiny procedural sound bank. It keeps the prototype self-contained while still giving weapons,
## impacts and UI feedback readable audio on phones with no downloaded audio assets.

const SAMPLE_RATE := 22050
var muted := false

func play_shot() -> void:
	_play_tone(170.0, 0.075, 0.16, 0.72, true)

func play_hit() -> void:
	_play_tone(420.0, 0.06, 0.12, 0.45, false)

func play_reload() -> void:
	_play_tone(260.0, 0.12, 0.11, 0.4, false)
	await get_tree().create_timer(0.11).timeout
	_play_tone(520.0, 0.16, 0.1, 0.35, false)

func play_click() -> void:
	_play_tone(720.0, 0.035, 0.08, 0.2, false)

func play_victory() -> void:
	_play_tone(392.0, 0.12, 0.1, 0.45, false)
	await get_tree().create_timer(0.1).timeout
	_play_tone(523.0, 0.16, 0.1, 0.42, false)
	await get_tree().create_timer(0.13).timeout
	_play_tone(784.0, 0.26, 0.09, 0.35, false)

func _play_tone(start_frequency: float, duration: float, volume: float, sweep: float, noise: bool) -> void:
	if muted:
		return
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = SAMPLE_RATE
	stream.stereo = false
	var frames := maxi(1, int(duration * SAMPLE_RATE))
	var bytes := PackedByteArray()
	bytes.resize(frames * 2)
	for i in range(frames):
		var progress := float(i) / float(frames)
		var frequency := start_frequency * (1.0 + sweep * progress)
		var sample := sin(TAU * frequency * float(i) / float(SAMPLE_RATE))
		if noise:
			sample = sample * 0.68 + randf_range(-1.0, 1.0) * 0.32
		var envelope := minf(progress * 30.0, 1.0) * minf((1.0 - progress) * 12.0, 1.0)
		bytes.encode_s16(i * 2, int(clampf(sample * volume * envelope, -1.0, 1.0) * 32767.0))
	stream.data = bytes
	var player := AudioStreamPlayer.new()
	player.stream = stream
	add_child(player)
	player.finished.connect(player.queue_free)
	player.play()
