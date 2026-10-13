extends Node
## Procedurally synthesised sound effects (no audio files, no licensing issues).
## Sounds are generated once at startup as 16-bit mono AudioStreamWAV resources.

const MIX_RATE := 22050
const POOL_2D := 10
const POOL_3D := 16

var _streams: Dictionary = {}
var _players_2d: Array = []
var _players_3d: Array = []
var _next_2d := 0
var _next_3d := 0
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	_rng.seed = 7
	_build_all()
	for i in POOL_2D:
		var p := AudioStreamPlayer.new()
		add_child(p)
		_players_2d.append(p)
	for i in POOL_3D:
		var p3 := AudioStreamPlayer3D.new()
		p3.unit_size = 9.0
		p3.max_distance = 140.0
		add_child(p3)
		_players_3d.append(p3)


func has_sound(sound_name: String) -> bool:
	return _streams.has(sound_name)


func play(sound_name: String, volume_db: float = 0.0, pitch: float = 1.0) -> void:
	if not _streams.has(sound_name) or _players_2d.is_empty():
		return
	var p: AudioStreamPlayer = _players_2d[_next_2d]
	_next_2d = (_next_2d + 1) % _players_2d.size()
	p.stream = _streams[sound_name]
	p.volume_db = volume_db
	p.pitch_scale = pitch
	p.play()


func play_at(sound_name: String, pos: Vector3, volume_db: float = 0.0, pitch: float = 1.0) -> void:
	if not _streams.has(sound_name) or _players_3d.is_empty():
		return
	var p: AudioStreamPlayer3D = _players_3d[_next_3d]
	_next_3d = (_next_3d + 1) % _players_3d.size()
	p.stream = _streams[sound_name]
	p.volume_db = volume_db
	p.pitch_scale = pitch
	p.global_position = pos
	p.play()


# ---------------------------------------------------------------- synthesis
func _build_all() -> void:
	_streams["shot_rifle"] = _shot(0.22, 24.0, 0.32, 95.0)
	_streams["shot_smg"] = _shot(0.13, 34.0, 0.45, 150.0)
	_streams["shot_pistol"] = _shot(0.16, 30.0, 0.4, 120.0)
	_streams["shot_shotgun"] = _shot(0.42, 11.0, 0.18, 70.0)
	_streams["shot_sniper"] = _shot(0.5, 8.0, 0.14, 60.0)
	_streams["dry"] = _shot(0.05, 60.0, 0.9, 0.0)
	_streams["reload"] = _reload_clicks()
	_streams["switch"] = _shot(0.07, 40.0, 0.6, 0.0)
	_streams["hit"] = _tone(0.09, 880.0, 440.0, 0.35, 30.0)
	_streams["headshot"] = _tone(0.22, 1480.0, 1480.0, 0.4, 12.0)
	_streams["hurt"] = _tone(0.22, 180.0, 90.0, 0.45, 9.0)
	_streams["pickup"] = _arpeggio([523.0, 659.0, 784.0], 0.07, 0.3)
	_streams["heal"] = _arpeggio([392.0, 523.0, 659.0, 784.0], 0.08, 0.28)
	_streams["build"] = _shot(0.2, 14.0, 0.12, 60.0)
	_streams["explode"] = _explosion(1.4)
	_streams["step"] = _shot(0.07, 30.0, 0.15, 0.0)
	_streams["ui"] = _tone(0.05, 1000.0, 1000.0, 0.25, 40.0)
	_streams["zone_warn"] = _tone(0.35, 440.0, 440.0, 0.35, 4.0)
	_streams["win"] = _arpeggio([523.0, 659.0, 784.0, 1046.0], 0.16, 0.35)
	_streams["lose"] = _arpeggio([392.0, 330.0, 262.0], 0.2, 0.35)


func _to_stream(samples: PackedFloat32Array) -> AudioStreamWAV:
	var bytes := PackedByteArray()
	bytes.resize(samples.size() * 2)
	for i in samples.size():
		var v := int(clampf(samples[i], -1.0, 1.0) * 32000.0)
		bytes.encode_s16(i * 2, v)
	var st := AudioStreamWAV.new()
	st.format = AudioStreamWAV.FORMAT_16_BITS
	st.mix_rate = MIX_RATE
	st.stereo = false
	st.data = bytes
	return st


## Gunshot-like burst: filtered noise + a short low thump.
func _shot(length: float, decay: float, lowpass: float, thump_hz: float) -> AudioStreamWAV:
	var n := int(length * MIX_RATE)
	var out := PackedFloat32Array()
	out.resize(n)
	var lp := 0.0
	for i in n:
		var t := float(i) / MIX_RATE
		var noise := _rng.randf_range(-1.0, 1.0)
		lp += (noise - lp) * lowpass
		var env := exp(-t * decay)
		var s := lp * env
		if thump_hz > 0.0:
			s += sin(TAU * thump_hz * t) * exp(-t * decay * 2.2) * 0.9
		out[i] = s * 0.85
	return _to_stream(out)


func _reload_clicks() -> AudioStreamWAV:
	var n := int(0.7 * MIX_RATE)
	var out := PackedFloat32Array()
	out.resize(n)
	for i in n:
		var t := float(i) / MIX_RATE
		var s := 0.0
		for start in [0.0, 0.42]:
			var lt: float = t - float(start)
			if lt >= 0.0 and lt < 0.06:
				s += sin(TAU * 1800.0 * lt) * exp(-lt * 90.0) * 0.6
		out[i] = s
	return _to_stream(out)


func _tone(length: float, f0: float, f1: float, amp: float, decay: float) -> AudioStreamWAV:
	var n := int(length * MIX_RATE)
	var out := PackedFloat32Array()
	out.resize(n)
	var phase := 0.0
	for i in n:
		var t := float(i) / MIX_RATE
		var f := lerpf(f0, f1, t / length)
		phase += TAU * f / MIX_RATE
		out[i] = sin(phase) * exp(-t * decay) * amp
	return _to_stream(out)


func _arpeggio(freqs: Array, note_len: float, amp: float) -> AudioStreamWAV:
	var n := int(note_len * freqs.size() * MIX_RATE)
	var out := PackedFloat32Array()
	out.resize(n)
	var phase := 0.0
	for i in n:
		var t := float(i) / MIX_RATE
		var idx := mini(int(t / note_len), freqs.size() - 1)
		var lt := fmod(t, note_len)
		phase += TAU * float(freqs[idx]) / MIX_RATE
		out[i] = sin(phase) * exp(-lt * 14.0) * amp
	return _to_stream(out)


func _explosion(length: float) -> AudioStreamWAV:
	var n := int(length * MIX_RATE)
	var out := PackedFloat32Array()
	out.resize(n)
	var lp := 0.0
	for i in n:
		var t := float(i) / MIX_RATE
		lp += (_rng.randf_range(-1.0, 1.0) - lp) * 0.08
		var s := lp * exp(-t * 3.2) * 1.1
		s += sin(TAU * (60.0 - 25.0 * t) * t) * exp(-t * 4.0) * 0.9
		out[i] = s
	return _to_stream(out)
