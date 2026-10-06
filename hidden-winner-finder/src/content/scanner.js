/* GENERATED FILE - DO NOT EDIT.
 * Sources: src/content/scanner.src.js + src/core/parse.js
 * Rebuild: node tools/build-scanner.mjs
 */
/**
 * scanner.src.js - the injected page reader (SOURCE FILE).
 *
 * ⚠️ Do not load this file directly. Run `node tools/build-scanner.mjs`, which
 * inlines the shared parsers from src/core/parse.js and writes the generated
 * src/content/scanner.js that the extension actually injects.
 *
 * What it does: reads the product cards of the *currently open, publicly
 * accessible* search results page in the user's own browser tab, using a
 * per-marketplace adapter with a generic fallback for any other marketplace.
 *
 * What it never does: log in, bypass a paywall, call a private API, follow
 * pagination links, or send anything to a server. Everything is returned to the
 * extension locally and the user can clear it at any time.
 */

(() => {
  if (window.__hiddenWinnerFinderScan) return window.__hiddenWinnerFinderScan;

  /* ───────────── inlined from src/core/parse.js (generated) ───────────── */
  /**
 * parse.js - pure, DOM-free parsing + statistics helpers.
 *
 * Nothing in this file touches `window`, `document` or any Chrome API, so it runs
 * both inside the content-script scanner (via tools/build-scanner.mjs, which
 * inlines this module and strips the `export` keywords) and inside `node --test`.
 *
 * Source of truth for every "observed" number the extension reports.
 */


/** Parse a human price string ("$14.99", "US $1,299.00", "12,50 €") → number|null. */
function parsePrice(input) {
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
function parseCount(input) {
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
function parseReviews(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  return parseCount(raw);
}

function parseSalesText(input) {
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
function parseResultCount(input) {
  const raw = String(input ?? '').toLowerCase();
  if (!/\d/.test(raw)) return null;
  const over = raw.match(/over\s+([\d.,]+)\s*([km]?)/);
  if (over) return parseCount(`${over[1]}${over[2] || ''}`);
  const results = raw.match(/([\d.,]+\s*[km]?)\s*(results?|listings?|items?|products?|résultats?|articles?|articles|adverts?)/);
  if (results) return parseCount(results[1]);
  return null;
}


function mean(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function median(values) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function percentile(values, p) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const idx = Math.min(nums.length - 1, Math.max(0, Math.round((nums.length - 1) * p)));
  return nums[idx];
}

function stdDev(values) {
  const m = mean(values);
  if (m == null) return null;
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length < 2) return 0;
  const variance = nums.reduce((acc, v) => acc + (v - m) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

/** Coefficient of variation - used as the "price competition" proxy. */
function coefficientOfVariation(values) {
  const m = mean(values);
  const sd = stdDev(values);
  if (m == null || sd == null || m === 0) return null;
  return sd / m;
}

/** Share of values that sit inside ±tolerance of the median (price-war density). */
function priceClustering(prices, tolerance = 0.15) {
  const nums = prices.filter((v) => Number.isFinite(v));
  const mid = median(nums);
  if (mid == null || nums.length < 3) return null;
  const near = nums.filter((p) => Math.abs(p - mid) / mid <= tolerance).length;
  return near / nums.length;
}


const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'of', 'to', 'in', 'on', 'by', 'from', 'your', 'you',
  'my', 'our', 'set', 'pack', 'new', 'free', 'shipping', 'gift', 'gifts', 'custom', 'personalized',
  'personalised', 'handmade',
]);

function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[-']+|[-']+$/g, ''))
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/** Jaccard similarity of two token sets - a proxy for "how copy-able" a niche is. */
function titleSimilarity(titles) {
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
function qualityShare(listings) {
  if (!listings.length) return null;
  const good = listings.filter((l) => {
    if (l.hasVideo) return true;
    if (Number.isFinite(l.imageCount) && l.imageCount >= 8) return true;
    return Number.isFinite(l.titleLength) && l.titleLength >= 70 && l.rating >= 4.7;
  }).length;
  return good / listings.length;
}

function share(list, predicate) {
  if (!list.length) return null;
  return list.filter(predicate).length / list.length;
}

function safeRatio(numerator, denominator, fallback = null) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return fallback;
  return numerator / denominator;
}

/** Deduplicate near-identical scraped entries (same title + price). */
function dedupeListings(listings) {
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

function truncate(text, max = 90) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
  /* ────────────────────────────────────────────────────────────────────── */

  const MAX_LISTINGS = 60;

  const clean = (text) => String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  const textOf = (el) => clean(el?.textContent);
  const attrOf = (el, ...names) => {
    for (const name of names) {
      const v = el?.getAttribute?.(name);
      if (v) return clean(v);
    }
    return '';
  };
  const all = (selector, root = document) => {
    try {
      return [...root.querySelectorAll(selector)];
    } catch {
      return [];
    }
  };
  const first = (selectors, root = document) => {
    for (const selector of [].concat(selectors)) {
      try {
        const found = root.querySelector(selector);
        if (found) return found;
      } catch { /* invalid selector - ignore */ }
    }
    return null;
  };

  const host = location.hostname.replace(/^www\./, '').toLowerCase();
  const url = location.href;
  const params = new URLSearchParams(location.search);

  const queryFromUrl = () => {
    const keys = ['q', 'k', 'keyword', 'search_query', 'search', 'query', 'term', 'text', 'SearchText'];
    for (const key of keys) {
      const value = params.get(key);
      if (value) return clean(value);
    }
    return clean(document.title.split(/[|–—-]/)[0] || '');
  };

  const findResultCount = () => {
    // Look for the phrase marketplaces print above their results, e.g.
    // "1-48 of over 2,000 results", "1,482 results", "About 3,000 listings".
    const candidates = [];
    const selectors = [
      '[data-testid*="result"]', '[data-automation-id*="result"]', '.searchShowingCount', '.srp-controls__count-heading',
      '.s-desktop-toolbar', '[role="status"]', 'h1', 'h2', 'span', 'div', 'p',
    ];
    for (const node of all(selectors.join(','))) {
      if (candidates.length > 400) break;
      const text = textOf(node);
      if (text.length < 4 || text.length > 160) continue;
      if (!/result|listing|item|advert|produit|résultat/i.test(text)) continue;
      candidates.push(text);
    }
    candidates.sort((a, b) => a.length - b.length);
    for (const text of candidates) {
      const value = parseResultCount(text);
      if (value != null) return value;
    }
    const bodyMatch = document.body?.innerText?.slice(0, 6000).match(/[\d.,]+\s*[km]?\+?\s*(results?|listings?|items?|adverts?)/i);
    return bodyMatch ? parseResultCount(bodyMatch[0]) : null;
  };

  const badgesFor = (card, title) => {
    const badges = [];
    const text = `${title} ${textOf(card).slice(0, 400)}`.toLowerCase();
    const patterns = [
      ['bestseller', /best\s?seller|bestseller/],
      ['amazons-choice', /amazon'?s\s+choice/],
      ['sold', /\b\d[\d.,]*\s*[km]?\+?\s*(sold|bought|sales|orders)\b/],
      ['popular', /popular now|trending|in demand|hot item/],
      ['star-seller', /star seller|top rated|top seller/],
      ['new', /new listing|just listed|new arrival/],
    ];
    for (const [id, re] of patterns) if (re.test(text)) badges.push(id);
    return badges;
  };

  const sponsoredFor = (card) => {
    const attrs = `${attrOf(card, 'data-ad-id', 'data-sponsored', 'aria-label')} ${textOf(card).slice(0, 260)}`;
    if (/sponsored|advertisement|\bAd\b/.test(attrs)) return true;
    return Boolean(card.querySelector('[aria-label*="Sponsored" i], [data-sponsored="true"], .s-sponsored-label-text, [class*="sponsored" i]'));
  };

  const reviewsFor = (card) => {
    const text = textOf(card);
    const patterns = [
      /\(([\d.,]+\s*[km]?)\)/,                              // Etsy/Amazon style (1,284)
      /([\d.,]+\s*[km]?)\s*(?:reviews?|ratings?|avis|évaluations?)/i,
      /([\d.,]+\s*[km]?)\s*(?:sold|bought|sales|orders)/i,   // "2,300 sold"
      /([\d.,]+\s*[km]?)\s*\+?\s*(?:reviews?)/i,
    ];
    for (const re of patterns) {
      const match = text.match(re);
      if (match) {
        const value = parseCount(match[1]);
        if (value != null && value >= 0) return value;
      }
    }
    return null;
  };

  const ratingFor = (card) => {
    const text = attrOf(card, 'aria-label') + ' ' + textOf(card).slice(0, 200);
    const match = text.match(/([0-5](?:[.,]\d)?)\s*(?:out of 5|stars?|étoiles?|★)/i);
    if (!match) return null;
    const value = Number.parseFloat(match[1].replace(',', '.'));
    return Number.isFinite(value) && value >= 0 && value <= 5 ? value : null;
  };

  const imageCountFor = (card) => card.querySelectorAll('img').length || null;
  const hasVideoFor = (card) => Boolean(card.querySelector('video, [aria-label*="video" i], [class*="video" i]'));

  const priceFor = (card) => {
    const priceSelectors = [
      '[data-automation-id="product-price"]', '.a-price .a-offscreen', '.s-item__price',
      '.currency-value', '.wt-text-title-01', '[class*="price" i]', '[data-testid*="price" i]', 'ins',
    ];
    for (const selector of priceSelectors) {
      for (const node of all(selector, card).slice(0, 4)) {
        const value = parsePrice(textOf(node) || attrOf(node, 'content', 'data-price'));
        if (value != null) return value;
      }
    }
    const text = textOf(card);
    const match = text.match(/(?:US\s*)?[$£€]\s?\d[\d.,]*/);
    return match ? parsePrice(match[0]) : null;
  };

  /* ───────────────────────── marketplace adapters ───────────────────────── */

  const adapters = {
    etsy: {
      id: 'etsy',
      cardSelectors: [
        'div[data-listing-id]', 'li[data-listing-id]', 'div[data-appears-component-name="search_listing"]',
        '.v2-listing-card', '[data-search-results] li',
      ],
      titleSelectors: ['h3', '[data-listing-card-title]', '.v2-listing-card__info h3', 'h2', 'a[title]'],
    },
    amazon: {
      id: 'amazon',
      cardSelectors: ['div[data-component-type="s-search-result"]', 'div.s-result-item[data-asin]:not([data-asin=""])'],
      titleSelectors: ['h2 span', 'h2', '[data-cy="title-recipe"] span', '.a-text-normal'],
    },
    ebay: {
      id: 'ebay',
      cardSelectors: ['li.s-item', 'li.s-card', '[data-view="mi"]', '.srp-results > li'],
      titleSelectors: ['.s-item__title', '.s-card__title', '[role="heading"]', 'span[role="heading"]'],
    },
    walmart: {
      id: 'walmart',
      cardSelectors: ['div[data-item-id]', '[data-testid="list-view"] > div', '[data-testid="item-stack"] > div'],
      titleSelectors: ['[data-automation-id="product-title"]', 'a[link-identifier]', 'span[data-automation-id="product-title"]'],
    },
    tiktok: {
      id: 'tiktok',
      cardSelectors: ['[data-e2e="search-card"]', 'div[class*="ProductCard"]', 'a[href*="/product/"]', 'a[href*="/view/product/"]'],
      titleSelectors: ['[data-e2e="search-card-title"]', 'h3', '[class*="title"]', 'img[alt]'],
    },
  };

  const genericAdapter = {
    id: null,
    cardSelectors: [
      '[data-testid*="product" i]', '[class*="product-card" i]', '[class*="productCard" i]',
      '[class*="listing" i]', 'li[class*="item" i]', 'article', '[itemtype*="Product"]',
    ],
    titleSelectors: ['[itemprop="name"]', 'h2', 'h3', 'h4', '[class*="title" i]', 'a[title]', 'img[alt]'],
  };

  const detectAdapter = () => {
    if (/(^|\.)etsy\.com$/.test(host)) return adapters.etsy;
    if (/(^|\.)amazon\./.test(host)) return adapters.amazon;
    if (/(^|\.)ebay\./.test(host)) return adapters.ebay;
    if (/(^|\.)walmart\.com$/.test(host)) return adapters.walmart;
    if (/(^|\.)tiktok\.com$/.test(host)) return adapters.tiktok;
    return genericAdapter;
  };

  const extractListings = (adapter) => {
    let cards = [];
    for (const selector of adapter.cardSelectors) {
      const found = all(selector);
      if (found.length >= 3) { cards = found; break; }
      if (found.length > cards.length) cards = found;
    }
    const out = [];
    for (const card of cards.slice(0, MAX_LISTINGS * 2)) {
      const titleNode = first(adapter.titleSelectors, card);
      const title = clean(
        attrOf(titleNode, 'title', 'alt', 'aria-label') || textOf(titleNode)
        || attrOf(card, 'aria-label', 'data-title') || textOf(card).slice(0, 120),
      );
      if (!title || title.length < 6) continue;
      const price = priceFor(card);
      const reviews = reviewsFor(card);
      if (price == null && reviews == null) continue;   // navigation / promo blocks
      out.push({
        title: title.slice(0, 180),
        price,
        reviews,
        rating: ratingFor(card),
        badges: badgesFor(card, title),
        sponsored: sponsoredFor(card),
        hasVideo: hasVideoFor(card),
        imageCount: imageCountFor(card),
        favorites: (() => {
          const text = textOf(card);
          const match = text.match(/([\d.,]+\s*[km]?)\s*favourites?|([\d.,]+\s*[km]?)\s*favorites?/i);
          return match ? parseCount(match[1] || match[2]) : null;
        })(),
      });
      if (out.length >= MAX_LISTINGS) break;
    }
    return out;
  };

  const run = () => {
    const adapter = detectAdapter();
    const listings = extractListings(adapter);
    const resultCount = findResultCount();
    const result = {
      ok: listings.length > 0 || resultCount != null,
      marketplaceId: adapter.id,
      host,
      url,
      pageTitle: clean(document.title).slice(0, 200),
      query: queryFromUrl(),
      resultCount,
      listings,
      scannedAt: Date.now(),
      adapter: adapter.id || 'generic',
      warnings: [],
    };
    if (!listings.length) result.warnings.push('No product cards detected on this page.');
    if (listings.length && listings.length < 5) result.warnings.push(`Only ${listings.length} products were readable - confidence will be limited.`);
    if (/captcha|are you a human|access denied/i.test(document.title)) {
      return { ok: false, error: 'This page looks like a challenge/CAPTCHA screen - open the results page again and retry.' };
    }
    return result;
  };

  window.__hiddenWinnerFinderScan = true;
  return run();
})();

