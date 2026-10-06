/**
 * trend.js - trend analysis (🔥 Rising / ➡️ Stable / 📉 Declining).
 *
 * Momentum comes from two places:
 *   1. The curated 30/90-day public-interest snapshot per niche.
 *   2. The user's own scan history: every SCAN MARKET run stores the observed
 *      signals, so after two scans the extension can compare them and report
 *      *observed* movement instead of the snapshot. That is the only place where
 *      trend can reach High confidence.
 */

import { BASIS, clamp, round } from './metrics.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const TREND_BANDS = {
  rising: { id: 'rising', label: 'Rising', icon: '🔥', tone: 'positive' },
  stable: { id: 'stable', label: 'Stable', icon: '➡️', tone: 'neutral' },
  declining: { id: 'declining', label: 'Declining', icon: '📉', tone: 'negative' },
};

export function trendBandFromScore(score) {
  if (!Number.isFinite(score)) return { id: 'unknown', label: 'Unknown', icon: '•', tone: 'neutral' };
  if (score >= 68) return TREND_BANDS.rising;
  if (score >= 45) return TREND_BANDS.stable;
  return TREND_BANDS.declining;
}

export function describeMovement(rate) {
  if (!Number.isFinite(rate)) return { movement: 'No data', icon: '•' };
  if (rate >= 0.25) return { movement: 'Strong growth', icon: '↑↑' };
  if (rate >= 0.08) return { movement: 'Increasing', icon: '↑' };
  if (rate > -0.08) return { movement: 'Flat', icon: '→' };
  if (rate > -0.25) return { movement: 'Softening', icon: '↓' };
  return { movement: 'Falling', icon: '↓↓' };
}

/**
 * @param {object} product
 * @param {object} ctx { month (0-11), history: [{at, d30, d90}], observed }
 */
export function computeTrend(product, ctx = {}) {
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const month = Number.isFinite(ctx.month) ? ctx.month : now.getMonth();
  const snapshot = product?.trend || {};
  const history = Array.isArray(ctx.history) ? ctx.history.filter((h) => Number.isFinite(h?.at)) : [];
  const observedD30 = Number.isFinite(ctx.observed?.d30) ? ctx.observed.d30 : null;

  // Observed history wins over the snapshot when we have at least two points.
  let d30 = snapshot.d30 ?? null;
  let d90 = snapshot.d90 ?? null;
  let basis = BASIS.SNAPSHOT;
  let historyUsed = null;

  if (history.length >= 2) {
    const sorted = [...history].sort((a, b) => a.at - b.at);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (Number.isFinite(first.reviewsTop10Median) && Number.isFinite(last.reviewsTop10Median) && first.reviewsTop10Median > 0) {
      const change = (last.reviewsTop10Median - first.reviewsTop10Median) / first.reviewsTop10Median;
      historyUsed = {
        from: first.at,
        to: last.at,
        metric: 'median reviews of ranked listings',
        change,
        days: Math.max(1, Math.round((last.at - first.at) / 86_400_000)),
      };
      // Reviews accumulate: treat the observed change as the strongest evidence.
      const perMonth = change * (30 / Math.max(7, historyUsed.days));
      d30 = perMonth;
      d90 = Number.isFinite(d90) ? (d90 + perMonth) / 2 : perMonth;
      basis = BASIS.OBSERVED;
    }
  }
  if (Number.isFinite(observedD30)) {
    d30 = observedD30;
    basis = BASIS.OBSERVED;
  }

  let score = 50;
  if (Number.isFinite(d30)) score += d30 * 80;
  if (Number.isFinite(d90)) score += d90 * 50;

  const seasonality = seasonalityRead(snapshot.seasonPeakMonths, month, ctx.hemisphere);
  score += seasonality.adjustment;

  score = Math.round(clamp(score, 0, 100));
  const band = trendBandFromScore(score);

  const spark = Array.isArray(snapshot.spark) && snapshot.spark.length > 2
    ? snapshot.spark.map((v) => round(v, 1))
    : synthSpark(d30, d90);

  return {
    id: 'trend',
    score,
    band,
    d30,
    d90,
    basis,
    confidence: basis === BASIS.OBSERVED ? 'High' : 'Medium',
    windows: [
      { label: '30 days', rate: d30, ...describeMovement(d30) },
      { label: '90 days', rate: d90, ...describeMovement(d90) },
    ],
    seasonality,
    historyUsed,
    spark,
    note: basis === BASIS.OBSERVED
      ? 'Momentum computed by comparing two of your own scans of this niche.'
      : 'Momentum from a curated public-interest snapshot - run SCAN MARKET twice to upgrade it to observed.',
  };
}

/** Seasonality read: is this niche's peak now, next month, or months away? */
export function seasonalityRead(peakMonths, month, hemisphere = 'north') {
  const peaks = Array.isArray(peakMonths) && peakMonths.length ? peakMonths.map((m) => (m - 1 + 12) % 12) : [];
  if (!peaks.length) {
    return { id: 'evergreen', label: 'Evergreen', adjustment: 0, peakMonths: [], note: 'No strong seasonal peak - demand is spread across the year.' };
  }
  const shift = hemisphere === 'south' ? 6 : 0;
  const idx = (month - shift + 12) % 12;
  const distance = (peak) => {
    const diff = Math.abs(((peak - idx + 12) % 12));
    return Math.min(diff, 12 - diff);
  };
  const nearest = Math.min(...peaks.map(distance));
  let adjustment = 0;
  let label = '';
  let note = '';
  if (nearest === 0) {
    adjustment = 6;
    label = 'In season now';
    note = 'Demand is at its yearly peak this month - buyers are searching right now.';
  } else if (nearest === 1) {
    adjustment = 3;
    label = 'Ramping up';
    note = 'Peak season starts within a month - list and collect reviews now.';
  } else if (nearest === 2) {
    adjustment = 1;
    label = 'Ahead of peak';
    note = 'Build the listing history now, in time for the peak.';
  } else {
    adjustment = -2;
    label = 'Off season';
    note = 'Peak demand is months away. Use the time to validate the product and gather reviews.';
  }
  return {
    id: nearest === 0 ? 'in-season' : nearest <= 2 ? 'approaching' : 'off-season',
    label,
    adjustment,
    peakMonths: peaks.map((p) => MONTHS[p]),
    note,
  };
}

function synthSpark(d30, d90) {
  const base = 50;
  const mid = base + (Number.isFinite(d90) ? d90 * 30 : 0);
  const end = mid + (Number.isFinite(d30) ? d30 * 30 : 0);
  const start = mid - (Number.isFinite(d90) ? d90 * 20 : 0);
  return [start, (start + mid) / 2, mid, (mid + end) / 2, end].map((v) => round(clamp(v, 0, 100), 1));
}

/** Human sentence for the report, e.g. "30 days: ↑ Increasing". */
export function trendSentence(window) {
  if (!window) return 'No trend data';
  if (!Number.isFinite(window.rate)) return `${window.label}: no public data`;
  return `${window.label}: ${window.icon} ${window.movement}`;
}
