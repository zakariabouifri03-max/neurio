// ── Deterministic RNG + math helpers ─────────────────────────────────────────
// Everything in the football world is generated from a single seed, so the
// same seed always rebuilds the exact same universe (and saves stay valid).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) { this.next = mulberry32(seed); }
  f() { return this.next(); }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.min(b, a + Math.floor(this.next() * (b - a + 1))); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
  chance(p) { return this.next() < p; }
  weighted(items, wf) {
    let total = 0;
    for (const it of items) total += Math.max(0, wf(it));
    if (total <= 0) return items[0];
    let r = this.next() * total;
    for (const it of items) { r -= Math.max(0, wf(it)); if (r <= 0) return it; }
    return items[items.length - 1];
  }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  // gaussian-ish (sum of 3 uniforms), mean 0, ~unit spread
  gauss() { return (this.next() + this.next() + this.next() - 1.5) * 1.1547; }
}

// proper integer in [a, b]
function ri(rng, a, b) { return Math.min(b, a + Math.floor(rng.f() * (b - a + 1))); }

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const r2 = (v) => Math.round(v * 100) / 100;
export const round = (v, d = 0) => { const m = 10 ** d; return Math.round(v * m) / m; };

export function fmtMoney(v) {
  const n = Math.round(v);
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2).replace(/\.00$/, '') + 'B€';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M€';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + 'K€';
  return n + '€';
}
export function fmtNum(v) { return Math.round(v).toLocaleString('en-US'); }

export const POS_GROUP = (p) => {
  if (p === 'GK') return 'GK';
  if (p[0] === 'D') return 'DF';
  if (p[0] === 'M') return 'MF';
  return 'FW';
};
export const POS_NAME_AR = { GK: 'حارس', RB: 'ظهير أيمن', LB: 'ظهير أيسر', CB: 'قلب دفاع', DM: 'وسط مدافع', CM: 'وسط ميدان', AM: 'صانع ألعاب', RW: 'جناح أيمن', LW: 'جناح أيسر', ST: 'مهاجم صريح' };
export const POS_NAME_EN = { GK: 'Goalkeeper', RB: 'Right Back', LB: 'Left Back', CB: 'Centre Back', DM: 'Defensive Mid', CM: 'Central Mid', AM: 'Attacking Mid', RW: 'Right Wing', LW: 'Left Wing', ST: 'Striker' };

export const ATTRS = ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
export const ATTR_AR = { pac: 'السرعة', sho: 'التسديد', pas: 'التمرير', dri: 'المراوغة', def: 'الدفاع', phy: 'البدنية', gk: 'الحراسة' };
export const ATTR_EN = { pac: 'Pace', sho: 'Shooting', pas: 'Passing', dri: 'Dribbling', def: 'Defending', phy: 'Physical', gk: 'Goalkeeping' };

export { ri };
