/* Etsy Insight Pro — content/extractors/shop.js
 * Extracts VERIFIED data from an Etsy shop page (/shop/<name>).
 */
(function initShopExtractor(root) {
  const EIP = root.EIP || (root.EIP = {});
  EIP.register && EIP.register('extract-shop');

  function extractShop(doc) {
    const C = EIP.extract.common;
    const U = EIP.utils;
    const scope = doc || (typeof document !== 'undefined' ? document : null);
    const hints = {};
    const set = (obj, key, value, source) => { obj[key] = value; if (source) hints[key] = source; };
    const out = {
      pageType: 'shop', url: safeHref(), extractedAt: Date.now(),
      shopName: null, shopTitle: null, totalSales: null, activeListings: null,
      reviewCount: null, rating: null, sinceYear: null, shopAgeYears: null,
      location: null, avgPrice: null, currency: null, niche: null,
      listings: [], _hints: hints
    };
    if (!scope) return out;
    const $ = (s) => C.$(s, scope);
    const $all = (s) => C.$all(s, scope);

    out.shopName = C.shopNameFromUrl(out.url);
    if (out.shopName) hints.shopName = 'url:/shop/';

    // Title.
    const title = C.firstText(['h1', '[data-shop-name]', '.shop-title'], scope);
    if (title.value) set(out, 'shopTitle', title.value, title.source);

    const pageText = C.bodyText(150000);

    // "12,345 Sales".
    {
      const m = pageText.match(/([0-9][0-9,.\s\u00a0\u202f]*)\s+Sales\b/);
      if (m) {
        const n = U.parseCount(m[1]);
        if (n !== null && n < 100000000) set(out, 'totalSales', Math.round(n), 'dom:text-sales');
      }
    }
    // Review count + rating: "4.9 (2,341)" near shop header.
    {
      const star = $('[aria-label*="out of 5"], [aria-label*="stars"]');
      if (star) {
        const r = U.parseRating(star.getAttribute('aria-label'));
        if (r !== null) set(out, 'rating', r, 'dom:aria-stars');
      }
      const m = pageText.match(/([0-9][0-9,.\s\u00a0]*)\s+(?:Shop Reviews|reviews)\b/i);
      if (m) {
        const n = U.parseCount(m[1]);
        if (n !== null) set(out, 'reviewCount', Math.round(n), 'dom:text-shop-reviews');
      }
      if (out.reviewCount === null) {
        const near = C.numberNearStars(scope);
        if (near.value !== null) set(out, 'reviewCount', Math.round(near.value), near.source);
      }
      if (out.rating === null) {
        const rm = pageText.match(/(\d\.\d)\s*(?:out of 5|stars?)/i);
        if (rm) {
          const r = U.parseRating(rm[0]);
          if (r !== null) set(out, 'rating', r, 'dom:text-rating');
        }
      }
    }
    // Active listings: "128 Items" / "All Items (128)".
    {
      const m = pageText.match(/(?:All Items|Items)\s*\(?\s*([0-9][0-9,.\s]*)\s*\)?/i)
        || pageText.match(/([0-9][0-9,.\s]*)\s+Items\b/);
      if (m) {
        const n = U.parseCount(m[1]);
        if (n !== null && n < 1000000) set(out, 'activeListings', Math.round(n), 'dom:text-items');
      }
    }
    // "On Etsy since 2014".
    {
      const m = pageText.match(/On Etsy since\s+(19|20)\d{2}/i);
      if (m) {
        const parsed = U.parseShopSince(m[0]);
        if (parsed.year) {
          set(out, 'sinceYear', parsed.year, 'dom:on-etsy-since');
          set(out, 'shopAgeYears', parsed.ageYears, 'dom:on-etsy-since');
        }
      }
    }
    // Location (best effort).
    {
      const loc = C.firstText(['[data-shop-location]', '.shop-location'], scope);
      if (loc.value) set(out, 'location', loc.value, loc.source);
    }

    // ---- Visible listings grid ----
    out.listings = extractShopListings(scope);
    if (out.listings.length) {
      hints.listings = `dom:grid:${out.listings.length}-visible`;
      const prices = out.listings.map(l => l.price).filter(Number.isFinite);
      if (prices.length) {
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        set(out, 'avgPrice', Math.round(avg * 100) / 100, 'computed:visible-listings-mean');
      }
      const cur = out.listings.map(l => l.currency).filter(Boolean)[0];
      if (cur) set(out, 'currency', cur, 'dom:listing-card-currency');
      if (out.activeListings === null) {
        set(out, 'activeListings', out.listings.length, 'dom:grid-count-fallback');
      }
      // Niche guess from titles.
      try {
        const kw = EIP.keywords && EIP.keywords.analyzeKeywords(
          out.listings.map(l => ({ title: l.title, price: l.price, reviews: l.reviews, rating: l.rating })),
          { minFrequency: 2, maxRows: 5 }
        );
        if (kw && kw.rows && kw.rows.length) {
          set(out, 'niche', kw.rows.slice(0, 3).map(r => r.keyword).join(' · '), 'computed:title-keywords');
        }
      } catch (e) { /* optional */ }
    }

    return out;
  }

  function extractShopListings(scope) {
    const C = EIP.extract.common;
    const U = EIP.utils;
    const cards = C.$all(
      '[data-listing-id], a[href*="/listing/"].listing-link, .v2-listing-card a[href*="/listing/"], ' +
      '[data-testid="listing-card"], .shop-home-listing-grid a[href*="/listing/"]',
      scope
    );
    const seen = new Set();
    const out = [];
    for (const card of cards) {
      try {
        const anchor = card.tagName === 'A' ? card : (card.querySelector && card.querySelector('a[href*="/listing/"]')) || card;
        const href = anchor.getAttribute ? anchor.getAttribute('href') : null;
        const absUrl = href ? new URL(href, 'https://www.etsy.com').href.split('?')[0] : null;
        const id = C.listingIdFromUrl(absUrl || '') || (card.getAttribute && card.getAttribute('data-listing-id'));
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const root = card.closest ? (card.closest('[data-listing-id], .v2-listing-card, li, div') || card) : card;
        const title =
          C.textOf(root.querySelector && root.querySelector('img[alt]') && altAsEl(root)) ||
          C.textOf((root.querySelector && (root.querySelector('.v2-listing-card__title, [data-title], h3, h2, p'))) || null) ||
          imgAlt(root, C);
        const priceText = C.textOf(root.querySelector && root.querySelector('.currency-value, [data-price], .n-listing-card__price, .v2-listing-card__price')) || C.textOf(card);
        const parsed = U.parsePrice(priceText || '');
        const starsText = C.textOf(root.querySelector && root.querySelector('[aria-label*="stars"], [aria-label*="out of 5"]')) || '';
        const rating = U.parseRating((root.querySelector && root.querySelector('[aria-label*="stars"], [aria-label*="out of 5"]') || {}).getAttribute
          ? (root.querySelector('[aria-label*="stars"], [aria-label*="out of 5"]')).getAttribute('aria-label') : starsText);
        const revM = (C.textOf(root) || '').match(/\(([0-9][0-9,.\sKkMm]*)\)/);
        const reviews = revM ? U.parseCount(revM[1]) : null;
        const badgeText = (C.textOf(root) || '');
        out.push({
          listingId: id,
          title: title || `Listing ${id}`,
          price: parsed.value,
          currency: parsed.currencyGuess,
          rating, reviews,
          isBestseller: /\bBestseller\b/.test(badgeText),
          isStarred: /Star Seller/.test(badgeText),
          url: absUrl,
          image: imgSrc(root)
        });
        if (out.length >= 120) break;
      } catch (e) { /* skip bad card */ }
    }
    return out;
  }

  function altAsEl() { return null; }
  function imgAlt(root, C) {
    try {
      const img = root.querySelector && root.querySelector('img[alt]');
      const alt = img && img.getAttribute('alt');
      return alt ? alt.trim() : null;
    } catch (e) { return null; }
  }
  function imgSrc(root) {
    try {
      const img = root.querySelector && root.querySelector('img[src]');
      return (img && (img.getAttribute('src') || img.getAttribute('data-src'))) || null;
    } catch (e) { return null; }
  }

  function safeHref() {
    try { return (typeof location !== 'undefined' && location.href) || ''; }
    catch (e) { return ''; }
  }

  EIP.extract = EIP.extract || {};
  EIP.extract.shop = { extractShop };
})(typeof globalThis !== 'undefined' ? globalThis : this);
