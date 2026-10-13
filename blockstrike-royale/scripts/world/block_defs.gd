extends RefCounted
## Voxel block definitions. Block ids are stored as bytes in the world grid.
## Tile indices refer to the procedural atlas built by texture_atlas.gd (8 cols x 4 rows).

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
const CONCRETE := 10
const GLASS := 11
const ROAD := 12
const CRATE := 13
const SANDBAG := 14
const ROOF := 15
const METAL := 16
const COBBLE := 17
const COUNT := 18

const NAMES := ["air", "grass", "dirt", "stone", "sand", "water", "log", "leaves", "planks", "brick",
	"concrete", "glass", "road", "crate", "sandbag", "roof", "metal", "cobble"]

const TILE_TOP := [0, 0, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
const TILE_SIDE := [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
const TILE_BOTTOM := [0, 2, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]

## Approximate average colour, used for the minimap and debris particles.
const COLORS := [
	Color(0, 0, 0, 0), Color(0.36, 0.66, 0.26), Color(0.48, 0.33, 0.2), Color(0.5, 0.5, 0.52),
	Color(0.86, 0.8, 0.56), Color(0.2, 0.45, 0.85), Color(0.4, 0.28, 0.16), Color(0.2, 0.5, 0.2),
	Color(0.7, 0.52, 0.3), Color(0.6, 0.27, 0.2), Color(0.66, 0.66, 0.66), Color(0.6, 0.85, 0.95),
	Color(0.3, 0.3, 0.32), Color(0.6, 0.45, 0.25), Color(0.85, 0.7, 0.4), Color(0.5, 0.2, 0.18),
	Color(0.45, 0.5, 0.55), Color(0.42, 0.42, 0.4),
]

## Blocks that block movement and bullets (water and air do not).
static func is_solid(id: int) -> bool:
	return id != AIR and id != WATER


## Blocks that hide the face of a neighbour (water and glass are see-through).
static func is_opaque(id: int) -> bool:
	return id != AIR and id != WATER and id != GLASS


static func color_of(id: int) -> Color:
	if id < 0 or id >= COLORS.size():
		return Color.MAGENTA
	return COLORS[id]
