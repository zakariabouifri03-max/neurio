extends Node
## AudioDirector - buses, music and a bounded pool of sound players.
##
## Sounds are pooled so a firefight cannot spawn hundreds of AudioStreamPlayer
## nodes; when the pool is saturated the least important (quietest, farthest)
## request is dropped instead of stacking another voice.

const SFX_DIR := "res://assets/audio/"
const BUSES := {
	"Master": {"volume": 1.0, "send": ""},
	"Music": {"volume": 0.55, "send": "Master"},
	"SFX": {"volume": 0.9, "send": "Master"},
	"UI": {"volume": 0.8, "send": "Master"},
	"Voice": {"volume": 0.8, "send": "Master"},
}
const POOL_3D := 12
const POOL_UI := 4

var _streams: Dictionary = {}
var _pool_3d: Array[AudioStreamPlayer3D] = []
var _pool_ui: Array[AudioStreamPlayer] = []
var _music: AudioStreamPlayer
var _current_music: String = ""
var _missing_warned: Dictionary = {}

func _ready() -> void:
	_ensure_buses()
	_build_pool()
	_music = AudioStreamPlayer.new()
	_music.bus = "Music"
	_music.name = "MusicPlayer"
	add_child(_music)

func _ensure_buses() -> void:
	for bus_name: String in BUSES.keys():
		if AudioServer.get_bus_index(bus_name) != -1:
			continue
		if bus_name == "Master":
			continue
		AudioServer.add_bus()
		var index := AudioServer.get_bus_count() - 1
		AudioServer.set_bus_name(index, bus_name)
		AudioServer.set_bus_send(index, str(BUSES[bus_name]["send"]))

func _build_pool() -> void:
	for i: int in POOL_3D:
		var player := AudioStreamPlayer3D.new()
		player.bus = "SFX"
		player.max_distance = 90.0
		player.unit_size = 6.0
		player.attenuation_model = AudioStreamPlayer3D.ATTENUATION_INVERSE_DISTANCE
		player.name = "Sfx3D_%d" % i
		add_child(player)
		_pool_3d.append(player)
	for i: int in POOL_UI:
		var player := AudioStreamPlayer.new()
		player.bus = "UI"
		player.name = "SfxUi_%d" % i
		add_child(player)
		_pool_ui.append(player)

func stream_path(sound_name: String) -> String:
	return SFX_DIR + sound_name + ".wav"

## Loads (and caches) a sound.  Returns null when the asset is not imported yet,
## warning once per file so a missing import is obvious but not spammy.
func load_stream(sound_name: String) -> AudioStream:
	if _streams.has(sound_name):
		return _streams[sound_name]
	var path := stream_path(sound_name)
	if not ResourceLoader.exists(path):
		if not _missing_warned.has(path):
			_missing_warned[path] = true
			push_warning("AudioDirector: missing sound %s (run the Godot editor import step)" % path)
		_streams[sound_name] = null
		return null
	var resource: Resource = load(path)
	var stream := resource as AudioStream
	_streams[sound_name] = stream
	return stream

func play_sfx(sound_name: String, at_position: Vector3 = Vector3.ZERO,
			  volume_db: float = 0.0, use_position: bool = true, pitch: float = 1.0) -> void:
	var stream := load_stream(sound_name)
	if stream == null:
		return
	if not use_position:
		_play_ui_stream(stream, volume_db, pitch)
		return
	var player := _free_3d_player()
	if player == null:
		return
	player.stream = stream
	player.global_position = at_position
	player.volume_db = volume_db
	player.pitch_scale = clampf(pitch, 0.4, 2.5)
	player.play()

func play_ui(sound_name: String, volume_db: float = 0.0, pitch: float = 1.0) -> void:
	var stream := load_stream(sound_name)
	if stream == null:
		return
	_play_ui_stream(stream, volume_db, pitch)

func _play_ui_stream(stream: AudioStream, volume_db: float, pitch: float) -> void:
	for player: AudioStreamPlayer in _pool_ui:
		if not player.playing:
			player.stream = stream
			player.volume_db = volume_db
			player.pitch_scale = pitch
			player.play()
			return
	var fallback: AudioStreamPlayer = _pool_ui[0]
	fallback.stream = stream
	fallback.volume_db = volume_db
	fallback.pitch_scale = pitch
	fallback.play()

func _free_3d_player() -> AudioStreamPlayer3D:
	for player: AudioStreamPlayer3D in _pool_3d:
		if not player.playing:
			return player
	return null

func play_music(sound_name: String, fade_time: float = 0.8) -> void:
	if _current_music == sound_name:
		return
	var stream := load_stream(sound_name)
	if stream == null:
		return
	_current_music = sound_name
	_music.stream = stream
	_music.volume_db = -12.0
	_music.play()
	var tween := create_tween()
	tween.tween_property(_music, "volume_db", 0.0, maxf(0.05, fade_time))

func stop_music(fade_time: float = 0.6) -> void:
	_current_music = ""
	if not _music.playing:
		return
	var tween := create_tween()
	tween.tween_property(_music, "volume_db", -40.0, maxf(0.05, fade_time))
	tween.tween_callback(_music.stop)

func current_music() -> String:
	return _current_music

## Applies the audio settings block; called on load and on every change.
func apply_audio_settings(settings: Dictionary) -> void:
	var muted: bool = bool(settings.get("muted", false))
	for bus_name: String in BUSES.keys():
		var index := AudioServer.get_bus_index(bus_name)
		if index == -1:
			continue
		var linear: float = 1.0
		match bus_name:
			"Master":
				linear = float(settings.get("master", 1.0))
			"Music":
				linear = float(settings.get("music", 0.6))
			"SFX":
				linear = float(settings.get("sfx", 1.0))
			"UI":
				linear = float(settings.get("ui", 0.9))
			"Voice":
				linear = float(settings.get("voice", 0.9))
		var db := -80.0 if muted else linear_to_db(clampf(linear, 0.0001, 1.0))
		AudioServer.set_bus_volume_db(index, db)
		AudioServer.set_bus_mute(index, muted and bus_name != "Master")

## Stops every pooled sound (used when a match scene is torn down).
func stop_all() -> void:
	for player: AudioStreamPlayer3D in _pool_3d:
		player.stop()
	for player: AudioStreamPlayer in _pool_ui:
		player.stop()
