extends Node
## Root of match.tscn: builds the Match, camera, controller and HUD from Game.match_cfg.

var m: Match
var pc: PlayerController
var hud: HUD
var cam: Camera3D

func _ready() -> void:
	get_tree().root.theme = UI.build_theme()
	m = Match.new()
	m.name = "Match"
	add_child(m)
	Game.current_match = m
	m.setup(Game.match_cfg)
	cam = Camera3D.new()
	cam.name = "Camera"
	m.add_child(cam)
	cam.current = true
	pc = PlayerController.new()
	pc.name = "Controller"
	add_child(pc)
	pc.setup(m, cam)
	m.controller = pc
	hud = HUD.new()
	hud.name = "HUD"
	add_child(hud)
	hud.setup(m, pc)
	m.hud = hud
	var a := m.local_actor()
	if a:
		cam.global_position = a.pos + Vector3(0, 3, 4)
	if Game.autoplay in ["tour", "bench"]:
		var ap: Node = load("res://tests/autoplay.gd").new()
		ap.name = "Autoplay"
		add_child(ap)
		ap.call("start", self)

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_PAUSED and m and m.net_role == "offline":
		pass
