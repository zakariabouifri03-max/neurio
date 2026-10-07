// Command registry: one source of truth for menus, shortcuts and the Ctrl+K palette.
import { S } from './state.js';
export const COMMANDS = new Map();
let userKeys = {};
export function defCommand(c) { COMMANDS.set(c.id, { cat: 'Other', ...c }); return c; }
export function setUserShortcuts(map) { userKeys = map || {}; }
export const shortcutOf = (id) => { const c = COMMANDS.get(id); if (!c) return ''; return id in userKeys ? userKeys[id] : c.key || ''; };
export function defaultShortcutOf(id) { const c = COMMANDS.get(id); return (c && c.key) || ''; }
export function userShortcuts() { return userKeys; }
export function runCommand(id, ...args) {
  const c = COMMANDS.get(id); if (!c) return false;
  if (c.enabled && !c.enabled()) return false;
  try { const r = c.run(...args); if (r && r.catch) r.catch((e) => reportError(id, e)); } catch (e) { reportError(id, e); }
  return true;
}
function reportError(id, e) { console.error('[command ' + id + ']', e); import('../ui/common.js').then((m) => m.toast(`${(COMMANDS.get(id) || {}).label || id} failed: ${e.message || e}`, 'error', 5000)); }
const NAMES = { ' ': 'Space', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Delete: 'Delete', Backspace: 'Backspace', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', '+': '+', '=': '=', '-': '-', ',': ',', '.': '.' };
export function comboOf(e) {
  let k = e.key; if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return '';
  k = NAMES[k] || (k.length === 1 ? k.toUpperCase() : k);
  const parts = []; if (e.ctrlKey || e.metaKey) parts.push('Ctrl'); if (e.altKey) parts.push('Alt'); if (e.shiftKey && !(k.length === 1 && !/[A-Z0-9]/.test(k) && false)) parts.push('Shift');
  parts.push(k); return parts.join('+');
}
export function matchCommand(e) {
  const combo = comboOf(e); if (!combo) return null;
  let found = null;
  for (const [id, c] of COMMANDS) { const sc = id in userKeys ? userKeys[id] : c.key; if (!sc) continue; if (sc.split('|').includes(combo)) { found = c; break; } }
  return found;
}
export function prettyKey(s) { return (s || '').split('|')[0]; }
