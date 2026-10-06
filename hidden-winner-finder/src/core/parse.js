/**
 * parse.js - pure, DOM-free parsing + statistics helpers.
 *
 * Nothing in this file touches `window`, `document` or any Chrome API, so it runs
 * both inside the content-script scanner (via tools/build-scanner.mjs, which
 * inlines this module and strips the `export` keywords) and inside `node --test`.
 *
 * Source of truth for every "observed" number the extension reports.
 */

/* ─────────────────────────── numbers & currency ─────────────────────────── */

/** Parse a human price string ("$14.99", "US $1,299.00", "12,50 €") → number|null. */
export function parsePrice(input) {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? input : null;
  const raw = String(input).trim();
  if (!raw) return null;
  const match = raw.replace(/\u00a0/g, ' ').match(/-?\d[\d\s.,']*\d|\d/);
  if (!match) return null;
  let token = match[0].replace(/[\s']/g, '');
  const lastComma = token.lastIndexOf(',');
  const lastDot = token.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator sits further right is the decimal separator.
    token = lastComma > lastDot
      ? token.replace(/\./g, '').replace(',', '.')
      : token.replace(/,/g, '');
  } else if (lastComma > -1) {
    const decimals = token.length - lastComma - 1;
    token = decimals === 3 ? token.replace(/,/g, '') : token.replace(',', '.');
  }
  const value = Number.parseFloat(token);
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Parse a compact count ("1,234", "1.2k", "3.4K reviews", "12K+", "1 234") → number|null.
 * Grouping separators are distinguished from decimal separators by digit count,
 * so "1,234" is 1234 while "1,2k" is 1200.
 */
export function parseCount(input) {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? input : null;
  const raw = String(input).replace(/\u00a0/g, ' ').trim();
  const match = raw.match(/(\d[\d\s.,]*)\s*([kKmM])?/);
  if (!match) return null;

  let digits = match[1].trim();
  const suffix = (match[2] || '').toLowerCase();
  const hasBoth = digits.includes(',') && digits.includes('.');
  if (hasBoth) {
    // The right-most separator is the decimal one; the other is grouping.
    const lastComma = digits.lastIndexOf(',');
    const lastDot = digits.lastIndexOf('.');
    digits = lastComma > lastDot
      ? digits.replace(/\./g, '').replace(/,/g, '.')
      : digits.replace(/,/g, '');
  } else if (digits.includes(',') || digits.includes('.')) {
    const sep = digits.includes(',') ? ',' : '.';
    const parts = digits.split(sep);
    const last = parts[parts.length - 1];
    // Counts are whole numbers, so a single separator followed by exactly three
    // digits is grouping: "1,234" → 1234 and "12,345" → 12345.
    if (last.length === 3 && parts.length >= 2) digits = parts.join('');
    else digits = parts.join('.');
  }
  digits = digits.replace(/\s/g, '');
  let value = Number.parseFloat(digits);
  if (!Number.isFinite(value)) return null;
  if (suffix === 'k') value *= 1_000;
  if (suffix === 'm') value *= 1_000_000;
  return Math.round(value);
}

/**
 * Parse a review/sales string into a count plus the signal it came from.
 * Understands: "4.9 (1,284)", "300+ sold", "1.2K sales", "2,400 Reviews",
 * "Best Seller", "Bestseller", "5,000+ bought in past month".
 */
export function parseReviews(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  return parseCount(raw);
}

export function parseSalesText(input) {
  const raw = String(input ?? '').toLowerCase();
  if (!raw) return null;
  const strong = /(best\s?seller|bestseller|top\s?seller|amazon'?s\s+choice|#1\s+best)/.test(raw);
  const counts = [...raw.matchAll(/(\d[\d.,]*\s*[km]?)\s*\+?\s*(sold|sales|bought|orders|commandes|vendus)/g)]
    .map((m) => parseCount(m[1]))
    .filter((n) => n != null);
  const count = counts.length ? Math.max(...counts) : null;
  if (count == null && !strong) return null;
  return { count, bestSeller: strong, raw: raw.slice(0, 120) };
}

/** Parse "1,482 results" / "About 3,000 results" / "1-48 of over 2,000 results". */
export function parseResultCount(input) {
  const raw = String(input ?? '').toLowerCase();
  if (!/\d/.test(raw)) return null;
  const over = raw.match(/over\s+([\d.,]+)\s*([km]?)/);
  if (over) return parseCount(`${over[1]}${over[2] || ''}`);
  const results = raw.match(/([\d.,]+\s*[km]?)\s*(results?|listings?|items?|products?|résultats?|articles?|articles|adverts?)/);
  if (results) return parseCount(results[1]);
  return null;
}

/* ─────────────────────────── statistics ─────────────────────────── */

export function mean(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function median(values) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

export function percentile(values, p) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const idx = Math.min(nums.length - 1, Math.max(0, Math.round((nums.length - 1) * p)));
  return nums[idx];
}

export function stdDev(values) {
  const m = mean(values);
  if (m == null) return null;
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length < 2) return 0;
  const variance = nums.reduce((acc, v) => acc + (v - m) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

/** Coefficient of variation - used as the "price competition" proxy. */
export function coefficientOfVariation(values) {
  const m = mean(values);
  const sd = stdDev(values);
  if (m == null || sd == null || m === 0) return null;
  return sd / m;
}

/** Share of values that sit inside ±tolerance of the median (price-war density). */
export function priceClustering(prices, tolerance = 0.15) {
  const nums = prices.filter((v) => Number.isFinite(v));
  const mid = median(nums);
  if (mid == null || nums.length < 3) return null;
  const near = nums.filter((p) => Math.abs(p - mid) / mid <= tolerance).length;
  return near / nums.length;
}

/* ─────────────────────────── text signals ─────────────────────────── */

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'of', 'to', 'in', 'on', 'by', 'from', 'your', 'you',
  'my', 'our', 'set', 'pack', 'new', 'free', 'shipping', 'gift', 'gifts', 'custom', 'personalized',
  'personalised', 'handmade',
]);

export function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[-']+|[-']+$/g, ''))
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/** Jaccard similarity of two token sets - a proxy for "how copy-able" a niche is. */
export function titleSimilarity(titles) {
  const sets = titles.map((t) => new Set(tokenize(t))).filter((s) => s.size);
  if (sets.length < 2) return null;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i];
      const b = sets[j];
      let inter = 0;
      a.forEach((t) => { if (b.has(t)) inter++; });
      const union = a.size + b.size - inter;
      sum += union ? inter / union : 0;
      pairs++;
    }
  }
  return pairs ? sum / pairs : null;
}

/** Share of listings that carry a quality signal (video, 8+ images, long title). */
export function qualityShare(listings) {
  if (!listings.length) return null;
  const good = listings.filter((l) => {
    if (l.hasVideo) return true;
    if (Number.isFinite(l.imageCount) && l.imageCount >= 8) return true;
    return Number.isFinite(l.titleLength) && l.titleLength >= 70 && l.rating >= 4.7;
  }).length;
  return good / listings.length;
}

export function share(list, predicate) {
  if (!list.length) return null;
  return list.filter(predicate).length / list.length;
}

export function safeRatio(numerator, denominator, fallback = null) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return fallback;
  return numerator / denominator;
}

/** Deduplicate near-identical scraped entries (same title + price). */
export function dedupeListings(listings) {
  const seen = new Set();
  const out = [];
  for (const l of listings) {
    const key = `${String(l.title || '').toLowerCase().slice(0, 60)}|${Math.round((l.price || 0) * 100)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

export function truncate(text, max = 90) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
