class_name Blocks
extends RefCounted
## Block type registry. Ids fit in a byte. Texture layers index the procedural Texture2DArray.

const AIR := 0
const GRASS := 1
const DIRT := 2
const STONE := 3
const SAND := 4
const WATER := 5
const LOG := 6
const LEAVES := 7
const PLANKS := 8
const BRICK := 9
const ROOF_RED := 10
const ROOF_BLUE := 11
const CONCRETE := 12
const METAL := 13
const CRATE := 14
const GLASS := 15
const GRAVEL := 16
const ASPHALT := 17
const ROAD_LINE := 18
const SNOW := 19
const SANDSTONE := 20
const COBBLE := 21
const HAY := 22
const SANDBAG := 23
const CAMO := 24
const LAMP := 25
const BUILD := 26
const BEDROCK := 27
const PINE_LEAVES := 28
const DARK_PLANKS := 29
const TEAM_RED := 30
const TEAM_BLUE := 31
const TARGET := 32
const FARMLAND := 33
const MOSSY := 34
const BARRIER := 35  # invisible wall
const COUNT := 36

## Texture tile names (layer index = position in this array).
const TILES := [
	"grass_top", "grass_side", "dirt", "stone", "sand", "water", "log_side", "log_top", "leaves", "planks",
	"brick", "roof_red", "roof_blue", "concrete", "metal", "crate", "glass", "gravel", "asphalt", "road_line",
	"snow", "snow_side", "sandstone", "cobble", "hay", "sandbag", "camo", "lamp", "build", "bedrock",
	"pine_leaves", "dark_planks", "team_red", "team_blue", "target", "farmland", "mossy", "hay_top",
]

static var _solid := PackedByteArray()
static var _opaque := PackedByteArray()
static var _tex := PackedInt32Array()   # 3 entries per block: top, side, bottom
static var _emit := PackedByteArray()
static var _color := PackedColorArray()  # minimap colors
static var _ready_done := false

static func _t(name: String) -> int:
	return TILES.find(name)

static func setup() -> void:
	if _ready_done:
		return
	_ready_done = true
	_solid.resize(256)
	_opaque.resize(256)
	_emit.resize(256)
	_tex.resize(256 * 3)
	_color.resize(256)
	for i in 256:
		_solid[i] = 0
		_opaque[i] = 0
		_emit[i] = 0
		_color[i] = Color.MAGENTA
	_def(GRASS, "grass_top", "grass_side", "dirt", Color(0.36, 0.62, 0.27))
	_def(DIRT, "dirt", "dirt", "dirt", Color(0.52, 0.37, 0.24))
	_def(STONE, "stone", "stone", "stone", Color(0.5, 0.5, 0.52))
	_def(SAND, "sand", "sand", "sand", Color(0.86, 0.8, 0.56))
	_def(LOG, "log_top", "log_side", "log_top", Color(0.4, 0.29, 0.17))
	_def(LEAVES, "leaves", "leaves", "leaves", Color(0.2, 0.48, 0.18))
	_def(PLANKS, "planks", "planks", "planks", Color(0.7, 0.53, 0.32))
	_def(BRICK, "brick", "brick", "brick", Color(0.66, 0.3, 0.24))
	_def(ROOF_RED, "roof_red", "roof_red", "planks", Color(0.72, 0.25, 0.2))
	_def(ROOF_BLUE, "roof_blue", "roof_blue", "planks", Color(0.25, 0.38, 0.65))
	_def(CONCRETE, "concrete", "concrete", "concrete", Color(0.68, 0.68, 0.66))
	_def(METAL, "metal", "metal", "metal", Color(0.36, 0.4, 0.34))
	_def(CRATE, "crate", "crate", "crate", Color(0.62, 0.45, 0.25))
	_def(GLASS, "glass", "glass", "glass", Color(0.7, 0.85, 0.92))
	_opaque[GLASS] = 0
	_def(GRAVEL, "gravel", "gravel", "gravel", Color(0.55, 0.53, 0.5))
	_def(ASPHALT, "asphalt", "asphalt", "asphalt", Color(0.24, 0.24, 0.26))
	_def(ROAD_LINE, "road_line", "asphalt", "asphalt", Color(0.3, 0.3, 0.3))
	_def(SNOW, "snow", "snow_side", "dirt", Color(0.94, 0.96, 0.98))
	_def(SANDSTONE, "sandstone", "sandstone", "sandstone", Color(0.82, 0.72, 0.5))
	_def(COBBLE, "cobble", "cobble", "cobble", Color(0.45, 0.45, 0.46))
	_def(HAY, "hay_top", "hay", "hay_top", Color(0.85, 0.72, 0.25))
	_def(SANDBAG, "sandbag", "sandbag", "sandbag", Color(0.7, 0.62, 0.45))
	_def(CAMO, "camo", "camo", "camo", Color(0.3, 0.38, 0.24))
	_def(LAMP, "lamp", "lamp", "lamp", Color(1.0, 0.9, 0.5))
	_emit[LAMP] = 1
	_def(BUILD, "build", "build", "build", Color(0.3, 0.75, 0.95))
	_def(BEDROCK, "bedrock", "bedrock", "bedrock", Color(0.15, 0.15, 0.16))
	_def(PINE_LEAVES, "pine_leaves", "pine_leaves", "pine_leaves", Color(0.15, 0.36, 0.22))
	_def(DARK_PLANKS, "dark_planks", "dark_planks", "dark_planks", Color(0.4, 0.28, 0.17))
	_def(TEAM_RED, "team_red", "team_red", "team_red", Color(0.85, 0.2, 0.2))
	_def(TEAM_BLUE, "team_blue", "team_blue", "team_blue", Color(0.2, 0.4, 0.9))
	_def(TARGET, "target", "target", "target", Color(0.9, 0.9, 0.9))
	_def(FARMLAND, "farmland", "dirt", "dirt", Color(0.45, 0.32, 0.2))
	_def(MOSSY, "mossy", "mossy", "mossy", Color(0.4, 0.5, 0.38))
	# Water: visible, not solid, not opaque.
	_tex[WATER * 3] = _t("water")
	_tex[WATER * 3 + 1] = _t("water")
	_tex[WATER * 3 + 2] = _t("water")
	_color[WATER] = Color(0.2, 0.45, 0.75)
	# Barrier: solid, invisible.
	_solid[BARRIER] = 1
	_color[BARRIER] = Color(0, 0, 0, 0)

static func _def(id: int, top: String, side: String, bottom: String, col: Color) -> void:
	_solid[id] = 1
	_opaque[id] = 1
	_tex[id * 3] = _t(top)
	_tex[id * 3 + 1] = _t(side)
	_tex[id * 3 + 2] = _t(bottom)
	_color[id] = col

static func solid_table() -> PackedByteArray:
	setup()
	return _solid

static func opaque_table() -> PackedByteArray:
	setup()
	return _opaque

static func tex_table() -> PackedInt32Array:
	setup()
	return _tex

static func emit_table() -> PackedByteArray:
	setup()
	return _emit

static func is_solid(id: int) -> bool:
	setup()
	return _solid[id] == 1

static func map_color(id: int) -> Color:
	setup()
	return _color[id]
