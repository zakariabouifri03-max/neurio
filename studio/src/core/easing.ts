import type { Easing, EasingName } from './types';

export const EASING_NAMES: { id: EasingName; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'easeIn', label: 'Ease In' },
  { id: 'easeOut', label: 'Ease Out' },
  { id: 'easeInOut', label: 'Ease In/Out' },
  { id: 'easeInCubic', label: 'Ease In (Cubic)' },
  { id: 'easeOutCubic', label: 'Ease Out (Cubic)' },
  { id: 'easeInOutCubic', label: 'Ease In/Out (Cubic)' },
  { id: 'easeOutBack', label: 'Overshoot' },
  { id: 'easeOutBounce', label: 'Bounce' },
  { id: 'easeOutElastic', label: 'Elastic' },
  { id: 'hold', label: 'Hold' },
];

const named: Record<EasingName, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeOutBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeOutBounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  easeOutElastic: (t) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  hold: () => 0,
};

/** Solve cubic bezier y for x using Newton iterations (CSS-like timing function). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const ax = 1 - 3 * x2 + 3 * x1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 1 - 3 * y2 + 3 * y1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const e = sampleX(t) - x;
    if (Math.abs(e) < 1e-5) return sampleY(t);
    const s = slopeX(t);
    if (Math.abs(s) < 1e-6) break;
    t -= e / s;
  }
  let lo = 0, hi = 1;
  t = x;
  while (lo < hi) {
    const e = sampleX(t);
    if (Math.abs(e - x) < 1e-5) break;
    if (x > e) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return sampleY(t);
}

export function applyEasing(e: Easing, t: number): number {
  if (Array.isArray(e)) return cubicBezier(e[0], e[1], e[2], e[3], t);
  return (named[e] || named.linear)(t);
}
