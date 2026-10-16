// Deterministic, browser-independent survival rules.
export const SAVE_KEY = "hollowpine-save-v1";
export const SETTINGS_KEY = "hollowpine-settings-v1";
export const CAMP = Object.freeze({ x: -1, z: 7 });
export const FIRE_SITE = Object.freeze({ x: -4.5, z: 6 });
export const SHELTER_SITE = Object.freeze({ x: 4, z: 2 });
export const SPAWN = Object.freeze({ x: 0, z: 20 });
export const WATER_SITE = Object.freeze({ x: 21.4, z: 12 });
export const INTERACT_RANGE = 3.2;
export const RECIPES = Object.freeze({
  fire: {
    name: "Campfire",
    description:
      "A little light in a very large darkness. Restores warmth and keeps wolves away.",
    cost: { wood: 4, stone: 4 },
  },
  shelter: {
    name: "Lean-to shelter",
    description:
      "A roof of branches and pine boughs. A place to rest, recover, and see another dawn.",
    cost: { wood: 8, fiber: 4 },
  },
});
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function random(seed = 8217) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const shoreX = (z) =>
  23 + Math.sin(z * 0.065) * 2.7 + Math.sin(z * 0.18) * 0.7;
export function heightAt(x, z) {
  const clearing = 1 - Math.exp(-((x + 1) ** 2 + (z - 8) ** 2) / 450);
  const land =
    0.35 +
    (Math.sin(x * 0.13) * 0.65 +
      Math.cos(z * 0.12) * 0.5 +
      Math.sin((x + z) * 0.17) * 0.32 +
      0.2) *
      clearing;
  const edge = clamp((shoreX(z) - x) / 6, 0, 1);
  return -0.7 + (land + 0.7) * edge;
}
export const RESOURCE_DEFS = Object.freeze([
  ...[
    [-2.2, 18],
    [4, 15],
    [-6, 12],
    [-8, 6],
    [2, -3],
    [-12, 0],
    [10, -3],
    [-3, -13],
    [-19, 8],
    [-16, 23],
    [5, 28],
    [-8, 32],
    [11, 20],
    [-25, -9],
  ].map(([x, z], i) => ({
    id: `wood-${i}`,
    type: "wood",
    name: "Fallen branch",
    x,
    z,
    amount: 2,
  })),
  ...[
    [5.5, 20],
    [8, 11],
    [-7, 21],
    [-14, 8],
    [13, 5],
    [-3, -6],
    [9, -20],
    [-19, -16],
  ].map(([x, z], i) => ({
    id: `stone-${i}`,
    type: "stone",
    name: "Loose stones",
    x,
    z,
    amount: 2,
  })),
  ...[
    [-4.5, 22],
    [-9, 10],
    [7, 7],
    [-13, -5],
    [3, 31],
    [-24, 12],
    [-15, -20],
  ].map(([x, z], i) => ({
    id: `fiber-${i}`,
    type: "fiber",
    name: "Wild flax",
    x,
    z,
    amount: 2,
  })),
  ...[
    [7, 23],
    [-10, 18],
    [14, -1],
    [-18, 0],
    [-2, -19],
    [-18, 32],
    [8, -29],
  ].map(([x, z], i) => ({
    id: `berries-${i}`,
    type: "berries",
    name: "Wild berries",
    x,
    z,
    amount: 3,
  })),
]);
export const TREE_DEFS = Object.freeze(
  [
    [-11, 15],
    [-13, 2],
    [8, -9],
    [-1, -16],
    [14, -18],
    [-17, -14],
    [-23, 18],
    [-8, 33],
    [-18, 36],
    [-29, -5],
    [8, 37],
    [-31, -21],
  ].map(([x, z], i) => ({
    id: `pine-${i}`,
    type: "tree",
    name: "Pine tree",
    x,
    z,
    amount: 5,
    height: 12 + (i % 4) * 1.7,
  })),
);
function safeNumber(value, fallback, min = 0, max = 100) {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, min, max)
    : fallback;
}
export function readStorage(storage, key) {
  try {
    return JSON.parse(storage.getItem(key)) || {};
  } catch {
    return {};
  }
}
export function writeStorage(storage, key, data) {
  try {
    storage.setItem(key, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
export function collides(x, z, radius, obstacle) {
  return Math.hypot(x - obstacle.x, z - obstacle.z) < radius + obstacle.radius;
}
export function movePlayer(position, dx, dz, obstacles, radius = 0.3) {
  let x = clamp(position.x + dx, -58, shoreX(position.z) - 1),
    z = position.z;
  if (obstacles.some((o) => collides(x, z, radius, o))) x = position.x;
  z = clamp(position.z + dz, -58, 62);
  if (obstacles.some((o) => collides(x, z, radius, o))) z = position.z;
  x = Math.min(x, shoreX(z) - 1);
  return { x, z };
}
export function formatClock(hour) {
  const m = Math.floor((hour % 24) * 60 + 1e-8);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
export function formatDuration(seconds) {
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}s`;
}

export class Survival {
  constructor(save = {}) {
    save = save && typeof save === "object" ? save : {};
    this.active = false;
    this.health = safeNumber(save.health, 100);
    this.stamina = 100;
    this.hunger = safeNumber(save.hunger, 88);
    this.thirst = safeNumber(save.thirst, 92);
    this.warmth = safeNumber(save.warmth, 82);
    this.inventory = Object.fromEntries(
      ["wood", "stone", "fiber", "berries"].map((k) => [
        k,
        Math.floor(
          safeNumber(save.inventory?.[k], k === "berries" ? 2 : 0, 0, 99),
        ),
      ]),
    );
    this.bottle = Math.floor(safeNumber(save.bottle, 2, 0, 3));
    this.built = {
      fire: save.built?.fire === true,
      shelter: save.built?.shelter === true,
    };
    this.fuel = this.built.fire ? safeNumber(save.fuel, 600, 0, 900) : 0;
    this.collected = new Set(
      Array.isArray(save.collected)
        ? save.collected.filter((id) => RESOURCE_DEFS.some((r) => r.id === id))
        : [],
    );
    this.felled = new Set(
      Array.isArray(save.felled)
        ? save.felled.filter((id) => TREE_DEFS.some((t) => t.id === id))
        : [],
    );
    this.treeHits = {};
    this.clockHours = safeNumber(save.clockHours, 17.2, 0, 24000);
    this.playTime = safeNumber(save.playTime, 0, 0, 864000);
    this.gathered = save.gathered === true || this.built.fire;
    this.completed =
      save.completed === true && this.built.fire && this.built.shelter;
    this.checkMilestone();
  }
  get hour() {
    return this.clockHours % 24;
  }
  get day() {
    return Math.floor(this.clockHours / 24) + 1;
  }
  get night() {
    return this.hour >= 20 || this.hour < 6;
  }
  get fireLit() {
    return this.built.fire && this.fuel > 0;
  }
  get dead() {
    return this.health <= 0;
  }
  get objectives() {
    return [this.gathered, this.built.fire, this.built.shelter, this.completed];
  }
  start() {
    this.active = true;
  }
  checkMilestone() {
    if (this.inventory.wood >= 4 && this.inventory.stone >= 4)
      this.gathered = true;
  }
  gather(id, position) {
    const r = RESOURCE_DEFS.find((r) => r.id === id);
    if (
      !this.active ||
      this.dead ||
      !r ||
      this.collected.has(id) ||
      distance(position, r) > INTERACT_RANGE
    )
      return { ok: false, reason: "range" };
    if (this.inventory[r.type] >= 99) return { ok: false, reason: "full" };
    this.inventory[r.type] = Math.min(99, this.inventory[r.type] + r.amount);
    this.collected.add(id);
    this.checkMilestone();
    return { ok: true, type: r.type, amount: r.amount, name: r.name };
  }
  chop(id, position) {
    const tree = TREE_DEFS.find((t) => t.id === id);
    if (
      !this.active ||
      this.dead ||
      !tree ||
      this.felled.has(id) ||
      distance(position, tree) > INTERACT_RANGE
    )
      return { ok: false, reason: "range" };
    if (this.stamina < 8) return { ok: false, reason: "tired" };
    this.stamina -= 8;
    this.treeHits[id] = (this.treeHits[id] || 0) + 1;
    if (this.treeHits[id] >= 4) {
      this.felled.add(id);
      this.inventory.wood = Math.min(99, this.inventory.wood + 5);
      this.checkMilestone();
      return { ok: true, felled: true, amount: 5 };
    }
    return { ok: true, felled: false, hits: this.treeHits[id] };
  }
  canAfford(key) {
    return (
      Object.hasOwn(RECIPES, key) &&
      Object.entries(RECIPES[key].cost).every(
        ([k, n]) => this.inventory[k] >= n,
      )
    );
  }
  craft(key, position) {
    const recipe = Object.hasOwn(RECIPES, key) ? RECIPES[key] : null;
    if (!this.active || this.dead || !recipe)
      return { ok: false, reason: "invalid" };
    if (this.built[key]) return { ok: false, reason: "built" };
    if (distance(position, CAMP) > 11) return { ok: false, reason: "camp" };
    if (!this.canAfford(key)) return { ok: false, reason: "materials" };
    this.checkMilestone();
    for (const [k, n] of Object.entries(recipe.cost)) this.inventory[k] -= n;
    this.built[key] = true;
    if (key === "fire") {
      this.fuel = 600;
      this.gathered = true;
    }
    return { ok: true, key, name: recipe.name };
  }
  eat() {
    if (!this.active || this.dead) return { ok: false, reason: "inactive" };
    if (this.hunger > 97) return { ok: false, reason: "full" };
    if (this.inventory.berries <= 0) return { ok: false, reason: "empty" };
    this.inventory.berries--;
    this.hunger = Math.min(100, this.hunger + 32);
    this.health = Math.min(100, this.health + 5);
    return { ok: true };
  }
  drink() {
    if (!this.active || this.dead) return { ok: false, reason: "inactive" };
    if (this.thirst > 97) return { ok: false, reason: "full" };
    if (this.bottle <= 0) return { ok: false, reason: "empty" };
    this.bottle--;
    this.thirst = Math.min(100, this.thirst + 42);
    return { ok: true };
  }
  refill(position) {
    if (!this.active || this.dead || distance(position, WATER_SITE) > 4)
      return { ok: false, reason: "range" };
    this.bottle = 3;
    this.thirst = 100;
    return { ok: true };
  }
  tendFire(position) {
    if (
      !this.active ||
      this.dead ||
      !this.built.fire ||
      distance(position, FIRE_SITE) > 4
    )
      return { ok: false, reason: "range" };
    if (this.inventory.wood <= 0) return { ok: false, reason: "wood" };
    if (this.fuel > 800) return { ok: false, reason: "full" };
    this.inventory.wood--;
    this.fuel = Math.min(900, this.fuel + 180);
    this.warmth = Math.min(100, this.warmth + 10);
    return { ok: true };
  }
  rest(position) {
    if (
      !this.active ||
      this.dead ||
      !this.built.shelter ||
      distance(position, SHELTER_SITE) > 4.2
    )
      return { ok: false, reason: "shelter" };
    if (!this.fireLit) return { ok: false, reason: "fire" };
    if (this.hunger < 20 || this.thirst < 20)
      return { ok: false, reason: "vitals" };
    let dawn = Math.floor(this.clockHours / 24) * 24 + 6.2;
    if (dawn <= this.clockHours + 1e-8) dawn += 24;
    this.clockHours = dawn;
    this.health = Math.min(100, this.health + 35);
    this.hunger = Math.max(30, this.hunger - 12);
    this.thirst = Math.max(30, this.thirst - 18);
    this.warmth = 100;
    this.stamina = 100;
    this.fuel = Math.max(120, this.fuel - 60);
    const first = !this.completed;
    this.completed = true;
    return { ok: true, first };
  }
  recover() {
    this.health = 85;
    this.hunger = 72;
    this.thirst = 80;
    this.warmth = 78;
    this.stamina = 100;
    this.clockHours = Math.floor(this.clockHours / 24) * 24 + 30.2;
    this.active = true;
  }
  tick(dt, environment = {}) {
    if (!this.active || this.dead || !Number.isFinite(dt) || dt <= 0)
      return null;
    dt = Math.min(dt, 0.1);
    this.playTime += dt;
    this.clockHours += dt * 0.014;
    this.hunger = Math.max(0, this.hunger - dt * 0.065);
    this.thirst = Math.max(0, this.thirst - dt * 0.095);
    this.stamina = clamp(
      this.stamina + dt * (environment.sprinting ? -17 : 13),
      0,
      100,
    );
    this.fuel = Math.max(0, this.fuel - dt);
    const warm = (environment.nearFire && this.fireLit) || environment.torch;
    this.warmth = clamp(
      this.warmth + dt * (warm ? 1.4 : this.night ? -0.25 : 0.025),
      0,
      100,
    );
    const danger =
      (this.hunger <= 0 ? 0.5 : 0) +
      (this.thirst <= 0 ? 0.8 : 0) +
      (this.warmth < 10 ? 0.4 : 0) +
      (environment.wolfDanger ? 9 : 0);
    this.health = clamp(this.health - dt * danger, 0, 100);
    return this.dead ? { type: "death" } : null;
  }
  snapshot() {
    return {
      health: this.health,
      hunger: this.hunger,
      thirst: this.thirst,
      warmth: this.warmth,
      inventory: { ...this.inventory },
      bottle: this.bottle,
      built: { ...this.built },
      fuel: this.fuel,
      collected: [...this.collected],
      felled: [...this.felled],
      clockHours: this.clockHours,
      playTime: this.playTime,
      gathered: this.gathered,
      completed: this.completed,
    };
  }
}
