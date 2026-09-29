// ── Tiny helpers shared by the authoritative server and the client ───────────
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rint = (r, a, b) => a + Math.floor(r() * (b - a + 1));
export const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
export const flip = (r) => r() < 0.5;

export function shuffle(r, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

export const fmt = (n) => Math.abs(Math.round(n)).toLocaleString('en-US');
export const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(n);

const CODE_ALPHA = 'ACDEFGHJKLMNPQRSTUVWXY345679';
export function makeCode(r) {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_ALPHA[Math.floor(r() * CODE_ALPHA.length)];
  return s;
}

// Server-side sanitisers. Names never reach the renderer as raw HTML.
export function cleanName(s, fb = 'Player') {
  if (typeof s !== 'string') return fb;
  const out = s.replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/&/g, 'and')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14);
  return out.length ? out : fb;
}

export function cleanText(s, max = 90) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// Extremely small "be kind" filter: strips contact info + a few rude words.
const BANNED = ['fuck', 'shit', 'bitch', 'cunt', 'dick', 'nigger', 'faggot', 'retard'];
export function filterChat(s) {
  let out = cleanText(s, 80);
  for (const w of BANNED) {
    const re = new RegExp(w.slice(0, 3) + '[a-z@!*+-]*', 'gi');
    out = out.replace(re, (m) => m[0] + '•'.repeat(Math.min(6, m.length - 1)));
  }
  out = out.replace(/(\+?\d[\d\s().-]{7,}\d)/g, '[number hidden]');
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email hidden]');
  return out.slice(0, 80);
}

export function uid(r, pre = 'x') {
  return pre + Math.floor(r() * 1e9).toString(36);
}
