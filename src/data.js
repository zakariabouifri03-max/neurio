/* ============================================================
   Botola 25 — data.js
   Pitch constants, clubs, name pools, player/squad generation.
   Pure data + pure functions (no DOM / no Three.js).
   ============================================================ */

import { clamp, rngFrom } from './util.js';

/* ---------- the pitch (metres, real football proportions) ---------- */
export const PITCH = {
  L: 105, // length  → x ∈ [-52.5, 52.5]
  W: 68,  // width   → z ∈ [-34, 34]
  HX: 52.5,
  HZ: 34,
  GOAL_W: 7.32, // x is the goal line, mouth spans z
  GOAL_H: 2.44,
  GOAL_D: 2.0,  // net depth behind the line
  BOX_L: 16.5,  // penalty area depth from goal line
  BOX_W: 40.32,
  SIX_L: 5.5,
  SIX_W: 18.32,
  PEN_SPOT: 11,
  CIRCLE_R: 9.15,
  BALL_R: 0.115,
};

/* ---------- clubs : fictional but 100% Maghrib-flavoured ---------- */
export const CLUBS = [
  { id: 'fes',  name: 'Atlas Fès',        short: 'ATF', city: 'Fès',        c1: 0x1b7a3d, c2: 0xffffff, gk: 0xffc400, rate: 78 },
  { id: 'mkn',  name: 'Olive Meknès',     short: 'OLM', city: 'Meknès',     c1: 0x0f6b3a, c2: 0xf2e28a, gk: 0x2b2b2b, rate: 71 },
  { id: 'cas',  name: 'Casa United',      short: 'CSU', city: 'Casablanca', c1: 0xd21e2c, c2: 0xffffff, gk: 0x111111, rate: 84 },
  { id: 'rba',  name: 'Rabat Olympique',  short: 'RBO', city: 'Rabat',      c1: 0x10407f, c2: 0xffd34d, gk: 0x22aa55, rate: 81 },
  { id: 'mrk',  name: 'Marrakech Stars',  short: 'MKS', city: 'Marrakech',  c1: 0xe0402a, c2: 0x1b1b1b, gk: 0x3ad1d1, rate: 79 },
  { id: 'tng',  name: 'Tanger Port',      short: 'TGP', city: 'Tanger',     c1: 0x0d6ea8, c2: 0xffffff, gk: 0xff5a1f, rate: 76 },
  { id: 'aga',  name: 'Agadir Waves',     short: 'AGW', city: 'Agadir',     c1: 0x00a0a8, c2: 0x0b2b45, gk: 0xffe14d, rate: 74 },
  { id: 'ouj',  name: 'Oujda East',       short: 'OJE', city: 'Oujda',      c1: 0x2f9e44, c2: 0xc92a2a, gk: 0xffffff, rate: 72 },
  { id: 'tet',  name: 'Tétouan North',    short: 'TTN', city: 'Tétouan',    c1: 0xffffff, c2: 0xc92a2a, gk: 0x3b3b3b, rate: 73 },
  { id: 'sfi',  name: 'Safi Ocean',       short: 'SFO', city: 'Safi',       c1: 0x1e5aa8, c2: 0x9fd3ff, gk: 0xff9f1c, rate: 70 },
  { id: 'lao',  name: 'Laâyoune Sands',   short: 'LAS', city: 'Laâyoune',   c1: 0xd9a520, c2: 0x1b3a2f, gk: 0x7b2ff7, rate: 69 },
  { id: 'ken',  name: 'Kénitra Rail',     short: 'KNR', city: 'Kénitra',    c1: 0x4b2e83, c2: 0xffffff, gk: 0x00c853, rate: 68 },
];

export const clubById = (id) => CLUBS.find((c) => c.id === id) || CLUBS[0];

/* ---------- name pools ---------- */
const FIRST = [
  'Yassine','Anas','Mehdi','Youssef','Hamza','Omar','Reda','Simo','Bilal','Zakaria',
  'Amine','Karim','Nabil','Soufiane','Ilyas','Adam','Oussama','Hicham','Tarik','Walid',
  'Mounir','Rachid','Ayoub','Mehdi','Ismail','Noureddine','Badre','Ziad','Anasse','Houssam',
];
const LAST = [
  'Bouifri','El Amrani','Benali','Chraibi','Ouazzani','Tazi','Fassi','Bennani','Alaoui','Idrissi',
  'Sabri','El Khattabi','Mokhtari','Naciri','Berrada','Cherkaoui','Lahlou','Ziani','Bouhaddou','Rifi',
  'El Idrissi','Sbai','Kabbaj','Amrani','Belhaj','Ouhaddou','Lamrani','Filali','Seddiki','Benjelloun',
];

/* 4-4-2, coordinates from OWN goal line (x 0→105) and centred on z */
export const FORMATION = [
  { role: 'GK',  x: 4.5, z: 0 },
  { role: 'LB',  x: 23,  z: -23 },
  { role: 'CB',  x: 17,  z: -8.5 },
  { role: 'CB',  x: 17,  z: 8.5 },
  { role: 'RB',  x: 23,  z: 23 },
  { role: 'LM',  x: 50,  z: -26 },
  { role: 'CM',  x: 43,  z: -10 },
  { role: 'CM',  x: 43,  z: 10 },
  { role: 'RM',  x: 50,  z: 26 },
  { role: 'ST',  x: 66,  z: -9 },
  { role: 'ST',  x: 66,  z: 9 },
];

/* attribute bias per role so generated squads feel like football */
const ROLE_BIAS = {
  GK: { pace: -0.9, shoot: -1.4, pass: -0.2, defend: 0.5, gk: 1.8 },
  LB: { pace: 0.4, shoot: -0.4, pass: 0.1, defend: 0.7, gk: -1 },
  RB: { pace: 0.4, shoot: -0.4, pass: 0.1, defend: 0.7, gk: -1 },
  CB: { pace: -0.2, shoot: -0.6, pass: -0.1, defend: 1.1, gk: -1 },
  LM: { pace: 0.7, shoot: 0.1, pass: 0.5, defend: -0.2, gk: -1 },
  RM: { pace: 0.7, shoot: 0.1, pass: 0.5, defend: -0.2, gk: -1 },
  CM: { pace: 0.0, shoot: 0.1, pass: 0.9, defend: 0.4, gk: -1 },
  ST: { pace: 0.6, shoot: 1.1, pass: 0.0, defend: -0.7, gk: -1 },
};

const SKIN = [0x8d5524, 0xa5673f, 0xc68642, 0x6b4226, 0x7a4a2b, 0xb07a4a];
const HAIR = [0x16110d, 0x241a12, 0x000000, 0x2e2118];

let uid = 1;

export function makePlayer(rng, clubRate, role, i) {
  const bias = ROLE_BIAS[role] || { pace: 0, shoot: 0, pass: 0, defend: 0, gk: -1 };
  const jitter = () => clamp(Math.round(clubRate + rng.gauss() * 5 + bias[role === 'GK' ? 'gk' : 'pace'] * 0), 45, 95);
  const stat = (k) => clamp(Math.round(clubRate + rng.gauss() * 5.5 + (bias[k] || 0) * 7), 40, 96);
  const pace = clamp(Math.round(clubRate + rng.gauss() * 5 + (bias.pace || 0) * 7), 40, 96);
  const shoot = stat('shoot');
  const pass = stat('pass');
  const defend = stat('defend');
  const gk = role === 'GK' ? clamp(Math.round(clubRate + 10 + rng.gauss() * 4), 50, 97) : 20;
  const rating =
    role === 'GK'
      ? Math.round(gk * 0.7 + pace * 0.1 + pass * 0.2)
      : Math.round(pace * 0.25 + shoot * (role === 'ST' ? 0.35 : 0.2) + pass * 0.25 + defend * (role === 'CB' ? 0.35 : 0.2));
  void jitter;
  return {
    uid: uid++,
    name: rng.pick(FIRST) + ' ' + rng.pick(LAST),
    no: role === 'GK' ? 1 : i + 1,
    role,
    age: rng.irange(18, 34),
    pace, shoot, pass, defend, gk, rating,
    stamina: 100,
    value: Math.round((Math.pow(rating / 60, 6) * 0.35 + 0.2) * 100) / 10, // in millions-ish coins
    skin: rng.pick(SKIN),
    hair: rng.pick(HAIR),
    goals: 0,
    apps: 0,
  };
}

export function makeSquad(seed, clubRate) {
  const rng = rngFrom(seed);
  return FORMATION.map((f, i) => makePlayer(rng, clubRate, f.role, i));
}

/* world-space home spot for a formation slot.
   dir = +1 team attacks towards +x, dir = -1 towards -x                */
export function homeSpot(slot, dir) {
  const x = dir > 0 ? slot.x - PITCH.HX : PITCH.HX - slot.x;
  const z = dir > 0 ? slot.z : -slot.z;
  return { x, z };
}

/* ---------- league helpers ---------- */
export function buildFixtureList(ids) {
  // circle method → double round-robin
  const n = ids.length;
  const rounds = [];
  const arr = ids.slice();
  for (let r = 0; r < n - 1; r++) {
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      const flip = (r + i) % 2 === 0;
      games.push({ home: flip ? a : b, away: flip ? b : a });
    }
    rounds.push(games);
    arr.splice(1, 0, arr.pop());
  }
  const second = rounds.map((games) => games.map((g) => ({ home: g.away, away: g.home })));
  return rounds.concat(second);
}

export function emptyTable(ids) {
  return ids.map((id) => ({ id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }));
}

export function sortTable(table) {
  return table
    .map((r) => ({ ...r, gd: r.gf - r.ga }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.id.localeCompare(b.id));
}
