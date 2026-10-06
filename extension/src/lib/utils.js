/* Etsy Insight Pro — utils.js
 * Dependency-free shared helpers. Pure functions only (no chrome.* calls)
 * so they can be unit-tested in Node.
 */
(function initUtils(root) {
  const EIP = root.EIP || (root.EIP = {});
  EIP.register && EIP.register('utils');

  const MONTHS = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
    sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
  };

  /** Parse "1,234", "1.2k", "3.4M", "1 234" → number. Returns null when unparseable. */
  function parseCount(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    let s = String(raw).trim().toLowerCase().replace(/[,\s\u00a0\u202f]/g, '');
    if (!s) return null;
    let mult = 1;
    if (s.endsWith('k')) { mult = 1000; s = s.slice(0, -1); }
    else if (s.endsWith('m')) { mult = 1000000; s = s.slice(0, -1); }
    // Keep digits, dot, minus.
    s = s.replace(/[^0-9.\-]/g, '');
    if (!s || s === '.' || s === '-') return null;
    const n = parseFloat(s) * mult;
    return Number.isFinite(n) ? n : null;
  }

  /** Parse a price string ("$12.99", "€12,99", "£1,234.56") → { value, currencyGuess }. */
  function parsePrice(raw) {
    if (raw === null || raw === undefined) return { value: null, currencyGuess: null };
    if (typeof raw === 'number') return { value: Number.isFinite(raw) ? raw : null, currencyGuess: null };
    const s = String(raw).trim();
    if (!s) return { value: null, currencyGuess: null };
    const symbolMap = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', 'A$': 'AUD', 'C$': 'CAD' };
    let currencyGuess = null;
    for (const [sym, code] of Object.entries(symbolMap)) {
      if (s.includes(sym)) { currencyGuess = code; break; }
    }
    // Detect 3-letter codes like "USD 12.99" / "12.99 USD".
    const codeMatch = s.match(/\b([A-Z]{3})\b/);
    if (codeMatch && !currencyGuess) currencyGuess = codeMatch[1];
    // Normalise number: keep digits, comma, dot, minus, spaces.
    let num = s.replace(/[^0-9,.\-\s]/g, '').replace(/\s+/g, '').trim();
    if (!num) return { value: null, currencyGuess };
    const lastComma = num.lastIndexOf(',');
    const lastDot = num.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      // Both present: the later one is the decimal separator.
      if (lastComma > lastDot) { num = num.replace(/\./g, '').replace(',', '.'); }
      else { num = num.replace(/,/g, ''); }
    } else if (lastComma > -1) {
      // Only comma: decimal if 1-2 digits follow it, else thousands.
      const tail = num.slice(lastComma + 1);
      num = tail.length <= 2 ? num.replace(',', '.') : num.replace(/,/g, '');
    }
    const value = parseFloat(num);
    return { value: Number.isFinite(value) ? value : null, currencyGuess };
  }

  function parseRating(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') return raw >= 0 && raw <= 5 ? raw : null;
    const m = String(raw).replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(?:out of\s*5|\/\s*5|stars?)?/i);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return n >= 0 && n <= 5 ? n : null;
  }

  /** "On Etsy since 2019" / "2019" → { year, ageYears }. */
  function parseShopSince(raw, nowYear) {
    if (raw === null || raw === undefined) return { year: null, ageYears: null };
    const m = String(raw).match(/(19|20)\d{2}/);
    if (!m) return { year: null, ageYears: null };
    const year = parseInt(m[0], 10);
    const current = nowYear || new Date().getFullYear();
    return { year, ageYears: Math.max(0, current - year) };
  }

  /** "Listed on Mar 12, 2023" → age in days (null when unknown). */
  function parseListedDate(raw, now) {
    if (!raw) return { date: null, ageDays: null };
    const nowDate = now instanceof Date ? now : new Date(now || Date.now());
    // Try native parse first.
    const cleaned = String(raw).replace(/listed\s*on\s*/i, '').trim();
    let d = new Date(cleaned);
    if (Number.isNaN(d.getTime())) {
      // Manual "Mar 12, 2023" parse.
      const m = cleaned.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
      if (!m) return { date: null, ageDays: null };
      const month = MONTHS[m[1].toLowerCase()];
      if (month === undefined) return { date: null, ageDays: null };
      d = new Date(parseInt(m[3], 10), month, parseInt(m[2], 10));
      if (Number.isNaN(d.getTime())) return { date: null, ageDays: null };
    }
    const ageDays = Math.max(0, Math.floor((nowDate - d) / 86400000));
    return { date: d.toISOString().slice(0, 10), ageDays };
  }

  function clamp(n, min, max) {
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function round(n, digits) {
    if (!Number.isFinite(n)) return null;
    const p = Math.pow(10, digits || 0);
    return Math.round(n * p) / p;
  }

  /** 0-100 score helper with one decimal trimmed. */
  function score(n) {
    return clamp(Math.round(n), 0, 100);
  }

  function formatInt(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n));
  }

  function formatCompact(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    if (abs < 1000) return String(Math.round(n));
    if (abs < 1000000) {
      const v = n / 1000;
      return (v >= 100 ? Math.round(v) : round(v, 1)) + 'K';
    }
    const v = n / 1000000;
    return (v >= 100 ? Math.round(v) : round(v, 1)) + 'M';
  }

  function formatRange(lo, hi, formatter) {
    const f = formatter || formatCompact;
    if (!Number.isFinite(lo) && !Number.isFinite(hi)) return '—';
    if (!Number.isFinite(lo)) return `≤ ${f(hi)}`;
    if (!Number.isFinite(hi)) return `≥ ${f(lo)}`;
    if (Math.round(lo) === Math.round(hi)) return f(lo);
    return `${f(lo)}–${f(hi)}`;
  }

  function formatMoney(value, currency, locale) {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    try {
      return new Intl.NumberFormat(locale || 'en-US', {
        style: 'currency', currency: currency || 'USD', maximumFractionDigits: value >= 1000 ? 0 : 2
      }).format(value);
    } catch (e) {
      return `${currency || '$'}${formatInt(value)}`;
    }
  }

  function formatMoneyCompact(value, currency) {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const sym = ({ USD: '$', EUR: '€', GBP: '£', JPY: '¥', INR: '₹', AUD: 'A$', CAD: 'C$' })[currency] || (currency ? currency + ' ' : '$');
    return sym + formatCompact(value);
  }

  function formatDate(ts) {
    try {
      return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return '—'; }
  }

  function timeAgo(ts, now) {
    const t = now || Date.now();
    const diff = Math.max(0, t - ts);
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    const mo = Math.floor(d / 30);
    if (mo < 12) return `${mo}mo ago`;
    return `${Math.floor(mo / 12)}y ago`;
  }

  function debounce(fn, wait) {
    let t = null;
    return function debounced(...args) {
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; fn.apply(this, args); }, wait || 150);
    };
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function tokenize(text) {
    return String(text || '').toLowerCase()
      .replace(/[^a-z0-9'\s-]/g, ' ')
      .split(/[\s\-_]+/)
      .map(w => w.replace(/^'+|'+$/g, ''))
      .filter(w => w.length >= 2 && !/^\d+$/.test(w));
  }

  /** Safe nested getter: get(obj, 'a.b.0.c', fallback). */
  function get(obj, path, fallback) {
    try {
      const parts = String(path).split('.');
      let cur = obj;
      for (const p of parts) {
        if (cur === null || cur === undefined) return fallback;
        cur = cur[p];
      }
      return cur === undefined ? fallback : cur;
    } catch (e) { return fallback; }
  }

  /** Log-scale normalisation: value in [0,max] → [0,1]. */
  function logNorm(value, max) {
    if (!Number.isFinite(value) || value <= 0) return 0;
    const m = max > 1 ? max : 10;
    return clamp(Math.log10(1 + value) / Math.log10(1 + m), 0, 1);
  }

  /** Weighted mean of [value, weight] pairs, ignoring non-finite values. */
  function weightedMean(pairs) {
    let sum = 0, w = 0;
    for (const [v, weight] of pairs) {
      if (Number.isFinite(v) && Number.isFinite(weight) && weight > 0) {
        sum += v * weight; w += weight;
      }
    }
    return w > 0 ? sum / w : null;
  }

  EIP.utils = {
    parseCount, parsePrice, parseRating, parseShopSince, parseListedDate,
    clamp, round, score, formatInt, formatCompact, formatRange,
    formatMoney, formatMoneyCompact, formatDate, timeAgo,
    debounce, escapeHtml, tokenize, get, logNorm, weightedMean, MONTHS
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
