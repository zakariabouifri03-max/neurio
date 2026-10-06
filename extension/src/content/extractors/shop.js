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
    const title = C.firstText(['h1.shop-title', '[data-shop-name]', '.shop-title', 'h1'], scope);
    if (title.value) set(out, 'shopTitle', cleanShopTitle(title.value), title.source);

    const pageText = C.bodyText(150000);
    // Shop header region (first 25k chars ≈ header) — keeps listing-grid
    // numbers ("(1,243)" under cards) out of shop-level fields.
    const headerText = pageText.slice(0, 25000);

    // "12,345 Sales" — consensus of header + global occurrences.
    {
      const cands = [];
      const hm = headerText.match(/([0-9][0-9,.\s\u00a0\u202fKkMm]*)\s+sales\b/i);
      if (hm) {
        const n = C.validCount(U.parseCount(hm[1]));
        if (n !== null) cands.push({ value: n, source: 'dom:header-sales', trust: 3 });
      }
      const gm = pageText.match(/([0-9][0-9,.\s\u00a0\u202fKkMm]*)\s+sales\b/i);
      if (gm) {
        const n = C.validCount(U.parseCount(gm[1]));
        if (n !== null) cands.push({ value: n, source: 'dom:text-sales', trust: 1 });
      }
      const win = C.consensus(cands);
      if (win.value !== null) set(out, 'totalSales', Math.round(win.value), win.source);
    }
    // Review count + rating: prefer "N Shop Reviews" + header stars.
    {
      const revCands = [], rateCands = [];
      const sm = headerText.match(/([0-9][0-9,.\s\u00a0\u202fKkMm]*)\s+shop\s+reviews?\b/i)
        || pageText.match(/([0-9][0-9,.\s\u00a0\u202fKkMm]*)\s+shop\s+reviews?\b/i);
      if (sm) {
        const n = C.validCount(U.parseCount(sm[1]));
        if (n !== null) revCands.push({ value: n, source: 'dom:text-shop-reviews', trust: 3 });
      }
      const headerEl = $('header, [data-shop-header], main');
      const star = (headerEl && C.$('[aria-label*="out of 5"], [aria-label*="stars"]', headerEl)) || $('[aria-label*="out of 5"]');
      if (star) {
        const r = C.validRating(U.parseRating(star.getAttribute('aria-label')));
        if (r !== null) rateCands.push({ value: r, source: 'dom:header-stars', trust: 3 });
        const near = C.countNearElement(star, U.parseCount);
        if (near !== null) revCands.push({ value: near, source: 'dom:stars-parens', trust: 1 });
      }
      if (!rateCands.length) {
        const rm = headerText.match(/(\d[.,]\d)\s*(?:out of 5|stars?)/i);
        if (rm) {
          const r = C.validRating(U.parseRating(rm[0]));
          if (r !== null) rateCands.push({ value: r, source: 'dom:text-rating', trust: 1 });
        }
      }
      const revWin = C.consensus(revCands);
      if (revWin.value !== null) set(out, 'reviewCount', Math.round(revWin.value), revWin.source);
      const rateWin = C.consensus(rateCands);
      if (rateWin.value !== null) set(out, 'rating', rateWin.value, rateWin.source);
    }
    // Active listings: "All Items (128)" / "128 Items" / tab buttons.
    {
      const cands = [];
      const tabBtn = $all('button, a[role="tab"], [role="tab"]').map(b => C.textOf(b)).find(t => t && /items?/i.test(t));
      if (tabBtn) {
        const m = tabBtn.match(/([0-9][0-9,.\s]*)/);
        if (m) {
          const n = C.validCount(U.parseCount(m[1]), 1000000);
          if (n !== null) cands.push({ value: n, source: 'dom:items-tab', trust: 3 });
        }
      }
      const m = pageText.match(/(?:all\s+items|items)\s*\(?\s*([0-9][0-9,.\s]*)\s*\)?/i)
        || pageText.match(/([0-9][0-9,.\s]*)\s+items\b/i);
      if (m) {
        const n = C.validCount(U.parseCount(m[1]), 1000000);
        if (n !== null) cands.push({ value: n, source: 'dom:text-items', trust: 2 });
      }
      const win = C.consensus(cands);
      if (win.value !== null) set(out, 'activeListings', Math.round(win.value), win.source);
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
      '[data-testid="listing-card"], .shop-home-listing-grid a[href*="/listing/"], ' +
      'li a[href*="/listing/"], .listing-card a[href*="/listing/"]',
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
        const root = card.closest ? (card.closest('[data-listing-id], .v2-listing-card, li') || card.closest('div') || card) : card;
        const q = (sel) => { try { return root.querySelector ? root.querySelector(sel) : null; } catch (e) { return null; } };
        // Title: image alt is the most stable card title on Etsy.
        const title = imgAlt(root) ||
          C.textOf(q('.v2-listing-card__title, [data-title], h3, h2')) ||
          C.textOf(q('p[class*="title" i]')) ||
          `Listing ${id}`;
        // Price: currency-value spans first (avoids rating/review numbers).
        const priceEl = q('.currency-value') || q('[data-price], .n-listing-card__price, .v2-listing-card__price, [class*="price" i]');
        const parsed = U.parsePrice(C.textOf(priceEl) || '');
        const price = C.validPrice(parsed.value);
        // Rating + reviews.
        const starEl = q('[aria-label*="out of 5"], [aria-label*="stars"]');
        const rating = starEl ? C.validRating(U.parseRating(starEl.getAttribute('aria-label'))) : null;
        const revM = (C.scopedText(root, 3000) || '').match(/\(([0-9][0-9,.\s\u00a0\u202fKkMm]*)\)/);
        const reviews = revM ? C.validCount(U.parseCount(revM[1]), 10000000) : null;
        const badgeText = C.scopedText(root, 3000) || '';
        out.push({
          listingId: id,
          title: String(title).slice(0, 200),
          price,
          currency: parsed.currencyGuess,
          rating, reviews,
          isBestseller: /\bBestseller\b/i.test(badgeText),
          isStarred: /Star Seller/i.test(badgeText),
          url: absUrl,
          image: imgSrc(root)
        });
        if (out.length >= 120) break;
      } catch (e) { /* skip bad card */ }
    }
    return out;
  }

  function cleanShopTitle(t) {
    if (!t) return t;
    return String(t).replace(/\s*[|\-–]\s*Etsy\s*$/i, '').trim();
  }
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
