extends Node
## LAN host side of the network test: hosts a LAN room, waits for a client, starts and plays.
##   godot --headless --path . res://tests/test_runner.tscn -- --suite=lanhost --port=7791
func run() -> bool:
	var port := 7791
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--port="):
			port = int(a.substr(7))
	var tree := get_tree()
	get_parent().remove_child(self)
	tree.root.add_child.call_deferred(self)
	await tree.process_frame
	await tree.process_frame
	Settings.data["lan_port"] = port
	var err := Net.host_lan({"mode": "arena_2v2", "bots": true})
	if err != "":
		print("host error ", err)
		get_tree().quit(1)
		return false
	print("LAN code ", Net.lan_code("127.0.0.1", port))
	var t := 0.0
	while Net.room.get("players", []).size() < 2 and t < 30.0:
		await get_tree().create_timer(0.2).timeout
		t += 0.2
	print("players in room: ", Net.room.get("players", []).size())
	Net.start_room_match()
	t = 0.0
	while (Game.current_match == null or Game.current_match.has_meta("hold") or Game.current_match.loading) and t < 90.0:
		await get_tree().create_timer(0.2).timeout
		t += 0.2
	var m := Game.current_match
	if m == null:
		print("FAIL no match")
		get_tree().quit(1)
		return false
	print("host match running: actors %d hold=%s" % [m.actors.size(), str(m.has_meta("hold"))])
	var remote: Actor = null
	for id in m.actors:
		var a: Actor = m.actors[id]
		if not a.is_bot and a.peer_id != 1:
			remote = a
	var p0 := remote.pos if remote else Vector3.ZERO
	await get_tree().create_timer(32.0).timeout
	var ok := remote != null and remote.pos.distance_to(p0) > 3.0
	print("host: remote player moved %.1f m on the host (seq %d)" % [remote.pos.distance_to(p0) if remote else -1.0, remote.last_seq if remote else -1])
	print("SUITE lanhost: %s" % ("PASS" if ok else "FAIL"))
	get_tree().quit(0 if ok else 1)
	return ok
