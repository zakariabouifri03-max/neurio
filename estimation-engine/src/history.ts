/**
 * Historical-snapshot math: review velocity, ranking movement, acceleration.
 *
 * Only uses observations the extension actually recorded, each with its real
 * timestamp. If there are not enough observations, these return null — the
 * estimation engine must then say "Not enough historical observations",
 * never invent a velocity.
 */
import type { HistoricalSnapshot } from "@etsy-signal/shared";

export interface VelocityFit {
  /** Slope in units per day. */
  slopePerDay: number;
  /** Ordinary-least-squares R^2 (0..1). */
  r2: number;
  /** Number of points used. */
  n: number;
  /** Days between first and last point used. */
  spanDays: number;
  /** Latest observed value. */
  lastValue: number;
  /** True when raw values ever decreased between consecutive snapshots. */
  inconsistent: boolean;
}

interface Pt {
  t: number; // days since first snapshot
  v: number;
}

function toPoints(snapshots: HistoricalSnapshot[], pick: (s: HistoricalSnapshot) => number | undefined): Pt[] {
  if (snapshots.length === 0) return [];
  const t0 = Date.parse(snapshots[0]!.observedAt);
  const pts: Pt[] = [];
  for (const s of snapshots) {
    const v = pick(s);
    if (v == null || !Number.isFinite(v)) continue;
    const t = Date.parse(s.observedAt);
    if (!Number.isFinite(t)) continue;
    pts.push({ t: (t - t0) / 86_400_000, v });
  }
  // De-duplicate same-timestamp points: keep the last value seen at that t.
  const byT = new Map<number, number>();
  for (const p of pts) byT.set(p.t, p.v);
  return [...byT.entries()].map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t);
}

/** OLS fit of value against time-in-days. */
export function fitVelocity(snapshots: HistoricalSnapshot[], pick: (s: HistoricalSnapshot) => number | undefined): VelocityFit | null {
  const pts = toPoints(snapshots, pick);
  if (pts.length < 2) return null;
  const spanDays = (pts[pts.length - 1]!.t - pts[0]!.t) || 0;
  if (spanDays < 1) return null; // same-day duplicates are not history

  const n = pts.length;
  const meanT = pts.reduce((a, p) => a + p.t, 0) / n;
  const meanV = pts.reduce((a, p) => a + p.v, 0) / n;
  let sTT = 0;
  let sTV = 0;
  let sVV = 0;
  for (const p of pts) {
    sTT += (p.t - meanT) * (p.t - meanT);
    sTV += (p.t - meanT) * (p.v - meanV);
    sVV += (p.v - meanV) * (p.v - meanV);
  }
  const slope = sTT > 0 ? sTV / sTT : 0;
  const r2 = sVV > 0 && sTT > 0 ? Math.min(1, (sTV * sTV) / (sTT * sVV)) : 1;

  let inconsistent = false;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i]!.v < pts[i - 1]!.v) {
      inconsistent = true;
      break;
    }
  }

  return {
    slopePerDay: slope,
    r2,
    n,
    spanDays,
    lastValue: pts[n - 1]!.v,
    inconsistent,
  };
}

/** Review-count velocity (reviews/day). Slope is floored at 0 with a flag. */
export function reviewVelocity(snapshots: HistoricalSnapshot[]): VelocityFit | null {
  const fit = fitVelocity(snapshots, (s) => s.reviewCount);
  if (!fit) return null;
  if (fit.slopePerDay < 0) {
    // Review counts do not legitimately decrease; treat as data noise but
    // never report a negative velocity as sales evidence.
    return { ...fit, slopePerDay: 0, inconsistent: true };
  }
  return fit;
}

/** Search-position velocity (positions/day; NEGATIVE means improving). */
export function positionVelocity(snapshots: HistoricalSnapshot[]): VelocityFit | null {
  return fitVelocity(snapshots, (s) => s.searchPosition);
}

/**
 * Review-velocity acceleration: compares the slope of the first half of the
 * tracking window against the second half.
 * Returns >1 when demand is accelerating, <1 decelerating, null if unknown.
 */
export function velocityAcceleration(snapshots: HistoricalSnapshot[]): number | null {
  if (snapshots.length < 4) return null;
  const mid = Math.floor(snapshots.length / 2);
  const first = reviewVelocity(snapshots.slice(0, mid + 1));
  const second = reviewVelocity(snapshots.slice(mid));
  if (!first || !second) return null;
  if (first.slopePerDay <= 0.01) return second.slopePerDay > 0.02 ? 1.5 : null;
  return second.slopePerDay / first.slopePerDay;
}

/** Distinct days covered by the snapshot set (for "Tracked for N days"). */
export function trackedDays(snapshots: HistoricalSnapshot[]): number {
  if (snapshots.length === 0) return 0;
  const ts = snapshots.map((s) => Date.parse(s.observedAt)).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (ts.length < 2) return 0;
  return (ts[ts.length - 1]! - ts[0]!) / 86_400_000;
}
