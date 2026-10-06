/**
 * format.js - presentation-only helpers (no business logic, no DOM).
 * Every estimate the UI prints goes through `estimate()` or `range()` so the
 * "Estimated / Approx. / Public-data based" labelling can never be skipped by
 * a caller that forgets.
 */

export const DISCLAIMER = {
  ESTIMATE: 'Estimated',
  APPROX: 'Approx.',
  PUBLIC: 'Public-data based',
  OBSERVED: 'Observed on page',
  MODELLED: 'Modelled',
};

export function currency(value, { decimals = 2, symbol = '$' } = {}) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const d = decimals == null ? (abs >= 1000 ? 0 : 2) : decimals;
  return `${value < 0 ? '-' : ''}${symbol}${abs.toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })}`;
}

export function roundCurrency(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

/** Format a [lo, hi] pair, e.g. "$4,500 – $7,500". */
export function range(lo, hi, formatter = (v) => currency(v, { decimals: null })) {
  if (!Number.isFinite(lo) && !Number.isFinite(hi)) return '—';
  if (!Number.isFinite(hi) || lo === hi) return formatter(lo);
  if (!Number.isFinite(lo)) return formatter(hi);
  return `${formatter(lo)} – ${formatter(hi)}`;
}

export const count = (value) => (Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '—');

export const compact = (value) => {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(value));
};

export const percent = (ratio, { decimals = 0 } = {}) =>
  Number.isFinite(ratio) ? `${(ratio * 100).toFixed(decimals)}%` : '—';

export const signedPercent = (ratio, { decimals = 0 } = {}) =>
  Number.isFinite(ratio) ? `${ratio >= 0 ? '+' : ''}${(ratio * 100).toFixed(decimals)}%` : '—';

export const score = (value) => (Number.isFinite(value) ? `${Math.round(value)}/100` : '—');

/** Spread an estimate into a plausible interval (never presented as exact). */
export function spreadEstimate(value, lowFactor = 0.8, highFactor = 1.25) {
  if (!Number.isFinite(value)) return [null, null];
  return [roundCurrency(value * lowFactor), roundCurrency(value * highFactor)];
}

/**
 * Wrap a string in the mandated estimate labelling, e.g.
 *   estimate('$4,500 – $7,500') → 'Estimated $4,500 – $7,500'
 */
export function estimate(text, kind = DISCLAIMER.ESTIMATE) {
  return `${kind} ${text}`;
}

export function basisLabel(basis) {
  if (basis === 'observed') return DISCLAIMER.OBSERVED;
  if (basis === 'snapshot') return DISCLAIMER.PUBLIC;
  return DISCLAIMER.MODELLED;
}

export function marketDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

export function timeAgo(timestamp) {
  if (!Number.isFinite(timestamp)) return 'never';
  const diff = Date.now() - timestamp;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const escapeHtml = (text) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
