/* Etsy Insight Pro — content/extractors/product.js
 * Extracts VERIFIED (visible on-page) data from an Etsy listing page.
 * Never invents values: every field is either observed or null.
 */
(function initProductExtractor(root) {
  const EIP = root.EIP || (root.EIP = {});
  EIP.register && EIP.register('extract-product');

  function extractProduct(doc) {
    const C = EIP.extract.common;
    const U = EIP.utils;
    const scope = doc || (typeof document !== 'undefined' ? document : null);
    const hints = {}; // field → source string (transparency + debugging)
    const set = (obj, key, value, source) => { obj[key] = value; if (source) hints[key] = source; };
    const out = {
      pageType: 'product', url: safeHref(), extractedAt: Date.now(),
      listingId: null, title: null, price: null, currency: null,
      reviews: null, rating: null, shopName: null, shopUrl: null,
      shopTotalSales: null, shopReviewCount: null, shopSinceYear: null, shopAgeYears: null,
      favorites: null, inCarts: null, category: null, categoryPath: [],
      isDigital: null, isBestseller: false, isPopular: false, isStarSeller: false,
      availability: 'unknown', listedDate: null, listingAgeDays: null,
      recentReviews30d: null, image: null, _hints: hints
    };
    if (!scope) return out;

    const $ = (s) => C.$(s, scope);
    const $all = (s) => C.$all(s, scope);

    out.listingId = C.listingIdFromUrl(out.url);

    // ---- JSON-LD first (most stable) ----
    let ld = null;
    try {
      ld = C.findProductJsonLd(C.parseJsonLd());
    } catch (e) { ld = null; }
    if (ld) {
      if (ld.name && !out.title) set(out, 'title', String(ld.name).trim(), 'jsonld:Product.name');
      const offers = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
      if (offers) {
        if (offers.price !== undefined && offers.price !== null) {
          const p = parseFloat(offers.price);
          if (Number.isFinite(p)) set(out, 'price', p, 'jsonld:offers.price');
        }
        if (offers.priceCurrency) set(out, 'currency', String(offers.priceCurrency).toUpperCase(), 'jsonld:offers.priceCurrency');
        if (offers.availability && /instock/i.test(String(offers.availability))) out.availability = 'in_stock';
      }
      const agg = ld.aggregateRating;
      if (agg) {
        const rc = U.parseCount(agg.reviewCount);
        if (rc !== null) set(out, 'reviews', rc, 'jsonld:aggregateRating.reviewCount');
        const rv = U.parseRating(agg.ratingValue);
        if (rv !== null) set(out, 'rating', rv, 'jsonld:aggregateRating.ratingValue');
      }
      if (ld.image && !out.image) {
        const img = Array.isArray(ld.image) ? ld.image[0] : ld.image;
        if (typeof img === 'string') out.image = img;
        else if (img && img.url) out.image = img.url;
      }
    }

    // ---- Title ----
    if (!out.title) {
      const t = C.firstText([
        'h1[data-buy-box-listing-title]', 'h1.wt-text-body-03', 'h1.wt-text-title-03',
        '[data-listing-title] h1', 'main h1', 'h1'
      ], scope);
      if (t.value) set(out, 'title', t.value, t.source);
      else {
        const og = C.metaContent(['og:title']);
        if (og.value) set(out, 'title', og.value.split('|')[0].trim(), og.source);
      }
    }

    // ---- Price / currency ----
    if (out.price === null) {
      const priceSel = [
        '[data-buy-box-listing-price] .currency-value', '[data-buy-box-listing-price]',
        'p.wt-text-title-03.price', '.listing-page-price .currency-value',
        '[data-test-id="price"]', '.wt-text-title-03'
      ];
      for (const sel of priceSel) {
        const el = $(sel);
        const txt = C.textOf(el);
        if (!txt) continue;
        const parsed = U.parsePrice(txt);
        if (parsed.value !== null && parsed.value > 0 && parsed.value < 10000000) {
          set(out, 'price', parsed.value, `dom:${sel}`);
          if (!out.currency && parsed.currencyGuess) set(out, 'currency', parsed.currencyGuess, `dom:${sel}:symbol`);
          // data-currency attribute if present.
          try {
            const cur = el.closest && el.closest('[data-currency]');
            if (cur && cur.dataset.currency && !hints.currency) set(out, 'currency', String(cur.dataset.currency).toUpperCase(), 'dom:data-currency');
          } catch (e) { /* ignore */ }
          break;
        }
      }
      if (out.price === null) {
        const og = C.metaContent(['product:price:amount', 'og:price:amount']);
        if (og.value) {
          const p = parseFloat(og.value);
          if (Number.isFinite(p)) set(out, 'price', p, og.source);
        }
      }
    }
    if (!out.currency) {
      const cur = C.metaContent(['product:price:currency', 'og:price:currency']);
      if (cur.value) set(out, 'currency', String(cur.value).toUpperCase(), cur.source);
      else {
        const attr = C.firstAttr(['[data-currency]', 'body'], 'data-currency', scope);
        if (attr.value) set(out, 'currency', String(attr.value).toUpperCase(), attr.source);
      }
    }

    // ---- Reviews + rating ----
    if (out.reviews === null || out.rating === null) {
      // aria-label star inputs like "4.8 out of 5 stars".
      const starEls = $all('[aria-label*="out of 5"], [aria-label*="stars"]');
      for (const el of starEls.slice(0, 20)) {
        const label = el.getAttribute && el.getAttribute('aria-label');
        const r = U.parseRating(label);
        if (r !== null && out.rating === null) set(out, 'rating', r, 'dom:aria-stars');
        const wrap = (C.textOf(el.closest && el.closest('a, div, span')) || '');
        const m = wrap.match(/\(([0-9][0-9,.\sKkMm]*)\)/);
        if (m && out.reviews === null) {
          const n = U.parseCount(m[1]);
          if (n !== null) set(out, 'reviews', n, 'dom:stars-parens');
        }
      }
      if (out.reviews === null) {
        const near = C.numberNearStars(scope);
        if (near.value !== null) set(out, 'reviews', near.value, near.source);
      }
      // "1,234 reviews" text fallback.
      if (out.reviews === null) {
        const m = C.findInPageText(/([0-9][0-9,.\s\u00a0]*)\s+reviews?\b/i);
        if (m) {
          const n = U.parseCount(m[1]);
          if (n !== null && n < 10000000) set(out, 'reviews', n, 'dom:text-reviews');
        }
      }
    }

    // ---- Shop ----
    const shopLink = $('a[href*="/shop/"][href]:not([href*="/listing/"])');
    if (shopLink) {
      const href = shopLink.getAttribute('href') || '';
      const name = C.shopNameFromUrl(href.startsWith('http') ? href : `https://www.etsy.com${href}`);
      if (name && !out.shopName) {
        set(out, 'shopName', name, 'dom:shop-link');
        set(out, 'shopUrl', href.startsWith('http') ? href.split('?')[0] : `https://www.etsy.com/shop/${encodeURIComponent(name)}`, 'dom:shop-link');
      }
      // Shop link text sometimes includes sales: "ShopName | 12,345 Sales".
    }
    if (!out.shopName) {
      const ds = C.firstAttr(['[data-shop-name]'], 'data-shop-name', scope);
      if (ds.value) set(out, 'shopName', ds.value, ds.source);
    }
    // "12,345 Sales" near shop header.
    {
      const m = C.findInPageText(/([0-9][0-9,.\s\u00a0\u202f]*)\s+Sales\b/);
      if (m) {
        const n = U.parseCount(m[1]);
        if (n !== null && n < 100000000) set(out, 'shopTotalSales', Math.round(n), 'dom:text-sales');
      }
    }
    // "On Etsy since 2016".
    {
      const m = C.findInPageText(/On Etsy since\s+(19|20)\d{2}/i);
      if (m) {
        const parsed = U.parseShopSince(m[0]);
        if (parsed.year) {
          set(out, 'shopSinceYear', parsed.year, 'dom:on-etsy-since');
          set(out, 'shopAgeYears', parsed.ageYears, 'dom:on-etsy-since');
        }
      }
    }

    // ---- Favorites / carts ----
    {
      const m = C.findInPageText(/([0-9][0-9,.\s\u00a0]*)\s+people have this in their carts?/i);
      if (m) {
        const n = U.parseCount(m[1]);
        if (n !== null) set(out, 'inCarts', Math.round(n), 'dom:in-carts');
      }
      const fav = C.firstAttr(['[data-fav-count]', '[data-favorers-count]'], 'data-fav-count', scope);
      const favNum = fav.value !== null ? U.parseCount(fav.value) : null;
      if (favNum !== null) set(out, 'favorites', Math.round(favNum), fav.source);
      else {
        const fm = C.findInPageText(/([0-9][0-9,.\s\u00a0]*)\s+(?:favorites|favourites|favorers|hearts)\b/i);
        if (fm) {
          const n = U.parseCount(fm[1]);
          if (n !== null) set(out, 'favorites', Math.round(n), 'dom:text-favorites');
        }
      }
    }

    // ---- Category breadcrumbs ----
    {
      const crumbs = $all('nav[aria-label*="breadcrumb" i] a, .breadcrumb a, [data-category] a, ol.wt-breadcrumbs a');
      const path = crumbs.map(a => C.textOf(a)).filter(Boolean).slice(0, 6);
      if (path.length) {
        out.categoryPath = path;
        set(out, 'category', path[path.length - 1], 'dom:breadcrumbs');
      } else {
        const cat = C.firstAttr(['[data-category]'], 'data-category', scope);
        if (cat.value) set(out, 'category', cat.value, cat.source);
      }
    }

    // ---- Digital vs physical ----
    {
      const t = C.bodyText(60000).toLowerCase();
      const digitalSignals = ['digital download', 'instant download', 'digital item', 'digital file', 'file type', 'this is a digital'];
      const found = digitalSignals.filter(s => t.includes(s));
      if (found.length >= 1) set(out, 'isDigital', true, `dom:text:${found[0]}`);
      else {
        const ships = /ships from|shipping|delivery|physical item/i.test(t);
        if (ships) set(out, 'isDigital', false, 'dom:text:shipping-signals');
      }
    }

    // ---- Badges ----
    {
      const t = C.bodyText(80000);
      if (/\bBestseller\b/.test(t)) { out.isBestseller = true; hints.isBestseller = 'dom:badge-bestseller'; }
      if (/Popular (Now|Right Now)|In \d+ carts|Over \d+ people have/i.test(t)) { out.isPopular = true; hints.isPopular = 'dom:popular-signal'; }
      if (/Star Seller/.test(t)) { out.isStarSeller = true; hints.isStarSeller = 'dom:badge-star-seller'; }
    }

    // ---- Listed date / age ----
    {
      const m = C.findInPageText(/Listed on\s+[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}/);
      if (m) {
        const parsed = U.parseListedDate(m[0]);
        if (parsed.date) {
          set(out, 'listedDate', parsed.date, 'dom:listed-on');
          set(out, 'listingAgeDays', parsed.ageDays, 'dom:listed-on');
        }
      }
    }

    // ---- Recent review activity (best effort from visible review dates) ----
    try {
      out.recentReviews30d = estimateRecentReviews($all('[data-review-date], time[datetime]'));
    } catch (e) { out.recentReviews30d = null; }

    // ---- Image ----
    if (!out.image) {
      const og = C.metaContent(['og:image']);
      if (og.value) { out.image = og.value; hints.image = og.source; }
    }

    // ---- Availability ----
    {
      const t = C.bodyText(40000);
      if (/Sold out/i.test(t)) out.availability = 'sold_out';
      else if (/Only \d+ available|In stock|Add to cart/i.test(t)) out.availability = 'in_stock';
    }

    return out;
  }

  function estimateRecentReviews(dateEls) {
    if (!dateEls || !dateEls.length) return null;
    const now = Date.now();
    let count30 = 0, parsed = 0;
    for (const el of dateEls.slice(0, 60)) {
      const raw = (el.getAttribute && (el.getAttribute('datetime') || el.getAttribute('data-review-date') || el.textContent)) || '';
      const d = new Date(String(raw).trim());
      if (Number.isNaN(d.getTime())) continue;
      parsed++;
      if (now - d.getTime() <= 30 * 86400000) count30++;
    }
    if (!parsed) return null;
    // Scale: visible reviews are a sample; only report when the sample is meaningful.
    if (parsed < 3) return null;
    return count30;
  }

  function safeHref() {
    try { return (typeof location !== 'undefined' && location.href) || ''; }
    catch (e) { return ''; }
  }

  EIP.extract = EIP.extract || {};
  EIP.extract.product = { extractProduct };
})(typeof globalThis !== 'undefined' ? globalThis : this);
