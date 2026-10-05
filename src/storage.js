const WORLD_KEY = 'neurio_blocks_worlds_v1';
const SETTINGS_KEY = 'neurio_blocks_settings_v1';

export const DEFAULT_SETTINGS = Object.freeze({
  fov: 76,
  sensitivity: 0.0022,
  renderDistance: 2,
  quality: 'balanced',
  showCoordinates: true,
  invertY: false,
  sound: true,
  music: false,
});

export function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage may be disabled */ }
}

export function listWorlds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(WORLD_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((w) => w && w.id && w.seed) : [];
  } catch {
    return [];
  }
}

export function saveWorld(record) {
  const worlds = listWorlds();
  const index = worlds.findIndex((w) => w.id === record.id);
  const clean = {
    ...record,
    updatedAt: Date.now(),
    edits: record.edits || [],
    inventory: record.inventory || {},
  };
  if (index < 0) worlds.unshift(clean); else worlds[index] = clean;
  worlds.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  try { localStorage.setItem(WORLD_KEY, JSON.stringify(worlds.slice(0, 8))); } catch {
    // If a world becomes large, keep only the most recent worlds rather than losing the current save.
    try { localStorage.setItem(WORLD_KEY, JSON.stringify(worlds.slice(0, 2))); } catch { /* private browsing */ }
  }
  return clean;
}

export function deleteWorld(id) {
  const worlds = listWorlds().filter((w) => w.id !== id);
  try { localStorage.setItem(WORLD_KEY, JSON.stringify(worlds)); } catch { /* private browsing */ }
}

export function newWorldRecord({ name, seed, mode = 'survival', difficulty = 'normal' }) {
  const safeSeed = String(seed || Math.floor(Math.random() * 99999999 + 1));
  return {
    id: `world-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: String(name || 'New World').slice(0, 30),
    seed: safeSeed.slice(0, 36),
    mode,
    difficulty,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    time: 300,
    health: 20,
    hunger: 20,
    position: null,
    inventory: {},
    selected: 0,
    edits: [],
  };
}
