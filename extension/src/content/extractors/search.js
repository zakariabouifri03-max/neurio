/* Etsy Insight Pro — content/extractors/search.js
 * Extracts VERIFIED data from Etsy search / market pages.
 */
(function initSearchExtractor(root) {
  const EIP = root.EIP || (root.EIP = {});
  EIP.register && EIP.register('extract-search');

  function extractSearch(doc) {
    const C = EIP.extract.common;
    const U = EIP.utils;
    const scope = doc || (typeof document !== 'undefined' ? document : null);
    const hints = {};
    const out = {
      pageType: 'search', url: safeHref(), extractedAt: Date.now(),
      query: null, totalResults: null, items: [], _hints: hints
    };
    if (!scope) return out;

    // Query.
    try {
      const url = new URL(out.url);
      out.query = url.searchParams.get('q') || url.searchParams.get('search_query') || null;
      if (out.query) hints.query = 'url:q';
      if (!out.query) {
        const m = (url.pathname || '').match(/\/market\/([^/?#]+)/);
        if (m) { out.query = decodeURIComponent(m[1]).replace(/[-_]+/g, ' '); hints.query = 'url:/market/'; }
      }
    } catch (e) { /* ignore */ }
    if (!out.query) {
      const input = C.$('input[name="search_query"], input[type="search"], #search-query', scope);
      if (input && input.value) { out.query = input.value.trim(); hints.query = 'dom:search-input'; }
    }

    // Total results: "12,345 Results".
    {
      const t = C.firstText(['[data-results-count]', '.wt-display-inline'], scope);
      const pageText = C.bodyText(60000);
      const m = (t.value ? t.value + ' ' : '') .match(/([0-9][0-9,.\s\u00a0\u202f]*)\s+Results?/i)
        || pageText.match(/([0-9][0-9,.\s\u00a0\u202f]*)\s+Results?/);
      if (m) {
        const n = U.parseCount(m[1]);
        if (n !== null && n < 100000000) { out.totalResults = Math.round(n); hints.totalResults = 'dom:text-results'; }
      }
      const dc = C.firstAttr(['[data-results-count]'], 'data-results-count', scope);
      if (out.totalResults === null && dc.value) {
        const n = U.parseCount(dc.value);
        if (n !== null) { out.totalResults = Math.round(n); hints.totalResults = dc.source; }
      }
    }

    out.items = extractResultCards(scope);
    if (out.items.length) hints.items = `dom:cards:${out.items.length}-visible`;

    return out;
  }

  function extractResultCards(scope) {
    const C = EIP.extract.common;
    const U = EIP.utils;
    const cards = C.$all(
      '[data-listing-id], [data-testid="listing-card"], .v2-listing-card, ' +
      'a.listing-link[href*="/listing/"], li a[href*="/listing/"]',
      scope
    );
    const seen = new Set();
    const out = [];
    let rank = 0;
    for (const card of cards) {
      try {
        const anchor = card.tagName === 'A' ? card : (card.querySelector && card.querySelector('a[href*="/listing/"]'));
        const href = (anchor && anchor.getAttribute && anchor.getAttribute('href')) ||
          (card.getAttribute && card.getAttribute('href')) || '';
        const absUrl = href ? new URL(href, 'https://www.etsy.com').href.split('?')[0] : null;
        const id = C.listingIdFromUrl(absUrl || '') || (card.getAttribute && card.getAttribute('data-listing-id'));
        if (!id || seen.has(id)) continue;
        seen.add(id);
        rank++;
        const root = (card.closest && (card.closest('[data-listing-id], .v2-listing-card, li') || card)) || card;
        const q = (sel) => { try { return root.querySelector ? root.querySelector(sel) : null; } catch (e) { return null; } };
        const img = q('img[alt]');
        const title = ((img && img.getAttribute('alt')) || '').trim() ||
          C.textOf(q('.v2-listing-card__title, [data-title], h3, h2')) ||
          `Listing ${id}`;
        const parsed = U.parsePrice(C.textOf(q('.currency-value')) || C.textOf(q('[data-price], .n-listing-card__price, .v2-listing-card__price, [class*="price" i]')) || '');
        const price = C.validPrice(parsed.value);
        let rating = null;
        try {
          const star = q('[aria-label*="out of 5"], [aria-label*="stars"]');
          if (star) rating = C.validRating(U.parseRating(star.getAttribute('aria-label')));
        } catch (e) { /* ignore */ }
        const revM = (C.scopedText(root, 3000) || '').match(/\(([0-9][0-9,.\s\u00a0\u202fKkMm]*)\)/);
        const reviews = revM ? C.validCount(U.parseCount(revM[1]), 10000000) : null;
        const badgeText = C.textOf(root) || '';
        // Shop is rarely on the card; try data attrs.
        let shop = null;
        try {
          const shopEl = root.querySelector ? root.querySelector('[data-shop-name], a[href*="/shop/"]') : null;
          if (shopEl) {
            shop = shopEl.getAttribute('data-shop-name') ||
              C.shopNameFromUrl(shopEl.getAttribute('href') || '') ||
              C.textOf(shopEl);
          }
        } catch (e) { /* ignore */ }
        out.push({
          rank, position: rank, listingId: id, title: String(title).slice(0, 200),
          price, currency: parsed.currencyGuess,
          rating, reviews,
          shop: shop || null,
          isBestseller: /\bBestseller\b/.test(badgeText),
          isAd: /\bAd\b/.test(badgeText.slice(0, 60)),
          url: absUrl,
          image: (root.querySelector && root.querySelector('img[src]') || {}).src || null
        });
        if (out.length >= 120) break;
      } catch (e) { /* skip bad card */ }
    }
    return out;
  }

  function safeHref() {
    try { return (typeof location !== 'undefined' && location.href) || ''; }
    catch (e) { return ''; }
  }

  EIP.extract = EIP.extract || {};
  EIP.extract.search = { extractSearch };
})(typeof globalThis !== 'undefined' ? globalThis : this);
