// ── BOOYAH FIRE — the battle-royale SIMULATION (pure logic, no DOM, no three) ─
// Everything that decides who wins: terrain heightfield, loot, the shrinking
// safe zone, hitscan gunplay, gloo walls, grenades, airdrops, and 39 AI bots.
// The view & HUD layers only read from here, which keeps the sim testable.

import { Noise, clamp, clamp01, lerp, mulberry32, rand, randi, pick, dist2D, TAU, turnToward, rayOBB } from './util.js';
import { WEAPONS, VEST, HELMET, BAG, ITEMS, LOOT, CHARACTERS, PETS, BOT_NAMES, ISLANDS, MODES, VEHICLES } from './data.js';

export const WORLD = 560;          // island is WORLD × WORLD metres
export const GRID = 168;           // heightfield resolution
export const EYE = 1.62;           // standing eye height
export const EYE_CROUCH = 1.06;
export const PLANE_ALT = 240;      // parachute drop altitude
export const PLAYER_RADIUS = 0.42;

// ═══════════════════════════ ISLAND GENERATION ══════════════════════════════
export function makeIsland(seed, themeId) {
  const theme = ISLANDS.find((t) => t.id === themeId) || ISLANDS[0];
  const r = mulberry32(seed);
  const noise = new Noise(seed ^ 0x9e3779b9);
  const noise2 = new Noise(seed * 7919 + 13);
  const N = GRID, size = WORLD, inv = N / size;
  const hmap = new Float32Array((N + 1) * (N + 1));

  const coastR = size * 0.44;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = (i / N - 0.5) * size, z = (j / N - 0.5) * size;
      const d = Math.hypot(x, z);
      const wob = noise.fbm(x * 0.0045 + 10, z * 0.0045 - 4, 3) * 55;
      const edge = clamp01((coastR + wob - d) / 70);
      if (edge <= 0) { hmap[j * (N + 1) + i] = -9; continue; }
      const base = Math.max(-6.5, noise.fbm(x * 0.0075, z * 0.0075, 4) * 14) + noise.fbm(x * 0.03, z * 0.03, 3) * 1.5;
      const mask = Math.min(1, edge * 1.15);
      const ridge = Math.max(0, noise2.ridge(x * 0.0042 + 3, z * 0.0042 - 8, 4) - 0.52) * 3.4;
      let h = (base + 11) * mask + ridge * mask * 34;
      if (h < 0.6) h *= 0.7;
      hmap[j * (N + 1) + i] = h;
    }
  }

  const height = (x, z) => {
    const fx = clamp((x / size + 0.5) * N, 0, N);
    const fz = clamp((z / size + 0.5) * N, 0, N);
    const i0 = Math.floor(fx), j0 = Math.floor(fz);
    const i1 = Math.min(N, i0 + 1), j1 = Math.min(N, j0 + 1);
    const tx = fx - i0, tz = fz - j0;
    const h00 = hmap[j0 * (N + 1) + i0], h10 = hmap[j0 * (N + 1) + i1];
    const h01 = hmap[j1 * (N + 1) + i0], h11 = hmap[j1 * (N + 1) + i1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  };

  const slopeAt = (x, z, d = 2.5) => {
    const hx = height(x + d, z) - height(x - d, z);
    const hz = height(x, z + d) - height(x, z - d);
    return Math.hypot(hx, hz) / (2 * d);
  };

  // ── towns ────────────────────────────────────────────────────────────────
  const towns = [];
  let guard = 0;
  while (towns.length < 5 && guard++ < 900) {
    const a = r() * TAU, rad = rand(r, size * 0.06, size * 0.34);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (height(x, z) < 1.5) continue;
    if (towns.some((t) => dist2D(x, z, t.x, t.z) < 105)) continue;
    towns.push({ x, z, radius: rand(r, 26, 40), y: height(x, z), kind: r() < 0.45 ? 'city' : r() < 0.72 ? 'village' : 'factory' });
  }
  for (const t of towns) {
    const pad = t.radius + 14, cy = t.y;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const x = (i / N - 0.5) * size, z = (j / N - 0.5) * size;
        const d = dist2D(x, z, t.x, t.z);
        if (d > pad) continue;
        const w = clamp01(1 - d / pad);
        const k = j * (N + 1) + i;
        hmap[k] = lerp(hmap[k], cy + (d / pad) * 2.4, w * w * 0.92);
      }
    }
  }
  // store town pads so the view can paint dirt roads
  const roads = towns.map((t) => ({ x: t.x, z: t.z, r: t.radius + 3 }));

  const props = [];
  const push = (p) => { props.push(p); return p; };

  const buildHouse = (x, z, rot, big) => {
    const w = big ? 9 : 6.4, d = big ? 7 : 5.4, h = big ? 4.6 : 3.5;
    push({ type: 'house', x, y: height(x, z), z, rot, hw: w / 2, hd: d / 2, hh: h / 2, w, d, h, blocksShots: true, solid: true, seed: r() });
    for (let i = 0; i < 2; i++) {
      const a = rot + rand(r, -1.1, 1.1);
      const cx = x + Math.cos(a) * (w / 2 + 2.4), cz = z + Math.sin(a) * (w / 2 + 2.4);
      push({ type: 'crate', x: cx, y: height(cx, cz), z: cz, rot: rand(r, 0, TAU), hw: 0.85, hd: 0.85, hh: 0.85, blocksShots: true, solid: true });
    }
  };
  for (const t of towns) {
    const n = t.kind === 'city' ? randi(r, 7, 10) : randi(r, 4, 7);
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, rad = Math.sqrt(r()) * t.radius;
      const x = t.x + Math.cos(a) * rad, z = t.z + Math.sin(a) * rad;
      if (height(x, z) < 1.2) continue;
      buildHouse(x, z, rand(r, 0, TAU), r() < 0.4);
    }
    if (t.kind === 'factory') {
      for (let i = 0; i < 5; i++) {
        const a = r() * TAU, rad = r() * t.radius * 0.9;
        const x = t.x + Math.cos(a) * rad, z = t.z + Math.sin(a) * rad;
        push({ type: 'container', x, y: height(x, z), z, rot: rand(r, 0, TAU), hw: 3.1, hd: 1.3, hh: 1.35, blocksShots: true, solid: true });
      }
    }
    for (let i = 0, n2 = randi(r, 1, 2); i < n2; i++) {
      const x = t.x + rand(r, -18, 18), z = t.z + rand(r, -18, 18);
      push({ type: 'tower', x, y: height(x, z), z, rot: 0, hw: 3.1, hd: 3.1, hh: 7.2, blocksShots: true, solid: true });
    }
    for (let i = 0; i < randi(r, 2, 5); i++) {
      const a = r() * TAU, rad = t.radius + rand(r, 6, 18);
      const x = t.x + Math.cos(a) * rad, z = t.z + Math.sin(a) * rad;
      const len = rand(r, 6, 14);
      push({ type: 'wall', x, y: height(x, z), z, rot: a + Math.PI / 2, hw: len / 2, hd: 0.35, hh: 1.15, blocksShots: true, solid: true });
    }
  }
  for (let i = 0; i < 16; i++) {
    const a = r() * TAU, rad = rand(r, size * 0.1, size * 0.42);
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (height(x, z) < 2) continue;
    buildHouse(x, z, rand(r, 0, TAU), false);
  }

  // trees & rocks
  for (let i = 0, n = Math.round(280 * theme.tree); i < n; i++) {
    const x = rand(r, -size * 0.46, size * 0.46), z = rand(r, -size * 0.46, size * 0.46);
    const hh = height(x, z);
    if (hh < 1.6 || hh > 34) continue;
    push({ type: 'tree', x, y: hh, z, rot: rand(r, 0, TAU), hw: 0.42, hd: 0.42, hh: 2.6, size: rand(r, 0.8, 1.5), blocksShots: true, solid: true });
  }
  for (let i = 0; i < 130; i++) {
    const x = rand(r, -size * 0.46, size * 0.46), z = rand(r, -size * 0.46, size * 0.46);
    const hh = height(x, z);
    if (hh < 0.8) continue;
    const s = rand(r, 0.9, 2.6);
    push({ type: 'rock', x, y: hh, z, rot: rand(r, 0, TAU), hw: s, hd: s * 0.8, hh: s * 0.7, size: s, blocksShots: s > 1.2, solid: true });
  }

  // loot sites
  const sites = [];
  const siteAt = (x, z, tier, count) => {
    const y = height(x, z);
    if (y < 0.7) return;
    const drops = [];
    for (let i = 0; i < count; i++) {
      const a = r() * TAU, rad = Math.sqrt(r()) * 4.2;
      const dx = x + Math.cos(a) * rad, dz = z + Math.sin(a) * rad;
      drops.push({ x: dx, z: dz, y: height(dx, dz), tier });
    }
    sites.push({ x, y, z, tier, drops });
  };
  for (const t of towns) {
    const per = t.kind === 'city' ? 9 : 6;
    for (let i = 0; i < per; i++) {
      const a = r() * TAU, rad = Math.sqrt(r()) * (t.radius + 6);
      siteAt(t.x + Math.cos(a) * rad, t.z + Math.sin(a) * rad, t.kind === 'city' ? 2 : 1, randi(r, 2, 3));
    }
    siteAt(t.x + rand(r, -8, 8), t.z + rand(r, -8, 8), 3, 3);
  }
  for (let i = 0; i < 46; i++) {
    const a = r() * TAU, rad = Math.sqrt(r()) * size * 0.45;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (height(x, z) < 1.2) continue;
    siteAt(x, z, r() < 0.25 ? 2 : 1, randi(r, 1, 3));
  }

  // spatial grid of props
  const cell = 24, gN = Math.ceil(size / cell);
  const grid = new Array(gN * gN);
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    const rr = Math.max(p.hw, p.hd) + 1;
    const i0 = clamp(Math.floor((p.x - rr + size / 2) / cell), 0, gN - 1);
    const i1 = clamp(Math.floor((p.x + rr + size / 2) / cell), 0, gN - 1);
    const j0 = clamp(Math.floor((p.z - rr + size / 2) / cell), 0, gN - 1);
    const j1 = clamp(Math.floor((p.z + rr + size / 2) / cell), 0, gN - 1);
    for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
      const k = j * gN + ii;
      (grid[k] || (grid[k] = [])).push(i);
    }
  }
  const propsNear = (x, z) => {
    const i = clamp(Math.floor((x + size / 2) / cell), 0, gN - 1);
    const j = clamp(Math.floor((z + size / 2) / cell), 0, gN - 1);
    return grid[j * gN + i] || EMPTY;
  };

  const dropAngle = r() * TAU;
  const plane = {
    from: { x: Math.cos(dropAngle) * size * 0.75, z: Math.sin(dropAngle) * size * 0.75 },
    to: { x: -Math.cos(dropAngle) * size * 0.75, z: -Math.sin(dropAngle) * size * 0.75 },
    angle: dropAngle,
  };

  return { seed, theme, N, size, inv, hmap, height, slopeAt, towns, roads, props, sites, grid, propsNear, plane, cell, gN };
}
const EMPTY = [];

// ═══════════════════════════ ZONE PHASES ════════════════════════════════════
export const ZONE_PHASES = [
  { wait: 32, shrink: 32, ratio: 0.63, dps: 1 },
  { wait: 28, shrink: 28, ratio: 0.65, dps: 2 },
  { wait: 25, shrink: 25, ratio: 0.67, dps: 4 },
  { wait: 22, shrink: 21, ratio: 0.69, dps: 6 },
  { wait: 19, shrink: 19, ratio: 0.71, dps: 9 },
  { wait: 17, shrink: 16, ratio: 0.73, dps: 12 },
  { wait: 14, shrink: 14, ratio: 0.75, dps: 16 },
  { wait: 12, shrink: 11, ratio: 0.80, dps: 20 },
];
const MIN_ZONE_R = 11;

function rollDrop(rng, tier) {
  const t = Math.min(3, tier);
  const r = rng();
  if (r < 0.42) {
    const id = pick(rng, LOOT.weapons[t]);
    return { kind: 'weapon', id, ammo: WEAPONS[id].mag + Math.round(WEAPONS[id].mag * rand(rng, 0.2, 0.8)), reserve: WEAPONS[id].mag * 2, tier: t };
  }
  if (r < 0.54) {
    const id = pick(rng, LOOT.weapons[1]);
    return { kind: 'weapon', id, ammo: WEAPONS[id].mag, reserve: WEAPONS[id].mag, tier: 1 };
  }
  if (r < 0.78) {
    const lvl = pick(rng, LOOT.gear[t]);
    return { kind: rng() < 0.5 ? 'vest' : 'helmet', level: lvl, tier: t };
  }
  const it = pick(rng, LOOT.items[t]);
  return { kind: 'item', id: it, count: (it === 'ammo' || it === 'firstaid') ? 2 : 1, tier: t };
}

// ═══════════════════════════ BATTLE ═════════════════════════════════════════
let uid = 1;

export class Battle {
  constructor(opts = {}) {
    const {
      seed = (Math.random() * 1e9) | 0,
      mode = 'solo',
      themeId = null,
      playerName = 'YOU',
      playerChar = 'kelly',
      playerPet = 'none',
      difficulty = 0.55,
    } = opts;

    this.seed = seed;
    this.rng = mulberry32(seed ^ 0x5bf03635);
    this.mode = MODES.find((m) => m.id === mode) || MODES[0];
    const theme = themeId ? (ISLANDS.find((t) => t.id === themeId) || ISLANDS[0]) : pick(this.rng, ISLANDS);
    this.theme = theme;
    this.island = makeIsland(seed, theme.id);
    this.difficulty = difficulty;

    this.entities = [];
    this.projectiles = [];
    this.effects = [];
    this.glools = [];
    this.drops = [];
    this.airdrops = [];
    this.vehicles = [];
    this.events = [];
    this.killFeed = [];
    this.time = 0;
    this.frame = 0;
    this.over = false;
    this.result = null;
    this.zone = { x: 0, z: 0, r: this.island.size * 0.48, tx: 0, tz: 0, tr: 0, targetR: 0, fromR: 0, fromX: 0, fromZ: 0, phase: -1, state: 'wait', t: 5, dps: 0, shrinkT: 1 };
    this.airdropT = 145;
    this.airdrop2T = 320;
    this.stats = { kills: 0, knocks: 0, damage: 0, headshots: 0, shots: 0, hits: 0, damageTaken: 0 };

    this.teamCount = this.mode.bots + 1;
    this.totalPlayers = this.teamCount * this.mode.team;

    this._spawnLoot();
    this._spawnVehicles();
    this._spawnEntities(playerName, playerChar, playerPet);
    this.alive = this.entities.length;
  }

  _spawnLoot() {
    for (const site of this.island.sites) {
      for (const d of site.drops) {
        const n = site.tier >= 2 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const roll = rollDrop(this.rng, site.tier);
          this.drops.push({ uid: uid++, ...roll, x: d.x + rand(this.rng, -1.1, 1.1), z: d.z + rand(this.rng, -1.1, 1.1), y: this.island.height(d.x, d.z), taken: false, t: 0 });
        }
      }
    }
  }

  _newEntity(name, isPlayer, team, charId, petId) {
    const char = CHARACTERS.find((c) => c.id === charId) || CHARACTERS[0];
    const pet = PETS.find((p) => p.id === petId) || PETS[0];
    const perk = {
      hp: (char.perk.hp || 0) + (pet.perk.hp || 0),
      speed: (char.perk.speed || 1) * (pet.perk.speed || 1),
      dmg: (char.perk.dmg || 1) * (pet.perk.dmg || 1),
      reload: (char.perk.reload || 1) * (pet.perk.reload || 1),
    };
    const maxHp = 100 + perk.hp;
    const e = {
      id: uid++, name, isPlayer, team, char, pet, perk, alive: true, knocked: false,
      x: 0, y: PLANE_ALT, z: 0, yaw: 0, pitch: 0,
      velX: 0, velZ: 0, vy: 0, speed: 0, moveInX: 0, moveInZ: 0,
      hp: maxHp, maxHp, bleed: 0, helmet: 0, vest: 0, bag: 0, vehicle: null, interactHeld: false,
      weapons: [], cur: 0, items: { medkit: 0, firstaid: 0, gloo: 0, grenade: 0, smoke: 0, flash: 0, ammo: 0 },
      onGround: false, inWater: false, crouch: false, ads: false, sprint: false,
      reloading: false, reloadT: 0, reloadTotal: 1, fireT: 0, glooCd: 0, punchT: 0,
      using: null, useT: 0, useTotal: 1, revivingT: 0, reviveProgress: 0,
      parachuting: true, chuteOpen: false, onPlane: false,
      kills: 0, damageDealt: 0, headshots: 0, place: 1,
      lastDamageTime: -99, lastShotTime: -99, flash: 0, footT: 0, spreadHeat: 0, recoil: 0, outsideZone: false,
      ai: null,
    };
    if (!isPlayer) {
      const skill = clamp(rand(this.rng, 0.42, 1) * (0.6 + this.difficulty * 0.75), 0.28, 1.3);
      e.ai = {
        skill, target: null, reactT: 0, strafe: this.rng() < 0.5 ? 1 : -1, strafeT: 0,
        aimYaw: 0, aimPitch: 0, thinkT: 0, wander: { x: 0, z: 0, t: 0 }, lootT: 0, stuckT: 0, lastX: 0, lastZ: 0,
        burstLeft: 0, pauseT: 0,
      };
    }
    return e;
  }

  _spawnEntities(playerName, playerChar, playerPet) {
    const rng = this.rng;
    this.entities.push(this._newEntity(playerName, true, 0, playerChar, playerPet));
    const teams = [];
    for (let t = 0; t < this.teamCount; t++) {
      const size = this.mode.team - (t === 0 ? 1 : 0);
      for (let i = 0; i < size; i++) teams.push(t);
    }
    for (let i = teams.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = teams[i]; teams[i] = teams[j]; teams[j] = t; }
    const names = BOT_NAMES.slice();
    for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = names[i]; names[i] = names[j]; names[j] = t; }
    teams.forEach((team, i) => {
      const char = pick(rng, CHARACTERS);
      const pet = rng() < 0.35 ? pick(rng, PETS) : PETS[0];
      const name = names[i % names.length] + (i >= names.length ? '‌' + (i + 1) : '');
      this.entities.push(this._newEntity(name, false, team, char.id, pet.id));
    });

    const pl = this.island.plane;
    this.entities.forEach((e, i) => {
      const t = clamp01(0.1 + (i / this.entities.length) * 0.74 + rand(rng, -0.05, 0.05));
      e.x = lerp(pl.from.x, pl.to.x, t) + rand(rng, -20, 20);
      e.z = lerp(pl.from.z, pl.to.z, t) + rand(rng, -20, 20);
      e.y = PLANE_ALT + rand(rng, -5, 5);
      e.yaw = pl.angle;
      const ang = rng() * TAU, rad = 20 + Math.sqrt(rng()) * 62;
      e.targetLandX = clamp(e.x + Math.cos(ang) * rad, -WORLD * 0.42, WORLD * 0.42);
      e.targetLandZ = clamp(e.z + Math.sin(ang) * rad, -WORLD * 0.42, WORLD * 0.42);
    });
    this.player = this.entities[0];
    // keep the first drop fair: no bot lands right next to the player
    for (const e of this.entities) {
      if (e.isPlayer) continue;
      let guard = 0;
      while (dist2D(e.targetLandX, e.targetLandZ, this.player.targetLandX, this.player.targetLandZ) < 55 && guard++ < 12) {
        const a = rng() * TAU, rr = 55 + rng() * 80;
        e.targetLandX = clamp(e.targetLandX + Math.cos(a) * rr, -WORLD * 0.42, WORLD * 0.42);
        e.targetLandZ = clamp(e.targetLandZ + Math.sin(a) * rr, -WORLD * 0.42, WORLD * 0.42);
      }
    }
    for (const e of this.entities) {
      e.weapons.push(this._makeWeapon(pick(rng, ['usp', 'usp', 'uzi', 'mp40'])));
      e.items.firstaid = 1;
    }
  }

  _makeWeapon(id) {
    const w = WEAPONS[id];
    return { id, ammo: w.mag, reserve: w.mag * 2, attach: {} };
  }

  // ═══════════════════════════ MAIN STEP ═══════════════════════════════════
  update(dt, input) {
    this.events.length = 0;
    if (this.over) return this.events;
    this.frame++;
    this.time += dt;
    dt = Math.min(dt, 0.05);
    this._updateZone(dt);
    this._updateAirdrops(dt);
    for (const e of this.entities) {
      if (!e.alive) continue;
      if (e.isPlayer) this._updatePlayer(e, dt, input);
      else this._updateBot(e, dt);
      this._physics(e, dt);
      this._zoneDamage(e, dt);
      this._weaponTimers(e, dt);
    }
    this._updateVehicles(dt);
    if (this.player) this.player.input = null;
    this._updateProjectiles(dt);
    this._updateEffects(dt);
    this._updateDrops(dt);
    this._checkEnd();
    return this.events;
  }

  // ── zone ────────────────────────────────────────────────────────────────
  _updateZone(dt) {
    const z = this.zone;
    z.t -= dt;
    if (z.state === 'wait') {
      if (z.phase < 0) this._planNextZone();
      else if (z.t <= 0) {
        const ph = ZONE_PHASES[Math.min(z.phase, ZONE_PHASES.length - 1)];
        z.state = 'shrink';
        z.t = ph.shrink; z.shrinkT = ph.shrink; z.dps = ph.dps;
        z.fromR = z.r; z.fromX = z.x; z.fromZ = z.z;
        this._emit({ type: 'zoneShrink' });
      }
    } else {
      const k = 1 - clamp01(z.t / z.shrinkT);
      z.r = lerp(z.fromR, z.targetR, k);
      z.x = lerp(z.fromX, z.tx, k);
      z.z = lerp(z.fromZ, z.tz, k);
      if (z.t <= 0) {
        z.r = z.targetR; z.x = z.tx; z.z = z.tz;
        this._emit({ type: 'zoneDone', phase: z.phase });
        this._planNextZone();          // → next phase: new wait + new target circle
      }
    }
  }

  _planNextZone() {
    const z = this.zone;
    z.phase++;
    const ph = ZONE_PHASES[Math.min(z.phase, ZONE_PHASES.length - 1)];
    z.state = 'wait';
    z.t = ph.wait;
    const newR = Math.max(MIN_ZONE_R, z.r * ph.ratio);
    let bx = z.x, bz = z.z, best = -1;
    for (let i = 0; i < 12; i++) {
      const a = this.rng() * TAU, rad = Math.max(0, z.r - newR) * Math.sqrt(this.rng());
      const cx = z.x + Math.cos(a) * rad, cz = z.z + Math.sin(a) * rad;
      let score = 0;
      for (const e of this.entities) if (e.alive) score += 1 / (1 + dist2D(cx, cz, e.x, e.z) / 40);
      if (score > best) { best = score; bx = cx; bz = cz; }
    }
    z.tx = bx; z.tz = bz; z.targetR = newR;
    this._emit({ type: 'zonePlan', phase: z.phase, x: bx, z: bz, r: newR });
  }

  _zoneDamage(e, dt) {
    const z = this.zone;
    if (z.dps > 0 && !e.parachuting && dist2D(e.x, e.z, z.x, z.z) > z.r) {
      e.outsideZone = true;
      this._damage(e, z.dps * dt, null, 'body', 'zone', true);
    } else e.outsideZone = false;
  }

  _updateAirdrops(dt) {
    if (this.time >= this.airdropT) {
      this.airdropT = 1e9;
      const z = this.zone, a = this.rng() * TAU, rad = Math.sqrt(this.rng()) * z.r * 0.7;
      const ad = { x: z.x + Math.cos(a) * rad, z: z.z + Math.sin(a) * rad, y: 180, landed: false, t: 0 };
      this.airdrops.push(ad);
      this._emit({ type: 'airdrop', a: ad, x: ad.x, z: ad.z });
    }
    if (this.time >= this.airdrop2T) {
      this.airdrop2T = 1e9;
      const z = this.zone, a = this.rng() * TAU, rad = Math.sqrt(this.rng()) * z.r * 0.6;
      const ad = { x: z.x + Math.cos(a) * rad, z: z.z + Math.sin(a) * rad, y: 180, landed: false, t: 0 };
      this.airdrops.push(ad);
      this._emit({ type: 'airdrop', a: ad, x: ad.x, z: ad.z });
    }
    for (const a of this.airdrops) {
      if (a.landed) continue;
      a.t += dt;
      a.y -= 15 * dt;
      const ground = this.island.height(a.x, a.z) + 1.3;
      if (a.y <= ground) {
        a.landed = true; a.y = ground;
        for (let i = 0; i < 5; i++) {
          const roll = rollDrop(this.rng, 3);
          const ang = this.rng() * TAU, r2 = rand(this.rng, 1, 4);
          this.drops.push({ uid: uid++, ...roll, x: a.x + Math.cos(ang) * r2, z: a.z + Math.sin(ang) * r2, y: this.island.height(a.x, a.z), taken: false, t: 0, fromAir: true });
        }
        this._emit({ type: 'airdropLand', x: a.x, z: a.z });
      }
    }
  }

  // ═══════════════════════════ PLAYER ══════════════════════════════════════
  _updatePlayer(e, dt, input) {
    const inp = input || {};
    e.input = inp;
    if (inp.yaw !== undefined && !e.vehicle) e.yaw = inp.yaw;
    if (inp.pitch !== undefined) e.pitch = clamp(inp.pitch, -1.35, 1.35);

    if (e.parachuting) {
      let dx = inp.moveX || 0, dz = inp.moveZ || 0;
      if (Math.hypot(dx, dz) < 0.15 && e.targetLandX !== undefined) {
        // no steering input → glide toward the marked landing spot
        const tx = e.targetLandX - e.x, tz = e.targetLandZ - e.z;
        const td = Math.hypot(tx, tz);
        if (td > 3) { dx = tx / td; dz = tz / td; }
      }
      const len = Math.hypot(dx, dz);
      e.chuteOpen = e.y < 60;
      const fly = e.chuteOpen ? 17 : 32;
      if (len > 0.01) {
        e.x += (dx / len) * fly * dt;
        e.z += (dz / len) * fly * dt;
        e.yaw = Math.atan2(dx, dz);
      }
      e.y -= (e.chuteOpen ? 12 : 44) * dt;
      const ground = this.island.height(e.x, e.z);
      if (e.y <= ground) { e.y = ground; e.parachuting = false; e.chuteOpen = false; this._emit({ type: 'landed', e }); }
      return;
    }

    if (e.vehicle) {
      e.crouch = false; e.ads = false; e.sprint = false;
      e.moveInX = 0; e.moveInZ = 0;
      if (inp.interact) {
        if (!e.interactHeld) { e.interactHeld = true; this.exitVehicle(e); }
      } else e.interactHeld = false;
      return;
    }
    e.crouch = !!inp.crouch;
    e.ads = !!inp.ads;
    e.sprint = !!inp.sprint && !e.ads && !inp.fire && !e.crouch && !e.knocked;
    e.moveInX = inp.moveX || 0;
    e.moveInZ = inp.moveZ || 0;
    if (inp.jump && e.onGround && !e.knocked && !e.crouch) { e.vy = 6.2; e.onGround = false; }

    const w = this._curWeapon(e);
    if (inp.reload) this.startReload(e);
    if (inp.switchSlot !== undefined && inp.switchSlot !== null && inp.switchSlot !== e.cur) this.switchSlot(e, inp.switchSlot);
    if (inp.fire && !e.reloading && !e.using && !e.knocked) {
      if (w) this._tryShoot(e, w, dt);
      else this._punch(e);
    }
    if (inp.punch) this._punch(e);
    if (inp.useMed) this.useItem(e, 'medkit');
    if (inp.useFA) this.useItem(e, 'firstaid');
    if (inp.throwGloo) this.throwGloo(e);
    if (inp.throwNade) this.throwProjectile(e, inp.throwNade);
    // edge-triggered: holding the key must not re-trigger pickups every frame
    if (inp.interact) {
      if (!e.interactHeld) { e.interactHeld = true; this._playerInteract(e); }
    } else e.interactHeld = false;
    // quality of life: walk over meds / ammo / armor and grab them automatically
    for (const d of this.drops) {
      if (d.taken || d.kind === 'weapon') continue;
      if (dist2D(e.x, e.z, d.x, d.z) > 1.5) continue;
      this.pickupDrop(e, d);
    }
  }

  _playerInteract(e) {
    if (e.vehicle) { this.exitVehicle(e); return; }
    const mate = this._nearestReviveTarget(e);
    if (mate) { this.reviveTick(e, mate, 0.5); return; }
    const veh = this.nearestVehicle(e, 4.5);
    if (veh) { this.enterVehicle(e, veh); return; }
    const drop = this._nearestDrop(e, 4.5);
    if (drop) this.pickupDrop(e, drop);
  }

  _nearestReviveTarget(e) {
    let best = null, bd = 2.8;
    for (const o of this.entities) {
      if (!o.knocked || o.team !== e.team || o === e) continue;
      const d = dist2D(e.x, e.z, o.x, o.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  reviveTick(reviver, target, dt) {
    if (reviver.knocked) return;
    target.reviveProgress = (target.reviveProgress || 0) + dt;
    reviver.revivingT = 0.25;
    if (target.reviveProgress >= 3) {
      target.reviveProgress = 0;
      target.knocked = false;
      target.hp = Math.round(target.maxHp * 0.4);
      target.bleed = 0;
      this._emit({ type: 'revive', by: reviver, target });
    }
  }

  // ═══════════════════════════ BOT AI ══════════════════════════════════════
  _updateBot(e, dt) {
    const ai = e.ai;
    if (e.parachuting) { this._botDrop(e, dt); return; }

    if (e.knocked) {
      const mate = this._nearestTeammate(e);
      if (mate) {
        const dx = mate.x - e.x, dz = mate.z - e.z, d = Math.hypot(dx, dz) || 1;
        ai.moveX = dx / d; ai.moveZ = dz / d;
      } else { ai.moveX = 0; ai.moveZ = 0; }
      if (ai.thinkT <= 0) {
        ai.thinkT = 0.5;
        const rev = this._nearestReviveTarget(e);
        if (rev) this.reviveTick(e, rev, 0.4);
      }
      ai.thinkT -= dt;
      return;
    }

    const w = this._curWeapon(e);

    // heal when hurt and safe
    if (!e.using && e.hp < e.maxHp * 0.45 && this.time - e.lastDamageTime > 3.5) {
      if (e.items.medkit > 0 && e.hp < e.maxHp * 0.34) this.useItem(e, 'medkit');
      else if (e.items.firstaid > 0) this.useItem(e, 'firstaid');
    }
    // reload when dry
    if (w && w.ammo <= 0 && w.reserve > 0 && !e.reloading) this.startReload(e);
    if (e.using) { ai.moveX = 0; ai.moveZ = 0; return; }

    // squad play: go pick up a knocked teammate when it's safe
    if (this.mode.team > 1) {
      ai.revive = ai.revive && ai.revive.knocked && ai.revive.alive ? ai.revive : null;
      if (!ai.revive && (this.frame + e.id) % 20 === 0) {
        let best = null, bd = 34;
        for (const o of this.entities) {
          if (o === e || !o.knocked || o.team !== e.team) continue;
          const dd = dist2D(e.x, e.z, o.x, o.z);
          if (dd < bd) { bd = dd; best = o; }
        }
        ai.revive = best;
      }
      if (ai.revive && !(ai.target && ai.target.alive)) {
        const rd = dist2D(e.x, e.z, ai.revive.x, ai.revive.z);
        if (rd > 2.2) {
          const dx = ai.revive.x - e.x, dz = ai.revive.z - e.z, dd = Math.hypot(dx, dz) || 1;
          ai.moveX = dx / dd; ai.moveZ = dz / dd; e.sprint = rd > 8;
        } else {
          ai.moveX = 0; ai.moveZ = 0;
          this.reviveTick(e, ai.revive, dt);
          return;
        }
      }
    }

    ai.thinkT -= dt;
    if (ai.thinkT <= 0) {
      ai.thinkT = rand(this.rng, 0.12, 0.3);
      const seen = e.flash > 0 ? null : this._findVisibleEnemy(e, 92);
      if (seen) {
        if (ai.target !== seen) { ai.target = seen; ai.reactT = rand(this.rng, 0.14, 0.6) * (1.7 - ai.skill); }
      } else if (ai.target && (dist2D(e.x, e.z, ai.target.x, ai.target.z) > 100 || !this._canSee(e, ai.target))) {
        ai.target = null;
      }
    }

    const tgt = ai.target;
    if (tgt && tgt.alive && !tgt.knocked) {
      const dx = tgt.x - e.x, dz = tgt.z - e.z;
      const d = Math.hypot(dx, dz) || 0.001;
      const aimY = (tgt.y + (tgt.crouch ? 0.85 : 1.15)) - (e.y + EYE);
      const turn = (5.5 + ai.skill * 5) * dt;
      ai.aimYaw = turnToward(ai.aimYaw, Math.atan2(dx, dz), turn);
      ai.aimPitch = turnToward(ai.aimPitch, Math.atan2(aimY, d), turn * 0.75);
      e.yaw = ai.aimYaw; e.pitch = ai.aimPitch;
      ai.reactT -= dt;

      ai.strafeT -= dt;
      if (ai.strafeT <= 0) { ai.strafeT = rand(this.rng, 0.6, 1.7); ai.strafe = this.rng() < 0.5 ? 1 : -1; }
      const kind = w ? WEAPONS[w.id].kind : 'punch';
      const desired = kind === 'shotgun' ? 8 : kind === 'sniper' ? 40 : kind === 'dmr' ? 30 : kind === 'pistol' ? 14 : 20;
      const push = d > desired * 1.3 ? 1 : d < desired * 0.7 ? -1 : 0;
      const nx = dx / d, nz = dz / d;
      ai.moveX = nx * push - nz * ai.strafe * 0.85;
      ai.moveZ = nz * push + nx * ai.strafe * 0.85;
      e.sprint = push > 0 && d > 30;
      e.crouch = d > 45 && this.rng() < 0.02;
      // burst-fire discipline: fire a few rounds, then take a human-like pause
      if (ai.reactT <= 0 && w && !e.reloading && w.ammo > 0) {
        if (ai.burstLeft > 0) {
          ai.burstLeft -= dt;
          this._tryShoot(e, w, dt, true);          // rpm + fireT limit the real rate
        } else {
          ai.pauseT -= dt;
          if (ai.pauseT <= 0) {
            const k = WEAPONS[w.id].kind;
            let n = k === 'smg' ? rand(this.rng, 5, 11) : k === 'ar' ? rand(this.rng, 4, 8)
              : k === 'shotgun' ? rand(this.rng, 1, 2) : k === 'dmr' ? rand(this.rng, 1, 3)
              : k === 'sniper' ? 1 : rand(this.rng, 2, 4);
            ai.burstLeft = Math.max(1, Math.round(n * (0.55 + ai.skill * 0.7)));
            ai.pauseT = rand(this.rng, 0.35, 1.6) * (1.6 - ai.skill) + d / 80;
          }
        }
      }
      // grenade use
      if (d > 16 && d < 45 && e.items.grenade > 0 && this.rng() < dt * 0.02 * ai.skill) this.throwProjectile(e, 'grenade');
      if (d < 14 && e.items.gloo > 0 && e.hp < e.maxHp * 0.5 && this.rng() < dt * 0.15) this.throwGloo(e);
    } else {
      const z = this.zone;
      const far = dist2D(e.x, e.z, z.tx, z.tz);
      const outside = dist2D(e.x, e.z, z.x, z.z) > z.r * 0.82;
      if (outside || (far > 34 && this.rng() < dt * 0.6)) {
        ai.wander.x = z.tx + rand(this.rng, -z.targetR * 0.4, z.targetR * 0.4);
        ai.wander.z = z.tz + rand(this.rng, -z.targetR * 0.4, z.targetR * 0.4);
        ai.wander.t = 22;
      }
      ai.lootT -= dt;
      if (ai.lootT <= 0) {
        ai.lootT = rand(this.rng, 0.4, 1.2);
        const dr = this._nearestDrop(e, 24);
        if (dr && !outside) { ai.wander.x = dr.x; ai.wander.z = dr.z; ai.wander.t = 5; }
      }
      const wx = ai.wander.x - e.x, wz = ai.wander.z - e.z;
      const wd = Math.hypot(wx, wz);
      if (wd < 2 || ai.wander.t <= 0) {
        const a = this.rng() * TAU, rr = rand(this.rng, 8, 40);
        ai.wander.x = clamp(e.x + Math.cos(a) * rr, -WORLD * 0.45, WORLD * 0.45);
        ai.wander.z = clamp(e.z + Math.sin(a) * rr, -WORLD * 0.45, WORLD * 0.45);
        ai.wander.t = rand(this.rng, 4, 12);
      } else {
        ai.wander.t -= dt;
        ai.moveX = wx / wd; ai.moveZ = wz / wd;
        e.sprint = wd > 16;
        e.crouch = false;
      }
      const dr = this._nearestDrop(e, 2.6);
      if (dr) this.pickupDrop(e, dr);
      if (w && w.ammo < WEAPONS[w.id].mag * 0.4 && w.reserve > 0) this.startReload(e);
      if (!w && e.weapons.length < 2) {
        const best = this._nearestDrop(e, 20);
        if (best && best.kind === 'weapon') { ai.wander.x = best.x; ai.wander.z = best.z; ai.wander.t = 4; }
      } else if (e.grabCd === undefined || this.time > e.grabCd) {
        // upgrade gear when it's close: better armour and a bigger backpack
        for (const d of this.drops) {
          if (d.taken || (d.kind !== 'vest' && d.kind !== 'helmet' && d.kind !== 'bag')) continue;
          if (e[d.kind] >= d.level) continue;
          if (dist2D(e.x, e.z, d.x, d.z) > 16) continue;
          ai.wander.x = d.x; ai.wander.z = d.z; ai.wander.t = 3.5;
          e.grabCd = this.time + 6;
          break;
        }
      }
    }

    if (this.frame % 24 === 0) {
      if (Math.hypot(e.x - ai.lastX, e.z - ai.lastZ) < 0.7 && Math.hypot(ai.moveX, ai.moveZ) > 0.2) {
        ai.stuckT += 0.4;
        if (ai.stuckT > 1.2) {
          const a = this.rng() * TAU;
          ai.wander.x = e.x + Math.cos(a) * 16; ai.wander.z = e.z + Math.sin(a) * 16; ai.wander.t = 5;
          ai.strafe *= -1; ai.stuckT = 0;
        }
      } else ai.stuckT = 0;
      ai.lastX = e.x; ai.lastZ = e.z;
    }
  }

  _botDrop(e, dt) {
    const ai = e.ai;
    e.chuteOpen = e.y < 68;
    const gx = e.targetLandX ?? e.x, gz = e.targetLandZ ?? e.z;
    const dx = gx - e.x, dz = gz - e.z;
    const d = Math.hypot(dx, dz);
    e.yaw = Math.atan2(dx, dz);
    if (d > 1) {
      const sp = e.chuteOpen ? 15 : 28;
      e.x += (dx / d) * Math.min(sp * dt, d);
      e.z += (dz / d) * Math.min(sp * dt, d);
    }
    e.y -= (e.chuteOpen ? 13 : 44) * dt;
    const ground = this.island.height(e.x, e.z);
    if (e.y <= ground) {
      e.y = ground; e.yaw = this.rng() * TAU; ai.aimYaw = e.yaw;
      e.parachuting = false; e.chuteOpen = false;
      this._emit({ type: 'landed', e });
    }
  }

  _nearestTeammate(e) {
    let best = null, bd = 1e9;
    for (const o of this.entities) {
      if (o === e || !o.alive || o.team !== e.team || o.knocked) continue;
      const d = dist2D(e.x, e.z, o.x, o.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // ═══════════════════════════ PHYSICS ═════════════════════════════════════
  _physics(e, dt) {
    if (e.parachuting || e.vehicle) return;
    let mx, mz;
    if (e.isPlayer) { mx = e.moveInX; mz = e.moveInZ; }
    else { mx = e.ai.moveX || 0; mz = e.ai.moveZ || 0; }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }

    const slow = (e.ads ? 0.5 : 1) * (e.crouch ? 0.55 : 1) * (e.reloading ? 0.9 : 1) * (e.using ? 0.2 : 1) * (e.knocked ? 0.3 : 1);
    const sprintMul = e.sprint ? 1.42 : 1;
    let speed = 5.4 * e.perk.speed * sprintMul * slow;
    speed *= clamp(1 - this.island.slopeAt(e.x, e.z) * 0.5, 0.5, 1);
    e.inWater = this.island.height(e.x, e.z) < 0.25;
    if (e.inWater && e.y < 0.35) speed *= 0.6;

    e.velX = lerp(e.velX, mx * speed, clamp01(dt * 13));
    e.velZ = lerp(e.velZ, mz * speed, clamp01(dt * 13));
    e.x += e.velX * dt;
    e.z += e.velZ * dt;
    e.speed = Math.hypot(e.velX, e.velZ);

    const lim = WORLD * 0.5 + 70;
    e.x = clamp(e.x, -lim, lim);
    e.z = clamp(e.z, -lim, lim);
    this._collideProps(e);

    const ground = Math.max(this.island.height(e.x, e.z), 0.05);
    const step = p2 => { /* step-height helper */
      const h = Math.max(this.island.height(e.x + p2.x, e.z + p2.z), 0.05);
      return h;
    };
    e.vy = (e.vy || 0) - 19 * dt;
    e.y += e.vy * dt;
    if (e.y <= ground) {
      e.y = ground; e.vy = 0; e.onGround = true;
      // walk up gentle slopes instead of stopping at them
      const ahead = Math.max(step({ x: e.velX * 0.12, z: e.velZ * 0.12 }), 0.05);
      if (ahead > e.y && ahead - e.y < 1.1) e.y = ahead;
    } else e.onGround = false;

    if (e.speed > 1.2) {
      e.footT -= dt * e.speed;
      if (e.footT <= 0) { e.footT = 3.2; this._emit({ type: 'step', e, surface: e.inWater ? 'water' : 'ground' }); }
    }
  }

  _collideProps(e) {
    const R = PLAYER_RADIUS + 0.12;
    for (const idx of this.island.propsNear(e.x, e.z)) {
      const p = this.island.props[idx];
      const cs = Math.cos(-p.rot), sn = Math.sin(-p.rot);
      const rx = e.x - p.x, rz = e.z - p.z;
      const lx = rx * cs - rz * sn, lz = rx * sn + rz * cs;
      const cx = clamp(lx, -p.hw, p.hw), cz = clamp(lz, -p.hd, p.hd);
      const dx = lx - cx, dz = lz - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > R * R) continue;
      const top = p.y + p.hh * 2;
      if (e.y > top - 0.4) { if (e.y < top) e.y = top; continue; }   // stand on crates/containers
      let nx, nz, push;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        nx = dx / d; nz = dz / d; push = R - d;
      } else {
        const ox = p.hw - Math.abs(lx), oz = p.hd - Math.abs(lz);
        if (ox < oz) { nx = Math.sign(lx) || 1; nz = 0; push = ox + R; }
        else { nx = 0; nz = Math.sign(lz) || 1; push = oz + R; }
      }
      // rotate the local-space normal back into world space, then push out
      const cw = Math.cos(p.rot), sw = Math.sin(p.rot);
      e.x += (nx * cw - nz * sw) * push;
      e.z += (nx * sw + nz * cw) * push;
      e.velX = 0; e.velZ = 0;
    }
    for (const g of this.glools) {
      const dx = e.x - g.x, dz = e.z - g.z;
      const d = Math.hypot(dx, dz);
      const rr = 1.45 + PLAYER_RADIUS;
      if (d < rr && d > 1e-4) { e.x = g.x + (dx / d) * rr; e.z = g.z + (dz / d) * rr; }
    }
  }

  // ═══════════════════════════ WEAPONS ═════════════════════════════════════
  _curWeapon(e) { return e.weapons[e.cur] || null; }

  _weaponTimers(e, dt) {
    if (e.reloading) {
      e.reloadT -= dt;
      if (e.reloadT <= 0) {
        const w = this._curWeapon(e);
        e.reloading = false;
        if (w) {
          const cap = WEAPONS[w.id].mag + (w.attach.mag ? 10 : 0);
          const take = Math.min(cap - w.ammo, w.reserve);
          w.ammo += take; w.reserve -= take;
        }
      }
    }
    if (e.fireT > 0) e.fireT -= dt;
    if (e.glooCd > 0) e.glooCd -= dt;
    if (e.spreadHeat > 0) e.spreadHeat = Math.max(0, e.spreadHeat - dt * 3.4);
    if (e.recoil > 0) e.recoil = Math.max(0, e.recoil - dt * 1.6);
    if (e.flash > 0) e.flash = Math.max(0, e.flash - dt);
    if (e.revivingT > 0) e.revivingT -= dt;
    if (e.using) {
      e.useT -= dt;
      if (e.useT <= 0) {
        const it = ITEMS[e.using];
        if (it && it.heal) e.hp = Math.min(e.maxHp, e.hp + it.heal);
        if (it) e.items[e.using] = Math.max(0, (e.items[e.using] || 0) - 1);
        this._emit({ type: 'used', e, item: e.using });
        e.using = null;
      }
    }
    if (e.punchT > 0) e.punchT -= dt;
    if (e.knocked) {
      e.bleed -= dt;
      if (e.bleed <= 0) { e.knocked = false; this._die(e, e.lastAttacker || null, 'body', 'bleed'); }
    }
  }

  switchSlot(e, i) {
    if (i < 0 || i >= e.weapons.length || i === e.cur) return;
    e.cur = i; e.reloading = false; e.fireT = Math.max(e.fireT, 0.3);
    this._emit({ type: 'switch', e, slot: i });
  }

  startReload(e) {
    const w = this._curWeapon(e);
    if (!w || e.reloading || e.using) return;
    const def = WEAPONS[w.id];
    const cap = def.mag + (w.attach.mag ? 10 : 0);
    if (w.ammo >= cap || w.reserve <= 0) return;
    e.reloading = true;
    e.reloadTotal = (def.reload * e.perk.reload + (w.attach.mag ? 0.15 : 0)) * (w.ammo === 0 ? 1.15 : 1);
    e.reloadT = e.reloadTotal;
    this._emit({ type: 'reload', e });
  }

  useItem(e, id) {
    const def = ITEMS[id];
    if (!def || (e.items[id] || 0) <= 0 || e.using || e.reloading || e.knocked) return;
    if (id === 'medkit' && e.hp > e.maxHp - 1) return;
    if (id === 'firstaid' && e.hp > e.maxHp * 0.75) return;
    e.using = id; e.useT = def.useTime; e.useTotal = def.useTime;
    this._emit({ type: 'using', e, item: id });
  }

  throwGloo(e) {
    if (e.items.gloo <= 0 || e.glooCd > 0 || e.using) return;
    e.items.gloo--;
    e.glooCd = 1.2;
    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
    const gx = e.x + fx * 4.4, gz = e.z + fz * 4.4;
    const g = { id: uid++, x: gx, z: gz, y: this.island.height(gx, gz), yaw: e.yaw, hp: 340, maxHp: 340, team: e.team, e, t: 0 };
    this.glools.push(g);
    this._emit({ type: 'gloo', e, g, x: gx, z: gz, yaw: e.yaw });
  }

  throwProjectile(e, kind) {
    const def = ITEMS[kind];
    if (!def || !(def.fuse) || (e.items[kind] || 0) <= 0 || e.knocked) return;
    e.items[kind]--;
    const pitch = clamp(e.pitch, -0.7, 0.9);
    let dx = Math.sin(e.yaw) * Math.cos(pitch), dy = Math.sin(pitch) + 0.3, dz = Math.cos(e.yaw) * Math.cos(pitch);
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    this.projectiles.push({
      id: uid++, kind, x: e.x + dx * 0.8, y: e.y + EYE + dy * 0.4, z: e.z + dz * 0.8,
      vx: dx * 18, vy: dy * 18 + 2.6, vz: dz * 18, fuse: def.fuse, owner: e, team: e.team, t: 0, dead: false,
    });
    this._emit({ type: 'throw', e, kind });
  }

  _punch(e) {
    if (e.punchT > 0 || e.knocked) return;
    e.punchT = 0.42;
    const dx = Math.sin(e.yaw), dz = Math.cos(e.yaw);
    const hit = this._rayHitEntity(e.x, e.y + EYE * 0.72, e.z, dx, 0, dz, 2.5, e, true);
    if (hit) this._damage(hit.e, 58 * e.perk.dmg, e, hit.zone, 'punch');
    this._emit({ type: 'punch', e, hit: !!hit });
  }

  _tryShoot(e, w, dt, isBot = false) {
    const def = WEAPONS[w.id];
    if (e.reloading || e.fireT > 0 || e.using || e.knocked) return;
    if (w.ammo <= 0) {
      if (!isBot) this._emit({ type: 'dryfire', e });
      if (w.reserve > 0) this.startReload(e);
      return;
    }
    w.ammo--;
    e.fireT = 60 / def.rpm;
    const heat = e.spreadHeat;
    e.spreadHeat = Math.min(2.6, heat + (def.kind === 'smg' ? 0.3 : def.kind === 'ar' ? 0.26 : def.kind === 'shotgun' ? 0.5 : 0.18));
    e.recoil = Math.min(1.4, (e.recoil || 0) + def.dmg / 70);
    e.lastShotTime = this.time;
    this._emit({ type: 'shoot', e, weapon: w.id });

    let extraAim = 0;
    if (isBot) {
      const tgt = e.ai.target;
      const dist = tgt ? dist2D(e.x, e.z, tgt.x, tgt.z) : 30;
      // human-ish inaccuracy: worse at range, worse against moving targets
      extraAim = (1.45 - e.ai.skill) * (2.0 + dist * 0.12 + (tgt ? (tgt.speed || 0) * 0.25 : 0));
      if (this.rng() < 0.15) extraAim += rand(this.rng, 3, 7);   // flinch / panic spray
    }
    const spreadDeg = def.spread * (e.ads ? 0.42 : 1) * (e.crouch ? 0.78 : 1) * (e.speed > 3 ? 1.45 : 1)
      * (1 + heat * 0.45) + extraAim;
    const pellets = def.pellets || 1;
    for (let i = 0; i < pellets; i++) this._fireBullet(e, def, spreadDeg);
    e.pitch = clamp(e.pitch - (def.kind === 'sniper' ? 0.05 : def.kind === 'ar' ? 0.026 : 0.02) * (e.ads ? 0.7 : 1), -1.35, 1.35);
    if (e.isPlayer) e.kick = (e.kick || 0) + def.dmg / 90;
  }

  _fireBullet(e, def, spreadDeg) {
    const oy = e.y + (e.crouch ? EYE_CROUCH : EYE) + (e.parachuting ? 0.6 : 0);
    const sp = spreadDeg * (Math.PI / 180);
    const a = this.rng() * TAU, rad = Math.sqrt(this.rng()) * sp;
    const pitch = clamp(e.pitch, -1.35, 1.35);
    const dir = { x: Math.sin(e.yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(e.yaw) * Math.cos(pitch) };
    const right = { x: Math.cos(e.yaw), y: 0, z: -Math.sin(e.yaw) };
    const up = { x: -Math.sin(e.yaw) * Math.sin(pitch), y: Math.cos(pitch), z: -Math.cos(e.yaw) * Math.sin(pitch) };
    const ox = Math.cos(a) * rad, oy2 = Math.sin(a) * rad;
    dir.x += right.x * ox + up.x * oy2;
    dir.y += right.y * ox + up.y * oy2;
    dir.z += right.z * ox + up.z * oy2;
    const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
    dir.x /= l; dir.y /= l; dir.z /= l;

    const maxDist = def.maxRange;
    const hitEnt = this._rayHitEntity(e.x, oy, e.z, dir.x, dir.y, dir.z, maxDist, e, false);
    let blockT = maxDist, blocker = null;
    const propT = this._rayHitProp(e.x, oy, e.z, dir, maxDist);
    if (propT < blockT) { blockT = propT; blocker = 'prop'; }
    const terrT = this._rayHitTerrain(e.x, oy, e.z, dir, maxDist);
    if (terrT < blockT) { blockT = terrT; blocker = 'terrain'; }
    const glooHit = this._rayHitGloo(e.x, oy, e.z, dir, maxDist);
    if (glooHit && glooHit.t < blockT) { blockT = glooHit.t; blocker = 'gloo'; }

    if (hitEnt && hitEnt.t <= blockT) {
      let dmg = def.dmg;
      const falloff = def.falloff ?? maxDist * 0.6;
      if (hitEnt.t > falloff) dmg *= lerp(1, 0.55, clamp01((hitEnt.t - falloff) / Math.max(1, maxDist - falloff)));
      if (hitEnt.zone === 'head') dmg *= def.hs;
      else if (hitEnt.zone === 'legs') dmg *= 0.85;
      const hx = e.x + dir.x * hitEnt.t, hy = oy + dir.y * hitEnt.t, hz = e.z + dir.z * hitEnt.t;
      this._damage(hitEnt.e, dmg * e.perk.dmg, e, hitEnt.zone, def.name);
      this._emit({ type: 'bulletHit', e, target: hitEnt.e, x: hx, y: hy, z: hz, zone: hitEnt.zone, dmg });
      if (e.isPlayer) { this.stats.shots++; this.stats.hits++; }
    } else {
      const t = Math.min(blockT, maxDist);
      const ex = e.x + dir.x * t, ey = oy + dir.y * t, ez = e.z + dir.z * t;
      if (blocker === 'gloo' && glooHit) {
        glooHit.g.hp -= def.dmg * 0.6;
        this._emit({ type: 'glooHit', g: glooHit.g, x: ex, y: ey, z: ez });
      }
      this._emit({ type: 'bulletMiss', e, x: ex, y: ey, z: ez, ox: e.x, oy, oz: e.z, impact: blocker });
      if (e.isPlayer) this.stats.shots++;
    }
  }

  // ═══════════════════════════ RAYCASTS ════════════════════════════════════
  _rayHitEntity(ox, oy, oz, dx, dy, dz, maxDist, ignore, melee) {
    let best = null, bestT = maxDist;
    for (const t of this.entities) {
      if (t === ignore || !t.alive || t.parachuting) continue;
      if (t.knocked && !melee) continue;
      const h = 1.78 * (t.crouch ? 0.72 : 1);
      const r = melee ? 0.62 : 0.42;
      let t0 = -1;
      const ax = dx * dx + dz * dz;
      if (ax > 1e-8) {
        const mx = ox - t.x, mz = oz - t.z;
        const b = 2 * (mx * dx + mz * dz);
        const c = mx * mx + mz * mz - r * r;
        const disc = b * b - 4 * ax * c;
        if (disc >= 0) {
          const sq = Math.sqrt(disc);
          let hh = (-b - sq) / (2 * ax);
          if (hh < 0) hh = (-b + sq) / (2 * ax);
          if (hh >= 0) {
            const y = oy + dy * hh;
            if (y >= t.y && y <= t.y + h) t0 = hh;
          }
        }
      }
      const headT = raySphere(ox, oy, oz, dx, dy, dz, t.x, t.y + h, t.z, r);
      if (headT >= 0 && (t0 < 0 || headT < t0)) t0 = headT;
      const footT = raySphere(ox, oy, oz, dx, dy, dz, t.x, t.y + 0.25, t.z, r);
      if (footT >= 0 && (t0 < 0 || footT < t0)) t0 = footT;
      if (t0 < 0 || t0 > bestT) continue;
      const hitY = oy + dy * t0 - t.y;
      bestT = t0;
      best = { e: t, t: t0, zone: hitY > h * 0.82 ? 'head' : hitY > h * 0.42 ? 'body' : 'legs' };
    }
    return best;
  }

  // grid-DDA ray vs. prop boxes — bullets can't tunnel through walls
  _rayHitProp(ox, oy, oz, dir, maxDist) {
    const isl = this.island, cell = isl.cell, gN = isl.gN, half = isl.size / 2;
    let gx = clamp(Math.floor((ox + half) / cell), 0, gN - 1);
    let gz = clamp(Math.floor((oz + half) / cell), 0, gN - 1);
    const stepX = dir.x > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
    const tDeltaX = dir.x !== 0 ? Math.abs(cell / dir.x) : Infinity;
    const tDeltaZ = dir.z !== 0 ? Math.abs(cell / dir.z) : Infinity;
    let tMaxX = dir.x !== 0 ? ((gx + (stepX > 0 ? 1 : 0)) * cell - half - ox) / dir.x : Infinity;
    let tMaxZ = dir.z !== 0 ? ((gz + (stepZ > 0 ? 1 : 0)) * cell - half - oz) / dir.z : Infinity;
    let bestT = maxDist, guard = 0;
    while (guard++ < 200) {
      const list = isl.grid[gz * gN + gx];
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const p = isl.props[list[i]];
          if (!p.blocksShots) continue;
          const t = rayOBB(ox, oy, oz, dir.x, dir.y, dir.z, p);
          if (t >= 0 && t < bestT) bestT = t;
        }
      }
      if (tMaxX < tMaxZ) { if (tMaxX > bestT) break; gx += stepX; tMaxX += tDeltaX; }
      else { if (tMaxZ > bestT) break; gz += stepZ; tMaxZ += tDeltaZ; }
      if (gx < 0 || gx >= gN || gz < 0 || gz >= gN) break;
    }
    return bestT;
  }

  _rayHitGloo(ox, oy, oz, dir, maxDist) {
    let best = null;
    for (const g of this.glools) {
      if (g.hp <= 0) continue;
      const r = 1.45, h = 2.7;
      const ax = dir.x * dir.x + dir.z * dir.z;
      if (ax < 1e-8) continue;
      const mx = ox - g.x, mz = oz - g.z;
      const b = 2 * (mx * dir.x + mz * dir.z);
      const c = mx * mx + mz * mz - r * r;
      const disc = b * b - 4 * ax * c;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      let t = (-b - sq) / (2 * ax);
      if (t < 0) t = (-b + sq) / (2 * ax);
      if (t < 0 || t > maxDist) continue;
      const y = oy + dir.y * t;
      if (y < g.y || y > g.y + h) continue;
      if (!best || t < best.t) best = { g, t };
    }
    return best;
  }

  _rayHitTerrain(ox, oy, oz, dir, maxDist) {
    if (dir.y >= 0 && oy > 60) return maxDist;
    const step = 2;
    for (let d = step; d < maxDist; d += step) {
      const y = oy + dir.y * d;
      const h = this.island.height(ox + dir.x * d, oz + dir.z * d);
      if (y <= Math.max(h, 0.03)) return d;
    }
    return maxDist;
  }

  // ═══════════════════════════ DAMAGE / DEATH ══════════════════════════════
  _damage(target, amount, attacker, zone = 'body', source = 'gun', silent = false) {
    if (!target.alive || amount <= 0) return 0;
    let dmg = amount;
    if (source !== 'zone' && attacker && !attacker.isPlayer && target.isPlayer) dmg *= 0.8;
    if (source !== 'zone') {
      if (target.knocked) dmg *= 1.35;
      if (zone === 'head') dmg *= 1 - HELMET[target.helmet].red;
      else dmg *= 1 - VEST[target.vest].red;
      dmg = Math.max(1, dmg);
    }
    if (target.vehicle && !target.vehicle.dead && source !== 'zone') {
      // the car takes the brunt; the occupant keeps a fraction
      this._hurtVehicle(target.vehicle, dmg * 1.35, attacker);
      dmg *= 0.42;
    }
    target.hp -= dmg;
    target.lastDamageTime = this.time;
    if (attacker && attacker !== target) {
      attacker.damageDealt += dmg;
      target.lastAttacker = attacker;
      if (attacker.isPlayer) {
        this.stats.damage += dmg;
        if (!silent) this._emit({ type: 'hitmarker', dmg, zone, kill: target.hp <= 0 });
      }
    }
    if (target.isPlayer) this.stats.damageTaken += dmg;
    this._emit({ type: 'damage', target, attacker, dmg, zone, source, silent });

    if (target.hp <= 0) {
      if (this.mode.team > 1 && !target.knocked) {
        target.knocked = true;
        target.hp = 40;
        target.bleed = 26;
        target.reviveProgress = 0;
        target.using = null; target.reloading = false;
        if (target.isPlayer) this._emit({ type: 'playerKnocked' });
        this._emit({ type: 'knock', target, attacker });
        if (attacker && attacker.isPlayer) this.stats.knocks++;
      } else {
        this._die(target, attacker, zone, source);
      }
    }
    return dmg;
  }

  _die(e, attacker, zone = 'body', source = 'gun') {
    if (!e.alive) return;
    e.alive = false;
    e.knocked = false;
    e.hp = 0;
    if (attacker && attacker !== e) {
      attacker.kills = (attacker.kills || 0) + 1;
      if (zone === 'head') attacker.headshots = (attacker.headshots || 0) + 1;
      if (attacker.isPlayer) { this.stats.kills++; if (zone === 'head') this.stats.headshots++; }
    }
    const wname = typeof source === 'string' ? source : source;
    this.killFeed.push({
      killer: attacker ? attacker.name : '☠ ZONE', victim: e.name,
      weapon: attacker ? (wNameFor(this, attacker, wname)) : 'ZONE',
      head: zone === 'head', t: this.time, victimIsPlayer: e.isPlayer, killerIsPlayer: !!(attacker && attacker.isPlayer),
      killerTeam: attacker ? attacker.team : -1, victimTeam: e.team,
    });
    while (this.killFeed.length > 7) this.killFeed.shift();
    this._emit({ type: 'death', e, attacker, zone, source });
    for (const w of e.weapons) {
      if (w.ammo + w.reserve <= 0) continue;
      const a = this.rng() * TAU, r2 = rand(this.rng, 0.4, 1.4);
      this.drops.push({ uid: uid++, kind: 'weapon', id: w.id, ammo: w.ammo, reserve: w.reserve, attach: w.attach, x: e.x + Math.cos(a) * r2, z: e.z + Math.sin(a) * r2, y: this.island.height(e.x, e.z), taken: false, t: 0, tier: 1 });
    }
    for (const k of ['medkit', 'firstaid', 'gloo', 'grenade', 'smoke', 'flash']) {
      if ((e.items[k] || 0) <= 0) continue;
      const a = this.rng() * TAU, r2 = rand(this.rng, 0.4, 1.6);
      this.drops.push({ uid: uid++, kind: 'item', id: k, count: e.items[k], x: e.x + Math.cos(a) * r2, z: e.z + Math.sin(a) * r2, y: this.island.height(e.x, e.z), taken: false, t: 0, tier: 1 });
    }
    if (e.bag > 0) this.drops.push({ uid: uid++, kind: 'bag', level: e.bag, x: e.x - 0.9, z: e.z, y: this.island.height(e.x, e.z), taken: false, t: 0, tier: 1 });
    if (e.vest > 0) this.drops.push({ uid: uid++, kind: 'vest', level: e.vest, x: e.x, z: e.z + 0.9, y: this.island.height(e.x, e.z), taken: false, t: 0, tier: 1 });
    if (e.helmet > 0) this.drops.push({ uid: uid++, kind: 'helmet', level: e.helmet, x: e.x, z: e.z - 0.9, y: this.island.height(e.x, e.z), taken: false, t: 0, tier: 1 });
    if (e.isPlayer) { this.playerDied = true; this.playerDeathT = this.time; }
  }

  // ═══════════════════════════ LOOT ════════════════════════════════════════
  _nearestDrop(e, maxD) {
    let best = null, bd = maxD;
    for (const d of this.drops) {
      if (d.taken) continue;
      const dd = dist2D(e.x, e.z, d.x, d.z);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }

  pickupDrop(e, d) {
    if (!d || d.taken) return null;
    if (d.kind === 'weapon') {
      const def = WEAPONS[d.id];
      const cap = def.mag + (d.attach && d.attach.mag ? 10 : 0);
      const sameIdx = e.weapons.findIndex((x) => x.id === d.id);
      const isNewSlot = sameIdx === -1 && e.weapons.length < 2;
      let slot = sameIdx !== -1 ? sameIdx : isNewSlot ? e.weapons.length : e.cur;
      if (slot === -1 || slot === undefined) return null;
      // bots don't downgrade a loaded gun — and never swap twice in a row
      if (!e.isPlayer) {
        if (this.time < (e.takeCd || 0)) return null;
        if (sameIdx === -1 && e.weapons.length === 2) {
          const score = (id) => WEAPONS[id].rarity * 12 + WEAPONS[id].dmg;
          const old = e.weapons[e.cur];
          if (old.ammo + old.reserve > 0 && score(old.id) * 1.12 >= score(d.id)) return null;
        }
        if (sameIdx === -1) e.takeCd = this.time + 3;
      }
      if (isNewSlot) e.weapons.push({ id: d.id, ammo: 0, reserve: 0, attach: {} });
      const w = e.weapons[slot];
      if (!isNewSlot && w.id !== d.id && w.ammo + w.reserve > 0) {
        this.drops.push({ uid: uid++, kind: 'weapon', id: w.id, ammo: w.ammo, reserve: w.reserve, attach: w.attach, x: e.x + rand(this.rng, -0.9, 0.9), z: e.z + rand(this.rng, -0.9, 0.9), y: this.island.height(e.x, e.z), taken: false, t: 0, tier: 1 });
      }
      const merging = w.id === d.id;
      w.id = d.id;
      w.ammo = Math.min(cap, (merging ? w.ammo : 0) + (d.ammo || 0) + (merging ? 0 : 0));
      const bagCap = Math.round(def.mag * BAG[e.bag || 0].reserve);
      w.reserve = clamp((merging ? w.reserve : 0) + (d.reserve || 0) + def.mag * 2, 0, bagCap);
      // a smaller backpack spills the excess
      for (const ww of e.weapons) {
        const cap = Math.round(WEAPONS[ww.id].mag * BAG[e.bag || 0].reserve);
        if (ww.reserve > cap) ww.reserve = cap;
      }
      w.attach = { ...(d.attach || {}) };
      if (e.isPlayer) e.cur = slot;
      d.taken = true;
      this._emit({ type: 'pickup', e, kind: 'weapon', id: d.id });
      return def.name;
    }
    if (d.kind === 'vest' || d.kind === 'helmet' || d.kind === 'bag') {
      const def = (d.kind === 'vest' ? VEST : d.kind === 'helmet' ? HELMET : BAG)[d.level];
      if (!def || e[d.kind] >= d.level) return null;
      e[d.kind] = d.level;
      d.taken = true;
      this._emit({ type: 'pickup', e, kind: d.kind, level: d.level });
      return def.name;
    }
    if (d.kind === 'item') {
      const def = ITEMS[d.id];
      const have = e.items[d.id] || 0;
      if (d.id === 'ammo') {
        let any = false;
        for (const w of e.weapons) {
          const capA = Math.round(WEAPONS[w.id].mag * BAG[e.bag || 0].reserve);
          if (w.reserve < capA) { w.reserve = Math.min(capA, w.reserve + Math.round(WEAPONS[w.id].mag * 1.5)); any = true; }
        }
        if (!any) return null;
      } else {
        const max = Math.max(1, Math.round((def.max ?? 3) * BAG[e.bag || 0].carry));
        if (have >= max) return null;
        e.items[d.id] = Math.min(max, have + (d.count || 1));
      }
      d.taken = true;
      this._emit({ type: 'pickup', e, kind: 'item', id: d.id });
      return def.name;
    }
    return null;
  }

  // ═══════════════════════════ VEHICLES ════════════════════════════════════
  _spawnVehicles() {
    const roads = this.island.roads;
    if (!roads.length) return;
    const kinds = ['jeep', 'buggy', 'bike', 'jeep', 'buggy', 'bike'];
    for (let i = 0; i < kinds.length; i++) {
      const road = roads[i % roads.length];
      for (let attempt = 0; attempt < 8; attempt++) {
        const a = (i / kinds.length) * TAU + this.rng() * 1.4;
        const rr = road.r * rand(this.rng, 0.70, 1.10);
        const x = clamp(road.x + Math.cos(a) * rr, -WORLD * 0.46, WORLD * 0.46);
        const z = clamp(road.z + Math.sin(a) * rr, -WORLD * 0.46, WORLD * 0.46);
        if (this.island.height(x, z) < 0.6) continue;             // keep cars out of the shallows
        // a car parked on a cliff face can't out-climb gravity: grip scales with
        // slope, so a 60°+ slope leaves it crawling at walking pace
        if (this.island.slopeAt(x, z) > 0.7) continue;
        const yaw = this.rng() * TAU;
        // 3.2 m of clearance is the vehicle's own footprint plus a margin: a car
        // parked inside a crate's collision box is a car that cannot drive away
        if (!this._clearSpot(x, z, 3.2) || !this._clearRun(x, z, yaw, 9)) continue;
        // don't stack two cars on the same spot: the "nearest vehicle" prompt would
        // pick the wrong one and driving off would bump into a neighbour
        if (this.vehicles.some((v) => Math.hypot(v.x - x, v.z - z) < 6)) continue;
        this.vehicles.push(this._makeVehicle(kinds[i], x, z, yaw));
        break;
      }
    }
    // boats float in the shallows: march out from the island edge until the sea starts
    for (let i = 0; i < 3; i++) {
      for (let tries = 0; tries < 60; tries++) {
        const a = this.rng() * TAU;
        let r = 0.34 * WORLD, shore = null;
        for (let step = 0; step < 80 && r < 0.52 * WORLD; step++, r += 4) {
          const x = Math.cos(a) * r, z = Math.sin(a) * r;
          if (this.island.height(x, z) < -0.2) { shore = { x, z }; break; }
        }
        if (shore && !this.vehicles.some((v) => Math.hypot(v.x - shore.x, v.z - shore.z) < 6)) {
          this.vehicles.push(this._makeVehicle('boat', shore.x, shore.z, a + Math.PI / 2));
          break;
        }
      }
    }
    this._emit({ type: 'vehicles', n: this.vehicles.length });
  }

  // nudge a spawn away from solid props so nothing starts embedded in a wall
  _clearSpot(x, z, pad) {
    for (let ring = 0; ring <= 6; ring++) {
      const rr = ring * 1.1;
      for (let a = 0; a < (ring ? 8 : 1); a++) {
        const ang = (a / 8) * TAU;
        const cx = x + Math.cos(ang) * rr, cz = z + Math.sin(ang) * rr;
        if (this.island.height(cx, cz) < 0.6) continue;
        let blocked = false;
        for (const idx of this.island.propsNear(cx, cz)) {
          const pr = this.island.props[idx];
          if (pr.type === 'tree' || pr.type === 'rock') continue;
          if (Math.abs(cx - pr.x) < pr.hw + pad && Math.abs(cz - pr.z) < pr.hd + pad) { blocked = true; break; }
        }
        if (!blocked) return { x: cx, z: cz };
      }
    }
    return null;
  }

  // is the road ahead (and behind) clear enough to actually drive away?
  _clearRun(x, z, yaw, len) {
    for (const dir of [1, -1]) {
      for (let d = 2; d <= len; d += 2) {
        const cx = x + Math.sin(yaw) * d * dir, cz = z + Math.cos(yaw) * d * dir;
        if (this.island.height(cx, cz) < 0.4) continue;             // over water is fine to skip
        if (dir === 1 && this.island.slopeAt(cx, cz) > 1) return false;   // no cliff straight ahead
        for (const idx of this.island.propsNear(cx, cz)) {
          const pr = this.island.props[idx];
          // 2.6 m half-width for solid buildings, 1.2 m for trunks and boulders:
          // the corridor has to fit the car, not just its centre line
          const pad = pr.type === 'tree' || pr.type === 'rock' ? 1.2 : 2.6;
          if (Math.abs(cx - pr.x) < pr.hw + pad && Math.abs(cz - pr.z) < pr.hd + pad) return false;
        }
      }
    }
    return true;
  }

  _makeVehicle(kind, x, z, yaw) {
    const def = VEHICLES[kind];
    return {
      id: uid++, kind, def, x, z, y: Math.max(this.island.height(x, z), -0.3), yaw,
      speed: 0, steer: 0, hp: def.hp, maxHp: def.hp, driver: null, dead: false, t: 0,
      water: def.water, color: def.color,
    };
  }

  nearestVehicle(e, maxD) {
    let best = null, bd = maxD;
    for (const v of this.vehicles) {
      if (v.dead || v.driver) continue;
      const d = dist2D(e.x, e.z, v.x, v.z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  enterVehicle(e, v) {
    if (!v || v.dead || v.driver || e.vehicle || e.knocked) return false;
    v.y = v.water ? Math.max(this.island.height(v.x, v.z), -0.35) : Math.max(this.island.height(v.x, v.z), 0.05);
    e.vehicle = v;
    v.driver = e;
    v.speed = 0;
    e.x = v.x; e.z = v.z; e.y = v.y + 1.1;
    e.yaw = v.yaw;
    e.moveInX = 0; e.moveInZ = 0;
    this._emit({ type: 'vehicle', e, v, action: 'enter' });
    return true;
  }

  exitVehicle(e) {
    const v = e.vehicle;
    if (!v) return false;
    v.driver = null;
    v.speed *= 0.4;
    e.vehicle = null;
    const off = 2.2;
    e.x = clamp(v.x + Math.cos(v.yaw) * off, -WORLD * 0.47, WORLD * 0.47);
    e.z = clamp(v.z - Math.sin(v.yaw) * off, -WORLD * 0.47, WORLD * 0.47);
    e.y = Math.max(this.island.height(e.x, e.z), 0.05) + 0.1;
    e.vy = 0;
    this._emit({ type: 'vehicle', e, v, action: 'exit' });
    return true;
  }

  _updateVehicles(dt) {
    for (const v of this.vehicles) {
      if (v.dead) continue;
      v.t += dt;
      const e = v.driver;
      const def = v.def;
      if (e && !e.alive) { v.driver = null; e.vehicle = null; }
      if (e && e.alive) {
        const inp = e.input || {};
        // stick forward = drive forward; stick right = steer right
        const throttle = inp.fwd !== undefined ? clamp(inp.fwd, -1, 1) : -(inp.moveZ || 0);
        const steer = inp.side !== undefined ? clamp(inp.side, -1, 1) : -(inp.moveX || 0);
        v.steer = lerp(v.steer, clamp(steer, -1, 1), 1 - Math.pow(0.001, dt));
        const want = clamp(throttle, -1, 1);
        const target = want > 0 ? want * def.topSpeed : want * def.topSpeed * 0.45;
        // power falls off on slopes and in water for land vehicles
        const slope = this.island.slopeAt(v.x, v.z);
        const inWater = this.island.height(v.x, v.z) < 0.1;
        let grip = 1;
        if (!v.water) grip = clamp(1 - slope * 0.5, 0.45, 1) * (inWater ? 0.35 : 1);
        else grip = inWater ? 1 : 0.25;                      // boats only move on water
        const accel = v.speed < target ? def.accel * grip : -def.accel * 1.4;
        v.speed = clamp(v.speed + accel * dt, -def.topSpeed * 0.4, def.topSpeed * grip);
        if (!want) v.speed *= Math.pow(0.28, dt);
        v.yaw += v.steer * def.turn * dt * clamp(Math.abs(v.speed) / 6, 0, 1.1);
        const nx = v.x + Math.sin(v.yaw) * v.speed * dt;
        const nz = v.z + Math.cos(v.yaw) * v.speed * dt;
        v.x = clamp(nx, -WORLD * 0.47, WORLD * 0.47);
        v.z = clamp(nz, -WORLD * 0.47, WORLD * 0.47);
        // solid props stop the car. Trees and boulders are "soft" (no damage, less
        // speed lost) but they still shove the car out — otherwise a car nosed into
        // a trunk grinds against it at walking pace forever instead of sliding free
        for (const idx of this.island.propsNear(v.x, v.z)) {
          const pr = this.island.props[idx];
          const bx = pr.hw + 1.7, bz = pr.hd + 1.7;
          if (Math.abs(v.x - pr.x) > bx || Math.abs(v.z - pr.z) > bz) continue;
          const hit = Math.abs(v.speed);
          const soft = pr.type === 'tree' || pr.type === 'rock';
          if (soft) v.speed *= Math.pow(0.45, dt * 10);
          else v.speed *= hit > 8 ? -0.12 : 0.55;
          if (!soft && hit > 8) this._hurtVehicle(v, hit * 1.5, null);
          // shove the car out along the shortest axis, at driving pace: even a
          // crawling car escapes the box within a few frames
          const ox = v.x - pr.x, oz = v.z - pr.z;
          const pushX = Math.abs(ox) / bx > Math.abs(oz) / bz ? Math.sign(ox) : 0;
          const pushZ = pushX === 0 ? Math.sign(oz) : 0;
          const push = Math.min(Math.max(hit, 3), 10) * dt * 2.2;
          v.x += pushX * push;
          v.z += pushZ * push;
          break;
        }
        // land vehicles can't drive into the open sea
        if (!v.water && this.island.height(v.x, v.z) < -1.2) {
          v.speed *= Math.pow(0.02, dt);
          v.x -= Math.sin(v.yaw) * 4 * dt;
          v.z -= Math.cos(v.yaw) * 4 * dt;
        }
        const g = v.water ? Math.max(this.island.height(v.x, v.z), -0.35)
                          : Math.max(this.island.height(v.x, v.z), 0.05);
        v.y = lerp(v.y, g, 1 - Math.pow(0.002, dt));
        // the driver rides along
        e.x = v.x; e.z = v.z; e.y = v.y + 1.15;
        e.yaw = v.yaw;
        e.moveInX = 0; e.moveInZ = 0; e.vy = 0; e.onGround = true;
        // roadkill
        if (Math.abs(v.speed) > 6) {
          for (const o of this.entities) {
            if (o === e || !o.alive || o.team === e.team) continue;
            if (dist2D(v.x, v.z, o.x, o.z) < 1.9) {
              this._damage(o, Math.abs(v.speed) * 3.4, e, 'body', 'vehicle');
              v.speed *= 0.86;
            }
          }
        }
        this._emit({ type: 'vehicleDrive', v, e });
      } else {
        v.speed *= Math.pow(0.05, dt);
        v.yaw += v.steer * 0.6 * dt;
      }
      // vehicles take bullet damage like anything else (handled in _damage via _hurtVehicle)
      if (v.hp <= 0 && !v.dead) {
        v.dead = true;
        if (v.driver) this.exitVehicle(v.driver);
        this.effects.push({ kind: 'explode', x: v.x, y: v.y + 0.8, z: v.z, t: 0, dur: 0.85, r: 7, });
        for (const o of this.entities) {
          if (!o.alive) continue;
          const d = dist2D(v.x, v.z, o.x, o.z);
          if (d < 6.5 && Math.abs(o.y - v.y) < 5) this._damage(o, 90 * (1 - d / 7), null, 'body', 'vehicle');
        }
        this._emit({ type: 'vehicleDead', v });
      }
    }
  }

  _hurtVehicle(v, dmg, attacker) {
    if (v.dead) return;
    v.hp -= dmg;
    this._emit({ type: 'vehicleHit', v, dmg, attacker });
  }

  // ═══════════════════════════ PROJECTILES & EFFECTS ═══════════════════════
  _updateProjectiles(dt) {
    for (const p of this.projectiles) {
      if (p.dead) continue;
      p.t += dt;
      p.fuse -= dt;
      p.vy -= 14.5 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const ground = Math.max(0.03, this.island.height(p.x, p.z));
      for (const idx of this.island.propsNear(p.x, p.z)) {
        const pr = this.island.props[idx];
        const top = pr.y + pr.hh * 2;
        if (p.y < top && p.y > pr.y - 0.5) {
          const cs = Math.cos(-pr.rot), sn = Math.sin(-pr.rot);
          const lx = (p.x - pr.x) * cs - (p.z - pr.z) * sn, lz = (p.x - pr.x) * sn + (p.z - pr.z) * cs;
          if (Math.abs(lx) < pr.hw + 0.2 && Math.abs(lz) < pr.hd + 0.2) {
            p.y = top + 0.05;
            p.vy = Math.abs(p.vy) * 0.3;
            p.vx *= 0.5; p.vz *= 0.5;
            break;
          }
        }
      }
      if (p.y <= ground) { p.y = ground; p.vy = Math.abs(p.vy) * 0.3; p.vx *= 0.5; p.vz *= 0.5; if (Math.abs(p.vy) < 1.4) p.vy = 0; }
      if (p.fuse <= 0 || (p.t > 0.5 && p.vy === 0 && Math.hypot(p.vx, p.vz) < 0.5)) this._explode(p);
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  _explode(p) {
    p.dead = true;
    const def = ITEMS[p.kind];
    if (p.kind === 'grenade') {
      this.effects.push({ kind: 'explosion', x: p.x, y: p.y, z: p.z, t: 0, dur: 0.75, radius: def.radius });
      for (const e of this.entities) {
        if (!e.alive || e.parachuting) continue;
        const d = dist2D(e.x, e.z, p.x, p.z);
        if (d > def.radius) continue;
        const visible = this._canSeePoint(e, { x: p.x, y: p.y, z: p.z });
        const dmg = def.dmg * (1 - d / def.radius) * (visible ? 1 : 0.4);
        if (dmg > 4) this._damage(e, dmg, p.owner, 'body', 'grenade');
      }
      for (const g of this.glools) if (g.hp > 0 && dist2D(g.x, g.z, p.x, p.z) < def.radius) g.hp -= 170;
    } else if (p.kind === 'smoke') {
      this.effects.push({ kind: 'smoke', x: p.x, y: p.y, z: p.z, t: 0, dur: def.dur, radius: def.radius });
    } else if (p.kind === 'flash') {
      this.effects.push({ kind: 'flash', x: p.x, y: p.y, z: p.z, t: 0, dur: 0.45, radius: def.radius });
      for (const e of this.entities) {
        if (!e.alive) continue;
        const d = dist2D(e.x, e.z, p.x, p.z);
        if (d > def.radius) continue;
        if (!this._canSeePoint(e, { x: p.x, y: p.y, z: p.z })) continue;
        const dur = Math.max(0.7, 4.5 * (1 - d / def.radius));
        e.flash = dur;
        if (e.isPlayer) this._emit({ type: 'flashed', e, dur });
        if (e.ai) e.ai.target = null;
      }
    }
    this._emit({ type: 'explode', kind: p.kind, x: p.x, y: p.y, z: p.z, owner: p.owner, e: p.owner });
  }

  _updateEffects(dt) {
    for (const fx of this.effects) fx.t += dt;
    if (this.effects.length) this.effects = this.effects.filter((f) => f.t < f.dur);
    for (const g of this.glools) g.t += dt;
    if (this.glools.some((g) => g.hp <= 0 || g.t > 34)) this.glools = this.glools.filter((g) => g.hp > 0 && g.t <= 34);
  }

  _updateDrops(dt) {
    for (const d of this.drops) d.t += dt;
    if (this.drops.length > 1100) this.drops = this.drops.filter((d) => !d.taken);
  }

  // ═══════════════════════════ VISIBILITY ══════════════════════════════════
  _canSee(a, b) { return this._canSeePoint(a, { x: b.x, y: b.y + 1.15, z: b.z }, b); }

  _canSeePoint(a, point, other) {
    const ox = a.x, oy = a.y + (a.crouch ? EYE_CROUCH : EYE), oz = a.z;
    let dx = point.x - ox, dy = point.y - oy, dz = point.z - oz;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.001) return true;
    dx /= d; dy /= d; dz /= d;
    const dir = { x: dx, y: dy, z: dz };
    if (this._rayHitProp(ox, oy, oz, dir, d) < d - 0.15) return false;
    if (this._rayHitTerrain(ox, oy, oz, dir, d) < d - 0.15) return false;
    for (const fx of this.effects) {
      if (fx.kind !== 'smoke') continue;
      for (let t = 0.1; t < 0.95; t += 0.18) {
        const px = ox + dx * d * t, py = oy + dy * d * t, pz = oz + dz * d * t;
        if (Math.hypot(px - fx.x, pz - fx.z) < fx.radius * 0.8 && Math.abs(py - fx.y) < 5.5) return false;
      }
    }
    if (other && other.flash > 0) return false;
    return true;
  }

  _findVisibleEnemy(e, maxDist) {
    if (e.flash > 0) return null;
    let best = null, bd = maxDist;
    for (const o of this.entities) {
      if (!o.alive || o.team === e.team || o.parachuting) continue;
      if (o.knocked && dist2D(e.x, e.z, o.x, o.z) > 14) continue;
      const d = dist2D(e.x, e.z, o.x, o.z);
      if (d >= bd) continue;
      if (!this._canSee(e, o)) continue;
      bd = d; best = o;
    }
    return best;
  }

  // ═══════════════════════════ END CONDITIONS ══════════════════════════════
  _checkEnd() {
    const teams = new Set();
    let aliveN = 0, myTeam = 0;
    for (const e of this.entities) {
      if (!e.alive) continue;
      aliveN++; teams.add(e.team);
      if (e.team === this.player.team) myTeam++;
    }
    this.alive = aliveN;
    this.aliveTeams = teams.size;
    if (this.over) return;
    if (teams.size <= 1 || myTeam === 0) {
      const won = teams.size === 1 && this.entities.some((e) => e.alive && e.team === this.player.team);
      const place = won ? 1 : aliveN + 1;
      this.over = true;
      this.player.place = place;
      this.result = {
        won, place, kills: this.player.kills, damage: Math.round(this.stats.damage),
        headshots: this.player.headshots, knocks: this.stats.knocks, time: this.time,
        shots: this.stats.shots, hits: this.stats.hits, alive: aliveN, total: this.totalPlayers,
        accuracy: this.stats.shots ? this.stats.hits / this.stats.shots : 0,
      };
      this._emit({ type: 'gameover', result: this.result });
    }
  }

  _emit(ev) { ev.t = this.time; this.events.push(ev); }

  // ── helpers for the UI ───────────────────────────────────────────────────
  get playerState() {
    const p = this.player;
    const w = this._curWeapon(p);
    return {
      hp: Math.max(0, Math.round(p.hp)), maxHp: p.maxHp, knocked: p.knocked,
      weapon: w, weaponDef: w ? WEAPONS[w.id] : null, reloading: p.reloading,
      reloadPct: p.reloading ? 1 - p.reloadT / p.reloadTotal : 0,
      using: p.using, usePct: p.using ? 1 - p.useT / p.useTotal : 0,
      items: p.items, helmet: p.helmet, vest: p.vest, bag: p.bag, cur: p.cur, driving: p.vehicle,
      nearVehicle: p.vehicle ? null : this.nearestVehicle(p, 4.5),
      parachuting: p.parachuting, chuteOpen: p.chuteOpen, flash: p.flash, speed: p.speed,
      inWater: p.inWater, punching: p.punchT > 0, reviveT: p.reviveProgress, kicked: p.kick || 0,
      crouch: p.crouch, ads: p.ads,
    };
  }

  nearbyDrops(limit = 6, radius = 5.5) {
    const p = this.player, out = [];
    for (const d of this.drops) {
      if (d.taken) continue;
      const dist = dist2D(p.x, p.z, d.x, d.z);
      if (dist > radius) continue;
      out.push({ drop: d, dist });
    }
    out.sort((a, b) => a.dist - b.dist);
    return out.slice(0, limit);
  }

  squadInfo() {
    const out = [];
    for (const e of this.entities) {
      if (e.team !== this.player.team) continue;
      out.push({ id: e.id, name: e.name, hp: Math.max(0, Math.round(e.hp)), maxHp: e.maxHp, alive: e.alive, knocked: e.knocked, isPlayer: e.isPlayer, kills: e.kills, revive: Math.round(((e.reviveProgress || 0) / 3) * 100) });
    }
    return out;
  }

  rankOf(place, total) {
    if (place === 1) return 'BOOYAH';
    if (place <= 3) return 'TOP 3';
    if (place <= 10) return 'TOP 10';
    return `#${place}`;
  }
}

function wNameFor(battle, attacker, source) {
  const w = battle._curWeapon(attacker);
  if (typeof source === 'string' && WEAPONS[source] === undefined && source !== 'punch' && source !== 'bleed' && source !== 'zone') return source;
  if (source === 'punch') return 'FISTS';
  if (source === 'bleed' || source === 'zone') return 'ZONE';
  return w ? WEAPONS[w.id].name : 'ZONE';
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const mx = ox - cx, my = oy - cy, mz = oz - cz;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? -1 : t;
}
