/* ============================================================
   Botola 25 — save.js
   LocalStorage persistence with a version tag, safe on private mode.
   ============================================================ */

const KEY = 'botola25.save';
const VERSION = 3;

const memory = {};

export function loadSave() {
  try {
    const raw = (typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) || memory[KEY];
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== VERSION) return null;
    return data;
  } catch (e) {
    return null;
  }
}

export function writeSave(data) {
  const payload = JSON.stringify({ ...data, version: VERSION, savedAt: Date.now() });
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, payload);
  } catch (e) { /* private mode / quota — fall through */ }
  memory[KEY] = payload;
  return true;
}

export function clearSave() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
  } catch (e) { /* ignore */ }
  delete memory[KEY];
}

export const hasSave = () => !!loadSave();
