/**
 * metrics.js - the math vocabulary used by every detector.
 *
 * Every number the extension shows is produced by one of these helpers, so the
 * same curve/weighting rules apply everywhere and nothing is hand-tuned per view.
 */

/* ─────────────────────────── basic scalers ─────────────────────────── */

export const clamp = (value, lo = 0, hi = 100) => {
  const n = Number.isFinite(value) ? value : lo;
  return Math.min(hi, Math.max(lo, n));
};

export const clamp01 = (value) => clamp(value, 0, 1);

export const round = (value, decimals = 0) => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Linear map from [lo, hi] onto [outLo, outHi], clamped. */
export function linearScale(value, lo, hi, outLo = 0, outHi = 100) {
  if (!Number.isFinite(value)) return null;
  if (hi === lo) return (outLo + outHi) / 2;
  const t = clamp01((value - lo) / (hi - lo));
  return outLo + (outHi - outLo) * t;
}

/**
 * Log10 map - used for anything that spans orders of magnitude (listing counts,
 * review moats, competitor counts). Marketplaces behave logarithmically: going
 * from 100 to 1,000 competitors matters far more than 90,000 → 99,000.
 */
export function logScale(value, lo, hi, outLo = 0, outHi = 100) {
  const v = Math.max(0, Number.isFinite(value) ? value : lo);
  const a = Math.log10(Math.max(1, lo));
  const b = Math.log10(Math.max(lo + 1, hi));
  if (b === a) return (outLo + outHi) / 2;
  const t = clamp01((Math.log10(Math.max(1, v)) - a) / (b - a));
  return outLo + (outHi - outLo) * t;
}

/** Map a 0..1 share onto a score. */
export const shareScale = (value, outLo = 0, outHi = 100) =>
  Number.isFinite(value) ? outLo + (outHi - outLo) * clamp01(value) : null;

/** value/saturation, clamped to 0..1. Used for "how much relief/penalty" math. */
export const clampedRatio = (value, saturation = 1) => {
  if (!Number.isFinite(value) || !Number.isFinite(saturation) || saturation <= 0) return 0;
  return clamp01(value / saturation);
};

/** Sigmoid-ish growth curve used for trend momentum (percent → score). */
export function momentumScale(rate, saturation = 0.5) {
  if (!Number.isFinite(rate)) return null;
  const t = clamp01(rate / saturation);
  return 50 + 50 * (t <= 0.5 ? 2 * t * t : 1 - 2 * (1 - t) ** 2) * (rate >= 0 ? 1 : -1);
}

/* ─────────────────────────── confidence ─────────────────────────── */

/**
 * Confidence model. "confidence" is never a vibe - it is derived from where the
 * number came from:
 *   observed  - read off a public page in the user's own browser (High)
 *   snapshot  - curated public-data snapshot maintained in the catalog (Medium)
 *   modelled  - derived from assumptions/fee schedules (Low)
 */
export const BASIS = {
  OBSERVED: 'observed',
  SNAPSHOT: 'snapshot',
  MODELLED: 'modelled',
};

export const CONFIDENCE = {
  High: { id: 'High', rank: 3, shrinkFactor: 1, label: 'High', blurb: 'Backed by data read from public pages in your browser.' },
  Medium: { id: 'Medium', rank: 2, shrinkFactor: 0.9, label: 'Medium', blurb: 'Based on a public-data snapshot - treat as a directional estimate.' },
  Low: { id: 'Low', rank: 1, shrinkFactor: 0.78, label: 'Low', blurb: 'Modelled from assumptions and public fee schedules - verify before investing.' },
};

export const basisConfidence = (basis) => {
  if (basis === BASIS.OBSERVED) return CONFIDENCE.High;
  if (basis === BASIS.SNAPSHOT) return CONFIDENCE.Medium;
  return CONFIDENCE.Low;
};

/** Aggregate item-level confidence into one label (weighted by metric weight). */
export function aggregateConfidence(items) {
  const usable = (items || []).filter((i) => i && i.confidence);
  if (!usable.length) return CONFIDENCE.Low;
  let weight = 0;
  let score = 0;
  for (const item of usable) {
    const w = Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 1;
    weight += w;
    score += w * CONFIDENCE[item.confidence.id || item.confidence]?.rank;
  }
  // Thresholds chosen so that a scan that observes demand + competition + trend
  // live can reach High, while a snapshot-only read stays at Medium.
  const avg = weight ? score / weight : 1;
  if (avg >= 2.3) return CONFIDENCE.High;
  if (avg >= 1.6) return CONFIDENCE.Medium;
  return CONFIDENCE.Low;
}

/**
 * Confidence shrinkage. A low-confidence 95/100 is not a 95/100 opportunity -
 * it is pulled toward neutral (50). This keeps honest labelling structural
 * instead of cosmetic: estimates can never outrank observed data by accident.
 */
export function shrinkToNeutral(score, confidence) {
  if (!Number.isFinite(score)) return null;
  const factor = (confidence && confidence.shrinkFactor) || CONFIDENCE.Low.shrinkFactor;
  return 50 + (score - 50) * factor;
}

/* ─────────────────────────── weighted fusion ─────────────────────────── */

/**
 * Weighted mean that renormalises over the metrics that actually exist.
 * A missing input never counts as a zero - it just carries no weight.
 */
export function weightedMean(items) {
  const usable = (items || []).filter((i) => i && Number.isFinite(i.value));
  if (!usable.length) return null;
  let weight = 0;
  let sum = 0;
  for (const item of usable) {
    const w = Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 1;
    weight += w;
    sum += i_value(item.value) * w;
  }
  return weight ? sum / weight : null;
}

const i_value = (v) => v;

/** Same as weightedMean but returns the diagnostics the UI shows in tooltips. */
export function weightedMeanDetailed(items) {
  const usable = (items || []).filter((i) => i && Number.isFinite(i.value));
  const totalWeight = usable.reduce((acc, i) => acc + (Number.isFinite(i.weight) && i.weight > 0 ? i.weight : 1), 0);
  const value = weightedMean(items);
  return {
    value: value == null ? null : round(value, 1),
    contributors: usable.map((i) => ({
      id: i.id,
      label: i.label,
      value: round(i.value, 1),
      weight: Number.isFinite(i.weight) ? i.weight : 1,
      share: totalWeight ? round(((Number.isFinite(i.weight) && i.weight > 0 ? i.weight : 1) / totalWeight) * 100, 1) : 0,
      basis: i.basis,
      confidence: i.confidence?.id || null,
      note: i.note || '',
    })),
    missing: (items || []).filter((i) => i && !Number.isFinite(i.value)).map((i) => i.label || i.id),
  };
}

/* ─────────────────────────── metric objects ─────────────────────────── */

/**
 * Create a metric descriptor. `value` may be null when the input is genuinely
 * unavailable - callers then renormalise instead of inventing a number.
 */
export function metric({ id, label, value, weight = 1, basis = BASIS.MODELLED, note = '', evidence = null, unit = null }) {
  const finite = Number.isFinite(value);
  return {
    id,
    label,
    value: finite ? round(value, 1) : null,
    weight,
    basis,
    unit,
    note,
    evidence,
    confidence: basisConfidence(basis),
  };
}

export const scoreBand = (score, variant = 'default') => {
  if (!Number.isFinite(score)) return 'Unknown';
  if (variant === 'competition') {
    if (score <= 30) return 'Low';
    if (score <= 60) return 'Medium';
    if (score <= 80) return 'High';
    return 'Very High';
  }
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Strong';
  if (score >= 55) return 'Moderate';
  if (score >= 40) return 'Weak';
  return 'Poor';
};

export const trendBand = (score) => {
  if (!Number.isFinite(score)) return { id: 'unknown', label: 'Unknown', icon: '•' };
  if (score >= 68) return { id: 'rising', label: 'Rising', icon: '🔥' };
  if (score >= 45) return { id: 'stable', label: 'Stable', icon: '➡️' };
  return { id: 'declining', label: 'Declining', icon: '📉' };
};

/** Blend two scores, e.g. demand-with-trend. */
export const blend = (a, b, weightA = 0.5) => {
  if (!Number.isFinite(a)) return b;
  if (!Number.isFinite(b)) return a;
  return a * weightA + b * (1 - weightA);
};

/** Penalty helper: multiply a score down by a bounded factor (0..1 of loss). */
export const applyPenalty = (score, loss) => (Number.isFinite(score) ? clamp(score * (1 - clamp01(loss))) : null);
