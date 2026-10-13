extends Node
## End-to-end network test (client side). Start a server first:
##   godot --headless --path . -- --server --port=7790
## then:  godot --headless --path . res://tests/test_runner.tscn -- --suite=net --port=7790 [--join=CODE] [--mode=arena_2v2]
## The client connects, creates (or joins) a room, starts the match, plays for a while with scripted input and
## checks that snapshots, events, prediction and server authority work.

var port := 7790
var mode := "arena_2v2"
var join_code := ""
var host := "127.0.0.1"
var lan_code := ""

func _args() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--port="):
			port = int(a.substr(7))
		elif a.begins_with("--mode="):
			mode = a.substr(7)
		elif a.begins_with("--join="):
			join_code = a.substr(7)
		elif a.begins_with("--host="):
			host = a.substr(7)
		elif a.begins_with("--lan="):
			lan_code = a.substr(6)

func run() -> bool:
	_args()
	# survive the scene change into the match
	var tree := get_tree()
	var runner := get_parent()
	runner.remove_child(self)
	tree.root.add_child.call_deferred(self)
	await tree.process_frame
	await tree.process_frame
	var ok: bool = await _client_flow()
	print("SUITE net: %s" % ("PASS" if ok else "FAIL"))
	get_tree().quit(0 if ok else 1)
	return ok

func _wait_until(cond: Callable, timeout: float) -> bool:
	var t := 0.0
	while not cond.call():
		await get_tree().create_timer(0.1).timeout
		t += 0.1
		if t > timeout:
			return false
	return true

func _client_flow() -> bool:
	var err := Net.join_code(lan_code) if lan_code != "" else Net.join(host, port)
	if err != "":
		print("join error ", err)
		return false
	if not await _wait_until(func(): return Net.connected and not Net.server_info.is_empty(), 10.0):
		print("FAIL: could not connect / no welcome")
		return false
	print("connected as peer ", Net.my_peer, " server: ", Net.server_info.get("server", ""))
	if lan_code != "":
		pass  # the LAN host puts us into its room automatically
	elif join_code == "":
		Net.create_room({"mode": mode, "bots": true, "building": true})
	else:
		Net.join_room(join_code)
	if not await _wait_until(func(): return not Net.room.is_empty(), 10.0):
		print("FAIL: no room")
		return false
	print("room ", Net.room["code"], " players ", Net.room["players"].size())
	if join_code == "" and lan_code == "":
		await get_tree().create_timer(4.0 if OS.has_environment("BSR_WAIT_SECOND") else 0.5).timeout
		Net.start_room_match()
	if not await _wait_until(func(): return Game.current_match != null and not Game.current_match.loading and Game.current_match.local_id >= 0, 90.0):
		print("FAIL: match did not start/load on the client")
		return false
	var m := Game.current_match
	print("match started: %d actors, local id %d" % [m.actors.size(), m.local_id])
	var me := m.local_actor()
	var start_pos := me.pos
	var snaps := [0]
	var events := {}
	m.hud_event.connect(func(t, _d): events[t] = int(events.get(t, 0)) + 1)
	var pc: PlayerController = m.controller
	var t := 0.0
	var max_err := 0.0
	while t < 25.0:
		await get_tree().create_timer(0.1).timeout
		t += 0.1
		if not is_instance_valid(pc) or Game.current_match != m:
			print("client: match scene left at t=%.1f notice='%s' role=%s connected=%s me.state=%d" % [t, Game.menu_notice, Net.role, str(Net.connected), me.state])
			return false
		if pc.touch:
			pc.touch.joy_active = true
			pc.touch.joy_vec = Vector2(sin(t * 0.7), 1.0).normalized()
			pc.touch.fire_down = int(t * 2.0) % 3 == 0
		pc.yaw += 0.02
		if not m.summary_cache.is_empty():
			snaps[0] += 1
	pc.touch.joy_active = false
	pc.touch.fire_down = false
	var moved := me.pos.distance_to(start_pos)
	print("client: moved %.1f m, hp %.0f, state %d, kills %d, snapshots-with-summary %d, pending cmds %d" % [moved, me.hp, me.state, me.kills, snaps[0], m.pending.size()])
	print("client: events seen ", events)
	print("client: ping %d ms, actors %d, loot %d, phase %s" % [Net.ping_ms(), m.actors.size(), m.loot.size(), str(m.summary_cache.get("ph", "?"))])
	var others_moved := 0
	for id in m.actors:
		var a: Actor = m.actors[id]
		if id != m.local_id and a.vel.length() > 0.1:
			others_moved += 1
	print("client: remote actors currently moving: ", others_moved)
	var ok: bool = moved > 3.0 and m.pending.size() < 30 and snaps[0] > 50
	Net.leave()
	return ok
