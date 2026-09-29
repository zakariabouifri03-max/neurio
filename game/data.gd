class_name RoadfallData
extends Node

## Shared, platform-neutral game data. No economy or match rule is hidden in a
## platform layer: Android and Windows call these same definitions.

const WORLD_SIZE := 12000.0
const CELL_SIZE := 600.0
const CELL_RADIUS := 1
const MAX_COMPETITORS := 50
const CHECKPOINT_TIME := 105.0
const FINAL_TIME := 150.0
const SAVE_VERSION := 1

const REGIONS := [
    {"id":"city", "name":"NEON CITY", "color":Color("#26384d"), "surface":"asphalt", "accent":Color("#42d8ff")},
    {"id":"suburbs", "name":"NORTHSTAR SUBURBS", "color":Color("#46565b"), "surface":"asphalt", "accent":Color("#ffbd5c")},
    {"id":"industrial", "name":"IRON YARD", "color":Color("#4a443e"), "surface":"gravel", "accent":Color("#ff6a3d")},
    {"id":"airport", "name":"SKYLINE AIRPORT", "color":Color("#77818c"), "surface":"asphalt", "accent":Color("#b4dcff")},
    {"id":"mountain", "name":"BLACKRIDGE", "color":Color("#28343d"), "surface":"rock", "accent":Color("#d19a6a")},
    {"id":"forest", "name":"PINEFALL", "color":Color("#1f433c"), "surface":"grass", "accent":Color("#68e28d")},
    {"id":"desert", "name":"RED DUST BASIN", "color":Color("#765238"), "surface":"sand", "accent":Color("#ffc15a")},
    {"id":"coast", "name":"TIDELINE COAST", "color":Color("#2c6574"), "surface":"asphalt", "accent":Color("#50e6ec")},
    {"id":"farmland", "name":"SUNFIELD", "color":Color("#63734a"), "surface":"mud", "accent":Color("#d3e579")},
    {"id":"snow", "name":"WHITEOUT PASS", "color":Color("#a5b8c5"), "surface":"snow", "accent":Color("#f4fcff")}
]

const VEHICLES := [
    {"id":"street", "name":"Street Car", "class":"SPRINTER", "mass":1120.0, "power":155.0, "grip":1.05, "top_speed":52.0, "color":Color("#e65050"), "price":0},
    {"id":"rally", "name":"Rally Car", "class":"ALL-ROAD", "mass":1280.0, "power":192.0, "grip":1.18, "top_speed":49.0, "color":Color("#e9a329"), "price":12000},
    {"id":"muscle", "name":"Muscle Car", "class":"TORQUE", "mass":1640.0, "power":285.0, "grip":0.90, "top_speed":58.0, "color":Color("#8068dd"), "price":24000},
    {"id":"suv", "name":"Off-Road SUV", "class":"CLIMBER", "mass":2080.0, "power":225.0, "grip":1.35, "top_speed":44.0, "color":Color("#63a875"), "price":30000},
    {"id":"sports", "name":"Sports Car", "class":"PRECISION", "mass":1240.0, "power":260.0, "grip":1.12, "top_speed":63.0, "color":Color("#37b3dc"), "price":42000},
    {"id":"hyper", "name":"Hyper Car", "class":"ROCKET", "mass":1180.0, "power":420.0, "grip":1.08, "top_speed":72.0, "color":Color("#d6429b"), "price":85000},
    {"id":"utility", "name":"Heavy Utility", "class":"ANCHOR", "mass":3100.0, "power":240.0, "grip":1.28, "top_speed":40.0, "color":Color("#73818b"), "price":36000},
    {"id":"performance_suv", "name":"Performance SUV", "class":"VERSATILE", "mass":1900.0, "power":330.0, "grip":1.20, "top_speed":56.0, "color":Color("#f27845"), "price":60000}
]

const LOOT := [
    {"id":"acceleration", "name":"Acceleration Upgrade", "rarity":"Common", "color":Color("#9aa8b6"), "stat":"accel", "amount":0.12},
    {"id":"grip", "name":"Grip Upgrade", "rarity":"Rare", "color":Color("#38bdf8"), "stat":"grip", "amount":0.16},
    {"id":"brake", "name":"Brake Upgrade", "rarity":"Common", "color":Color("#9aa8b6"), "stat":"brake", "amount":0.14},
    {"id":"suspension", "name":"Off-road Suspension", "rarity":"Epic", "color":Color("#c084fc"), "stat":"offroad", "amount":0.25},
    {"id":"boost", "name":"Temporary Boost", "rarity":"Rare", "color":Color("#22d3ee"), "stat":"boost", "amount":2.8},
    {"id":"armor", "name":"Armor", "rarity":"Epic", "color":Color("#fb923c"), "stat":"armor", "amount":35.0},
    {"id":"repair", "name":"Repair Kit", "rarity":"Common", "color":Color("#a3e635"), "stat":"repair", "amount":25.0},
    {"id":"scanner", "name":"Navigation Scanner", "rarity":"Legendary", "color":Color("#facc15"), "stat":"scanner", "amount":1.0}
]

const WEATHER := ["CLEAR", "RAIN", "HEAVY RAIN", "FOG", "SANDSTORM", "SNOWSTORM"]
const EVENTS := ["TRAIN CROSSING", "BRIDGE CLOSURE", "TRAFFIC JAM", "POLICE PURSUIT", "SUPPLY CONVOY", "CONSTRUCTION ZONE", "FALLING DEBRIS", "RARE LOOT EVENT", "POWER OUTAGE"]
const RANKS := ["ROOKIE", "PRO", "ELITE", "MASTER", "LEGEND"]

const DESTINATIONS := [
    {"id":"city", "name":"CITY", "pos":Vector3(0, 0, 0), "kind":"city"},
    {"id":"airport", "name":"AIRPORT", "pos":Vector3(-3000, 0, -1200), "kind":"airport"},
    {"id":"mountain", "name":"MOUNTAIN", "pos":Vector3(4000, 0, 4100), "kind":"mountain"},
    {"id":"forest", "name":"FOREST", "pos":Vector3(2700, 0, -3100), "kind":"forest"},
    {"id":"desert", "name":"DESERT", "pos":Vector3(-3700, 0, 2600), "kind":"desert"},
    {"id":"coast", "name":"COAST", "pos":Vector3(-4600, 0, -3900), "kind":"coast"},
    {"id":"farmland", "name":"FARMLAND", "pos":Vector3(3100, 0, 1200), "kind":"farmland"}
]

static func vehicle_by_id(id: String) -> Dictionary:
    for vehicle in VEHICLES:
        if vehicle.id == id:
            return vehicle.duplicate(true)
    return VEHICLES[0].duplicate(true)

static func loot_by_id(id: String) -> Dictionary:
    for item in LOOT:
        if item.id == id:
            return item.duplicate(true)
    return LOOT[0].duplicate(true)

static func region_for_position(pos: Vector3) -> Dictionary:
    var x := pos.x
    var z := pos.z
    if abs(x) < 950.0 and abs(z) < 950.0:
        return REGIONS[0]
    if x < -2100.0 and z < -2600.0:
        return REGIONS[7]
    if x < -2100.0 and z > 1800.0:
        return REGIONS[6]
    if x > 1900.0 and z > 2850.0:
        return REGIONS[4]
    if x > 1700.0 and z < -1800.0:
        return REGIONS[5]
    if x > 1600.0 and z > -800.0 and z < 1900.0:
        return REGIONS[8]
    if x < -1400.0 and z > -2100.0 and z < 900.0:
        return REGIONS[2]
    if x < -1900.0 and z < 1200.0:
        return REGIONS[3]
    if z < -700.0:
        return REGIONS[9]
    return REGIONS[1]

static func rank_for_xp(xp: int) -> String:
    var index := clampi(int(xp / 1500), 0, RANKS.size() - 1)
    return RANKS[index]
