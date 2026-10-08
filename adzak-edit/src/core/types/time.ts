/**
 * ADZAK EDIT — time model
 *
 * All time values in the project document are **seconds** (number). This keeps
 * the UI maths trivial and the `.adzak` file human readable.
 *
 * Float seconds drift under repeated arithmetic, so every mutation in
 * `core/timeline/operations.ts` funnels through `snapToRaster()`, which
 * quantises to the nearest frame of the project raster. Comparisons use
 * `TIME_EPSILON` instead of `===`.
 *
 * KNOWN LIMITATION (see docs/RISKS.md → R1): a 64-bit integer timebase
 * (e.g. 1/48000 s ticks) is the correct long-term model for frame-exact
 * conforming. The migration is mechanical: `secondsToTicks` / `ticksToSeconds`
 * are the only conversion points, so the swap does not touch feature code.
 */

/** Smallest meaningful delta (≈ 1/10 of a 120 fps frame). */
export const TIME_EPSILON = 1 / 1200;

/** Raster quantisation: round a second value to the nearest frame. */
export function snapToRaster(seconds: number, fps: number): number {
  if (!Number.isFinite(seconds)) return 0;
  const fpsSafe = fps > 0 ? fps : 30;
  // Guard against fp noise (e.g. 23.976 -> 24000/1001).
  const frame = Math.round(seconds * fpsSafe * 1000) / 1000;
  return Math.round(frame) / fpsSafe;
}

/** Round to a fixed number of decimals; kills float dust in serialised files. */
export function roundTo(value: number, decimals = 6): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function timeEq(a: number, b: number, epsilon = TIME_EPSILON): boolean {
  return Math.abs(a - b) <= epsilon;
}

/** Inclusive-start / exclusive-end overlap, epsilon tolerant. */
export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  epsilon = TIME_EPSILON,
): boolean {
  return aStart < bEnd - epsilon && bStart < aEnd - epsilon;
}

export interface TimeRange {
  start: number;
  duration: number;
}

export const endOf = (r: TimeRange): number => r.start + r.duration;

/** Convert seconds to a `HH:MM:SS.mmm` or `HH:MM:SS:FF` display string. */
export function formatTimecode(seconds: number, fps = 30, showFrames = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const totalFrames = Math.round(seconds * fps);
  const f = totalFrames % Math.round(fps);
  const totalSeconds = Math.floor(totalFrames / fps);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const base = `${pad(h)}:${pad(m)}:${pad(s)}`;
  return showFrames ? `${base}:${pad(f)}` : `${base}.${pad(Math.round((seconds % 1) * 1000), 3)}`;
}

/** Parse `HH:MM:SS.mmm`, `MM:SS.mmm` or bare seconds. Returns NaN when invalid. */
export function parseTimecode(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) return Number.NaN;
  const parts = trimmed.split(':');
  if (parts.length === 1) return Number.parseFloat(parts[0]!);
  if (parts.length > 3) return Number.NaN;
  let seconds = 0;
  for (const part of parts) {
    const n = Number.parseFloat(part);
    if (!Number.isFinite(n)) return Number.NaN;
    seconds = seconds * 60 + n;
  }
  return seconds;
}
