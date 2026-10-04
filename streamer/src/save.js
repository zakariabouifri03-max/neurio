// ── Persistence (localStorage) ──────────────────────────────────────────────

const KEY = 'streamerlife2_save_v1';
const SET_KEY = 'streamerlife2_settings_v1';

export function defaultSave() {
  return {
    v: 1,
    name: 'You',
    money: 160,
    followers: 0,
    xp: 0,
    day: 1, hour: 8.5,
    energy: 100, hunger: 90,
    skill: 1,
    home: 'room',
    ownedHouses: ['room'],
    parts: { mic: 0, webcam: 0, cpu: 1, cooler: 0, gpu: 1, ram: 1, hdd: 0, cdrom: 0, monitor: 1, keyboard: 1, mouse: 1, router: 1, chair: 1, rgb: 0 },
    food: ['noodles', 'noodles'],       // fridge contents (ids)
    furniture: [],                       // owned, unplaced item ids
    placed: {},                          // houseId -> { slotIdx -> itemId }
    cars: [],
    deliveries: [],                      // [{item, day}]
    mail: [],                            // [{day, title, body, read, quest}]
    questsDone: [],
    sponsor: null,
    streams: 0,
    totalEarned: 0,
    donations: 0,
    photos: 0,
    lastChirpDay: 0,
    jobCooldownHour: -99,
    wonGame: false,
  };
}

export function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s === 'object') {
      const out = Object.assign(defaultSave(), s);
      out.parts = Object.assign(defaultSave().parts, s.parts || {});
      out.v = 1;
      return out;
    }
  } catch (e) { /* corrupted → fresh */ }
  return defaultSave();
}

export function persist(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode */ }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch (e) {}
}

export function defaultSettings() {
  return { quality: 'high', master: 0.8, music: 0.5, sfx: 0.9, sens: 1.0, fov: 75 };
}

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SET_KEY));
    if (s && typeof s === 'object') return Object.assign(defaultSettings(), s);
  } catch (e) {}
  return defaultSettings();
}

export function persistSettings(s) {
  try { localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch (e) {}
}
