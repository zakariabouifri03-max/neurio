// Pure gameplay rules, shared by the game and its tests. No browser / WebGL required.
export const RELAYS = Object.freeze([
  { id: 'relay-01', name: 'South Bank relay', short: 'South Bank', x: 9, z: 8, code: 'NXS_001' },
  { id: 'relay-02', name: 'Waterloo relay', short: 'Waterloo', x: -9, z: -31, code: 'NXS_002' },
  { id: 'relay-03', name: 'Borough relay', short: 'Borough', x: 52, z: -55, code: 'NXS_003' },
]);
export const SAFEHOUSE = Object.freeze({ x: 3, z: 34 });
export const HACK_RANGE = 13;
export const HACK_DURATION = 2.4;
export const SAVE_KEY = 'ghostline-operation-v1';
export const SETTINGS_KEY = 'ghostline-settings-v1';
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function readStorage(storage, key) {
  try { return JSON.parse(storage.getItem(key)) || {}; } catch { return {}; }
}
export function writeStorage(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export function seededRandom(seed = 4917) {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function intersects(x, z, radius, rect) {
  const dx = x - clamp(x, rect.minX, rect.maxX), dz = z - clamp(z, rect.minZ, rect.maxZ);
  return dx * dx + dz * dz < radius * radius;
}
export function slideMove(position, dx, dz, colliders, radius = .32) {
  let x = clamp(position.x + dx, -120, 120), z = position.z;
  if (colliders.some(rect => intersects(x, z, radius, rect))) x = position.x;
  z = clamp(position.z + dz, -120, 120);
  if (colliders.some(rect => intersects(x, z, radius, rect))) z = position.z;
  return { x, z };
}
export function formatTime(seconds) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}
export class Mission {
  constructor(snapshot = {}) {
    snapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
    this.breached = new Set(Array.isArray(snapshot.breached) ? snapshot.breached.filter(id => RELAYS.some(r => r.id === id)) : []);
    this.elapsed = typeof snapshot.elapsed === 'number' && Number.isFinite(snapshot.elapsed) ? clamp(snapshot.elapsed, 0, 86400) : 0;
    this.completed = snapshot.completed === true && this.breached.size === RELAYS.length;
    this.active = false;
    this.hack = null;
  }
  get xp() { return this.breached.size * 150 + (this.completed ? 300 : 0); }
  get extracting() { return this.breached.size === RELAYS.length && !this.completed; }
  start() { this.active = true; }
  beginHack(id, position) {
    const relay = RELAYS.find(r => r.id === id);
    if (!this.active || this.hack || !relay || this.breached.has(id) || distance(position, relay) > HACK_RANGE) return false;
    this.hack = { id, progress: 0 };
    return true;
  }
  cancelHack() { this.hack = null; }
  tick(dt, position) {
    if (!this.active || !Number.isFinite(dt) || dt <= 0) return null;
    dt = Math.min(dt, .1); // Never let a background-tab stall skip the interaction.
    if (!this.completed) this.elapsed += dt;
    if (this.hack) {
      const relay = RELAYS.find(r => r.id === this.hack.id);
      if (distance(position, relay) > HACK_RANGE + 1) { this.hack = null; return { type: 'cancelled' }; }
      this.hack.progress = Math.min(1, this.hack.progress + dt / HACK_DURATION);
      if (this.hack.progress >= 1 - 1e-6) {
        this.breached.add(relay.id); this.hack = null;
        return { type: 'breached', relay, extracting: this.extracting };
      }
    }
    if (this.extracting && distance(position, SAFEHOUSE) < 3.5) {
      this.completed = true;
      return { type: 'complete' };
    }
    return null;
  }
  snapshot() { return { breached: [...this.breached], elapsed: this.elapsed, completed: this.completed }; }
}
