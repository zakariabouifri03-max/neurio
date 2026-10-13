class_name VoxelLibrary
extends RefCounted
## Block definitions and atlas UV lookup.
##
## The atlas (assets/textures/atlas.png + atlas.json) packs every tile into one
## texture so a whole chunk renders in a single draw call.  Blocks reference tiles
## by name; nothing else in the game needs to know about UV coordinates.

const ATLAS_TEXTURE := "res://assets/textures/atlas.png"
const ATLAS_TABLE := "res://assets/textures/atlas.json"

enum Block {
	AIR = 0,
	GRASS = 1,
	DIRT = 2,
	STONE = 3,
	COBBLE = 4,
	SAND = 5,
	GRAVEL = 6,
	SNOW = 7,
	WOOD = 8,
	LEAVES = 9,
	CONCRETE = 10,
	METAL = 11,
	BRICK = 12,
	WATER = 13,
	PLANKS = 14,
	ROOF = 15,
	ROOF_BLUE = 16,
	GLASS = 17,
	ROAD = 18,
	CRATE = 19,
	LOG = 20,
	ICE = 21,
	MARKER = 22,
	TARGET = 23,
}

const BLOCKS := {
	Block.AIR: {"name": "Air", "top": "", "side": "", "bottom": "", "solid": false,
				"transparent": true, "water": false, "material": "none", "breakable": false},
	Block.GRASS: {"name": "Grass", "top": "grass_top", "side": "grass_side", "bottom": "dirt",
				  "solid": true, "transparent": false, "water": false, "material": "grass",
				  "breakable": true},
	Block.DIRT: {"name": "Dirt", "top": "dirt", "side": "dirt", "bottom": "dirt", "solid": true,
				 "transparent": false, "water": false, "material": "grass", "breakable": true},
	Block.STONE: {"name": "Stone", "top": "stone", "side": "stone", "bottom": "stone",
				  "solid": true, "transparent": false, "water": false, "material": "stone",
				  "breakable": true},
	Block.COBBLE: {"name": "Cobblestone", "top": "cobble", "side": "cobble", "bottom": "cobble",
				   "solid": true, "transparent": false, "water": false, "material": "stone",
				   "breakable": true},
	Block.SAND: {"name": "Sand", "top": "sand", "side": "sand", "bottom": "sand", "solid": true,
				 "transparent": false, "water": false, "material": "grass", "breakable": true},
	Block.GRAVEL: {"name": "Gravel", "top": "gravel", "side": "gravel", "bottom": "gravel",
				   "solid": true, "transparent": false, "water": false, "material": "stone",
				   "breakable": true},
	Block.SNOW: {"name": "Snow", "top": "snow", "side": "snow_side", "bottom": "dirt",
				 "solid": true, "transparent": false, "water": false, "material": "grass",
				 "breakable": true},
	Block.WOOD: {"name": "Wood", "top": "log_top", "side": "log_side", "bottom": "log_top",
				 "solid": true, "transparent": false, "water": false, "material": "wood",
				 "breakable": true},
	Block.LEAVES: {"name": "Leaves", "top": "leaves", "side": "leaves", "bottom": "leaves",
				   "solid": true, "transparent": true, "water": false, "material": "wood",
				   "breakable": true},
	Block.CONCRETE: {"name": "Concrete", "top": "concrete", "side": "concrete",
					 "bottom": "concrete", "solid": true, "transparent": false, "water": false,
					 "material": "stone", "breakable": true},
	Block.METAL: {"name": "Metal", "top": "metal", "side": "metal", "bottom": "metal",
				  "solid": true, "transparent": false, "water": false, "material": "metal",
				  "breakable": true},
	Block.BRICK: {"name": "Brick", "top": "brick", "side": "brick", "bottom": "brick",
				  "solid": true, "transparent": false, "water": false, "material": "stone",
				  "breakable": true},
	Block.WATER: {"name": "Water", "top": "water", "side": "water", "bottom": "water",
				  "solid": false, "transparent": true, "water": true, "material": "water",
				  "breakable": false},
	Block.PLANKS: {"name": "Planks", "top": "planks", "side": "planks", "bottom": "planks",
				   "solid": true, "transparent": false, "water": false, "material": "wood",
				   "breakable": true},
	Block.ROOF: {"name": "Roof", "top": "roof", "side": "roof", "bottom": "planks", "solid": true,
				 "transparent": false, "water": false, "material": "wood", "breakable": true},
	Block.ROOF_BLUE: {"name": "Blue Roof", "top": "roof_blue", "side": "roof_blue",
					  "bottom": "planks", "solid": true, "transparent": false, "water": false,
					  "material": "wood", "breakable": true},
	Block.GLASS: {"name": "Glass", "top": "glass", "side": "glass", "bottom": "glass",
				  "solid": true, "transparent": true, "water": false, "material": "metal",
				  "breakable": true},
	Block.ROAD: {"name": "Road", "top": "road", "side": "road", "bottom": "stone", "solid": true,
				 "transparent": false, "water": false, "material": "stone", "breakable": true},
	Block.CRATE: {"name": "Crate", "top": "crate", "side": "crate", "bottom": "crate",
				  "solid": true, "transparent": false, "water": false, "material": "wood",
				  "breakable": true},
	Block.LOG: {"name": "Log", "top": "log_top", "side": "log_side", "bottom": "log_top",
				"solid": true, "transparent": false, "water": false, "material": "wood",
				"breakable": true},
	Block.ICE: {"name": "Ice", "top": "ice", "side": "ice", "bottom": "ice", "solid": true,
				"transparent": false, "water": false, "material": "stone", "breakable": true},
	Block.MARKER: {"name": "Marker", "top": "marker", "side": "marker", "bottom": "marker",
				   "solid": true, "transparent": false, "water": false, "material": "metal",
				   "breakable": false},
	Block.TARGET: {"name": "Target", "top": "target", "side": "target", "bottom": "target",
				   "solid": true, "transparent": false, "water": false, "material": "wood",
				   "breakable": false},
}

static var _uv: Dictionary = {}
static var _uv_cache: Dictionary = {}
static var _atlas: Texture2D = null
static var _material: StandardMaterial3D = null
static var _water_material: StandardMaterial3D = null
static var _loaded: bool = false

## Loads atlas metadata.  Returns false when the textures have not been generated
## yet (run tools/assets/gen_textures.py, then open the project once so Godot
## imports the PNG files).
static func load_atlas() -> bool:
	if _loaded:
		return _atlas != null
	_loaded = true
	if not FileAccess.file_exists(ATLAS_TABLE):
		push_error("VoxelLibrary: %s missing - run tools/assets/gen_textures.py" % ATLAS_TABLE)
		return false
	var table: Variant = JSON.parse_string(FileAccess.get_file_as_string(ATLAS_TABLE))
	if typeof(table) != TYPE_DICTIONARY:
		push_error("VoxelLibrary: atlas.json is not a dictionary")
		return false
	var table_info: Dictionary = table as Dictionary
	var tiles: Variant = table_info.get("tiles", {})
	if typeof(tiles) != TYPE_DICTIONARY:
		push_error("VoxelLibrary: atlas.json has no tiles block")
		return false
	_uv = _inset_tiles(tiles as Dictionary, table_info)
	_uv_cache.clear()
	if ResourceLoader.exists(ATLAS_TEXTURE):
		_atlas = load(ATLAS_TEXTURE) as Texture2D
	else:
		push_warning("VoxelLibrary: atlas.png not imported yet")
	return _atlas != null

## The atlas packs tiles edge to edge, so sampling exactly on a tile boundary can
## grab the first texel of the neighbouring tile (a one pixel seam of the wrong
## colour along every face edge).  Pulling each rect half a texel inwards samples
## texel centres instead, which is the standard fix and costs nothing at runtime.
static func _inset_tiles(tiles: Dictionary, table: Dictionary) -> Dictionary:
	var width := maxf(1.0, float(table.get("width", 0)))
	var height := maxf(1.0, float(table.get("height", 0)))
	var half_u := 0.5 / width
	var half_v := 0.5 / height
	var out: Dictionary = {}
	for tile: String in tiles.keys():
		var entry: Dictionary = (tiles[tile] as Dictionary).duplicate()
		entry["u0"] = float(entry.get("u0", 0.0)) + half_u
		entry["u1"] = float(entry.get("u1", 1.0)) - half_u
		entry["v0"] = float(entry.get("v0", 0.0)) + half_v
		entry["v1"] = float(entry.get("v1", 1.0)) - half_v
		out[tile] = entry
	return out

static func atlas_texture() -> Texture2D:
	load_atlas()
	return _atlas

static func atlas_material() -> StandardMaterial3D:
	if _material != null:
		return _material
	var material := StandardMaterial3D.new()
	material.albedo_texture = atlas_texture()
	material.vertex_color_use_as_albedo = true
	material.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	material.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	material.roughness = 0.95
	_material = material
	return material

static func water_material() -> StandardMaterial3D:
	if _water_material != null:
		return _water_material
	var material := StandardMaterial3D.new()
	material.albedo_texture = atlas_texture()
	material.vertex_color_use_as_albedo = true
	material.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	material.roughness = 0.25
	material.metallic = 0.2
	material.alpha_scissor_threshold = 0.0
	_water_material = material
	return material

## Returns {"uv": [u0,v0,u1,v1], "tint": Color} for a tile name, or a magenta
## checker substitute when the tile is unknown (impossible to miss while testing).
## Returns the cached [u0, v0, u1, v1] rect for an atlas tile.  Caching matters:
## this is called once per visible face while meshing a chunk.
static func uv_for(tile: String) -> Array:
	var cached: Variant = _uv_cache.get(tile)
	if cached != null:
		return cached
	load_atlas()
	var entry: Variant = _uv.get(tile)
	var rect: Array = [0.0, 0.0, 1.0, 1.0]
	if typeof(entry) == TYPE_DICTIONARY:
		var data: Dictionary = entry
		rect = [float(data.get("u0", 0.0)), float(data.get("v0", 0.0)),
				float(data.get("u1", 1.0)), float(data.get("v1", 1.0))]
	_uv_cache[tile] = rect
	return rect

static func info(block_id: int) -> Dictionary:
	return BLOCKS.get(block_id, BLOCKS[Block.AIR])

static func is_solid(block_id: int) -> bool:
	if block_id == Block.AIR:
		return false
	return bool(info(block_id).get("solid", true))

static func is_water(block_id: int) -> bool:
	return bool(info(block_id).get("water", false))

static func is_opaque(block_id: int) -> bool:
	if block_id == Block.AIR:
		return false
	return not bool(info(block_id).get("transparent", false))

static func material_kind(block_id: int) -> String:
	return str(info(block_id).get("material", "stone"))

static func block_id_by_name(block_name: String) -> int:
	for id: Variant in BLOCKS.keys():
		if str((BLOCKS[id] as Dictionary).get("name", "")).to_lower() == block_name.to_lower():
			return int(id)
	return Block.AIR

## Impact sound for a block type, used by bullets and melee.
static func impact_sound(block_id: int) -> String:
	match material_kind(block_id):
		"metal":
			return "impact_metal"
		"wood":
			return "impact_wood"
		"water":
			return "footstep_water"
	return "impact_stone"

static func footstep_sound(block_id: int) -> String:
	match material_kind(block_id):
		"wood":
			return "footstep_wood"
		"metal":
			return "footstep_stone"
		"water":
			return "footstep_water"
		"grass":
			return "footstep_grass"
	return "footstep_stone"
