extends Node
## Scene flow and process-wide state. Also boots the headless dedicated server (--server).

var match_cfg := {}
var current_match: Match
var last_results := {}
var dedicated := false
var server_port := 7777
var autoplay := ""          # CI helpers: "tour" (screenshots), "bench" (performance)
var menu_notice := ""
var menu_mode := "br_squad"
var menu_net := "offline"
var menu_ranked := false

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	var args := OS.get_cmdline_args() + OS.get_cmdline_user_args()
	for a in args:
		if a == "--server":
			dedicated = true
		elif a.begins_with("--port="):
			server_port = int(a.substr(7))
		elif a.begins_with("--autoplay="):
			autoplay = a.substr(11)

func start_match(cfg: Dictionary) -> void:
	match_cfg = cfg
	get_tree().change_scene_to_file("res://scenes/match.tscn")

func start_offline(mode: String, extra := {}) -> void:
	var cfg := {"mode": mode, "net": "offline", "local_peer": 1, "seed": randi(), "bots": true,
		"building": Settings.get_v("building"), "difficulty": Settings.get_v("difficulty"),
		"players": [{"peer": 1, "name": Profile.player_name(), "team": -1, "cos": Profile.equip_dict()}]}
	cfg.merge(extra, true)
	start_match(cfg)

## Called when the local player leaves a match (results screen, spectate exit, or disconnect).
func finish_match(m: Match) -> void:
	if m and not m.has_meta("recorded"):
		m.set_meta("recorded", true)
		var res := m.local_result()
		if not res.is_empty() and (m.match_ended or res.get("kind", "") == "br" or res.get("kind", "") == "training"):
			var rewards := Profile.record_match(res)
			last_results = {"res": res, "rewards": rewards}
			var names := []
			for id in m.actors:
				var a: Actor = m.actors[id]
				if not a.is_bot and a.id != m.local_id:
					names.append(a.name)
			if names.size() > 0:
				Profile.add_recent(names, str(res.get("mode", "")))
	current_match = null
	if Net.role == "host" and m and not m.match_ended:
		Net.leave()
	back_to_menu()

func back_to_menu() -> void:
	get_tree().paused = false
	get_tree().change_scene_to_file("res://scenes/main_menu.tscn")

func connection_lost() -> void:
	menu_notice = "Connection lost. The match could not continue."
	if current_match:
		finish_match(current_match)
	else:
		back_to_menu()
