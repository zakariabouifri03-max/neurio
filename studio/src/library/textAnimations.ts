/**
 * Text animation presets. Each animation maps progress (0..1, eased) to a per-unit
 * transform. "in" animations run forward, "out" animations run reversed.
 */
export interface UnitState {
  alpha: number;
  dx: number; // in em units (relative to fontSize)
  dy: number;
  scale: number;
  rotate: number; // degrees
  blur: number; // px (em)
  skew: number;
  clip?: number; // typewriter-like visibility 0..1
  colorShift?: number; // hue rotate degrees
  trackingDelta?: number;
}

export interface TextAnimDef {
  id: string;
  name: string;
  icon: string;
  kind: 'inout' | 'loop';
  fn: (p: number, index: number, count: number, t: number) => Partial<UnitState>;
}

const easeOutBack = (t: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const easeOutElastic = (t: number) => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1);
const easeOutBounce = (t: number) => {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};

export const TEXT_ANIMATIONS: TextAnimDef[] = [
  { id: 'none', name: 'None', icon: '—', kind: 'inout', fn: () => ({}) },
  { id: 'fade', name: 'Fade', icon: '◐', kind: 'inout', fn: (p) => ({ alpha: p }) },
  { id: 'slideUp', name: 'Slide Up', icon: '⬆', kind: 'inout', fn: (p) => ({ alpha: p, dy: (1 - p) * 0.8 }) },
  { id: 'slideDown', name: 'Slide Down', icon: '⬇', kind: 'inout', fn: (p) => ({ alpha: p, dy: -(1 - p) * 0.8 }) },
  { id: 'slideLeft', name: 'Slide Left', icon: '⬅', kind: 'inout', fn: (p) => ({ alpha: p, dx: (1 - p) * 1.5 }) },
  { id: 'slideRight', name: 'Slide Right', icon: '➡', kind: 'inout', fn: (p) => ({ alpha: p, dx: -(1 - p) * 1.5 }) },
  { id: 'pop', name: 'Pop', icon: '💥', kind: 'inout', fn: (p) => ({ alpha: Math.min(1, p * 3), scale: easeOutBack(p) }) },
  { id: 'zoom', name: 'Zoom', icon: '🔍', kind: 'inout', fn: (p) => ({ alpha: p, scale: 0.2 + 0.8 * p }) },
  { id: 'zoomOut', name: 'Zoom Out', icon: '🔎', kind: 'inout', fn: (p) => ({ alpha: p, scale: 3 - 2 * p }) },
  { id: 'bounce', name: 'Bounce', icon: '🏀', kind: 'inout', fn: (p) => ({ alpha: Math.min(1, p * 4), dy: -(1 - easeOutBounce(p)) * 1.5 }) },
  { id: 'elastic', name: 'Elastic', icon: '🪀', kind: 'inout', fn: (p) => ({ alpha: Math.min(1, p * 4), scale: easeOutElastic(p) }) },
  { id: 'blur', name: 'Blur In', icon: '◌', kind: 'inout', fn: (p) => ({ alpha: p, blur: (1 - p) * 0.3 }) },
  { id: 'typewriter', name: 'Typewriter', icon: '⌨', kind: 'inout', fn: (p) => ({ alpha: p > 0.01 ? 1 : 0 }) },
  { id: 'rotate', name: 'Rotate', icon: '🔄', kind: 'inout', fn: (p) => ({ alpha: p, rotate: (1 - p) * 90, scale: 0.5 + 0.5 * p }) },
  { id: 'flipX', name: 'Flip', icon: '🔃', kind: 'inout', fn: (p) => ({ alpha: p, skew: (1 - p) * 60 }) },
  { id: 'drop', name: 'Drop', icon: '🪂', kind: 'inout', fn: (p) => ({ alpha: Math.min(1, p * 3), dy: -(1 - p) * (1 - p) * 3, scale: 1 + (1 - p) * 0.5 }) },
  { id: 'rise', name: 'Rise', icon: '🎈', kind: 'inout', fn: (p) => ({ alpha: p, dy: (1 - p) * 2, rotate: (1 - p) * -10 }) },
  { id: 'tracking', name: 'Tracking', icon: '↔', kind: 'inout', fn: (p) => ({ alpha: p, trackingDelta: (1 - p) * 1.2 }) },
  { id: 'wave', name: 'Wave', icon: '〰', kind: 'inout', fn: (p, i) => ({ alpha: p, dy: Math.sin((1 - p) * Math.PI * 2 + i * 0.5) * (1 - p) * 0.6 }) },
  { id: 'glitch', name: 'Glitch', icon: '⚡', kind: 'inout', fn: (p, i) => ({ alpha: p < 0.9 ? (Math.sin(p * 60 + i) > -0.3 ? 1 : 0.2) * Math.min(1, p * 2) : 1, dx: p < 0.9 ? Math.sin(p * 90 + i * 7) * (1 - p) * 0.3 : 0 }) },
  { id: 'spinIn', name: 'Spin In', icon: '🌀', kind: 'inout', fn: (p) => ({ alpha: p, rotate: (1 - p) * 360, scale: p }) },
  { id: 'stamp', name: 'Stamp', icon: '📌', kind: 'inout', fn: (p) => ({ alpha: Math.min(1, p * 5), scale: 1 + (1 - Math.min(1, p * 1.5)) * 2.5, rotate: (1 - Math.min(1, p * 1.5)) * -15 }) },
  { id: 'neonFlicker', name: 'Neon Flicker', icon: '💡', kind: 'inout', fn: (p, i) => ({ alpha: p < 0.8 ? (Math.sin(p * 50 + i * 3) > 0 ? 1 : 0.1) * p : 1 }) },
  { id: 'shrink', name: 'Shrink', icon: '🔻', kind: 'inout', fn: (p) => ({ alpha: p, scale: 2.5 - 1.5 * p, blur: (1 - p) * 0.2 }) },
  // loop animations
  { id: 'pulse', name: 'Pulse', icon: '💓', kind: 'loop', fn: (_p, _i, _n, t) => ({ scale: 1 + Math.sin(t * Math.PI * 2) * 0.06 }) },
  { id: 'loopWave', name: 'Wave', icon: '🌊', kind: 'loop', fn: (_p, i, _n, t) => ({ dy: Math.sin(t * Math.PI * 2 + i * 0.6) * 0.12 }) },
  { id: 'shake', name: 'Shake', icon: '📳', kind: 'loop', fn: (_p, i, _n, t) => ({ dx: Math.sin(t * 60 + i) * 0.04, dy: Math.cos(t * 50 + i * 2) * 0.04 }) },
  { id: 'float', name: 'Float', icon: '☁', kind: 'loop', fn: (_p, _i, _n, t) => ({ dy: Math.sin(t * Math.PI * 2) * 0.15, rotate: Math.sin(t * Math.PI * 2 + 1) * 2 }) },
  { id: 'rainbow', name: 'Rainbow', icon: '🌈', kind: 'loop', fn: (_p, i, n, t) => ({ colorShift: ((t + i / Math.max(1, n)) * 360) % 360 }) },
  { id: 'flicker', name: 'Flicker', icon: '🕯', kind: 'loop', fn: (_p, i, _n, t) => ({ alpha: 0.75 + 0.25 * Math.sin(t * 40 + i * 1.7) * Math.sin(t * 7) }) },
  { id: 'swing', name: 'Swing', icon: '🎐', kind: 'loop', fn: (_p, _i, _n, t) => ({ rotate: Math.sin(t * Math.PI * 2) * 6 }) },
  { id: 'jump', name: 'Jump', icon: '🦘', kind: 'loop', fn: (_p, i, n, t) => ({ dy: -Math.abs(Math.sin((t + i / Math.max(1, n)) * Math.PI)) * 0.25 }) },
  { id: 'heartbeat', name: 'Heartbeat', icon: '❤', kind: 'loop', fn: (_p, _i, _n, t) => { const ph = (t % 1); const b = ph < 0.15 ? Math.sin((ph / 0.15) * Math.PI) : ph < 0.35 ? Math.sin(((ph - 0.2) / 0.15) * Math.PI) * 0.6 : 0; return { scale: 1 + Math.max(0, b) * 0.12 }; } },
  { id: 'blink', name: 'Blink', icon: '👁', kind: 'loop', fn: (_p, _i, _n, t) => ({ alpha: t % 1 < 0.5 ? 1 : 0.15 }) },
  { id: 'spinLoop', name: 'Spin', icon: '🔄', kind: 'loop', fn: (_p, _i, _n, t) => ({ rotate: (t * 360) % 360 }) },
  { id: 'wobble', name: 'Wobble', icon: '🫨', kind: 'loop', fn: (_p, i, _n, t) => ({ skew: Math.sin(t * Math.PI * 4 + i * 0.3) * 8 }) },
];

export const IN_OUT_ANIMATIONS = TEXT_ANIMATIONS.filter((a) => a.kind === 'inout');
export const LOOP_ANIMATIONS = TEXT_ANIMATIONS.filter((a) => a.kind === 'loop');
const byId = new Map(TEXT_ANIMATIONS.map((a) => [a.id, a]));
export const getTextAnimation = (id: string) => byId.get(id) ?? byId.get('none')!;
