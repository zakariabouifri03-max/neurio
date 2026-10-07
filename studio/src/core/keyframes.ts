import type { Animated, Keyframe, Vec2, Easing } from './types';
import { applyEasing } from './easing';
import { uid } from './util';

function interp(a: any, b: any, t: number): any {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (a && b && typeof a === 'object') {
    const out: any = {};
    for (const k of Object.keys(a)) out[k] = interp(a[k], b[k], t);
    return out;
  }
  return t < 1 ? a : b;
}

/** Evaluate an animated property at a time relative to the clip start. */
export function evalAnimated<T>(prop: Animated<T> | undefined, time: number, fallback: T): T {
  if (!prop) return fallback;
  const kfs = prop.keyframes;
  if (!kfs || kfs.length === 0) return prop.value ?? fallback;
  if (kfs.length === 1) return kfs[0].value;
  if (time <= kfs[0].time) return kfs[0].value;
  const last = kfs[kfs.length - 1];
  if (time >= last.time) return last.value;
  // binary search
  let lo = 0, hi = kfs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kfs[mid].time <= time) lo = mid;
    else hi = mid;
  }
  const a = kfs[lo], b = kfs[hi];
  const span = b.time - a.time;
  const t = span <= 0 ? 1 : (time - a.time) / span;
  const e = applyEasing(a.easing, t);
  return interp(a.value, b.value, e) as T;
}

export const num = (p: Animated<number> | undefined, t: number, fb = 0) => evalAnimated(p, t, fb);
export const vec = (p: Animated<Vec2> | undefined, t: number, fb: Vec2 = { x: 0, y: 0 }) => evalAnimated(p, t, fb);

export function a<T>(value: T): Animated<T> {
  return { value };
}

export function hasKeyframes(p?: Animated<any>): boolean {
  return !!p && !!p.keyframes && p.keyframes.length > 0;
}

/** Returns new Animated with a keyframe set/updated at time. */
export function setKeyframe<T>(prop: Animated<T>, time: number, value: T, easing: Easing = 'easeInOut', tol = 1e-4): Animated<T> {
  const kfs = [...(prop.keyframes || [])];
  const idx = kfs.findIndex((k) => Math.abs(k.time - time) < tol);
  if (idx >= 0) kfs[idx] = { ...kfs[idx], value };
  else kfs.push({ id: uid('kf'), time, value, easing });
  kfs.sort((x, y) => x.time - y.time);
  return { value: prop.value, keyframes: kfs };
}

export function removeKeyframe<T>(prop: Animated<T>, kfId: string): Animated<T> {
  const kfs = (prop.keyframes || []).filter((k) => k.id !== kfId);
  if (kfs.length === 0) {
    // bake last value as static
    const lastVal = prop.keyframes?.find((k) => k.id === kfId)?.value ?? prop.value;
    return { value: lastVal };
  }
  return { value: prop.value, keyframes: kfs };
}

export function keyframeAt<T>(prop: Animated<T> | undefined, time: number, tol = 1e-4): Keyframe<T> | undefined {
  return prop?.keyframes?.find((k) => Math.abs(k.time - time) < tol);
}

/** Update value: when keyframes exist, write a keyframe at time; else set static. */
export function writeValue<T>(prop: Animated<T> | undefined, time: number, value: T, fallback: T, forceKey = false): Animated<T> {
  const p = prop ?? { value: fallback };
  if (hasKeyframes(p) || forceKey) return setKeyframe(p, time, value);
  return { ...p, value };
}

/** Collect all keyframe times from a nested object (transform, grade, effects...). */
export function collectKeyframeTimes(obj: any, out: Set<number> = new Set()): Set<number> {
  if (!obj || typeof obj !== 'object') return out;
  if (Array.isArray(obj.keyframes) && 'value' in obj) {
    for (const k of obj.keyframes) out.add(k.time);
    return out;
  }
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object') collectKeyframeTimes(v, out);
  }
  return out;
}

/** Shift all keyframe times in a nested object by delta (used when trimming the clip head). */
export function shiftKeyframes<T>(obj: T, delta: number, maxTime?: number): T {
  if (!obj || typeof obj !== 'object') return obj;
  const o: any = obj;
  if (Array.isArray(o.keyframes) && 'value' in o) {
    let kfs = o.keyframes.map((k: Keyframe) => ({ ...k, time: k.time + delta }));
    if (maxTime !== undefined) kfs = kfs.filter((k: Keyframe) => k.time >= -1e-6 && k.time <= maxTime + 1e-6);
    return { ...o, keyframes: kfs.length ? kfs : undefined } as T;
  }
  if (Array.isArray(o)) return o.map((v) => shiftKeyframes(v, delta, maxTime)) as T;
  const out: any = {};
  for (const k of Object.keys(o)) out[k] = typeof o[k] === 'object' && o[k] !== null ? shiftKeyframes(o[k], delta, maxTime) : o[k];
  return out;
}

/** Scale keyframe times by factor (used when changing speed / duration). */
export function scaleKeyframes<T>(obj: T, factor: number): T {
  if (!obj || typeof obj !== 'object') return obj;
  const o: any = obj;
  if (Array.isArray(o.keyframes) && 'value' in o) {
    return { ...o, keyframes: o.keyframes.map((k: Keyframe) => ({ ...k, time: k.time * factor })) } as T;
  }
  if (Array.isArray(o)) return o.map((v) => scaleKeyframes(v, factor)) as T;
  const out: any = {};
  for (const k of Object.keys(o)) out[k] = typeof o[k] === 'object' && o[k] !== null ? scaleKeyframes(o[k], factor) : o[k];
  return out;
}
