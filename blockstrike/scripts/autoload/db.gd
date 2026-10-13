extends Node
## Static game data: weapons, items, cosmetics, missions, achievements, ranks, modes and maps.
## Everything here is original content made for BlockStrike Royale.
## Cosmetics are purely visual: no entry in COSMETICS carries any gameplay stat.

const VERSION := "0.3.0"
const NET_PROTOCOL := 3

# ---------------------------------------------------------------- weapons
enum Cat { AR, SMG, SG, SR, PISTOL, MELEE, THROW }
const CAT_NAMES := ["Assault Rifle", "SMG", "Shotgun", "Sniper", "Pistol", "Melee", "Throwable"]
const SLOT_PRIMARY_A := 0
const SLOT_PRIMARY_B := 1
const SLOT_PISTOL := 2
const SLOT_MELEE := 3
const SLOT_THROW := 4

## dmg per pellet, rps = rounds per second, rng = effective range (m), max = max range,
## hip/ads = spread in degrees, rec = vertical recoil (deg per shot), recx = horizontal jitter,
## mag, rel = reload seconds, pel = pellets, auto = hold-to-fire, zoom = FOV divisor when aiming,
## head = headshot multiplier, move = movement speed multiplier, ammo = ammo type.
var WEAPONS := {
	"ar_strike": {"name": "Strike-47", "cat": Cat.AR, "dmg": 30, "rps": 8.5, "rng": 55.0, "max": 120.0, "hip": 3.4, "ads": 0.9,
		"rec": 1.35, "recx": 0.55, "mag": 30, "rel": 2.4, "pel": 1, "auto": true, "zoom": 1.5, "head": 2.0, "move": 0.92,
		"ammo": "rifle", "rarity": 2, "snd": "shot_ar", "price": 2700},
	"ar_cobalt": {"name": "Cobalt M4", "cat": Cat.AR, "dmg": 25, "rps": 10.5, "rng": 50.0, "max": 110.0, "hip": 3.0, "ads": 0.7,
		"rec": 0.95, "recx": 0.4, "mag": 30, "rel": 2.2, "pel": 1, "auto": true, "zoom": 1.5, "head": 2.0, "move": 0.94,
		"ammo": "rifle", "rarity": 2, "snd": "shot_ar", "price": 2500},
	"smg_buzz": {"name": "Buzz-9", "cat": Cat.SMG, "dmg": 17, "rps": 14.0, "rng": 22.0, "max": 60.0, "hip": 3.6, "ads": 1.6,
		"rec": 0.75, "recx": 0.6, "mag": 32, "rel": 1.8, "pel": 1, "auto": true, "zoom": 1.25, "head": 1.6, "move": 1.0,
		"ammo": "light", "rarity": 1, "snd": "shot_smg", "price": 1600},
	"smg_hornet": {"name": "Hornet 45", "cat": Cat.SMG, "dmg": 21, "rps": 11.0, "rng": 26.0, "max": 70.0, "hip": 3.1, "ads": 1.3,
		"rec": 0.85, "recx": 0.5, "mag": 25, "rel": 2.0, "pel": 1, "auto": true, "zoom": 1.25, "head": 1.6, "move": 0.98,
		"ammo": "light", "rarity": 1, "snd": "shot_smg", "price": 1800},
	"sg_boom": {"name": "Boomstick 12", "cat": Cat.SG, "dmg": 14, "rps": 1.15, "rng": 9.0, "max": 24.0, "hip": 6.5, "ads": 4.8,
		"rec": 4.0, "recx": 1.2, "mag": 5, "rel": 3.0, "pel": 8, "auto": false, "zoom": 1.15, "head": 1.5, "move": 0.95,
		"ammo": "shells", "rarity": 1, "snd": "shot_sg", "price": 1400},
	"sg_thunder": {"name": "Thunder Auto-SG", "cat": Cat.SG, "dmg": 11, "rps": 3.0, "rng": 8.0, "max": 20.0, "hip": 7.5, "ads": 5.5,
		"rec": 3.0, "recx": 1.0, "mag": 8, "rel": 3.2, "pel": 7, "auto": true, "zoom": 1.15, "head": 1.5, "move": 0.93,
		"ammo": "shells", "rarity": 3, "snd": "shot_sg", "price": 2600},
	"sr_longshot": {"name": "Longshot K9", "cat": Cat.SR, "dmg": 105, "rps": 0.75, "rng": 160.0, "max": 260.0, "hip": 9.0, "ads": 0.05,
		"rec": 6.0, "recx": 0.8, "mag": 5, "rel": 3.3, "pel": 1, "auto": false, "zoom": 4.0, "head": 2.5, "move": 0.86,
		"ammo": "sniper", "rarity": 3, "snd": "shot_sr", "price": 4200},
	"sr_hawk": {"name": "Hawkeye DMR", "cat": Cat.SR, "dmg": 52, "rps": 3.0, "rng": 110.0, "max": 200.0, "hip": 5.0, "ads": 0.3,
		"rec": 2.6, "recx": 0.5, "mag": 10, "rel": 2.8, "pel": 1, "auto": false, "zoom": 2.6, "head": 2.2, "move": 0.9,
		"ammo": "sniper", "rarity": 2, "snd": "shot_sr", "price": 3300},
	"pi_pea": {"name": "Peashooter P9", "cat": Cat.PISTOL, "dmg": 22, "rps": 5.0, "rng": 22.0, "max": 60.0, "hip": 2.2, "ads": 1.0,
		"rec": 1.0, "recx": 0.4, "mag": 12, "rel": 1.4, "pel": 1, "auto": false, "zoom": 1.2, "head": 1.8, "move": 1.05,
		"ammo": "light", "rarity": 0, "snd": "shot_pistol", "price": 300},
	"pi_hammer": {"name": "Desert Hammer", "cat": Cat.PISTOL, "dmg": 48, "rps": 2.2, "rng": 30.0, "max": 80.0, "hip": 2.6, "ads": 0.6,
		"rec": 3.2, "recx": 0.7, "mag": 7, "rel": 1.8, "pel": 1, "auto": false, "zoom": 1.3, "head": 2.0, "move": 1.0,
		"ammo": "light", "rarity": 2, "snd": "shot_pistol", "price": 900},
	"me_pick": {"name": "Mining Pick", "cat": Cat.MELEE, "dmg": 30, "rps": 1.7, "rng": 2.3, "max": 2.3, "hip": 0.0, "ads": 0.0,
		"rec": 0.0, "recx": 0.0, "mag": 0, "rel": 0.0, "pel": 1, "auto": true, "zoom": 1.0, "head": 1.5, "move": 1.1,
		"ammo": "", "rarity": 0, "snd": "swing", "price": 0, "block_dmg": 90},
	"me_bat": {"name": "Block Bat", "cat": Cat.MELEE, "dmg": 50, "rps": 1.25, "rng": 2.5, "max": 2.5, "hip": 0.0, "ads": 0.0,
		"rec": 0.0, "recx": 0.0, "mag": 0, "rel": 0.0, "pel": 1, "auto": true, "zoom": 1.0, "head": 1.5, "move": 1.08,
		"ammo": "", "rarity": 1, "snd": "swing", "price": 200, "block_dmg": 50},
	"gr_frag": {"name": "Frag Cube", "cat": Cat.THROW, "dmg": 115, "radius": 5.5, "fuse": 2.4, "rps": 1.0, "rarity": 1, "snd": "pin", "price": 400},
	"gr_smoke": {"name": "Smoke Cube", "cat": Cat.THROW, "dmg": 0, "radius": 5.5, "fuse": 1.6, "rps": 1.0, "rarity": 0, "snd": "pin", "price": 250},
	"gr_wall": {"name": "Wall Cube", "cat": Cat.THROW, "dmg": 0, "radius": 0.0, "fuse": 0.9, "rps": 1.2, "rarity": 1, "snd": "pin", "price": 300},
}

const AMMO_TYPES := ["light", "rifle", "shells", "sniper"]
const AMMO_PICKUP := {"light": 40, "rifle": 40, "shells": 12, "sniper": 10}
const AMMO_MAX := {"light": 240, "rifle": 240, "shells": 60, "sniper": 50}
const AMMO_COLORS := {"light": Color(0.95, 0.8, 0.25), "rifle": Color(0.35, 0.85, 0.35), "shells": Color(0.9, 0.3, 0.25), "sniper": Color(0.35, 0.6, 1.0)}

# ---------------------------------------------------------------- items
## kind: med / armor / helmet / ammo / blocks / throw
var ITEMS := {
	"med_bandage": {"name": "Bandage", "kind": "med", "heal": 15, "time": 2.4, "stack": 10, "rarity": 0},
	"med_kit": {"name": "Med Kit", "kind": "med", "heal": 75, "time": 5.0, "stack": 3, "rarity": 2},
	"med_drink": {"name": "Energy Drink", "kind": "med", "heal": 40, "time": 1.5, "hot": 8.0, "stack": 4, "rarity": 1},
	"vest_1": {"name": "Vest Lv.1", "kind": "armor", "level": 1, "dur": 100, "rarity": 0},
	"vest_2": {"name": "Vest Lv.2", "kind": "armor", "level": 2, "dur": 150, "rarity": 1},
	"vest_3": {"name": "Vest Lv.3", "kind": "armor", "level": 3, "dur": 200, "rarity": 3},
	"helm_1": {"name": "Helmet Lv.1", "kind": "helmet", "level": 1, "dur": 80, "rarity": 0},
	"helm_2": {"name": "Helmet Lv.2", "kind": "helmet", "level": 2, "dur": 120, "rarity": 1},
	"helm_3": {"name": "Helmet Lv.3", "kind": "helmet", "level": 3, "dur": 160, "rarity": 3},
	"blocks": {"name": "Block Pack", "kind": "blocks", "amount": 10, "rarity": 0},
}
const ARMOR_REDUCTION := [0.0, 0.25, 0.35, 0.45]
const MED_ORDER := ["med_bandage", "med_drink", "med_kit"]
const RARITY_NAMES := ["Common", "Rare", "Epic", "Legendary"]
const RARITY_COLORS := [Color(0.78, 0.8, 0.84), Color(0.3, 0.62, 1.0), Color(0.72, 0.38, 1.0), Color(1.0, 0.72, 0.18)]

## Loot tables per point-of-interest tier (weights).
var LOOT_TABLES := {
	0: {"smg_buzz": 6, "pi_pea": 8, "sg_boom": 4, "me_bat": 2, "smg_hornet": 3, "ar_cobalt": 2, "med_bandage": 12, "med_drink": 4,
		"vest_1": 6, "helm_1": 6, "ammo": 22, "blocks": 6, "gr_frag": 3, "gr_smoke": 3, "gr_wall": 3, "vest_2": 1, "helm_2": 1, "pi_hammer": 1},
	1: {"ar_strike": 4, "ar_cobalt": 5, "smg_hornet": 4, "smg_buzz": 3, "sg_boom": 3, "sr_hawk": 3, "pi_hammer": 2, "med_bandage": 8,
		"med_kit": 4, "med_drink": 5, "vest_2": 5, "helm_2": 5, "ammo": 22, "blocks": 6, "gr_frag": 4, "gr_wall": 4, "gr_smoke": 2, "vest_1": 2, "helm_1": 2},
	2: {"ar_strike": 6, "ar_cobalt": 4, "sr_longshot": 3, "sr_hawk": 4, "sg_thunder": 3, "smg_hornet": 2, "med_kit": 6, "med_drink": 4,
		"vest_2": 4, "helm_2": 4, "vest_3": 2, "helm_3": 2, "ammo": 20, "blocks": 6, "gr_frag": 5, "gr_wall": 4},
}
var SUPPLY_TABLE := {"sr_longshot": 5, "sg_thunder": 4, "ar_strike": 3, "vest_3": 6, "helm_3": 6, "med_kit": 8, "gr_frag": 4, "blocks": 4}

# ---------------------------------------------------------------- cosmetics (visual only)
## type: skin / outfit / helmet / backpack / wrap / emote / victory
var COSMETICS := {}
const COSMETIC_TYPES := ["skin", "outfit", "helmet", "backpack", "wrap", "emote", "victory"]
const COSMETIC_TYPE_NAMES := {"skin": "Characters", "outfit": "Outfits", "helmet": "Helmets", "backpack": "Backpacks",
	"wrap": "Weapon Skins", "emote": "Emotes", "victory": "Victory Dances"}

func _build_cosmetics() -> void:
	# Characters: face / skin tone / hair. (tone, hair color, hair style, eyes, face)
	_c("skin_blox", "skin", "Blox", 0, 0, 0, {"tone": Color(0.93, 0.74, 0.58), "hair": Color(0.35, 0.22, 0.12), "hs": 0, "eye": Color(0.2, 0.45, 0.9), "face": 0})
	_c("skin_kira", "skin", "Kira", 1, 900, 0, {"tone": Color(0.98, 0.82, 0.68), "hair": Color(0.08, 0.08, 0.1), "hs": 2, "eye": Color(0.55, 0.25, 0.15), "face": 1})
	_c("skin_rook", "skin", "Rook", 1, 900, 0, {"tone": Color(0.55, 0.36, 0.24), "hair": Color(0.1, 0.07, 0.05), "hs": 1, "eye": Color(0.25, 0.15, 0.1), "face": 2})
	_c("skin_juno", "skin", "Juno", 1, 1200, 0, {"tone": Color(0.85, 0.62, 0.45), "hair": Color(0.85, 0.35, 0.2), "hs": 3, "eye": Color(0.2, 0.6, 0.35), "face": 1})
	_c("skin_volt", "skin", "Volt", 2, 0, 180, {"tone": Color(0.95, 0.78, 0.62), "hair": Color(1.0, 0.85, 0.1), "hs": 4, "eye": Color(0.1, 0.9, 1.0), "face": 3})
	_c("skin_nyx", "skin", "Nyx", 2, 0, 220, {"tone": Color(0.8, 0.6, 0.48), "hair": Color(0.3, 0.12, 0.45), "hs": 2, "eye": Color(0.8, 0.3, 1.0), "face": 4})
	_c("skin_sol", "skin", "Sol", 1, 1500, 0, {"tone": Color(0.7, 0.5, 0.33), "hair": Color(0.95, 0.92, 0.85), "hs": 1, "eye": Color(0.4, 0.3, 0.15), "face": 2})
	_c("skin_frost", "skin", "Frost", 2, 0, 200, {"tone": Color(0.9, 0.85, 0.88), "hair": Color(0.75, 0.9, 1.0), "hs": 3, "eye": Color(0.3, 0.75, 1.0), "face": 0})
	_c("skin_ember", "skin", "Ember", 3, 0, 400, {"tone": Color(0.95, 0.7, 0.55), "hair": Color(1.0, 0.35, 0.05), "hs": 4, "eye": Color(1.0, 0.55, 0.1), "face": 3})
	_c("skin_golem", "skin", "Golem Unit", 3, 0, 450, {"tone": Color(0.55, 0.58, 0.62), "hair": Color(0.3, 0.32, 0.36), "hs": 5, "eye": Color(1.0, 0.25, 0.2), "face": 5})
	# Outfits: shirt / pattern / pants / shoes / style
	_c("fit_scout", "outfit", "Scout Fatigues", 0, 0, 0, {"shirt": Color(0.35, 0.5, 0.27), "pat": Color(0.25, 0.36, 0.2), "pants": Color(0.55, 0.47, 0.32), "shoes": Color(0.2, 0.15, 0.1), "style": 0})
	_c("fit_street", "outfit", "Street Hoodie", 0, 700, 0, {"shirt": Color(0.45, 0.47, 0.52), "pat": Color(0.85, 0.85, 0.88), "pants": Color(0.18, 0.22, 0.35), "shoes": Color(0.9, 0.9, 0.9), "style": 1})
	_c("fit_red", "outfit", "Red Racer Jacket", 1, 1100, 0, {"shirt": Color(0.82, 0.15, 0.15), "pat": Color(0.1, 0.1, 0.1), "pants": Color(0.12, 0.12, 0.14), "shoes": Color(0.85, 0.15, 0.1), "style": 2})
	_c("fit_medic", "outfit", "Field Medic", 1, 1100, 0, {"shirt": Color(0.92, 0.94, 0.95), "pat": Color(0.1, 0.65, 0.6), "pants": Color(0.12, 0.5, 0.48), "shoes": Color(0.25, 0.25, 0.28), "style": 3})
	_c("fit_desert", "outfit", "Desert Camo", 1, 1300, 0, {"shirt": Color(0.78, 0.66, 0.45), "pat": Color(0.6, 0.48, 0.3), "pants": Color(0.68, 0.56, 0.38), "shoes": Color(0.4, 0.3, 0.2), "style": 4})
	_c("fit_arctic", "outfit", "Arctic Camo", 2, 0, 160, {"shirt": Color(0.92, 0.95, 1.0), "pat": Color(0.6, 0.72, 0.85), "pants": Color(0.8, 0.86, 0.94), "shoes": Color(0.3, 0.35, 0.45), "style": 4})
	_c("fit_neon", "outfit", "Neon Runner", 2, 0, 200, {"shirt": Color(0.1, 0.1, 0.14), "pat": Color(0.1, 1.0, 0.85), "pants": Color(0.12, 0.1, 0.16), "shoes": Color(1.0, 0.2, 0.7), "style": 5})
	_c("fit_navy", "outfit", "Captain's Uniform", 2, 0, 240, {"shirt": Color(0.1, 0.16, 0.36), "pat": Color(1.0, 0.8, 0.25), "pants": Color(0.95, 0.95, 0.95), "shoes": Color(0.1, 0.1, 0.12), "style": 3})
	_c("fit_lava", "outfit", "Magma Armor", 3, 0, 420, {"shirt": Color(0.2, 0.08, 0.06), "pat": Color(1.0, 0.45, 0.05), "pants": Color(0.16, 0.07, 0.05), "shoes": Color(1.0, 0.6, 0.1), "style": 5})
	# Helmets (hats) - visual only, never armor.
	_c("hat_none", "helmet", "No Hat", 0, 0, 0, {"model": 0})
	_c("hat_cap", "helmet", "Block Cap", 0, 400, 0, {"model": 1, "col": Color(0.15, 0.35, 0.8), "col2": Color(0.95, 0.95, 0.95)})
	_c("hat_tactical", "helmet", "Tactical Lid", 1, 900, 0, {"model": 2, "col": Color(0.3, 0.36, 0.25), "col2": Color(0.15, 0.17, 0.12)})
	_c("hat_beanie", "helmet", "Cozy Beanie", 0, 500, 0, {"model": 3, "col": Color(0.85, 0.3, 0.2), "col2": Color(0.95, 0.85, 0.3)})
	_c("hat_cowboy", "helmet", "Ranch Hat", 1, 1000, 0, {"model": 4, "col": Color(0.55, 0.36, 0.2), "col2": Color(0.3, 0.18, 0.1)})
	_c("hat_viking", "helmet", "Northman Helm", 2, 0, 180, {"model": 5, "col": Color(0.6, 0.6, 0.62), "col2": Color(0.95, 0.92, 0.82)})
	_c("hat_phones", "helmet", "Beat Headphones", 1, 1200, 0, {"model": 6, "col": Color(0.1, 0.1, 0.12), "col2": Color(1.0, 0.25, 0.4)})
	_c("hat_bunny", "helmet", "Bunny Ears", 2, 0, 160, {"model": 7, "col": Color(0.98, 0.98, 0.98), "col2": Color(1.0, 0.6, 0.75)})
	_c("hat_crown", "helmet", "Royale Crown", 3, 0, 500, {"model": 8, "col": Color(1.0, 0.8, 0.15), "col2": Color(0.85, 0.1, 0.25)})
	# Backpacks - visual only (inventory capacity is identical for everyone).
	_c("bag_none", "backpack", "No Backpack", 0, 0, 0, {"model": 0})
	_c("bag_scout", "backpack", "Scout Pack", 0, 600, 0, {"model": 1, "col": Color(0.4, 0.33, 0.22), "col2": Color(0.25, 0.2, 0.12)})
	_c("bag_rocket", "backpack", "Rocket Pack", 2, 0, 200, {"model": 2, "col": Color(0.85, 0.85, 0.9), "col2": Color(1.0, 0.4, 0.1)})
	_c("bag_crate", "backpack", "Loot Crate Pack", 1, 1000, 0, {"model": 3, "col": Color(0.65, 0.45, 0.25), "col2": Color(0.35, 0.25, 0.12)})
	_c("bag_wings", "backpack", "Pixel Wings", 3, 0, 450, {"model": 4, "col": Color(0.95, 0.95, 1.0), "col2": Color(0.6, 0.85, 1.0)})
	_c("bag_cube", "backpack", "Companion Cube", 2, 0, 220, {"model": 5, "col": Color(0.3, 0.9, 0.5), "col2": Color(0.1, 0.4, 0.2)})
	# Weapon wraps (apply to any weapon).
	_c("wrap_none", "wrap", "Factory Finish", 0, 0, 0, {"a": Color(0.22, 0.23, 0.25), "b": Color(0.42, 0.3, 0.2), "c": Color(0.12, 0.12, 0.13)})
	_c("wrap_desert", "wrap", "Dune Camo", 0, 500, 0, {"a": Color(0.78, 0.67, 0.45), "b": Color(0.6, 0.48, 0.3), "c": Color(0.35, 0.3, 0.22)})
	_c("wrap_jungle", "wrap", "Jungle Camo", 0, 500, 0, {"a": Color(0.3, 0.45, 0.22), "b": Color(0.2, 0.3, 0.15), "c": Color(0.15, 0.18, 0.1)})
	_c("wrap_arctic", "wrap", "Glacier", 1, 900, 0, {"a": Color(0.9, 0.95, 1.0), "b": Color(0.55, 0.75, 0.95), "c": Color(0.3, 0.4, 0.55)})
	_c("wrap_candy", "wrap", "Candy Pop", 1, 1100, 0, {"a": Color(1.0, 0.55, 0.75), "b": Color(0.55, 0.9, 1.0), "c": Color(1.0, 1.0, 1.0)})
	_c("wrap_neon", "wrap", "Neon Circuit", 2, 0, 150, {"a": Color(0.08, 0.08, 0.12), "b": Color(0.1, 1.0, 0.85), "c": Color(1.0, 0.2, 0.8)})
	_c("wrap_lava", "wrap", "Lava Flow", 2, 0, 180, {"a": Color(0.2, 0.06, 0.04), "b": Color(1.0, 0.45, 0.05), "c": Color(1.0, 0.85, 0.2)})
	_c("wrap_gold", "wrap", "Royal Gold", 3, 0, 400, {"a": Color(1.0, 0.78, 0.2), "b": Color(0.8, 0.55, 0.1), "c": Color(0.15, 0.12, 0.1)})
	_c("wrap_galaxy", "wrap", "Galaxy", 3, 0, 380, {"a": Color(0.18, 0.1, 0.35), "b": Color(0.45, 0.3, 0.9), "c": Color(0.95, 0.95, 1.0)})
	# Emotes
	_c("emote_wave", "emote", "Wave", 0, 0, 0, {"anim": 0})
	_c("emote_cheer", "emote", "Cheer", 0, 300, 0, {"anim": 1})
	_c("emote_robot", "emote", "Robo Bop", 1, 800, 0, {"anim": 2})
	_c("emote_spin", "emote", "Block Spin", 1, 900, 0, {"anim": 3})
	_c("emote_salute", "emote", "Salute", 0, 400, 0, {"anim": 4})
	_c("emote_flex", "emote", "Flex", 2, 0, 120, {"anim": 5})
	_c("emote_dance", "emote", "Pixel Shuffle", 2, 0, 160, {"anim": 6})
	_c("emote_laugh", "emote", "Laugh Out Loud", 1, 700, 0, {"anim": 7})
	# Victory dances (played on the victory screen)
	_c("vic_confetti", "victory", "Confetti Burst", 0, 0, 0, {"fx": 0, "anim": 1})
	_c("vic_fireworks", "victory", "Block Fireworks", 1, 1200, 0, {"fx": 1, "anim": 6})
	_c("vic_trophy", "victory", "Golden Trophy", 2, 0, 200, {"fx": 2, "anim": 5})
	_c("vic_lightning", "victory", "Thunder Strike", 3, 0, 380, {"fx": 3, "anim": 3})

func _c(id: String, type: String, nm: String, rarity: int, coins: int, gems: int, data: Dictionary) -> void:
	var d := data.duplicate()
	d["id"] = id
	d["type"] = type
	d["name"] = nm
	d["rarity"] = rarity
	d["coins"] = coins
	d["gems"] = gems
	COSMETICS[id] = d

const DEFAULT_OWNED := ["skin_blox", "fit_scout", "hat_none", "bag_none", "wrap_none", "emote_wave", "vic_confetti"]
const DEFAULT_EQUIP := {"skin": "skin_blox", "outfit": "fit_scout", "helmet": "hat_none", "backpack": "bag_none", "wrap": "wrap_none",
	"emote": "emote_wave", "victory": "vic_confetti"}

# ---------------------------------------------------------------- progression
func xp_for_level(level: int) -> int:
	return 400 + (level - 1) * 150

const LEVEL_REWARD_COINS := 250
const LEVEL_REWARD_GEMS_EVERY := 5
const LEVEL_REWARD_GEMS := 30

## Daily mission pool: stat key, target, coins, xp
var DAILY_POOL := [
	{"id": "d_play2", "text": "Play 2 matches", "stat": "matches", "goal": 2, "coins": 150, "xp": 120},
	{"id": "d_kill5", "text": "Eliminate 5 enemies", "stat": "kills", "goal": 5, "coins": 200, "xp": 150},
	{"id": "d_dmg1000", "text": "Deal 1000 damage", "stat": "damage", "goal": 1000, "coins": 200, "xp": 150},
	{"id": "d_heal200", "text": "Heal 200 HP", "stat": "healed", "goal": 200, "coins": 120, "xp": 100},
	{"id": "d_build30", "text": "Place 30 blocks", "stat": "blocks", "goal": 30, "coins": 150, "xp": 100},
	{"id": "d_head5", "text": "Land 5 headshots", "stat": "headshots", "goal": 5, "coins": 180, "xp": 130},
	{"id": "d_top10", "text": "Finish Top 10 in Battle Royale", "stat": "top10", "goal": 1, "coins": 200, "xp": 150},
	{"id": "d_loot25", "text": "Pick up 25 items", "stat": "loot", "goal": 25, "coins": 120, "xp": 90},
	{"id": "d_round3", "text": "Win 3 rounds (Clash Squad or Arena)", "stat": "rounds", "goal": 3, "coins": 200, "xp": 150},
	{"id": "d_survive", "text": "Survive 10 minutes in total", "stat": "survive", "goal": 600, "coins": 150, "xp": 120},
]
var WEEKLY_POOL := [
	{"id": "w_win1", "text": "Win a match", "stat": "wins", "goal": 1, "coins": 600, "gems": 20, "xp": 500},
	{"id": "w_kill40", "text": "Eliminate 40 enemies", "stat": "kills", "goal": 40, "coins": 800, "gems": 20, "xp": 600},
	{"id": "w_play15", "text": "Play 15 matches", "stat": "matches", "goal": 15, "coins": 700, "gems": 15, "xp": 600},
	{"id": "w_dmg10k", "text": "Deal 10,000 damage", "stat": "damage", "goal": 10000, "coins": 800, "gems": 20, "xp": 600},
	{"id": "w_supply3", "text": "Loot 3 supply drops", "stat": "supply", "goal": 3, "coins": 600, "gems": 15, "xp": 400},
	{"id": "w_build300", "text": "Place 300 blocks", "stat": "blocks", "goal": 300, "coins": 600, "gems": 15, "xp": 400},
	{"id": "w_revive5", "text": "Revive 5 teammates", "stat": "revives", "goal": 5, "coins": 600, "gems": 15, "xp": 450},
]
var ACHIEVEMENTS := [
	{"id": "a_first_blood", "text": "First Blood - get your first elimination", "stat": "kills", "goal": 1, "gems": 10},
	{"id": "a_hunter", "text": "Hunter - 100 eliminations", "stat": "kills", "goal": 100, "gems": 40},
	{"id": "a_legend", "text": "Legend - 1000 eliminations", "stat": "kills", "goal": 1000, "gems": 150},
	{"id": "a_champion", "text": "Champion - win your first match", "stat": "wins", "goal": 1, "gems": 25},
	{"id": "a_dynasty", "text": "Dynasty - 25 wins", "stat": "wins", "goal": 25, "gems": 100},
	{"id": "a_sharp", "text": "Sharpshooter - 100 headshots", "stat": "headshots", "goal": 100, "gems": 40},
	{"id": "a_builder", "text": "Master Builder - place 1000 blocks", "stat": "blocks", "goal": 1000, "gems": 40},
	{"id": "a_medic", "text": "Field Medic - heal 5000 HP", "stat": "healed", "goal": 5000, "gems": 30},
	{"id": "a_veteran", "text": "Veteran - play 50 matches", "stat": "matches", "goal": 50, "gems": 50},
	{"id": "a_collector", "text": "Collector - own 20 cosmetics", "stat": "owned", "goal": 20, "gems": 50},
]

## Ranked leagues
var RANKS := [
	{"name": "Wood", "rp": 0, "color": Color(0.6, 0.42, 0.25)},
	{"name": "Stone", "rp": 300, "color": Color(0.6, 0.62, 0.66)},
	{"name": "Bronze", "rp": 700, "color": Color(0.8, 0.5, 0.25)},
	{"name": "Silver", "rp": 1200, "color": Color(0.8, 0.84, 0.9)},
	{"name": "Gold", "rp": 1800, "color": Color(1.0, 0.8, 0.2)},
	{"name": "Crystal", "rp": 2500, "color": Color(0.4, 0.9, 1.0)},
	{"name": "Obsidian", "rp": 3300, "color": Color(0.55, 0.3, 0.85)},
	{"name": "Royale", "rp": 4200, "color": Color(1.0, 0.35, 0.3)},
]
## Season reward per peak rank index: coins, gems, cosmetic (optional, granted once).
var SEASON_REWARDS := [
	{"coins": 200, "gems": 0}, {"coins": 400, "gems": 0}, {"coins": 600, "gems": 10}, {"coins": 900, "gems": 20},
	{"coins": 1200, "gems": 40, "item": "hat_cap"}, {"coins": 1600, "gems": 60, "item": "wrap_arctic"},
	{"coins": 2200, "gems": 90, "item": "wrap_galaxy"}, {"coins": 3000, "gems": 150, "item": "hat_crown"},
]

func rank_index(rp: int) -> int:
	var idx := 0
	for i in RANKS.size():
		if rp >= RANKS[i]["rp"]:
			idx = i
	return idx

# ---------------------------------------------------------------- modes & maps
var MODES := {
	"br_solo": {"name": "Battle Royale - Solo", "short": "BR Solo", "team": 1, "players": 32, "map": "cubic_isle", "kind": "br"},
	"br_duo": {"name": "Battle Royale - Duo", "short": "BR Duo", "team": 2, "players": 32, "map": "cubic_isle", "kind": "br"},
	"br_squad": {"name": "Battle Royale - Squad", "short": "BR Squad", "team": 4, "players": 32, "map": "cubic_isle", "kind": "br"},
	"clash_squad": {"name": "Clash Squad 4v4", "short": "Clash Squad", "team": 4, "players": 8, "map": "clash_town", "kind": "cs"},
	"arena_2v2": {"name": "2v2 Arena", "short": "2v2 Arena", "team": 2, "players": 4, "map": "arena_blocks", "kind": "arena"},
	"training": {"name": "Training Ground", "short": "Training", "team": 1, "players": 6, "map": "training_ground", "kind": "training"},
}
const MODE_ORDER := ["br_solo", "br_duo", "br_squad", "clash_squad", "arena_2v2", "training"]
var MAPS := {
	"cubic_isle": {"name": "Cubic Isle", "size": 256, "height": 64, "seed": 1337, "desc": "Island with villages, forests, river, mountains and a military base."},
	"clash_town": {"name": "Clash Town", "size": 112, "height": 48, "seed": 4242, "desc": "Dense town streets for 4v4 rounds."},
	"arena_blocks": {"name": "Block Arena", "size": 56, "height": 40, "seed": 777, "desc": "Small symmetrical arena with cover."},
	"training_ground": {"name": "Training Ground", "size": 96, "height": 40, "seed": 99, "desc": "Targets, weapon racks and building pads."},
}

## Clash Squad buy menu (prices in round credits)
const CS_START_MONEY := 1000
const CS_ROUND_WIN := 2300
const CS_ROUND_LOSS := 1900
const CS_KILL_REWARD := 300
var CS_SHOP := ["pi_hammer", "smg_buzz", "smg_hornet", "sg_boom", "ar_cobalt", "ar_strike", "sr_hawk", "sr_longshot", "sg_thunder",
	"vest_2", "helm_2", "vest_3", "helm_3", "med_kit", "gr_frag", "gr_smoke", "gr_wall", "blocks"]
const ITEM_PRICES := {"vest_2": 600, "helm_2": 500, "vest_3": 1200, "helm_3": 1000, "med_kit": 400, "blocks": 300}
const ARENA_LOADOUTS := [
	["smg_buzz", "pi_pea"], ["ar_cobalt", "pi_hammer"], ["sg_boom", "smg_hornet"], ["sr_hawk", "smg_buzz"],
	["ar_strike", "sg_boom"], ["sr_longshot", "pi_hammer"], ["sg_thunder", "pi_pea"],
]

const BOT_NAMES := ["Pixelor", "CubeCrusher", "Blocky_Bro", "VoxelVex", "DirtDiver", "StoneCold", "Craftsman", "SkyDropper",
	"LootGoblin", "ZoneRunner", "BoomBox", "Sniper_Sam", "BrickWall", "MossyMike", "IronLung", "QuickScope", "TinyTank",
	"GrassToucher", "LavaLad", "CrateKing", "NoScopeNia", "BridgeTroll", "Obsidianne", "PebblePete", "RedstoneRay",
	"HeadshotHal", "CampfireCat", "BlockParty", "FrostByte", "PickaxePam", "SquadGoals", "RoofRunner", "SandSurfer",
	"GlowSquid", "CactusJack", "TowerTim", "BuilderBee", "ChunkLord", "SpawnPoint", "MinimapMo"]

func _ready() -> void:
	_build_cosmetics()

func weapon(id: String) -> Dictionary:
	return WEAPONS.get(id, {})

func is_weapon(id: String) -> bool:
	return WEAPONS.has(id)

func item_name(id: String) -> String:
	if WEAPONS.has(id):
		return WEAPONS[id]["name"]
	if ITEMS.has(id):
		return ITEMS[id]["name"]
	if id.begins_with("ammo_"):
		return id.substr(5).capitalize() + " Ammo"
	return id

func item_rarity(id: String) -> int:
	if WEAPONS.has(id):
		return int(WEAPONS[id].get("rarity", 0))
	if ITEMS.has(id):
		return int(ITEMS[id].get("rarity", 0))
	return 0

func item_price(id: String) -> int:
	if WEAPONS.has(id):
		return int(WEAPONS[id].get("price", 500))
	return int(ITEM_PRICES.get(id, 300))

func cosmetics_of(type: String) -> Array:
	var out := []
	for id in COSMETICS:
		if COSMETICS[id]["type"] == type:
			out.append(COSMETICS[id])
	out.sort_custom(func(a, b): return a["rarity"] < b["rarity"] or (a["rarity"] == b["rarity"] and a["name"] < b["name"]))
	return out

## Weighted pick from a {id: weight} dictionary.
static func weighted_pick(table: Dictionary, rng: RandomNumberGenerator) -> String:
	var total := 0
	for k in table:
		total += int(table[k])
	var r := rng.randi_range(1, max(1, total))
	for k in table:
		r -= int(table[k])
		if r <= 0:
			return k
	return table.keys()[0]
