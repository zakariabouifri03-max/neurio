class_name RoadfallMatchDirector
extends Node

signal match_started
signal destination_changed(destination: Dictionary, index: int, total: int)
signal match_event_changed(weather: String, event_name: String)
signal match_finished(result: Dictionary)
signal inventory_changed

var game: Node
var world: RoadfallWorldStream
var root_3d: Node3D
var player: RoadfallVehicle
var bots: Array[RoadfallBotVehicle] = []
var pickups: Array[RoadfallLootPickup] = []
var destinations: Array = []
var current_destination := 0
var destination_time := RoadfallData.CHECKPOINT_TIME
var state := "COUNTDOWN"
var countdown := 3.0
var match_time := 0.0
var final_run := false
var event_time := 18.0
var rng := RandomNumberGenerator.new()
var bot_destination: Array[int] = []
var bot_laps: Array[int] = []
var finish_position := 50
var winner_name := ""
var active_weather := "CLEAR"
var active_event := ""
var _finish_sent := false

func configure(owner_game: Node, owner_world: RoadfallWorldStream, scene_root: Node3D) -> void:
    game = owner_game
    world = owner_world
    root_3d = scene_root

func start_match() -> void:
    rng.randomize()
    state = "COUNTDOWN"
    countdown = 3.0
    match_time = 0.0
    destination_time = RoadfallData.CHECKPOINT_TIME
    current_destination = 0
    final_run = false
    _finish_sent = false
    active_weather = "CLEAR"
    active_event = ""
    _choose_destinations()
    _clear_racers()
    _spawn_racers()
    _spawn_pickups()
    _spawn_traffic()
    _announce_destination()
    match_started.emit()

func _choose_destinations() -> void:
    var pool := RoadfallData.DESTINATIONS.duplicate(true)
    pool.shuffle()
    destinations.clear()
    # City is always the launch region, then each match gets a different route.
    destinations.append(RoadfallData.DESTINATIONS[0].duplicate(true))
    for item in pool:
        if item.id != "city" and destinations.size() < 6:
            destinations.append(item.duplicate(true))
    destinations.append({"id":"final", "name":"FINAL RUN", "pos":Vector3(900, 0, 420), "kind":"finish"})

func _clear_racers() -> void:
    if root_3d == null:
        return
    for child in root_3d.get_children():
        child.queue_free()
    bots.clear()
    pickups.clear()
    bot_destination.clear()
    bot_laps.clear()

func _spawn_racers() -> void:
    var player_data := RoadfallData.vehicle_by_id(str(RoadfallSave.profile.get("selected_vehicle", "street")))
    player = RoadfallVehicle.new()
    player.name = "PLAYER_RIDER"
    root_3d.add_child(player)
    player.global_position = Vector3(0, 1.4, 75)
    player.rotation.y = PI
    player.configure(game, world, player_data, true)
    for i in range(RoadfallData.MAX_COMPETITORS - 1):
        var data := RoadfallData.VEHICLES[(i + 1) % RoadfallData.VEHICLES.size()].duplicate(true)
        var bot := RoadfallBotVehicle.new()
        bot.name = "BOT_%02d" % (i + 1)
        root_3d.add_child(bot)
        var row := i / 5
        var col := (i % 5) - 2
        bot.global_position = Vector3(col * 4.2, 1.4, 105 + row * 8)
        bot.rotation.y = PI
        bot.configure_bot(game, world, data, i, 0.38 + float(i % 11) * 0.055)
        bot.set_target(destinations[0].pos, 0)
        bots.append(bot)
        bot_destination.append(0)
        bot_laps.append(0)

func _spawn_pickups() -> void:
    for i in range(34):
        var destination: Dictionary = destinations[(i % maxi(1, destinations.size() - 1))]
        var angle := float(i) * 2.399 + rng.randf_range(-0.25, 0.25)
        var radius := 40.0 + float((i * 37) % 180)
        var position := destination.pos + Vector3(cos(angle) * radius, 0.0, sin(angle) * radius)
        var pickup := RoadfallLootPickup.new()
        root_3d.add_child(pickup)
        var item: Dictionary = RoadfallData.LOOT[rng.randi_range(0, RoadfallData.LOOT.size() - 1)].duplicate(true)
        pickup.configure(self, item, position)
        pickups.append(pickup)

func _spawn_traffic() -> void:
    var traffic_count := int(8.0 * float(game.quality.profile.get("traffic", 0.65)))
    for i in range(traffic_count):
        var car := RoadfallTraffic.new()
        root_3d.add_child(car)
        var x := -250.0 + float(i) * 61.0
        car.configure(Vector3(x, 0, 0), Vector3.RIGHT if i % 2 == 0 else Vector3.LEFT, Color.from_hsv(float(i) / maxf(1, traffic_count), 0.58, 0.9), 7.0 + (i % 4) * 1.8)

func _process(delta: float) -> void:
    if state == "FINISHED" or game == null:
        return
    if game.match_paused:
        return
    if state == "COUNTDOWN":
        countdown -= delta
        if countdown <= 0.0:
            state = "RACE"
            match_started.emit()
        return
    match_time += delta
    destination_time -= delta
    event_time -= delta
    if event_time <= 0.0:
        _roll_event()
        event_time = 22.0 + rng.randf_range(0.0, 14.0)
    if destination_time <= 0.0:
        _eliminate_late_competitors()
        if player and not player.is_eliminated:
            _finish_match(false, "TIMEOUT")
            return
    _update_bots(delta)
    if player == null or player.is_eliminated:
        _finish_match(false, "VEHICLE LOST")
        return
    if player.global_position.distance_to(destinations[current_destination].pos) < (270.0 if not final_run else 180.0):
        _reach_destination()

func _update_bots(_delta: float) -> void:
    for i in range(bots.size()):
        var bot := bots[i]
        if bot == null or bot.is_eliminated:
            continue
        var index := bot_destination[i]
        if index >= destinations.size():
            continue
        var target: Vector3 = destinations[index].pos
        if bot.global_position.distance_to(target) < 280.0:
            bot_destination[i] += 1
            if bot_destination[i] >= destinations.size():
                bot.is_eliminated = true
                continue
            bot.set_target(destinations[bot_destination[i]].pos, bot_destination[i])
        if destination_time <= 0.0 and bot_destination[i] < current_destination:
            bot.is_eliminated = true

func _eliminate_late_competitors() -> void:
    for i in range(bots.size()):
        if not bots[i].is_eliminated and bot_destination[i] < current_destination:
            bots[i].is_eliminated = true

func _reach_destination() -> void:
    RoadfallSave.profile.challenges.destinations += 1
    if current_destination >= destinations.size() - 1:
        final_run = true
        _finish_match(true, "FINISH LINE")
        return
    current_destination += 1
    destination_time = RoadfallData.FINAL_TIME if current_destination == destinations.size() - 1 else RoadfallData.CHECKPOINT_TIME
    final_run = current_destination == destinations.size() - 1
    _announce_destination()

func _announce_destination() -> void:
    if current_destination >= destinations.size():
        return
    destination_changed.emit(destinations[current_destination], current_destination, destinations.size())

func _roll_event() -> void:
    active_event = RoadfallData.EVENTS[rng.randi_range(0, RoadfallData.EVENTS.size() - 1)]
    active_weather = RoadfallData.WEATHER[rng.randi_range(0, RoadfallData.WEATHER.size() - 1)]
    world.set_weather(active_weather)
    world.set_event(active_event)
    match_event_changed.emit(active_weather, active_event)

func collect_loot(pickup: RoadfallLootPickup, collector: RoadfallVehicle) -> bool:
    if collector != player or collector.is_eliminated:
        return false
    var item := pickup.item.duplicate(true)
    if not game.add_inventory_item(item):
        return false
    RoadfallSave.profile.challenges.loot_collected += 1
    match_event_changed.emit(active_weather, "LOOT: %s" % item.name.to_upper())
    return true

func use_inventory_item(index: int) -> String:
    var inventory: Array = RoadfallSave.profile.inventory
    if index < 0 or index >= inventory.size() or player == null:
        return ""
    var item: Dictionary = inventory[index]
    var stat := str(item.get("stat", ""))
    var amount := float(item.get("amount", 0.0))
    match stat:
        "accel": player.upgrade_stats.accel += amount
        "grip": player.upgrade_stats.grip += amount
        "brake": player.upgrade_stats.brake += amount
        "offroad": player.upgrade_stats.offroad += amount
        "boost": player.boost_left = maxf(player.boost_left, amount)
        "armor": player.upgrade_stats.armor += amount / 100.0
        "repair": player.health = minf(100.0, player.health + amount)
        "scanner":
            match_event_changed.emit(active_weather, "SCANNER: ROUTE REVEALED")
    inventory.remove_at(index)
    RoadfallSave.save_profile()
    inventory_changed.emit()
    return str(item.name)

func _finish_match(player_finished: bool, reason: String) -> void:
    if _finish_sent:
        return
    _finish_sent = true
    state = "FINISHED"
    var player_score := float(current_destination) * 100000.0 + (100000.0 - player.global_position.distance_to(destinations[current_destination].pos))
    var ahead := 0
    for i in range(bots.size()):
        if not bots[i].is_eliminated and bots[i].bot_progress_score() > player_score:
            ahead += 1
    finish_position = clampi(ahead + 1, 1, RoadfallData.MAX_COMPETITORS)
    if not player_finished:
        finish_position = maxi(finish_position, 12)
    winner_name = RoadfallSave.profile.username if player_finished and finish_position == 1 else "NOVA BOT"
    var reward := RoadfallSave.award_match(finish_position, player_finished and finish_position == 1)
    var result := {"won": player_finished and finish_position == 1, "finished": player_finished, "place": finish_position, "total": RoadfallData.MAX_COMPETITORS, "reason": reason, "winner": winner_name, "reward": reward, "time": match_time, "weather": active_weather}
    match_finished.emit(result)

func scoreboard() -> Array:
    var rows: Array = [{"name":RoadfallSave.profile.username, "place":finish_position, "score":0, "player":true}]
    for i in range(bots.size()):
        rows.append({"name":"BOT %02d" % (i + 1), "place":i + 2, "score":bots[i].bot_progress_score(), "player":false})
    rows.sort_custom(func(a, b): return a.score > b.score)
    return rows

func destination_name() -> String:
    if current_destination >= destinations.size():
        return "FINISH LINE"
    return str(destinations[current_destination].name)

func destination_distance() -> float:
    if player == null or current_destination >= destinations.size():
        return 0.0
    return player.global_position.distance_to(destinations[current_destination].pos)

func alive_count() -> int:
    var count := 0
    for bot in bots:
        if bot and not bot.is_eliminated:
            count += 1
    return count + (1 if player and not player.is_eliminated else 0)
