// neurio Craft — block registry. `tiles` reference the procedural atlas
// (see textures.js, 8 columns). Tile ids:
export const TILE = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, SAND: 4, LOG_SIDE: 5, LOG_TOP: 6, LEAVES: 7,
  PLANKS: 8, COBBLE: 9, BRICK: 10, GLASS: 11, BEDROCK: 12, SNOW_TOP: 13, SNOW_SIDE: 14, GRAVEL: 15,
  STONEBRICK: 16, SANDSTONE: 17, BIRCH_SIDE: 18, WATER: 19, ROSE: 20, TALLGRASS: 21,
  CACTUS_SIDE: 22, CACTUS_TOP: 23, CRAFT_TOP: 24, CRAFT_SIDE: 25, DIAMOND_ORE: 26, GOLD_ORE: 27,
  COAL_ORE: 28, TNT_SIDE: 29, TNT_TOP: 30, PUMPKIN_SIDE: 31, PUMPKIN_TOP: 32,
};

export const AIR = 0;
export const B = {
  GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, LOG: 5, LEAVES: 6, PLANKS: 7, COBBLE: 8, BRICK: 9,
  GLASS: 10, BEDROCK: 11, SNOW: 12, GRAVEL: 13, STONEBRICK: 14, SANDSTONE: 15, WATER: 16,
  BIRCH: 17, CACTUS: 18, CRAFT: 19, DIAMOND_ORE: 20, GOLD_ORE: 21, COAL_ORE: 22, TNT: 23,
  PUMPKIN: 24, TALLGRASS: 25, ROSE: 26,
};

// color = particle / minimap-ish tint. transparent → glass-like rendering.
// cross → plant rendered as two diagonal quads, non-solid.
export const BLOCKS = {
  [B.GRASS]:       { name: 'Grass Block',  ar: 'عشب',        top: TILE.GRASS_TOP, side: TILE.GRASS_SIDE, bottom: TILE.DIRT, color: 0x67a73c },
  [B.DIRT]:        { name: 'Dirt',         ar: 'تراب',       all: TILE.DIRT, color: 0x8a5f3c },
  [B.STONE]:       { name: 'Stone',        ar: 'حجر',        all: TILE.STONE, color: 0x7d7d7d },
  [B.SAND]:        { name: 'Sand',         ar: 'رمل',        all: TILE.SAND, color: 0xdcd29b },
  [B.LOG]:         { name: 'Oak Log',      ar: 'خشب بلوط',   top: TILE.LOG_TOP, side: TILE.LOG_SIDE, bottom: TILE.LOG_TOP, color: 0x6b5230 },
  [B.LEAVES]:      { name: 'Oak Leaves',   ar: 'أوراق',      all: TILE.LEAVES, color: 0x3e7d28 },
  [B.PLANKS]:      { name: 'Oak Planks',   ar: 'ألواح',      all: TILE.PLANKS, color: 0xb08d57 },
  [B.COBBLE]:      { name: 'Cobblestone',  ar: 'حصى',        all: TILE.COBBLE, color: 0x757575 },
  [B.BRICK]:       { name: 'Bricks',       ar: 'طوب',        all: TILE.BRICK, color: 0x9c5a4a },
  [B.GLASS]:       { name: 'Glass',        ar: 'زجاج',       all: TILE.GLASS, color: 0xd8f2f5, transparent: true },
  [B.BEDROCK]:     { name: 'Bedrock',      ar: 'صخر أساسي',  all: TILE.BEDROCK, color: 0x3a3a3a, unbreakable: true },
  [B.SNOW]:        { name: 'Snow',         ar: 'ثلج',        top: TILE.SNOW_TOP, side: TILE.SNOW_SIDE, bottom: TILE.DIRT, color: 0xf2f7f7 },
  [B.GRAVEL]:      { name: 'Gravel',       ar: 'حصى رملي',   all: TILE.GRAVEL, color: 0x8a8078 },
  [B.STONEBRICK]:  { name: 'Stone Bricks', ar: 'طوب حجري',   all: TILE.STONEBRICK, color: 0x7a7a7a },
  [B.SANDSTONE]:   { name: 'Sandstone',    ar: 'حجر رملي',   all: TILE.SANDSTONE, color: 0xd8cf9f },
  [B.WATER]:       { name: 'Water',        ar: 'ماء',        all: TILE.WATER, color: 0x3f76e4, water: true, solid: false },
  [B.BIRCH]:       { name: 'Birch Log',    ar: 'خشب بتولا',  top: TILE.LOG_TOP, side: TILE.BIRCH_SIDE, bottom: TILE.LOG_TOP, color: 0xd8d3c3 },
  [B.CACTUS]:      { name: 'Cactus',       ar: 'صبار',       top: TILE.CACTUS_TOP, side: TILE.CACTUS_SIDE, bottom: TILE.CACTUS_TOP, color: 0x4c7d33 },
  [B.CRAFT]:       { name: 'Crafting Table', ar: 'طاولة صناعة', top: TILE.CRAFT_TOP, side: TILE.CRAFT_SIDE, bottom: TILE.PLANKS, color: 0xa07c4a },
  [B.DIAMOND_ORE]: { name: 'Diamond Ore',  ar: 'ألماس',      all: TILE.DIAMOND_ORE, color: 0x6fe3dd },
  [B.GOLD_ORE]:    { name: 'Gold Ore',     ar: 'ذهب',        all: TILE.GOLD_ORE, color: 0xf5d04a },
  [B.COAL_ORE]:    { name: 'Coal Ore',     ar: 'فحم',        all: TILE.COAL_ORE, color: 0x4a4a4a },
  [B.TNT]:         { name: 'TNT',          ar: 'متفجرات',    top: TILE.TNT_TOP, side: TILE.TNT_SIDE, bottom: TILE.TNT_TOP, color: 0xd63c22, explosive: true },
  [B.PUMPKIN]:     { name: 'Pumpkin',      ar: 'يقطين',      top: TILE.PUMPKIN_TOP, side: TILE.PUMPKIN_SIDE, bottom: TILE.PUMPKIN_SIDE, color: 0xd9821e },
  [B.TALLGRASS]:   { name: 'Tall Grass',   ar: 'عشب طويل',   all: TILE.TALLGRASS, color: 0x5f9e38, cross: true, solid: false },
  [B.ROSE]:        { name: 'Rose',         ar: 'وردة',       all: TILE.ROSE, color: 0xd63c4a, cross: true, solid: false },
};

export function tileFor(id, faceDirY) {
  const d = BLOCKS[id];
  if (!d) return 0;
  if (d.all !== undefined) return d.all;
  if (faceDirY > 0) return d.top;
  if (faceDirY < 0) return d.bottom;
  return d.side;
}

export const isOpaque = (id) => !!id && !BLOCKS[id]?.transparent && !BLOCKS[id]?.cross && !BLOCKS[id]?.water;
export const isSolid = (id) => !!id && BLOCKS[id]?.solid !== false;
export const isWater = (id) => id === B.WATER;

// Everything the player can put in the hotbar (creative inventory order).
export const PLACEABLE = [
  B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.STONEBRICK, B.SAND, B.SANDSTONE, B.GRAVEL,
  B.LOG, B.BIRCH, B.PLANKS, B.LEAVES, B.CRAFT, B.GLASS, B.BRICK, B.SNOW,
  B.CACTUS, B.PUMPKIN, B.COAL_ORE, B.GOLD_ORE, B.DIAMOND_ORE, B.TNT, B.TALLGRASS, B.ROSE,
];
