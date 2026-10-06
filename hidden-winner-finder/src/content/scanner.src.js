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
  /*__PARSE_JS__*/
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
