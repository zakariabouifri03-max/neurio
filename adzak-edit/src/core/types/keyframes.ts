/**
 * Keyframe model.
 *
 * Keyframe `time` is **clip-local**: seconds from the clip's timeline start.
 * That keeps keyframes glued to the clip when it is moved, and makes trimming
 * a well-defined operation (see `core/timeline/operations.ts` → `trimClip`).
 */

export type InterpolationType =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'bezier'
  | 'hold';

export interface Keyframe {
  id: string;
  /** Seconds from clip start. */
  time: number;
  /** Scalar, or vector for multi-dimensional params (e.g. position [x, y]). */
  value: number | number[];
  interpolation: InterpolationType;
  /** Cubic bezier handles in unit space, used when interpolation === 'bezier'. */
  bezier?: { in: [number, number]; out: [number, number] };
}

/** Properties that can be animated out of the box. */
export type AnimatableProperty =
  | 'position.x'
  | 'position.y'
  | 'scale'
  | 'rotation'
  | 'opacity'
  | 'volume'
  | 'pan'
  | (string & {}); // effect:<effectId>:<paramId>

export type KeyframeTrackMap = Record<string, Keyframe[]>;

const easeIn = (t: number): number => t * t;
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Solve a cubic bezier easing curve. Handles are unit-space [x, y] pairs. */
export function cubicBezier(
  t: number,
  p1: [number, number],
  p2: [number, number],
): number {
  // Newton–Raphson on x to find the curve parameter, then evaluate y.
  const cx = 3 * p1[0];
  const bx = 3 * (p2[0] - p1[0]) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1[1];
  const by = 3 * (p2[1] - p1[1]) - cy;
  const ay = 1 - cy - by;

  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  const sampleDX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;

  let u = t;
  for (let i = 0; i < 6; i++) {
    const dx = sampleX(u) - t;
    if (Math.abs(dx) < 1e-5) break;
    const d = sampleDX(u);
    if (Math.abs(d) < 1e-6) break;
    u -= dx / d;
  }
  return sampleY(Math.min(1, Math.max(0, u)));
}

export function ease(type: InterpolationType, t: number, bezier?: Keyframe['bezier']): number {
  const c = Math.min(1, Math.max(0, t));
  switch (type) {
    case 'linear':
      return c;
    case 'ease-in':
      return easeIn(c);
    case 'ease-out':
      return easeOut(c);
    case 'ease-in-out':
      return easeInOut(c);
    case 'hold':
      return 0;
    case 'bezier':
      return cubicBezier(c, bezier?.in ?? [0.42, 0], bezier?.out ?? [0.58, 1]);
    default:
      return c;
  }
}

/**
 * Sample a keyframe track at a clip-local time.
 * Returns `fallback` when the track is empty.
 * Before the first keyframe the first value holds; after the last, the last holds.
 */
export function sampleKeyframes(
  track: Keyframe[] | undefined,
  time: number,
  fallback: number | number[],
): number | number[] {
  if (!track || track.length === 0) return fallback;
  const sorted = [...track].sort((a, b) => a.time - b.time);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (time <= first.time) return first.value;
  if (time >= last.time) return last.value;

  let a = first;
  let b = last;
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i]!;
    const next = sorted[i + 1]!;
    if (time >= cur.time && time <= next.time) {
      a = cur;
      b = next;
      break;
    }
  }
  const span = b.time - a.time;
  if (span <= 0) return a.value;
  const t = ease(b.interpolation, (time - a.time) / span, b.bezier);

  if (Array.isArray(a.value) || Array.isArray(b.value)) {
    const av = Array.isArray(a.value) ? a.value : [a.value];
    const bv = Array.isArray(b.value) ? b.value : [b.value];
    const len = Math.max(av.length, bv.length);
    const out: number[] = [];
    for (let i = 0; i < len; i++) {
      const from = av[i] ?? bv[i] ?? 0;
      const to = bv[i] ?? av[i] ?? 0;
      out.push(from + (to - from) * t);
    }
    return out;
  }
  return (a.value as number) + ((b.value as number) - (a.value as number)) * t;
}

export function upsertKeyframe(
  track: Keyframe[] | undefined,
  keyframe: Keyframe,
): Keyframe[] {
  const next = [...(track ?? [])];
  const idx = next.findIndex((k) => Math.abs(k.time - keyframe.time) < 1e-6);
  if (idx >= 0) next[idx] = keyframe;
  else next.push(keyframe);
  return next.sort((a, b) => a.time - b.time);
}

export function removeKeyframeAt(track: Keyframe[], time: number, tolerance = 0.01): Keyframe[] {
  return track.filter((k) => Math.abs(k.time - time) > tolerance);
}
