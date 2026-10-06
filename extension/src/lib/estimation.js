/* Etsy Insight Pro — estimation.js
 * Transparent sales / views / revenue estimation engine.
 *
 * PHILOSOPHY
 * Etsy does not publish exact per-listing sales or views for competitor
 * listings, so every derived metric is an ESTIMATE presented as a range
 * with a confidence level (High / Medium / Low) and a human-readable
 * explanation ("How was this estimated?"). Estimates are NEVER presented
 * as verified data.
 *
 * CORE MODEL (documented in ALGORITHM.md and in the UI)
 *   monthlyReviews  = recentReviews30d (if observed) else
 *                     listingReviews / max(listingAgeMonths, 1)
 *   monthlyOrders   = monthlyReviews / reviewRate
 *   monthlySalesLo/Hi = monthlyOrders × sensitivity.low/high
 *
 * Shop calibration: when shop lifetime sales AND shop review count are
 * both known, the implied shop review rate (shopReviews / shopSales)
 * nudges the assumed reviewRate toward the observed value (50/50 blend,
 * clamped to 5%–50%). This grounds the estimate in verified shop data.
 *
 * Views: monthlyViews = monthlyOrders / conversionRate, optionally
 * cross-checked against favorites × viewsPerFavorite. Trend comes from
 * locally stored observations (tracking.js).
 */
(function initEstimation(root) {
  const EIP = root.EIP || (root.EIP = {});
  EIP.register && EIP.register('estimation');
  const U = () => EIP.utils;
  const S = () => EIP.settings;

  function defaultSettings() {
    const d = S() && S().DEFAULTS;
    return { ...(d || { reviewRate: 0.15, sensitivity: 'balanced', conversionRate: 0.02, viewsPerFavorite: 25, currency: 'USD' }) };
  }

  function sensitivityFactors(name) {
    const table = (S() && S().SENSITIVITY_FACTORS) || {};
    return table[name] || table.balanced || { low: 0.75, high: 1.6, label: 'Balanced' };
  }

  /**
   * @param {object} signals Publicly observable inputs. All optional.
   *   listingReviews, recentReviews30d, listingAgeDays, favorites,
   *   shopSales, shopReviews, shopListings, price, currency,
   *   historyPoints (number of stored observations), hasRecentActivity
   * @param {object} settings Sanitized settings (reviewRate, sensitivity…)
   * @returns {object} Estimate with ranges, confidence and explanation.
   */
  function estimateMonthlySales(signals, settings) {
    const u = U();
    const s = { ...defaultSettings(), ...(settings || {}) };
    const sig = signals || {};
    const factors = sensitivityFactors(s.sensitivity);
    const steps = [];

    const listingReviews = num(sig.listingReviews);
    const recent30 = num(sig.recentReviews30d);
    const ageDays = num(sig.listingAgeDays);
    const ageMonths = ageDays !== null ? Math.max(ageDays / 30.44, 0.25) : null;

    // 1. Monthly review velocity.
    let monthlyReviews = null;
    let velocitySource = 'none';
    if (recent30 !== null && sig.hasRecentActivity !== false) {
      monthlyReviews = recent30;
      velocitySource = 'recent';
      steps.push(`Recent review velocity: ~${fmt(recent30)} reviews in the last 30 days (observed on-page).`);
    } else if (listingReviews !== null && ageMonths !== null) {
      monthlyReviews = listingReviews / ageMonths;
      velocitySource = 'lifetime';
      steps.push(`Lifetime review velocity: ${fmt(listingReviews)} reviews ÷ ${fmt(ageMonths, 1)} months ≈ ${fmt(monthlyReviews, 1)} reviews/month.`);
    } else if (listingReviews !== null) {
      // No age: assume a 12-month amortisation and flag low confidence.
      monthlyReviews = listingReviews / 12;
      velocitySource = 'lifetime-assumed-age';
      steps.push(`Listing age unknown — amortised ${fmt(listingReviews)} reviews over an assumed 12 months ≈ ${fmt(monthlyReviews, 1)} reviews/month.`);
    }

    // 2. Effective review rate (with shop calibration).
    let reviewRate = s.reviewRate;
    let calibrationNote = `Assumed review rate: ${(s.reviewRate * 100).toFixed(0)}% of orders leave a review (adjustable in Settings).`;
    const shopSales = num(sig.shopSales);
    const shopReviews = num(sig.shopReviews);
    let calibrated = false;
    if (shopSales !== null && shopReviews !== null && shopSales > 0 && shopReviews > 0) {
      const implied = shopReviews / shopSales;
      if (implied >= 0.02 && implied <= 0.6) {
        const blended = (reviewRate + u.clamp(implied, 0.05, 0.5)) / 2;
        calibrationNote = `Review rate calibrated with verified shop data: shop shows ${fmt(shopReviews)} reviews / ${fmt(shopSales)} sales ` +
          `(implied ${(implied * 100).toFixed(1)}%), blended with your assumption to ${(blended * 100).toFixed(1)}%.`;
        reviewRate = blended;
        calibrated = true;
      }
    }
    steps.push(calibrationNote);

    // 3. Monthly orders → range.
    let monthly = null;
    if (monthlyReviews !== null && monthlyReviews > 0 && reviewRate > 0) {
      monthly = monthlyReviews / reviewRate;
      steps.push(`Estimated orders: ${fmt(monthlyReviews, 1)} reviews/month ÷ ${(reviewRate * 100).toFixed(1)}% ≈ ${fmt(monthly, 1)} orders/month (midpoint).`);
    } else if (monthlyReviews === 0 || listingReviews === 0) {
      monthly = 0;
      steps.push('No reviews observed — estimated sales are at or near zero. Any real sales would raise this over time.');
    }

    let lo = null, hi = null, mid = null;
    if (monthly !== null) {
      mid = monthly;
      lo = Math.max(0, monthly * factors.low);
      hi = Math.max(lo, monthly * factors.high);
      steps.push(`Range uses “${factors.label}” sensitivity: midpoint × ${factors.low} … × ${factors.high} → ${fmt(lo, 0)}–${fmt(hi, 0)}/month.`);
    }

    // 4. Favorites sanity check (soft signal only).
    const favorites = num(sig.favorites);
    if (favorites !== null && favorites > 0 && monthly !== null && monthly > 0) {
      const favPerOrder = favorites / Math.max(monthly * 6, 1); // ~6 months of orders
      if (favPerOrder > 25) {
        steps.push(`Note: favorites (${fmt(favorites)}) look high vs. estimated orders — the listing may get gift/shortlist traffic that converts later.`);
      }
    } else if (favorites !== null && favorites > 0 && (monthly === null || monthly === 0)) {
      // Favorites-only fallback: extremely rough.
      const fallbackMonthly = favorites / 60; // ~60 favorites per monthly order
      mid = fallbackMonthly; lo = fallbackMonthly * 0.5; hi = fallbackMonthly * 2;
      steps.push(`No review signal, so this is a favorites-only fallback (≈1 monthly order per 60 favorites). Treat as very rough.`);
    }

    // 5. Confidence.
    const evidence = [];
    if (velocitySource === 'recent') evidence.push('recent review activity observed');
    if (ageDays !== null) evidence.push('listing age known');
    if (calibrated) evidence.push('shop-level calibration available');
    if (favorites !== null) evidence.push('favorites visible');
    if ((sig.historyPoints || 0) >= 3) evidence.push(`${sig.historyPoints} tracked observations`);
    if ((sig.historyPoints || 0) >= 1 && (sig.historyPoints || 0) < 3) evidence.push('limited history');
    let confidence = 'Low';
    let confidenceScore = 0;
    if (velocitySource === 'recent') confidenceScore += 2;
    else if (velocitySource === 'lifetime') confidenceScore += 1;
    if (ageDays !== null) confidenceScore += 1;
    if (calibrated) confidenceScore += 1;
    if ((sig.historyPoints || 0) >= 3) confidenceScore += 1;
    else if ((sig.historyPoints || 0) >= 1) confidenceScore += 0.5;
    if (favorites !== null) confidenceScore += 0.5;
    if (mid === null) confidenceScore = 0;
    if (confidenceScore >= 4) confidence = 'High';
    else if (confidenceScore >= 2) confidence = 'Medium';

    return {
      kind: 'monthly-sales',
      mid: round1(mid), low: round1(lo), high: round1(hi),
      daily: mid === null ? null : { low: round1(lo / 30.44), mid: round1(mid / 30.44), high: round1(hi / 30.44) },
      weekly: mid === null ? null : { low: round1(lo / 4.345), mid: round1(mid / 4.345), high: round1(hi / 4.345) },
      inputs: {
        listingReviews, recentReviews30d: recent30, listingAgeDays: ageDays,
        reviewRate: round4(reviewRate), calibrated, favorites,
        shopSales, shopReviews, sensitivity: s.sensitivity, velocitySource
      },
      confidence,
      confidenceScore,
      evidence,
      steps,
      disclaimer: 'Estimated from public signals — not exact Etsy data. See “How was this estimated?”.'
    };
  }

  /** Revenue = sales range × price. Price should be the verified listing price. */
  function estimateRevenue(salesEstimate, price, currency) {
    const p = num(price);
    if (!salesEstimate || salesEstimate.mid === null || p === null) {
      return {
        kind: 'revenue', monthly: null, yearly: null, price: p, currency: currency || null,
        confidence: salesEstimate ? salesEstimate.confidence : 'Low',
        steps: ['Revenue needs a verified price and a sales estimate — at least one is missing.'],
        disclaimer: 'Estimated revenue = estimated sales × visible price.'
      };
    }
    const m = (x) => (x === null ? null : Math.round(x * p * 100) / 100);
    const monthly = { low: m(salesEstimate.low), mid: m(salesEstimate.mid), high: m(salesEstimate.high) };
    return {
      kind: 'revenue',
      monthly,
      yearly: { low: monthly.low !== null ? Math.round(monthly.low * 12) : null, mid: monthly.mid !== null ? Math.round(monthly.mid * 12) : null, high: monthly.high !== null ? Math.round(monthly.high * 12) : null },
      price: p, currency: currency || null,
      confidence: salesEstimate.confidence,
      steps: [
        `Monthly revenue ≈ estimated sales (${fmt(salesEstimate.low, 0)}–${fmt(salesEstimate.high, 0)}) × visible price.`,
        `Yearly revenue ≈ monthly × 12 (assumes stable demand — seasonal listings will vary).`
      ],
      disclaimer: 'Estimated revenue = estimated sales × visible price.'
    };
  }

  /**
   * View estimation. Etsy rarely exposes competitor views, so this converts
   * estimated orders back through an assumed conversion rate and optionally
   * cross-checks with favorites.
   */
  function estimateViews(signals, settings) {
    const u = U();
    const s = { ...defaultSettings(), ...(settings || {}) };
    const sig = signals || {};
    const steps = [];
    const factors = sensitivityFactors(s.sensitivity);

    if (num(sig.exactViews) !== null) {
      const v = num(sig.exactViews);
      return {
        kind: 'views', exact: true, mid: v, low: v, high: v,
        daily: { low: v, mid: v, high: v },
        confidence: 'High', confidenceScore: 5, evidence: ['exact views published on page'],
        steps: ['Exact view count was published on the page — shown as verified data.'],
        disclaimer: ''
      };
    }

    const monthlyOrdersMid = num(sig.monthlyOrdersMid);
    const monthlyOrdersLo = num(sig.monthlyOrdersLo);
    const monthlyOrdersHi = num(sig.monthlyOrdersHi);
    const conv = s.conversionRate;
    let mid = null, lo = null, hi = null;
    if (monthlyOrdersMid !== null && monthlyOrdersMid > 0) {
      mid = monthlyOrdersMid / conv;
      lo = (monthlyOrdersLo !== null ? monthlyOrdersLo : monthlyOrdersMid * factors.low) / conv;
      hi = (monthlyOrdersHi !== null ? monthlyOrdersHi : monthlyOrdersMid * factors.high) / conv;
      steps.push(`Views ≈ orders ÷ conversion rate: ${fmt(monthlyOrdersMid, 1)} orders ÷ ${(conv * 100).toFixed(1)}% ≈ ${fmt(mid, 0)} views/month.`);
    }
    const favorites = num(sig.favorites);
    if (mid === null && favorites !== null && favorites > 0) {
      mid = favorites * s.viewsPerFavorite;
      lo = mid * 0.5; hi = mid * 2;
      steps.push(`No order signal — fallback: ${fmt(favorites)} favorites × ${s.viewsPerFavorite} assumed views each ≈ ${fmt(mid, 0)} views/month (rough).`);
    }
    if (mid !== null && sig.isBestseller) {
      mid *= 1.15; hi = (hi !== null ? hi : mid) * 1.15; lo = lo !== null ? lo : mid * factors.low;
      steps.push('Bestseller badge visible — applied a +15% visibility uplift.');
    }
    if (mid !== null && sig.isPopular) {
      mid *= 1.08;
      steps.push('“Popular now” signal visible — applied a +8% visibility uplift.');
    }

    let confidence = 'Low', confidenceScore = 0;
    const evidence = [];
    if (monthlyOrdersMid !== null) { confidenceScore += 2; evidence.push('order estimate available'); }
    if (favorites !== null) { confidenceScore += 0.5; evidence.push('favorites visible'); }
    if ((sig.historyPoints || 0) >= 3) { confidenceScore += 1; evidence.push(`${sig.historyPoints} tracked observations`); }
    if (confidenceScore >= 3.5) confidence = 'High';
    else if (confidenceScore >= 2) confidence = 'Medium';

    const toDaily = (x) => (x === null ? null : round1(x / 30.44));
    const toWeekly = (x) => (x === null ? null : round1(x / 4.345));
    return {
      kind: 'views', exact: false,
      mid: round1(mid), low: round1(lo), high: round1(hi),
      daily: mid === null ? null : { low: toDaily(lo), mid: toDaily(mid), high: toDaily(hi) },
      weekly: mid === null ? null : { low: toWeekly(lo), mid: toWeekly(mid), high: toWeekly(hi) },
      confidence, confidenceScore, evidence,
      steps: steps.length ? steps : ['Not enough public signal to estimate views.'],
      disclaimer: 'Estimated from order estimates and engagement signals — Etsy does not publish competitor views.'
    };
  }

  /** Shop-level roll-up: sum listing estimates or derive from shop velocity. */
  function estimateShopMonthly(listingEstimates, shopSignals, settings) {
    const steps = [];
    let lo = 0, mid = 0, hi = 0, counted = 0, missing = 0;
    for (const e of listingEstimates || []) {
      if (e && e.mid !== null && Number.isFinite(e.mid)) { lo += e.low || 0; mid += e.mid; hi += e.high || 0; counted++; }
      else missing++;
    }
    const sig = shopSignals || {};
    const avgPrice = num(sig.avgPrice);
    steps.push(`Summed ${counted} listing-level estimates${missing ? ` (${missing} listings had no usable signal)` : ''}.`);
    if (!counted) {
      return {
        kind: 'shop-monthly', monthly: null, revenue: null, counted: 0,
        confidence: 'Low', steps: ['No listing-level signals available for this shop.'], evidence: [],
        disclaimer: 'Estimated from public signals.'
      };
    }
    const monthly = { low: round1(lo), mid: round1(mid), high: round1(hi) };
    let revenue = null;
    if (avgPrice !== null) {
      revenue = {
        low: Math.round(lo * avgPrice), mid: Math.round(mid * avgPrice),
        high: Math.round(hi * avgPrice), currency: sig.currency || null, avgPrice
      };
      steps.push(`Revenue ≈ summed sales × average listing price (${avgPrice}).`);
    }
    const coverage = counted / Math.max(1, (sig.totalListings || counted));
    const confidence = coverage >= 0.8 && counted >= 10 ? 'Medium' : 'Low';
    if (sig.totalListings && counted < sig.totalListings) {
      steps.push(`Only ${counted} of ${sig.totalListings} listings were visible — true shop sales are likely higher.`);
    }
    return {
      kind: 'shop-monthly', monthly, revenue, counted,
      perListing: { low: round1(lo / counted), mid: round1(mid / counted), high: round1(hi / counted) },
      confidence, steps, evidence: [`${counted} listings analysed`],
      disclaimer: 'Estimated from visible listings only — private/unlisted sales are not included.'
    };
  }

  // ---- small helpers ----
  function num(v) {
    if (v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  function round1(v) { return v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10) / 10; }
  function round4(v) { return v === null || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000; }
  function fmt(v, digits) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    const d = digits === undefined ? (Math.abs(v) >= 100 ? 0 : 1) : digits;
    return Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  }

  EIP.estimation = {
    estimateMonthlySales, estimateRevenue, estimateViews, estimateShopMonthly,
    sensitivityFactors, defaultSettings
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
