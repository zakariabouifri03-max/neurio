// ============================================================
// save.js — localStorage persistence: settings + game progress
// ============================================================
const SETTINGS_KEY = 'starview_settings_v1';
const SAVE_KEY = 'starview_save_v1';
const UNLOCK_KEY = 'starview_unlocked_v1';

export const defaultSettings = () => ({
  vol: 0.8, sens: 0.8, invertY: false, fov: 75,
  grain: 1,          // 0 off · 1 subtle · 2 strong
  bright: 1.0, subs: true,
});

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    return { ...defaultSettings(), ...(s || {}) };
  } catch { return defaultSettings(); }
}
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

export function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; }
}
// save = { checkpoint, flags:{}, clock, stats:{deaths, scares, thrown}, held }
export function writeSave(save) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {}
}
export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch {}
}
export function hasSave() { return !!loadSave(); }

export function loadUnlocked() {
  try { return JSON.parse(localStorage.getItem(UNLOCK_KEY) || '[]'); } catch { return []; }
}
export function unlockChapter(id) {
  const u = loadUnlocked();
  if (!u.includes(id)) { u.push(id); try { localStorage.setItem(UNLOCK_KEY, JSON.stringify(u)); } catch {} }
}
