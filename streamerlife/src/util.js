// ── small helpers ───────────────────────────────────────────────────────────
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const rnd = (a = 1, b = 0) => b + Math.random() * (a - b);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const ri = (a, b) => a + ((Math.random() * (b - a + 1)) | 0);
export const $ = (id) => document.getElementById(id);

export function money(n) {
  n = Math.round(n);
  if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  return '$' + n.toLocaleString('en-US');
}
export function short(n) {
  n = Math.round(n);
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return '' + n;
}
export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
// deterministic pseudo random
export function hash(n) {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
export const NAMES = ['Zakaria', 'Amine', 'Yassine', 'Sofia', 'Nour', 'Mehdi', 'Lina', 'Omar', 'Rayan', 'Salma',
  'Karim', 'Hiba', 'Anas', 'Ilyas', 'Maya', 'Adam', 'Ghita', 'Walid', 'Sara', 'Bilal'];
