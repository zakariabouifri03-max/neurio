/* Etsy Insight Pro — content/extractors/product.js
 * Extracts VERIFIED (visible on-page) data from an Etsy listing page.
 *
 * Accuracy design (v1.1):
 *  - Every numeric field is gathered from MULTIPLE independent sources
 *    (JSON-LD → scoped buy-box DOM → meta → global DOM) and resolved with
 *    consensus(): a value confirmed by 2+ sources wins; a lone outlier loses.
 *  - Listing-level numbers are read from the BUY BOX / review module first so
 *    shop-level distractors ("8,930 Shop Reviews") can never leak in.
 *  - Variant price ranges ("$19.95 – $34.95") are captured as low+high so
 *    revenue math uses the midpoint instead of a mangled number.
 *  - Nothing is invented: unobserved fields stay null and are counted in the
 *    data-quality report (see coverageReport).
 */
(function initProductExtractor(root) {
  const EIP = root.EIP || (root.EIP = {});
  EIP.register && EIP.register('extract-product');

  function extractProduct(doc) {
    const C = EIP.extract.common;
    const U = EIP.utils;
    const scope = doc || (typeof document !== 'undefined' ? document : null);
    const hints = {};
    const set = (obj, key, value, source) => { obj[key] = value; if (source) hints[key] = source; };
    const out = {
      pageType: 'product', url: safeHref(), extractedAt: Date.now(),
      listingId: null, title: null,
      price: null, priceHigh: null, priceDisplay: null, currency: null,
      reviews: null, rating: null, shopName: null, shopUrl: null,
      shopTotalSales: null, shopReviewCount: null, shopSinceYear: null, shopAgeYears: null,
      favorites: null, inCarts: null, category: null, categoryPath: [],
      isDigital: null, isBestseller: false, isPopular: false, isStarSeller: false,
      availability: 'unknown', listedDate: null, listingAgeDays: null,
      recentReviews30d: null, recentSampleSize: null, image: null, _hints: hints
    };
    if (!scope) return out;

    const $ = (s, sc) => C.$(s, sc || scope);
    const $all = (s, sc) => C.$all(s, sc || scope);

    out.listingId = C.listingIdFromUrl(out.url);
    if (out.listingId) hints.listingId = 'url:/listing/';

    // ---- structured data (most stable sources) ----
    let blocks = [];
    try { blocks = C.parseJsonLd(); } catch (e) { blocks = []; }
    const ld = C.findProductJsonLd(blocks);
    const bcLd = C.findBreadcrumbLd(blocks);

    // Scoped regions: buy box (listing facts) vs whole page (shop/global facts).
    const buyBox = $('[data-buy-box], [data-buybox], main, body');

    // ================= TITLE =================
    {
      const cands = [];
      const h1 = $('h1[data-buy-box-listing-title]', buyBox) || $('h1', buyBox);
      if (h1) cands.push({ value: cleanTitle(C.textOf(h1)), source: 'dom:buybox-h1', trust: 3 });
      const h1g = $('h1');
      if (h1g && h1g !== h1) cands.push({ value: cleanTitle(C.textOf(h1g)), source: 'dom:h1', trust: 2 });
      if (ld && ld.name) cands.push({ value: cleanTitle(ld.name), source: 'jsonld:Product.name', trust: 2 });
      const og = C.metaContent(['og:title']);
      if (og.value) cands.push({ value: cleanTitle(og.value), source: og.source, trust: 2 });
      const pick = firstValidTitle(cands);
      if (pick) set(out, 'title', pick.value, pick.source);
    }

    // ================= PRICE (+range) / CURRENCY =================
    {
      const priceCands = [];
      const pushPrice = (rawText, source, trust) => {
        if (!rawText) return;
        const p = U.parsePrice(rawText);
        const v = C.validPrice(p.value);
        if (v !== null) priceCands.push({ value: v, high: C.validPrice(p.high), source, trust });
      };
      if (ld && ld.offers) {
        const offers = Array.isArray(ld.offers) ? ld.offers : [ld.offers];
        for (const o of offers.slice(0, 3)) {
          if (o && o.price !== undefined && o.price !== null) {
            pushPrice(String(o.price), 'jsonld:offers.price', 3);
          }
        }
        const o0 = offers[0] || {};
        if (o0.priceCurrency) set(out, 'currency', String(o0.priceCurrency).toUpperCase(), 'jsonld:offers.priceCurrency');
        if (o0.availability && /instock/i.test(String(o0.availability))) out.availability = 'in_stock';
      }
      const metaAmt = C.metaContent(['product:price:amount', 'og:price:amount']);
      if (metaAmt.value) pushPrice(metaAmt.value, metaAmt.source, 2);
      const metaCur = C.metaContent(['product:price:currency', 'og:price:currency']);
      if (metaCur.value && !out.currency) set(out, 'currency', String(metaCur.value).toUpperCase(), metaCur.source);
      // Buy-box DOM (scoped first — avoids "related items" prices).
      const priceSels = [
        '[data-buy-box-listing-price]', '[data-buybox-price]',
        'p.wt-text-title-03', '[data-test-id="price"]',
        '.listing-page-price', '[class*="buy-box"] .currency-value'
      ];
      let domRangeHigh = null, domRangeSrc = null;
      for (const sel of priceSels) {
        const el = $(sel, buyBox) || (buyBox === scope ? null : $(sel));
        const txt = C.textOf(el);
        if (!txt) continue;
        const p = U.parsePrice(txt);
        const v = C.validPrice(p.value);
        if (v !== null) {
          priceCands.push({ value: v, high: C.validPrice(p.high), source: `dom:${sel}`, trust: 2 });
          if (p.high !== null && domRangeHigh === null) { domRangeHigh = C.validPrice(p.high); domRangeSrc = `dom:${sel}`; }
        }
      }
      // Currency symbol near the winning price element.
      const win = C.consensus(priceCands.map(c => ({ value: c.value, source: c.source, trust: c.trust })));
      if (win.value !== null) {
        set(out, 'price', win.value, win.source);
        // Range high: prefer one attached to a candidate that agrees with winner.
        const withHigh = priceCands.find(c => c.high !== null && Math.abs(c.value - win.value) <= Math.max(0.011, win.value * 0.011));
        const hi = withHigh ? withHigh.high : domRangeHigh;
        if (hi !== null && hi > win.value) {
          set(out, 'priceHigh', hi, withHigh ? withHigh.source : domRangeSrc);
        }
        if (!out.currency) {
          const symEl = $('[data-buy-box-listing-price] .currency-symbol, .currency-symbol', buyBox);
          const sym = C.textOf(symEl);
          const guess = sym ? U.parsePrice(sym + '1').currencyGuess : null;
          if (guess) set(out, 'currency', guess, 'dom:currency-symbol');
        }
      }
      if (!out.currency) {
        const attr = C.firstAttr(['[data-currency]', 'body'], 'data-currency');
        if (attr.value && /^[A-Z]{3}$/i.test(attr.value)) set(out, 'currency', String(attr.value).toUpperCase(), attr.source);
      }
      if (out.price !== null) {
        out.priceDisplay = out.priceHigh !== null
          ? `${fmtPrice(out.price)} – ${fmtPrice(out.priceHigh)}`
          : fmtPrice(out.price);
      }
    }

    // ================= REVIEWS + RATING (listing-level, buy-box scoped) =================
    {
      const revCands = [], rateCands = [];
      if (ld && ld.aggregateRating) {
        const rc = C.validCount(U.parseCount(ld.aggregateRating.reviewCount));
        if (rc !== null) revCands.push({ value: rc, source: 'jsonld:aggregateRating', trust: 3 });
        const rv = C.validRating(U.parseRating(ld.aggregateRating.ratingValue));
        if (rv !== null) rateCands.push({ value: rv, source: 'jsonld:aggregateRating', trust: 3 });
      }
      // Review link inside buy box: <a href="#reviews">4.8 (1,243)</a>.
      const revLinks = $all('a[href*="#reviews"]', buyBox);
      for (const a of revLinks.slice(0, 3)) {
        const t = C.scopedText(a, 500);
        const m = t.match(/\(([0-9][0-9,.\s\u00a0\u202fKkMm]*)\)/);
        if (m) {
          const n = C.validCount(U.parseCount(m[1]));
          if (n !== null) revCands.push({ value: n, source: 'dom:buybox-reviews-link', trust: 3 });
        }
        const star = a.querySelector ? a.querySelector('[aria-label*="star"], [aria-label*="out of 5"]') : null;
        const r = C.validRating(U.parseRating(star ? star.getAttribute('aria-label') : t));
        if (r !== null) rateCands.push({ value: r, source: 'dom:buybox-stars', trust: 3 });
      }
      // Reviews module heading: "1,243 reviews for this item".
      const revHead = $('h1, h2, h3', $('#reviews') || undefined) || $('[data-reviews-heading]');
      const revHeadText = revHead ? C.textOf(revHead) : null;
      if (revHeadText && /reviews?\s+for\s+this/i.test(revHeadText)) {
        const m = revHeadText.match(/([0-9][0-9,.\s\u00a0\u202f]*)/);
        if (m) {
          const n = C.validCount(U.parseCount(m[1]));
          if (n !== null) revCands.push({ value: n, source: 'dom:reviews-heading', trust: 3 });
        }
      }
      // Global fallback (lowest trust, shop-context excluded).
      if (!revCands.length) {
        const near = C.numberNearStars(scope);
        if (near.value !== null) revCands.push({ value: near.value, source: near.source, trust: 1 });
      }
      if (!rateCands.length) {
        const star = $('[aria-label*="out of 5"], [aria-label*="stars"]');
        const r = star ? C.validRating(U.parseRating(star.getAttribute('aria-label'))) : null;
        if (r !== null) rateCands.push({ value: r, source: 'dom:aria-stars', trust: 1 });
      }
      const revWin = C.consensus(revCands);
      if (revWin.value !== null) set(out, 'reviews', Math.round(revWin.value), revWin.source);
      const rateWin = C.consensus(rateCands);
      if (rateWin.value !== null) set(out, 'rating', rateWin.value, rateWin.source);
    }

    // ================= SHOP =================
    {
      const shopLinks = $all('a[href*="/shop/"]', buyBox);
      const allShopLinks = shopLinks.length ? shopLinks : $all('a[href*="/shop/"]');
      for (const a of allShopLinks.slice(0, 5)) {
        const href = a.getAttribute ? a.getAttribute('href') || '' : '';
        if (/\/shop\/[^/]+\/(items|reviews|about|policies)/.test(href)) continue; // sub-page link
        const name = C.shopNameFromUrl(href.startsWith('http') ? href : `https://www.etsy.com${href}`);
        if (name && name.length <= 60 && !/\s/.test(name)) {
          set(out, 'shopName', name, 'dom:shop-link');
          set(out, 'shopUrl', `https://www.etsy.com/shop/${encodeURIComponent(name)}`, 'dom:shop-link');
          break;
        }
      }
      if (!out.shopName) {
        const ds = C.firstAttr(['[data-shop-name]', '[data-shop]'], 'data-shop-name');
        const ds2 = ds.value ? ds : C.firstAttr(['[data-shop]'], 'data-shop');
        if (ds2.value) set(out, 'shopName', String(ds2.value).trim(), ds2.source);
      }
      // Shop sales: "45,210 Sales" (scoped to shop area first).
      const shopArea = out.shopName
        ? ((allShopLinks[0] && allShopLinks[0].closest && allShopLinks[0].closest('div, section, header')) || buyBox)
        : buyBox;
      const salesCands = [];
      const scopedSales = C.scopedText(shopArea, 8000).match(/([0-9][0-9,.\s\u00a0\u202fKkMm]*)\s+sales\b/i);
      if (scopedSales) {
        const n = C.validCount(U.parseCount(scopedSales[1]));
        if (n !== null) salesCands.push({ value: n, source: 'dom:shop-area-sales', trust: 2 });
      }
      const globalSales = C.findInPageText(/([0-9][0-9,.\s\u00a0\u202fKkMm]*)\s+sales\b/i);
      if (globalSales) {
        const n = C.validCount(U.parseCount(globalSales[1]));
        if (n !== null) salesCands.push({ value: n, source: 'dom:text-sales', trust: 1 });
      }
      const salesWin = C.consensus(salesCands);
      if (salesWin.value !== null) set(out, 'shopTotalSales', Math.round(salesWin.value), salesWin.source);
      // Shop review count: "8,930 Shop Reviews" (feeds calibration).
      const shopRev = C.findInPageText(/([0-9][0-9,.\s\u00a0\u202fKkMm]*)\s+shop\s+reviews?\b/i);
      if (shopRev) {
        const n = C.validCount(U.parseCount(shopRev[1]));
        if (n !== null) set(out, 'shopReviewCount', Math.round(n), 'dom:text-shop-reviews');
      }
      const since = C.findInPageText(/on\s+etsy\s+since\s+(19|20)\d{2}/i);
      if (since) {
        const parsed = U.parseShopSince(since[0]);
        if (parsed.year) {
          set(out, 'shopSinceYear', parsed.year, 'dom:on-etsy-since');
          set(out, 'shopAgeYears', parsed.ageYears, 'dom:on-etsy-since');
        }
      }
    }

    // ================= FAVORITES / CARTS =================
    {
      const favCands = [];
      const favAttr = C.firstAttr(['[data-fav-count]', '[data-favorers-count]', '[data-favorites-count]', '.favorite-listing-button'], 'data-fav-count');
      const favAttrs = ['data-fav-count', 'data-favorers-count', 'data-favorites-count', 'data-favorite-count'];
      for (const sel of ['[data-fav-count]', '[data-favorers-count]', '[data-favorites-count]', '.favorite-listing-button']) {
        const el = $(sel);
        if (!el) continue;
        for (const at of favAttrs) {
          const raw = el.getAttribute ? el.getAttribute(at) : null;
          const n = raw !== null ? C.validCount(U.parseCount(raw)) : null;
          if (n !== null) favCands.push({ value: n, source: `dom:${sel}@${at}`, trust: 3 });
        }
        const aria = el.getAttribute ? el.getAttribute('aria-label') || '' : '';
        const am = aria.match(/([0-9][0-9,.\s]*)/);
        if (am && /favor/i.test(aria)) {
          const n = C.validCount(U.parseCount(am[1]));
          if (n !== null) favCands.push({ value: n, source: 'dom:fav-aria', trust: 2 });
        }
      }
      void favAttr;
      const favText = C.findInPageText(/([0-9][0-9,.\s\u00a0\u202f]*)\s+(?:favorites|favourites|favorers)\b/i)
        || C.findInPageText(/favorited\s+by\s+([0-9][0-9,.\s\u00a0\u202f]*)/i);
      if (favText) {
        const n = C.validCount(U.parseCount(favText[1]));
        if (n !== null) favCands.push({ value: n, source: 'dom:text-favorites', trust: 1 });
      }
      const favWin = C.consensus(favCands);
      if (favWin.value !== null) set(out, 'favorites', Math.round(favWin.value), favWin.source);
      const carts = C.findInPageText(/([0-9][0-9,.\s\u00a0\u202f]*)\s+people\s+have\s+this\s+in\s+their\s+carts?/i)
        || C.findInPageText(/in\s+([0-9][0-9,.\s\u00a0\u202f]*)\s+carts?\b/i);
      if (carts) {
        const n = C.validCount(U.parseCount(carts[1]));
        if (n !== null) set(out, 'inCarts', Math.round(n), 'dom:in-carts');
      }
    }

    // ================= CATEGORY =================
    {
      const bcNames = C.breadcrumbNames(bcLd);
      if (bcNames.length) {
        out.categoryPath = bcNames.slice(0, 6);
        set(out, 'category', bcNames[bcNames.length - 1], 'jsonld:BreadcrumbList');
      } else {
        const crumbSels = [
          'nav[aria-label*="readcrumb" i] a', 'nav[aria-label*="Breadcrumb" i] a',
          '[class*="readcrumb" i] a', 'ol[class*="crumb" i] a', 'ul[class*="crumb" i] a',
          '[data-category-path] a'
        ];
        for (const sel of crumbSels) {
          try {
            const links = $all(sel).map(a => C.textOf(a)).filter(t => t && t.length < 60);
            if (links.length >= 2) {
              out.categoryPath = links.slice(0, 6);
              set(out, 'category', links[links.length - 1], `dom:${sel}`);
              break;
            }
          } catch (e) { /* bad selector in old engines */ }
        }
        if (!out.category) {
          const cat = C.firstAttr(['[data-category]'], 'data-category');
          if (cat.value) set(out, 'category', String(cat.value).trim(), cat.source);
        }
      }
    }

    // ================= DIGITAL vs PHYSICAL =================
    {
      const t = ` ${C.bodyText(80000).toLowerCase()} `;
      const digitalSignals = [
        'digital download', 'instant download', 'digital item', 'digital file',
        'file type', 'this is a digital', 'no physical item', 'nothing will be shipped',
        'download link', 'printable wall art'
      ];
      const found = digitalSignals.filter(s => t.includes(s));
      if (found.length >= 1) set(out, 'isDigital', true, `dom:text:${found[0]}`);
      else if (/ships from|shipping &|delivery estimate|physical item|handmade.*ships/i.test(t)) {
        set(out, 'isDigital', false, 'dom:text:shipping-signals');
      }
    }

    // ================= BADGES =================
    {
      const scoped = C.scopedText(buyBox, 30000);
      const has = (re) => re.test(scoped) || re.test(C.bodyText(60000));
      if (/\bbestseller\b/i.test(scoped)) { out.isBestseller = true; hints.isBestseller = 'dom:badge-bestseller'; }
      else if (has(/\bbestseller\b/i)) { out.isBestseller = true; hints.isBestseller = 'dom:text-bestseller'; }
      if (has(/star seller/i)) { out.isStarSeller = true; hints.isStarSeller = 'dom:badge-star-seller'; }
      if (has(/popular (now|right now)|in high demand|in \d+ carts|over \d+ people/i)) {
        out.isPopular = true; hints.isPopular = 'dom:popular-signal';
      }
    }

    // ================= LISTED DATE / AGE =================
    {
      const m = C.findInPageText(/listed on\s+[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}/i)
        || C.findInPageText(/listed\s+(?:on\s+)?(\d{4}-\d{2}-\d{2})/i);
      if (m) {
        const parsed = U.parseListedDate(m[0]);
        if (parsed.date) {
          set(out, 'listedDate', parsed.date, 'dom:listed-on');
          set(out, 'listingAgeDays', parsed.ageDays, 'dom:listed-on');
        }
      }
    }

    // ================= RECENT REVIEW ACTIVITY =================
    try {
      const dates = $all('#reviews time[datetime], #reviews [data-review-date], time[datetime], [data-review-date]');
      const res = countRecentReviewDates(dates);
      if (res) {
        set(out, 'recentReviews30d', res.count30, 'dom:review-dates-sample');
        set(out, 'recentSampleSize', res.parsed, 'dom:review-dates-sample');
      }
    } catch (e) { /* optional signal */ }

    // ================= IMAGE =================
    if (!ld || !ld.image) {
      const og = C.metaContent(['og:image']);
      if (og.value) { out.image = og.value; hints.image = og.source; }
      else {
        const img = $('img[data-listing-image] img, [data-carousel] img, main img[src*="etsystatic"], main img[src]');
        const src = img && (img.getAttribute('src') || img.getAttribute('data-src'));
        if (src && /^https?:/.test(src)) { out.image = src; hints.image = 'dom:listing-image'; }
      }
    } else {
      const img = Array.isArray(ld.image) ? ld.image[0] : ld.image;
      if (typeof img === 'string') { out.image = img; hints.image = 'jsonld:image'; }
      else if (img && img.url) { out.image = img.url; hints.image = 'jsonld:image'; }
    }

    // ================= AVAILABILITY =================
    if (out.availability === 'unknown') {
      const t = C.scopedText(buyBox, 20000);
      if (/sold out/i.test(t)) out.availability = 'sold_out';
      else if (/only \d+ available|in stock|add to cart|buy it now/i.test(t)) out.availability = 'in_stock';
    }

    return out;
  }

  function cleanTitle(t) {
    if (!t) return null;
    let s = String(t).replace(/\s+/g, ' ').trim();
    s = s.replace(/\s*[|\-–]\s*Etsy\s*$/i, '').trim();
    if (s.length < 3 || s.length > 300) return null;
    if (/^(etsy|home|search|cart)$/i.test(s)) return null;
    return s;
  }

  function firstValidTitle(cands) {
    const ranked = (cands || []).filter(c => c.value).sort((a, b) => (b.trust || 0) - (a.trust || 0));
    return ranked[0] || null;
  }

  function countRecentReviewDates(dateEls) {
    if (!dateEls || !dateEls.length) return null;
    const now = Date.now();
    let count30 = 0, parsed = 0;
    const seen = new Set();
    for (const el of dateEls.slice(0, 80)) {
      const raw = (el.getAttribute && (el.getAttribute('datetime') || el.getAttribute('data-review-date') || el.textContent)) || '';
      const key = String(raw).trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const d = new Date(key);
      if (Number.isNaN(d.getTime()) || d.getTime() > now + 86400000) continue;
      parsed++;
      if (now - d.getTime() <= 30 * 86400000) count30++;
    }
    if (parsed < 3) return null; // sample too small to trust
    return { count30, parsed };
  }

  function fmtPrice(v) {
    return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function safeHref() {
    try { return (typeof location !== 'undefined' && location.href) || ''; }
    catch (e) { return ''; }
  }

  EIP.extract = EIP.extract || {};
  EIP.extract.product = { extractProduct };
})(typeof globalThis !== 'undefined' ? globalThis : this);
