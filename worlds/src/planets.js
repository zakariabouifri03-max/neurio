// ── The 100 planets ─────────────────────────────────────────────────────────
// Each planet is one seed: biome, sky, gravity, terrain shape and the giant
// flora that grows on it. Nothing here is random at runtime — planet #37 is
// always the same planet.

import { mulberry32, rand, randi, pick, mixHex } from './rng.js';

export const PLANET_COUNT = 100;

// ── biomes ──────────────────────────────────────────────────────────────────
// scale  = how huge the plants grow (multiplier on real-world metres)
// night  = local sun is down, flora glows instead
export const BIOMES = {
  emerald: {
    label: 'Emerald Canopy', night: false, water: 0.15,
    sky: ['#5ec3f0', '#cdefff'], sun: '#fff6dc', fog: '#bfe6f2',
    ground: ['#2f6b33', '#4f9a3c'], trunk: '#5b4630',
    leaf: ['#2f8f3e', '#43b04a', '#1f6d33'], bloom: '#f4d35e', glow: 0.0,
    species: ['titanArbor', 'spiralConifer', 'towerFern', 'vineTower', 'bulbBloom'],
    scale: 1.25, density: 1.15, amp: 26,
  },
  spore: {
    label: 'Crimson Spore Forest', night: true, water: 0.1,
    sky: ['#2a0f1c', '#8c2b32'], sun: '#ff9d6b', fog: '#4a1a22',
    ground: ['#4a2020', '#7a3524'], trunk: '#d9c9a8',
    leaf: ['#c8384a', '#e0653f', '#8f2333'], bloom: '#ffd166', glow: 0.55,
    species: ['giantFungus', 'giantFungus', 'towerFern', 'crystalSpire', 'podTree'],
    scale: 1.0, density: 1.25, amp: 16,
  },
  lagoon: {
    label: 'Azure Lagoon', night: false, water: 0.55,
    sky: ['#3fa9e0', '#bff0ff'], sun: '#fff8e0', fog: '#a9dff0',
    ground: ['#2b7f8c', '#c9b98d'], trunk: '#8a6a45',
    leaf: ['#2ec4a6', '#57d9b0', '#1f9e86'], bloom: '#ff7ab8', glow: 0.1,
    species: ['umbrellaCap', 'towerFern', 'titanArbor', 'bulbBloom', 'vineTower'],
    scale: 1.05, density: 0.9, amp: 12,
  },
  amber: {
    label: 'Amber Savanna', night: false, water: 0.12,
    sky: ['#f0a94a', '#ffe6b0'], sun: '#fff1c4', fog: '#f0d7a8',
    ground: ['#a8813a', '#d9b768'], trunk: '#6b4a2a',
    leaf: ['#c9a227', '#e0c05a', '#8f7a24'], bloom: '#e76f51', glow: 0.0,
    species: ['umbrellaCap', 'titanArbor', 'podTree', 'grassGiant'],
    scale: 1.15, density: 0.55, amp: 10,
  },
  crystal: {
    label: 'Violet Crystal Woods', night: true, water: 0.2,
    sky: ['#150b33', '#4b2a7a'], sun: '#c9a6ff', fog: '#2a1a4d',
    ground: ['#3a2a5e', '#6a4b96'], trunk: '#9fb7d9',
    leaf: ['#8f7ae0', '#b48cf0', '#5f4bb0'], bloom: '#7df9ff', glow: 0.75,
    species: ['crystalSpire', 'crystalSpire', 'towerFern', 'giantFungus'],
    scale: 1.1, density: 1.0, amp: 30,
  },
  frost: {
    label: 'Frostfern Tundra', night: false, water: 0.3,
    sky: ['#9fc7e8', '#e8f6ff'], sun: '#ffffff', fog: '#d8ecf7',
    ground: ['#8fb4c9', '#e9f4fa'], trunk: '#6d7f8c',
    leaf: ['#a8d8e8', '#cfeef7', '#7fb3c9'], bloom: '#ffffff', glow: 0.2,
    species: ['spiralConifer', 'towerFern', 'crystalSpire', 'giantFungus'],
    scale: 0.95, density: 0.8, amp: 22,
  },
  biolume: {
    label: 'Biolume Night Garden', night: true, water: 0.25,
    sky: ['#040b1f', '#0d2a4a'], sun: '#8fd8ff', fog: '#0a1c33',
    ground: ['#0e2a33', '#1c5560'], trunk: '#2b4a52',
    leaf: ['#22d3ee', '#34e5a0', '#6366f1'], bloom: '#f0abfc', glow: 0.95,
    species: ['bulbBloom', 'giantFungus', 'towerFern', 'vineTower', 'crystalSpire'],
    scale: 1.2, density: 1.2, amp: 20,
  },
  ash: {
    label: 'Ashen Grove', night: true, water: 0.35,
    sky: ['#1a0d0a', '#6b2312'], sun: '#ff7a3c', fog: '#3a1a10',
    ground: ['#2b211d', '#57403a'], trunk: ['#3a2c28'][0],
    leaf: ['#8c3b1e', '#c25e2a', '#5e2a16'], bloom: '#ffb03a', glow: 0.65,
    species: ['vineTower', 'giantFungus', 'podTree', 'crystalSpire'],
    scale: 1.0, density: 0.95, amp: 34,
  },
  blossom: {
    label: 'Blossom Drift', night: false, water: 0.2,
    sky: ['#ffd0e8', '#fff3fb'], sun: '#fff2f8', fog: '#ffe4f0',
    ground: ['#c98fb8', '#efc9e2'], trunk: '#9c6b7a',
    leaf: ['#ff9ec7', '#ffc2dd', '#e07bb0'], bloom: '#ffffff', glow: 0.15,
    species: ['bulbBloom', 'umbrellaCap', 'titanArbor', 'towerFern'],
    scale: 1.1, density: 1.1, amp: 18,
  },
  abyss: {
    label: 'Verdant Abyss', night: true, water: 0.45,
    sky: ['#03150f', '#0b3b2a'], sun: '#a8ffd8', fog: '#072019',
    ground: ['#0d3325', '#17593f'], trunk: ['#24402f'][0],
    leaf: ['#1fa86a', '#3ddc84', '#12795a'], bloom: '#f9f871', glow: 0.8,
    species: ['titanArbor', 'vineTower', 'towerFern', 'giantFungus', 'bulbBloom'],
    scale: 1.45, density: 1.3, amp: 28,
  },
};
export const BIOME_KEYS = Object.keys(BIOMES);

// ── planet names ────────────────────────────────────────────────────────────
const PRE = ['Vor', 'Xan', 'Thal', 'Zeph', 'Kor', 'Myr', 'Ael', 'Dra', 'Solv', 'Nyx',
  'Vesh', 'Bel', 'Cyr', 'Fen', 'Gal', 'Hyr', 'Ix', 'Jor', 'Kal', 'Lum', 'Mor', 'Nex',
  'Oph', 'Pyr', 'Qor', 'Ryn', 'Sar', 'Tor', 'Umb', 'Val', 'Wyr', 'Xyl', 'Yar', 'Zor',
  'Aur', 'Dael', 'Eos', 'Phae', 'Cael', 'Bryn'];
const SUF = ['a', 'is', 'on', 'ar', 'ea', 'us', 'ia', 'or', 'eth', 'ix', 'an', 'ora',
  'iel', 'une', 'os', 'yra', 'antis', 'eon', 'alis', 'ova'];
const EPITHET = ['the Verdant', 'of Deep Roots', 'the Sleeping Giant', 'of Ten Thousand Fronds',
  'the Quiet Bloom', 'of Amber Light', 'the Hollow Crown', 'of Endless Dusk',
  'the Spore Mother', 'of Glass Leaves', 'the Long Summer', 'of Falling Pods',
  'the Green Cathedral', 'of Whispering Vines', 'the Last Garden'];

// ── the catalogue ───────────────────────────────────────────────────────────
export function buildPlanets() {
  const out = [];
  for (let i = 0; i < PLANET_COUNT; i++) {
    const seed = 0x9e37 + i * 7919;
    const r = mulberry32(seed);
    const biomeKey = BIOME_KEYS[(i + Math.floor(r() * 3)) % BIOME_KEYS.length];
    const b = BIOMES[biomeKey];

    const name = pick(r, PRE) + pick(r, SUF);
    const scaleJit = rand(r, 0.85, 1.3);

    out.push({
      id: `p${i}`,
      index: i + 1,
      name,
      epithet: EPITHET[i % EPITHET.length],
      seed,
      biomeKey,
      biome: b.label,
      night: b.night,
      palette: {
        skyTop: b.sky[0], skyBottom: b.sky[1], sun: b.sun, fog: b.fog,
        groundLow: b.ground[0], groundHigh: b.ground[1], trunk: b.trunk,
        leaf: b.leaf, bloom: b.bloom,
        water: mixHex(b.ground[0], '#1b6fa8', 0.72),
      },
      glow: b.glow,
      gravity: +rand(r, 0.55, 1.55).toFixed(2),
      terrainAmp: b.amp * rand(r, 0.75, 1.35),
      terrainFreq: rand(r, 0.0035, 0.0085),
      rough: rand(r, 0.35, 0.9),
      waterLevel: r() < b.water ? -rand(r, 1.5, 4.5) : null,
      floraScale: b.scale * scaleJit,
      floraDensity: b.density * rand(r, 0.8, 1.2),
      species: b.species.slice(),
      ringed: r() < 0.28,
      moons: randi(r, 0, 3),
      tempC: Math.round(rand(r, -32, 46)),
      radiusKm: Math.round(rand(r, 3200, 9800)),
      dayHours: +rand(r, 9, 42).toFixed(1),
    });
  }
  return out;
}

export const PLANETS = buildPlanets();
export const planetByIndex = (i) => PLANETS[((i - 1) % PLANET_COUNT + PLANET_COUNT) % PLANET_COUNT];
