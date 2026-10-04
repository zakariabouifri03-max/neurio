// ---------- persistence ----------
const KEY = 'streamer-life2-save-v1';

export const DEFAULT_SAVE = {
  money: 15,
  followers: 0,
  ownedItems: ['cpu_zintel_1', 'gpu_ztx_low', 'ram_4', 'hdd_1', 'mon_1', 'mic_none', 'kb_1', 'mouse_1', 'chair_1', 'desk_1'],
  equipped: {},           // cat -> itemId (derived on load if empty)
  ownedHouses: ['trailer'],
  currentHouse: 'trailer',
  ownedCars: ['sedan_old'],
  wallpaper: 0,
  timeMin: 9 * 60,        // 09:00
  settings: {
    quality: 'high',      // low / medium / high
    shadows: true,
    viewDist: 220,
    volume: 0.8,
    sensitivity: 1,
    invertY: false,
    name: 'Streamer_' + Math.floor(1000 + Math.random() * 9000),
  },
};

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SAVE);
    const s = JSON.parse(raw);
    const base = structuredClone(DEFAULT_SAVE);
    return { ...base, ...s, settings: { ...base.settings, ...(s.settings || {}) } };
  } catch { return structuredClone(DEFAULT_SAVE); }
}

export function storeSave(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

export function wipeSave() { try { localStorage.removeItem(KEY); } catch {} }
