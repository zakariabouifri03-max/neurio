class_name RoadfallSaveService
extends Node

## Local profile for offline play and presentation. Online authority is kept in
## NetcodeAdapter; client-side currency is never trusted by a server session.

const PATH := "user://roadfall_profile.json"
var profile: Dictionary = {}

func _ready() -> void:
    load_profile()

func defaults() -> Dictionary:
    return {
        "version": RoadfallData.SAVE_VERSION,
        "username": "RIDER",
        "selected_vehicle": "street",
        "owned_vehicles": ["street"],
        "credits": 18000,
        "road_gems": 120,
        "xp": 0,
        "rank": "ROOKIE",
        "wins": 0,
        "matches": 0,
        "eliminations": 0,
        "best_place": 50,
        "season": 1,
        "season_xp": 0,
        "settings": {
            "quality": "AUTO",
            "performance_mode": "BALANCED",
            "touch_layout": "BUTTONS",
            "left_handed": false,
            "steering_sensitivity": 1.0,
            "camera_sensitivity": 1.0,
            "vibration": 0.8,
            "minimap_zoom": 1.0,
            "minimap_rotation": "PLAYER",
            "master_volume": 0.75
        },
        "vehicle_upgrades": {},
        "cosmetics": {"paint": "factory", "wheels": "street", "decal": "none", "effect": "none"},
        "achievements": [],
        "challenges": {"drive_distance": 0.0, "destinations": 0, "loot_collected": 0},
        "inventory": []
    }

func load_profile() -> void:
    profile = defaults()
    if not FileAccess.file_exists(PATH):
        save_profile()
        return
    var file := FileAccess.open(PATH, FileAccess.READ)
    if file == null:
        return
    var parsed = JSON.parse_string(file.get_as_text())
    if parsed is Dictionary:
        _merge_defaults(profile, parsed)
    profile.version = RoadfallData.SAVE_VERSION

func _merge_defaults(target: Dictionary, source: Dictionary) -> void:
    for key in source.keys():
        if target.has(key) and target[key] is Dictionary and source[key] is Dictionary:
            _merge_defaults(target[key], source[key])
        else:
            target[key] = source[key]

func save_profile() -> void:
    if profile.is_empty():
        profile = defaults()
    var file := FileAccess.open(PATH, FileAccess.WRITE)
    if file:
        file.store_string(JSON.stringify(profile))

func get_setting(key: String, fallback = null):
    return profile.get("settings", {}).get(key, fallback)

func set_setting(key: String, value) -> void:
    profile.settings[key] = value
    save_profile()

func get_vehicle_upgrade(vehicle_id: String) -> Dictionary:
    if not profile.vehicle_upgrades.has(vehicle_id):
        profile.vehicle_upgrades[vehicle_id] = {"accel": 0, "grip": 0, "brake": 0, "armor": 0}
    return profile.vehicle_upgrades[vehicle_id]

func own_vehicle(vehicle_id: String) -> bool:
    return vehicle_id in profile.owned_vehicles

func buy_vehicle(vehicle_id: String) -> bool:
    var vehicle := RoadfallData.vehicle_by_id(vehicle_id)
    if own_vehicle(vehicle_id) or int(profile.credits) < int(vehicle.price):
        return false
    profile.credits -= int(vehicle.price)
    profile.owned_vehicles.append(vehicle_id)
    save_profile()
    return true

func award_match(place: int, won: bool) -> Dictionary:
    var credit_reward := maxi(150, 2600 - (place - 1) * 42)
    var gem_reward := 0 if place > 5 else 3
    if won:
        credit_reward += 2800
        gem_reward += 12
        profile.wins += 1
    profile.credits += credit_reward
    profile.road_gems += gem_reward
    profile.matches += 1
    profile.best_place = mini(int(profile.best_place), place)
    profile.xp += maxi(80, 650 - place * 8)
    profile.season_xp += maxi(60, 500 - place * 6)
    profile.rank = RoadfallData.rank_for_xp(int(profile.xp))
    save_profile()
    return {"credits": credit_reward, "gems": gem_reward, "xp": maxi(80, 650 - place * 8)}
