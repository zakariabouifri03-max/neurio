// ── shared, mutable game state ─────────────────────────────────
// Everything the modules need to talk to each other lives here, so
// there are no circular imports between weapons / bots / world / main.

export const G = {
  // three.js
  THREE: null,
  renderer: null,
  scene: null,
  camera: null,
  sun: null,
  clock: null,

  // phase: 'boot' | 'menu' | 'drop' | 'play' | 'over' | 'paused'
  phase: 'boot',
  time: 0,            // seconds since match start
  dt: 0,
  fps: 60,
  frameMs: 16,

  // quality
  tier: 0,            // 0 KHFIF, 1 NORMAL, 2 ZWIN
  autoTune: true,
  sens: 1,
  renderScale: 0.7,

  // world
  world: null,        // { size, obstacles, buildings, heightAt, zone, ... }
  rand: null,
  seed: 1,

  // entities
  player: null,
  bots: [],
  bullets: [],        // active bullet structs
  grenades: [],
  pickups: [],
  fx: [],             // particle/tracer/muzzle records

  // zone
  zone: { x: 0, z: 0, r: 74, tx: 0, tz: 0, tr: 74, phase: 0, timer: 25, shrinking: false, dps: 1 },
  aliveCount: 13,
  placement: 13,

  // stats for the current match
  stats: { kills: 0, damage: 0, started: 0 },

  // ui refs (filled by main.js)
  ui: {},
};

// ── persistent profile ─────────────────────────────────────────
const KEY = 'nar-survivor-3d-v1';
export const profile = {
  coins: 0,
  matches: 0,
  wins: 0,
  bestPlace: 13,
  totalKills: 0,
  bestKills: 0,
  tier: 0,
  sens: 1,
  sound: true,
};

export function loadProfile() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(profile, JSON.parse(raw));
  } catch (e) { /* private mode / full storage — ignore */ }
  return profile;
}
export function saveProfile() {
  try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch (e) { /* ignore */ }
}

// ── quality presets ────────────────────────────────────────────
// tier 0 is deliberately brutal: it has to hold 45+ fps on a 2 GB
// phone with a 2017 GPU, so no shadows, no grass, low render scale.
export const TIERS = [
  {
    name: '⚡ KHFIF',
    renderScale: 0.62,
    shadows: false,
    antialias: false,
    maxPixelRatio: 1,
    fog: 0.0125,
    drawDist: 135,
    grass: 0,
    bushes: 60,
    trees: 120,
    rocks: 70,
    particles: 0.45,
    maxBots: 12,
    fpsCap: 40,
    hint: 'Bla dhl, bla 3chb, render scale 62% — l-ahsan l telephone b 1–2 GB RAM.',
  },
  {
    name: '🌤 NORMAL',
    renderScale: 0.85,
    shadows: true,
    shadowMap: 1024,
    antialias: false,
    maxPixelRatio: 1.5,
    fog: 0.0092,
    drawDist: 210,
    grass: 900,
    bushes: 110,
    trees: 210,
    rocks: 120,
    particles: 1,
    maxBots: 12,
    fpsCap: 60,
    hint: 'Dhl khfif (1024), 3chb, distance kbira — telephone b 3–4 GB RAM.',
  },
  {
    name: '✨ ZWIN',
    renderScale: 1,
    shadows: true,
    shadowMap: 2048,
    antialias: true,
    maxPixelRatio: 2,
    fog: 0.0068,
    drawDist: 300,
    grass: 2200,
    bushes: 170,
    trees: 320,
    rocks: 180,
    particles: 1.6,
    maxBots: 12,
    fpsCap: 60,
    hint: 'Kolchi mzyan: dhl 2048, 3chb kteer, anti-aliasing — telephone qwi.',
  },
];
export const tier = () => TIERS[G.tier] || TIERS[0];
