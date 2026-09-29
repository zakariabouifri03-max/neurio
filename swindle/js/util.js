// ── client-side helpers ──────────────────────────────────────────────────────
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export function haptic(ms = 12) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* no vibrate */ } }

export function tween(from, to, dur, ease, onDone) {
  const t0 = performance.now();
  const f = (n) => {
    const k = Math.min(1, (performance.now() - t0) / dur);
    const v = from + (to - from) * (ease ? ease(k) : k);
    if (onDone) onDone(v, k);
    if (k < 1) requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}
export const easeOut = (k) => 1 - Math.pow(1 - k, 3);
export const easeBack = (k) => 1 + 2.2 * Math.pow(k - 1, 3) + 1.4 * Math.pow(k - 1, 2);
export const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export function fmt(n) { return Math.abs(Math.round(n)).toLocaleString('en-US'); }
export function signed(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(n); }
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function timeLeft(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : String(s);
}

// confetti / coin burst in DOM (used on menus & the final board)
export function burst(node, { count = 26, chars = ['🪙', '💵', '✨'], colors = ['#ffd23f', '#ff3d7f', '#39e6a0', '#5ad1ff'], spread = 1.0 } = {}) {
  if (!node) return;
  for (let i = 0; i < count; i++) {
    const p = el('i', 'bit');
    const c = colors[(Math.random() * colors.length) | 0];
    p.textContent = Math.random() < 0.55 ? c && chars[(Math.random() * chars.length) | 0] : '';
    if (!p.textContent) { p.style.background = c; p.style.borderColor = c; }
    const a = Math.random() * Math.PI * 2;
    const d = (60 + Math.random() * 320) * spread;
    p.style.setProperty('--dx', Math.cos(a) * d + 'px');
    p.style.setProperty('--dy', (Math.sin(a) * d - 160) + 'px');
    p.style.setProperty('--rot', (Math.random() * 900 - 450) + 'deg');
    p.style.setProperty('--dur', (0.9 + Math.random() * 0.9) + 's');
    node.appendChild(p);
    setTimeout(() => p.remove(), 1900);
  }
}

export function toastHost() { return $('#toasts'); }
export function toast(text, tone = '', ms = 2600) {
  const h = toastHost();
  if (!h) return;
  const t = el('div', 'toast ' + tone, text);
  h.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 320); }, ms);
}

export function copyText(s) {
  try { navigator.clipboard.writeText(s); return Promise.resolve(true); } catch (e) {
    return new Promise((res) => {
      const ta = el('textarea'); ta.value = s; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (x) { ok = false; }
      ta.remove(); res(ok);
    });
  }
}

export function isTouch() { return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window; }
export function portrait() { return innerHeight > innerWidth; }
