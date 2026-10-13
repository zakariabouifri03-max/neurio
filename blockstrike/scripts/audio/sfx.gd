extends Node
## Autoload "Sfx": original sound effects synthesised at startup.
##
## No audio files are shipped: every effect is generated as 16-bit PCM from
## simple oscillators and noise envelopes. Playback uses fixed-size pools so the
## number of simultaneous voices stays bounded.

const RATE := 22050
const POOL_3D := 12
const POOL_2D := 6

var _streams: Dictionary = {}
var _pool_3d: Array[AudioStreamPlayer3D] = []
var _pool_2d: Array[AudioStreamPlayer] = []
var _next_3d := 0
var _next_2d := 0
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	_rng.seed = 1337
	for i in POOL_3D:
		var p := AudioStreamPlayer3D.new()
		p.unit_size = 8.0
		p.max_distance = 90.0
		add_child(p)
		_pool_3d.append(p)
	for i in POOL_2D:
		var p2 := AudioStreamPlayer.new()
		add_child(p2)
		_pool_2d.append(p2)
	_build_streams()


func has_sound(sound_name: String) -> bool:
	return _streams.has(sound_name)


func play_3d(sound_name: String, position: Vector3, volume_db: float = 0.0) -> void:
	if not _streams.has(sound_name) or _is_muted():
		return
	var p := _pool_3d[_next_3d]
	_next_3d = (_next_3d + 1) % POOL_3D
	p.stream = _streams[sound_name]
	p.global_position = position
	p.volume_db = volume_db + _base_db()
	p.play()


func play_ui(sound_name: String, volume_db: float = 0.0) -> void:
	if not _streams.has(sound_name) or _is_muted():
		return
	var p := _pool_2d[_next_2d]
	_next_2d = (_next_2d + 1) % POOL_2D
	p.stream = _streams[sound_name]
	p.volume_db = volume_db + _base_db()
	p.play()


func _is_muted() -> bool:
	return bool(AppSettings.get_value("muted"))


func _base_db() -> float:
	var v := float(AppSettings.get_value("sfx_volume"))
	return linear_to_db(maxf(v, 0.0001))


func _build_streams() -> void:
	_streams["gunshot"] = _make(0.30, func(t: float) -> float:
		var noise := _rng.randf() * 2.0 - 1.0
		var crack := noise * exp(-t * 85.0)
		var body := noise * 0.55 * exp(-t * 16.0)
		var thump := sin(TAU * (80.0 - 35.0 * t) * t) * exp(-t * 11.0) * 0.9
		return crack * 0.9 + body + thump * 0.8)
	_streams["dry_click"] = _make(0.07, func(t: float) -> float:
		return (_rng.randf() * 2.0 - 1.0) * 0.35 * exp(-t * 140.0) + sin(TAU * 1800.0 * t) * exp(-t * 220.0) * 0.35)
	_streams["reload_click"] = _make(0.16, func(t: float) -> float:
		var a := sin(TAU * 2400.0 * t) * exp(-t * 320.0)
		var t2 := t - 0.085
		var b := sin(TAU * 1700.0 * t2) * exp(-t2 * 300.0) if t2 > 0.0 else 0.0
		return (a + b) * 0.4)
	_streams["impact"] = _make(0.10, func(t: float) -> float:
		return (_rng.randf() * 2.0 - 1.0) * exp(-t * 60.0) * 0.5 + sin(TAU * 620.0 * t) * exp(-t * 45.0) * 0.25)
	_streams["hit"] = _make(0.14, func(t: float) -> float:
		return sin(TAU * (950.0 - 500.0 * t) * t) * exp(-t * 22.0) * 0.55)
	_streams["footstep"] = _make(0.09, func(t: float) -> float:
		return (_rng.randf() * 2.0 - 1.0) * exp(-t * 48.0) * 0.22)
	_streams["jump"] = _make(0.20, func(t: float) -> float:
		return sin(TAU * (260.0 + 500.0 * t) * t) * exp(-t * 9.0) * 0.4)
	_streams["land"] = _make(0.22, func(t: float) -> float:
		return (sin(TAU * (90.0 - 40.0 * t) * t) * exp(-t * 18.0) * 0.7
			+ (_rng.randf() * 2.0 - 1.0) * exp(-t * 55.0) * 0.2))
	_streams["eliminated"] = _make(0.55, func(t: float) -> float:
		var note := int(t / 0.14)
		var freq: float = [392.0, 523.25, 659.25, 784.0][clampi(note, 0, 3)]
		var local := fmod(t, 0.14)
		return sin(TAU * freq * t) * exp(-local * 14.0) * 0.4)
	_streams["victory"] = _make(0.9, func(t: float) -> float:
		var note := int(t / 0.18)
		var freq: float = [523.25, 659.25, 783.99, 1046.5][clampi(note, 0, 3)]
		var local := fmod(t, 0.18)
		return (sin(TAU * freq * t) + 0.3 * sin(TAU * freq * 2.0 * t)) * exp(-local * 6.0) * 0.35)
	_streams["ui_click"] = _make(0.04, func(t: float) -> float:
		return sin(TAU * 1500.0 * t) * exp(-t * 130.0) * 0.3)


func _make(duration: float, sample_fn: Callable) -> AudioStreamWAV:
	var count := int(duration * RATE)
	var data := PackedByteArray()
	data.resize(count * 2)
	for i in range(count):
		var t := float(i) / RATE
		var v := clampf(float(sample_fn.call(t)), -1.0, 1.0)
		data.encode_s16(i * 2, int(v * 30000.0))
	var s := AudioStreamWAV.new()
	s.format = AudioStreamWAV.FORMAT_16_BITS
	s.mix_rate = RATE
	s.stereo = false
	s.data = data
	return s
