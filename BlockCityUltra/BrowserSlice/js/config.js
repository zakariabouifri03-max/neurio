// BLOCK CITY ULTRA — browser slice configuration.

/** World scale. One voxel = 0.5 m here so a 64-voxel block is a 32 m street. */
export const VOXEL = 0.5;

/** City extent, in blocks. 12×12 blocks ≈ a 1.4 km × 1.4 km slice. */
export const CITY_BLOCKS = 12;
export const BLOCK_SIZE = 64;              // voxels per block edge
export const ROAD_HALF = 7;                // voxels, half carriageway
export const SIDEWALK = 3;                 // voxels

export const WORLD_SIZE = CITY_BLOCKS * BLOCK_SIZE * VOXEL;   // metres

/** Districts. Original names — no real city or existing game is reproduced. */
export const DISTRICTS = [
  { id: 'foundry',  name: 'FOUNDRY HEIGHTS', color: 0x5c84d6, density: 0.95, verticality: 0.95, nature: 0.06, interior: 0.22 },
  { id: 'marbella', name: 'MARBELLA ROW',    color: 0xdbbc84, density: 0.86, verticality: 0.52, nature: 0.20, interior: 0.30 },
  { id: 'neon',     name: 'NEON MILE',       color: 0xdb569e, density: 0.90, verticality: 0.66, nature: 0.10, interior: 0.42 },
  { id: 'rowan',    name: 'ROWAN PARK',      color: 0x6bb866, density: 0.72, verticality: 0.18, nature: 0.50, interior: 0.06 },
  { id: 'ironside', name: 'IRONSIDE DOCKS',  color: 0x75706a, density: 0.66, verticality: 0.14, nature: 0.16, interior: 0.10 },
  { id: 'calder',   name: 'CALDER INTL',     color: 0x8499b8, density: 0.34, verticality: 0.22, nature: 0.30, interior: 0.00 },
];

/** Which district owns which cell of the CITY_BLOCKS × CITY_BLOCKS grid.
 *  A fixed macro-plan so the slice always reads as one coherent city. */
export function districtAt(bx, by, n = CITY_BLOCKS) {
  // Normalised so the plan scales with CITY_BLOCKS instead of being tuned for
  // one size. d = 0 is the exact centre, d = 1 is the corner of the slice.
  const cx = (bx - n / 2 + 0.5) / (n / 2);
  const cy = (by - n / 2 + 0.5) / (n / 2);
  const d = Math.hypot(cx, cy);

  if (d < 0.34) return 0;                     // Foundry Heights — downtown core
  if (d < 0.62) return cx > cy ? 2 : 1;       // Neon Mile east, Marbella Row west
  if (d < 0.92) return cx + cy > 0 ? 4 : 3;   // Ironside Docks, Rowan Park
  return 5;                                   // Calder International / outskirts
}

/** Graphics presets. Mirror the UE5 project's four scalability groups. */
export const PRESETS = {
  performance: {
    label: 'PERFORMANCE', drawDistance: 260, buildingsPerBlockCap: 2,
    trafficCount: 14, pedCount: 40, shadows: false, rain: false,
    pixelRatio: 0.75, fogNear: 60, fogFar: 300, antialias: false, wetness: 0.0,
  },
  balanced: {
    label: 'BALANCED', drawDistance: 380, buildingsPerBlockCap: 3,
    trafficCount: 22, pedCount: 80, shadows: true, rain: false,
    pixelRatio: 0.9, fogNear: 90, fogFar: 420, antialias: true, wetness: 0.15,
  },
  quality: {
    label: 'QUALITY', drawDistance: 560, buildingsPerBlockCap: 4,
    trafficCount: 34, pedCount: 140, shadows: true, rain: true,
    pixelRatio: 1.0, fogNear: 120, fogFar: 620, antialias: true, wetness: 0.45,
  },
  ultra: {
    label: 'ULTRA', drawDistance: 780, buildingsPerBlockCap: 6,
    trafficCount: 48, pedCount: 220, shadows: true, rain: true,
    // Guarded so the config module can be imported headlessly (Tools/smoke-test.mjs).
    pixelRatio: Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1),
    fogNear: 150, fogFar: 840, antialias: true, wetness: 0.75,
  },
};

/** Player tuning. Values in metres/second to match the UE5 character. */
export const PLAYER = {
  walkSpeed: 1.8, jogSpeed: 4.2, sprintSpeed: 6.6,
  accel: 24, decel: 32, jumpVelocity: 5.2, gravity: 18,
  eyeHeight: 1.62, radius: 0.36, height: 1.82,
  staminaDrain: 0.16, staminaRegen: 0.11, maxHealth: 100,
};

/** Vehicle tuning. One shared model; per-vehicle stats scale it. */
export const VEHICLES = [
  { id: 'kestrel_c1',    name: 'Kestrel C1',        class: 'Compact',   mass: 1240, torque: 180, top: 178, grip: 1.00, brake: 1.00, color: 0xc8ccd4, w: 4, h: 4, l: 9 },
  { id: 'bramford_240',  name: 'Bramford 240',      class: 'Sedan',     mass: 1480, torque: 240, top: 196, grip: 1.02, brake: 1.05, color: 0x2f6fb5, w: 4, h: 4, l: 10 },
  { id: 'vellum_gt',     name: 'Vellum GT',         class: 'Supercar',  mass: 1395, torque: 720, top: 338, grip: 1.34, brake: 1.42, color: 0xd4a017, w: 4, h: 3, l: 10 },
  { id: 'kestrel_rs',    name: 'Kestrel RS',        class: 'Muscle',    mass: 1720, torque: 610, top: 262, grip: 1.16, brake: 1.20, color: 0xb22222, w: 4, h: 4, l: 10 },
  { id: 'rowan_trail',   name: 'Rowan Trailblazer', class: 'SUV',       mass: 2180, torque: 420, top: 198, grip: 1.05, brake: 1.08, color: 0x3d5a3d, w: 5, h: 5, l: 10 },
  { id: 'neon_courier',  name: 'Neon Courier',      class: 'Van',       mass: 2020, torque: 320, top: 168, grip: 0.94, brake: 0.96, color: 0xe8e4da, w: 5, h: 7, l: 12 },
  { id: 'ashfall_1500',  name: 'Ashfall 1500',      class: 'Pickup',    mass: 2340, torque: 460, top: 186, grip: 1.00, brake: 1.02, color: 0x6b5a45, w: 5, h: 5, l: 11 },
  { id: 'vault_cruiser', name: 'Vault City Cruiser',class: 'Police',    mass: 1860, torque: 440, top: 232, grip: 1.14, brake: 1.22, color: 0xf2f4f8, w: 4, h: 4, l: 10, police: true },
];

/** Police response profile per wanted level. */
export const WANTED = [
  { units: 0, responseTime: 0,   aggression: 0.0, decayPerSec: 0 },
  { units: 1, responseTime: 9,   aggression: 0.35, decayPerSec: 0.30 },
  { units: 2, responseTime: 7,   aggression: 0.55, decayPerSec: 0.24 },
  { units: 3, responseTime: 5.5, aggression: 0.75, decayPerSec: 0.18 },
  { units: 4, responseTime: 4.5, aggression: 0.90, decayPerSec: 0.13 },
  { units: 5, responseTime: 3.5, aggression: 1.05, decayPerSec: 0.09 },
  { units: 6, responseTime: 2.8, aggression: 1.20, decayPerSec: 0.06 },
];

/** Heat contributed by each crime. Matches the UE5 table exactly. */
export const CRIME_HEAT = {
  traffic: 8, reckless: 18, damage: 22, theft: 34, pedestrian: 40,
  assault: 48, gunfire: 55, officer: 72, evasion: 60, explosion: 95, heist: 160,
};

/** Wanted-level heat thresholds. */
export const WANTED_THRESHOLDS = [0, 25, 70, 150, 280, 460, 700];

/** Day length in real seconds for the slice (a full 24 h cycle). */
export const DAY_LENGTH_SECONDS = 300;

export const STARTING_CASH = 2500;
