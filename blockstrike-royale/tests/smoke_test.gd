extends Node
## Runtime smoke test: loads the menu, then a real match, lets bots act for a while and
## checks that the match reaches the live state and that core systems respond.
## Run with:  godot --headless --path . res://tests/smoke.tscn
## Script errors are printed by Godot; a clean run prints "SMOKE PASS".

const MAX_FRAMES := 5600
var _is_training := false
var _ui_done := false
const BD := preload("res://scripts/world/block_defs.gd")

var _menu
var _match
var _frames := 0
var _phase := "menu"
var _errors: Array = []
var _start_alive := 0
var _prev_alive: Dictionary = {}
var _pending_build := -1
var _deaths := {"zone": 0, "fall": 0, "shot": 0}


func _ready() -> void:
	_is_training = "training" in OS.get_cmdline_user_args()
	Game.current_mode = "training" if "training" in OS.get_cmdline_user_args() else "br_solo"
	var menu_scene: PackedScene = load("res://scenes/main.tscn")
	_menu = menu_scene.instantiate()
	add_child(_menu)
	for s in ["play", "modes", "rooms", "shop", "inventory", "missions", "ranked", "friends", "settings"]:
		_menu._show(s)
	print("SMOKE menu screens built")
	_menu.queue_free()
	_phase = "match"
	call_deferred("_start_match")


func _start_match() -> void:
	var match_scene: PackedScene = load("res://scenes/match.tscn")
	_match = match_scene.instantiate()
	add_child(_match)


var _last_ms := 0


func _process(_delta: float) -> void:
	_frames += 1
	if _frames % 900 == 0 and _match != null and _match.state == "live":
		print("SMOKE zone phase=%d radius=%.1f shrinking=%s dps=%.1f supply=%d" % [_match.zone_phase, _match.zone_radius, str(_match.zone_shrinking), _match.zone_dps, _match._supply_roots.size()])
	if _frames % 60 == 0:
		var now := Time.get_ticks_msec()
		print("SMOKE tick frame=%d ms_per_frame=%.1f" % [_frames, float(now - _last_ms) / 60.0])
		_last_ms = now
	if _match == null:
		return
	if _frames % 300 == 0:
		print("SMOKE t=%d state=%s alive=%d/%d" % [_frames, _match.state, _count_alive(), _match._chars.size()])
	if _match.state == "live" and _start_alive == 0:
		_start_alive = _count_alive()
		_exercise_systems()
	_track_deaths()
	if _match.state == "live" and _frames == 400 and not _ui_done:
		_ui_done = true
		_match.toggle_pause()
		print("SMOKE paused=%s controls_enabled=%s" % [str(_match.paused), str(Controls.enabled)])
		_match.toggle_pause()
		_match.toggle_inventory()
		print("SMOKE inventory_open=%s controls_enabled=%s" % [str(_match.inventory_open), str(Controls.enabled)])
		if _is_training:
			print("SMOKE training_unlimited=%s" % str(_match.player.inv.unlimited_ammo and _match.player.inv.reserve_of(_match.player.current_weapon_id()) > 0))
		_match.toggle_inventory()
		if _match.player.alive:
			_match.player.use_heal()
	# the match is ended near the end of the run so the zone and supply drop are exercised first
	var end_at := 3000 if _is_training else MAX_FRAMES - 10
	if _frames == end_at and _match.state == "live":
		_match._end_match()
		print("SMOKE results_visible=%s" % str(_match.hud._results_panel.visible))
	if _pending_build == 4:
		var cam: Camera3D = _match.player.camera
		var c: Vector3 = cam.global_position
		_match.world.set_block(Vector3i(floori(c.x), floori(c.y), floori(c.z - 5.5)), BD.STONE)
	if _pending_build > 0:
		_pending_build -= 1
	elif _pending_build == 0:
		_pending_build = -1
		var ok: bool = _match.request_build(_match.player)
		print("SMOKE build_against_wall=%s blocks_left=%d" % [ok, _match.player.inv.items["blocks"]])
	if _match.state == "ended" or _frames >= MAX_FRAMES:
		_finish()


func _track_deaths() -> void:
	for c in _match._chars:
		var id: int = c.get_instance_id()
		var was_alive: bool = _prev_alive.get(id, true)
		if was_alive and not c.alive:
			var killer_name: String = c.last_attacker.display_name if c.last_attacker else "none"
			var cause := "shot"
			if c.global_position.y < -10.0:
				cause = "fall"
				_deaths["fall"] += 1
			elif c.last_attacker == null:
				cause = "zone"
				_deaths["zone"] += 1
			else:
				_deaths["shot"] += 1
			if _deaths["fall"] + _deaths["zone"] <= 6:
				print("SMOKE death %s cause=%s last_attacker=%s y=%.1f t=%d" % [c.display_name, cause, killer_name, c.global_position.y, _frames])
		_prev_alive[id] = c.alive


func _count_alive() -> int:
	var n := 0
	for c in _match._chars:
		if c.alive:
			n += 1
	return n


func _exercise_systems() -> void:
	var p = _match.player
	var pickups: Array = _match._pickups
	print("SMOKE live: characters=%d pickups=%d blocks=%d" % [_match._chars.size(), pickups.size(), _match.gen.spawn_points.size()])
	# teleport the player onto a loot pickup and collect it
	if not pickups.is_empty():
		var n = pickups[0]
		p.global_position = n.global_position + Vector3(0, 1.0, 0)
		var before := JSON.stringify(p.inv.items) + JSON.stringify(p.inv.ammo) + str(p.inv.slots)
		var got: bool = _match.try_pickup(p)
		var after := JSON.stringify(p.inv.items) + JSON.stringify(p.inv.ammo) + str(p.inv.slots)
		print("SMOKE pickup collected=%s changed=%s" % [got, before != after])
	# a wall is placed in front of the camera a few frames later, then the build is attempted
	_pending_build = 4
	# fire the current weapon once
	var fired: bool = p.try_fire(p.global_position + Vector3(0, 1.5, -20))
	print("SMOKE fire=%s" % fired)
	# bots should be able to see and reach each other
	var bot_moves := 0
	for c in _match._chars:
		if c != p and c.wish_dir.length() > 0.0:
			bot_moves += 1
	print("SMOKE bots_with_goal=%d" % bot_moves)


func _finish() -> void:
	# pass only if the UI checks ran and the match reached its expected end state
	var expected_state := "ended"
	var ok: bool = _match != null and _ui_done and _match.state == expected_state and _start_alive > 0
	print("SMOKE final state=%s frames=%d alive_at_live=%d kills=%d deaths=%s" % [
		_match.state if _match else "none", _frames, _start_alive, _match.player_kills if _match else -1, str(_deaths)])
	if ok:
		print("SMOKE PASS")
		get_tree().quit(0)
	else:
		print("SMOKE FAIL")
		get_tree().quit(1)
