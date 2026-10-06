/* Etsy Insight Pro — scores.js
 * Demand / Competition / Revenue-potential / Opportunity scores (0–100).
 * Every score returns { value, label, breakdown } so the UI can show the
 * exact math. All inputs are public signals or prior estimates.
 */
(function initScores(root) {
  const EIP = root.EIP || (root.EIP = {});
  EIP.register && EIP.register('scores');

  function scoreLabel(v) {
    if (v === null || v === undefined) return 'Unknown';
    if (v >= 80) return 'Very high';
    if (v >= 60) return 'High';
    if (v >= 40) return 'Moderate';
    if (v >= 20) return 'Low';
    return 'Very low';
  }

  /**
   * Demand (0–100): how much buyer interest does the listing show?
   * Inputs: reviews, rating, favorites, recentReviews30d, isBestseller,
   * isPopular, monthlyOrdersMid, reviewGrowthPct (from tracking).
   */
  function demandScore(input) {
    const U = EIP.utils;
    const s = input || {};
    const parts = [];
    // Review volume (log scale, 0–35 pts, saturates ~2,000 reviews).
    const revPts = U.logNorm(s.reviews, 2000) * 35;
    parts.push({ name: 'Review volume', points: r1(revPts), detail: `${f(s.reviews)} reviews (log scale, max 35)` });
    // Rating quality (0–15 pts).
    let ratePts = 0;
    if (Number.isFinite(s.rating)) {
      ratePts = U.clamp((s.rating - 3.5) / 1.5, 0, 1) * 15;
      parts.push({ name: 'Rating', points: r1(ratePts), detail: `${s.rating}★ (max 15)` });
    } else parts.push({ name: 'Rating', points: 0, detail: 'rating unknown' });
    // Favorites (0–15 pts, saturates ~5,000).
    const favPts = U.logNorm(s.favorites, 5000) * 15;
    parts.push({ name: 'Favorites', points: r1(favPts), detail: `${f(s.favorites)} favorites (max 15)` });
    // Recent momentum (0–20 pts).
    let momPts = 0;
    if (Number.isFinite(s.recentReviews30d) && s.recentReviews30d > 0) {
      momPts = U.logNorm(s.recentReviews30d, 60) * 20;
      parts.push({ name: 'Recent momentum', points: r1(momPts), detail: `~${f(s.recentReviews30d)} reviews in 30 days (max 20)` });
    } else if (Number.isFinite(s.monthlyOrdersMid) && s.monthlyOrdersMid > 0) {
      momPts = U.logNorm(s.monthlyOrdersMid, 120) * 20;
      parts.push({ name: 'Recent momentum', points: r1(momPts), detail: `~${f(s.monthlyOrdersMid)} est. orders/mo (max 20)` });
    } else parts.push({ name: 'Recent momentum', points: 0, detail: 'no recent activity signal' });
    // Badges (0–10 pts).
    let badgePts = 0;
    if (s.isBestseller) badgePts += 7;
    if (s.isPopular) badgePts += 3;
    parts.push({ name: 'Popularity badges', points: badgePts, detail: s.isBestseller ? 'Bestseller visible (+7)' : (s.isPopular ? 'Popular signal (+3)' : 'none visible') });
    // Growth bonus (±5).
    let growthPts = 0;
    if (Number.isFinite(s.reviewGrowthPct)) {
      growthPts = U.clamp(s.reviewGrowthPct / 20, -1, 1) * 5;
      parts.push({ name: 'Tracked growth', points: r1(growthPts), detail: `${r1(s.reviewGrowthPct)}% review growth (±5)` });
    }
    const total = parts.reduce((a, p) => a + p.points, 0);
    const value = U.score(total);
    return {
      value, label: scoreLabel(value), max: 100, breakdown: parts,
      formula: 'Demand = review volume (35) + rating (15) + favorites (15) + momentum (20) + badges (10) + growth (±5)'
    };
  }

  /**
   * Competition (0–100, higher = MORE competitive / harder).
   * Inputs: searchResults (total), avgCompetitorReviews, pricePosition
   * ('undercut'|'mid'|'premium'), shopListings, ratingVsMarket (-1..1).
   */
  function competitionScore(input) {
    const U = EIP.utils;
    const s = input || {};
    const parts = [];
    // Result saturation (0–40 pts, saturates ~50k results).
    const satPts = U.logNorm(s.searchResults, 50000) * 40;
    parts.push({ name: 'Search saturation', points: r1(satPts), detail: `${f(s.searchResults)} competing results (max 40)` });
    // Entrenched competitors (0–30 pts, avg reviews saturates ~1,000).
    const entPts = U.logNorm(s.avgCompetitorReviews, 1000) * 30;
    parts.push({ name: 'Entrenched rivals', points: r1(entPts), detail: `avg ${f(s.avgCompetitorReviews)} rival reviews (max 30)` });
    // Price pressure (0–20 pts).
    let pricePts = 10;
    let priceDetail = 'price position unknown (10)';
    if (s.pricePosition === 'undercut') { pricePts = 16; priceDetail = 'priced above market median (16)'; }
    else if (s.pricePosition === 'mid') { pricePts = 10; priceDetail = 'priced near market median (10)'; }
    else if (s.pricePosition === 'value') { pricePts = 4; priceDetail = 'priced below market median (4)'; }
    parts.push({ name: 'Price pressure', points: pricePts, detail: priceDetail });
    // Shop scale proxy (0–10 pts).
    const scalePts = U.logNorm(s.shopListings, 500) * 10;
    parts.push({ name: 'Category depth', points: r1(scalePts), detail: `${f(s.shopListings)} listings in shop/niche (max 10)` });
    const total = parts.reduce((a, p) => a + p.points, 0);
    const value = U.score(total);
    return {
      value, label: scoreLabel(value), max: 100, breakdown: parts, higherIsWorse: true,
      formula: 'Competition = search saturation (40) + entrenched rivals (30) + price pressure (20) + category depth (10). Higher = tougher.'
    };
  }

  /**
   * Revenue potential (0–100): price × estimated monthly sales, log scale.
   * Inputs: price, monthlySalesMid, currency (display only).
   */
  function revenueScore(input) {
    const U = EIP.utils;
    const s = input || {};
    const parts = [];
    const monthlyRev = (Number.isFinite(s.price) && Number.isFinite(s.monthlySalesMid))
      ? s.price * s.monthlySalesMid : null;
    const revPts = monthlyRev !== null ? U.logNorm(monthlyRev, 20000) * 70 : 0;
    parts.push({
      name: 'Estimated monthly revenue', points: r1(revPts),
      detail: monthlyRev !== null ? `≈ ${f(monthlyRev, 0)}/mo (log scale, max 70)` : 'needs price + sales estimate'
    });
    const marginPts = Number.isFinite(s.price) ? U.logNorm(s.price, 200) * 30 : 0;
    parts.push({
      name: 'Price point', points: r1(marginPts),
      detail: Number.isFinite(s.price) ? `${f(s.price, 2)} per order (max 30)` : 'price unknown'
    });
    const value = monthlyRev !== null ? U.score(revPts + marginPts) : (Number.isFinite(s.price) ? U.score(marginPts) : 0);
    return {
      value, label: scoreLabel(value), max: 100, breakdown: parts, monthlyRevenue: monthlyRev,
      formula: 'Revenue potential = est. monthly revenue, log scale (70) + price point (30)'
    };
  }

  /**
   * Opportunity (0–100): the headline "should I look closer?" number.
   *   Opportunity = 0.45×Demand + 0.25×(100−Competition) + 0.30×Revenue
   */
  function opportunityScore(demand, competition, revenue) {
    const U = EIP.utils;
    const d = numOr(demand, 50), c = numOr(competition, 50), r = numOr(revenue, 50);
    const value = U.score(0.45 * d + 0.25 * (100 - c) + 0.30 * r);
    return {
      value, label: opportunityLabel(value), max: 100,
      breakdown: [
        { name: 'Demand', points: r1(0.45 * d), detail: `${d}/100 × 45%` },
        { name: 'Low competition', points: r1(0.25 * (100 - c)), detail: `(100−${c}) × 25%` },
        { name: 'Revenue potential', points: r1(0.30 * r), detail: `${r}/100 × 30%` }
      ],
      formula: 'Opportunity = 45% demand + 25% (100 − competition) + 30% revenue potential'
    };
  }

  function opportunityLabel(v) {
    if (v >= 75) return 'Excellent';
    if (v >= 60) return 'Good';
    if (v >= 45) return 'Moderate';
    if (v >= 30) return 'Weak';
    return 'Poor';
  }

  /** Convenience: compute all four at once. */
  function allScores(input) {
    const s = input || {};
    const demand = demandScore(s);
    const competition = competitionScore(s);
    const revenue = revenueScore(s);
    const opportunity = opportunityScore(demand.value, competition.value, revenue.value);
    return { demand, competition, revenue, opportunity };
  }

  function numOr(v, fallback) {
    if (v !== null && typeof v === 'object' && Number.isFinite(v.value)) return v.value;
    return Number.isFinite(v) ? v : fallback;
  }
  function r1(v) { return Math.round(v * 10) / 10; }
  function f(v, digits) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    return Number(v).toLocaleString('en-US', { maximumFractionDigits: digits === undefined ? 0 : digits });
  }

  EIP.scores = { demandScore, competitionScore, revenueScore, opportunityScore, allScores, scoreLabel, opportunityLabel };
})(typeof globalThis !== 'undefined' ? globalThis : this);
