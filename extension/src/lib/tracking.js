/* Etsy Insight Pro — tracking.js
 * Historical tracking: timestamped observations of saved products/shops.
 * Stored locally via storage.js. Observations are only recorded for items
 * the user explicitly saves ("Track" button) or when autoTrack visits a
 * saved item — never silently for the whole browsing history.
 *
 * Observation: { t, price, currency, reviews, rating, sales, favorites,
 *   status, rank, monthlySalesMid, demand }
 */
(function initTracking(root) {
  const EIP = root.EIP || (root.EIP = {});
  EIP.register && EIP.register('tracking');

  function pruneObservations(obs, retentionDays) {
    const cutoff = Date.now() - (retentionDays || 365) * 86400000;
    return (obs || []).filter(o => o && o.t >= cutoff).sort((a, b) => a.t - b.t).slice(-500);
  }

  function summarizeHistory(observations, days) {
    const obs = (observations || []).filter(o => o && Number.isFinite(o.t));
    if (!obs.length) return null;
    const since = Date.now() - days * 86400000;
    const window = obs.filter(o => o.t >= since);
    const first = window[0] || obs[0];
    const last = obs[obs.length - 1];
    const pct = (a, b) => {
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      if (a === 0) return b > 0 ? 100 : 0;
      return Math.round(((b - a) / Math.abs(a)) * 1000) / 10;
    };
    return {
      days, points: window.length,
      first: first.t, last: last.t,
      reviewGrowth: pct(first.reviews, last.reviews),
      reviewDelta: (Number.isFinite(first.reviews) && Number.isFinite(last.reviews)) ? last.reviews - first.reviews : null,
      priceChange: pct(first.price, last.price),
      salesDelta: (Number.isFinite(first.sales) && Number.isFinite(last.sales)) ? last.sales - first.sales : null,
      favoritesDelta: (Number.isFinite(first.favorites) && Number.isFinite(last.favorites)) ? last.favorites - first.favorites : null,
      demandDelta: (Number.isFinite(first.demand) && Number.isFinite(last.demand)) ? Math.round((last.demand - first.demand) * 10) / 10 : null,
      trend: trendOf(window.map(o => o.reviews))
    };
  }

  function trendOf(values) {
    const nums = (values || []).filter(Number.isFinite);
    if (nums.length < 2) return 'flat';
    const first = nums[0], last = nums[nums.length - 1];
    if (first === 0) return last > 0 ? 'up' : 'flat';
    const change = (last - first) / Math.abs(first);
    if (change >= 0.05) return 'up';
    if (change <= -0.05) return 'down';
    return 'flat';
  }

  function trendLabel(trend) {
    return trend === 'up' ? '↑ Increasing' : trend === 'down' ? '↓ Decreasing' : '→ Stable';
  }

  /** Estimate recent (30d) review velocity from observations, if possible. */
  function recentVelocity(observations, days) {
    const d = days || 30;
    const obs = (observations || []).filter(o => o && Number.isFinite(o.t) && Number.isFinite(o.reviews)).sort((a, b) => a.t - b.t);
    if (obs.length < 2) return null;
    const cutoff = Date.now() - d * 86400000;
    // Find earliest obs at/after cutoff, else use oldest two.
    let start = obs.find(o => o.t >= cutoff) || obs[0];
    let end = obs[obs.length - 1];
    if (end.t <= start.t) return null;
    const elapsed = (end.t - start.t) / 86400000;
    if (elapsed < 1) return null;
    const perDay = (end.reviews - start.reviews) / elapsed;
    if (!Number.isFinite(perDay) || perDay < 0) return 0;
    return Math.round(perDay * 30 * 10) / 10;
  }

  // ---- persistence helpers (async, need storage.js) ----

  async function recordProductObservation(listingId, meta, observation, settings) {
    const storage = EIP.storage;
    if (!storage) throw new Error('Storage module unavailable');
    const map = await storage.loadProducts();
    const key = String(listingId);
    const existing = map[key] || { id: key, meta: {}, observations: [], createdAt: Date.now() };
    existing.meta = { ...(existing.meta || {}), ...(meta || {}), updatedAt: Date.now() };
    existing.observations = existing.observations || [];
    const minGap = ((settings && settings.trackingMinIntervalHours) || 6) * 3600000;
    const last = existing.observations[existing.observations.length - 1];
    if (last && (observation.t - last.t) < minGap) {
      // Update the in-progress point instead of spamming.
      Object.assign(last, observation, { t: observation.t });
    } else {
      existing.observations.push(observation);
    }
    existing.observations = pruneObservations(existing.observations, settings && settings.historyRetentionDays);
    map[key] = existing;
    await storage.saveProducts(map);
    await storage.bumpObservations(1);
    return existing;
  }

  async function recordShopObservation(shopName, meta, observation, settings) {
    const storage = EIP.storage;
    if (!storage) throw new Error('Storage module unavailable');
    const map = await storage.loadShops();
    const key = String(shopName).toLowerCase();
    const existing = map[key] || { id: key, name: shopName, meta: {}, observations: [], createdAt: Date.now() };
    existing.meta = { ...(existing.meta || {}), ...(meta || {}), updatedAt: Date.now() };
    existing.observations = existing.observations || [];
    const minGap = ((settings && settings.trackingMinIntervalHours) || 6) * 3600000;
    const last = existing.observations[existing.observations.length - 1];
    if (last && (observation.t - last.t) < minGap) {
      Object.assign(last, observation, { t: observation.t });
    } else {
      existing.observations.push(observation);
    }
    existing.observations = pruneObservations(existing.observations, settings && settings.historyRetentionDays);
    map[key] = existing;
    await storage.saveShops(map);
    await storage.bumpObservations(1);
    return existing;
  }

  async function removeProduct(listingId) {
    const map = await EIP.storage.loadProducts();
    delete map[String(listingId)];
    await EIP.storage.saveProducts(map);
  }

  async function removeShop(shopName) {
    const map = await EIP.storage.loadShops();
    delete map[String(shopName).toLowerCase()];
    await EIP.storage.saveShops(map);
  }

  function buildProductObservation(extracted, computed) {
    const c = computed || {};
    return {
      t: Date.now(),
      price: numOrNull(extracted && extracted.price),
      currency: (extracted && extracted.currency) || null,
      reviews: numOrNull(extracted && extracted.reviews),
      rating: numOrNull(extracted && extracted.rating),
      sales: numOrNull(extracted && extracted.shopTotalSales),
      favorites: numOrNull(extracted && extracted.favorites),
      status: (extracted && extracted.availability) || 'unknown',
      monthlySalesMid: c.sales ? c.sales.mid : null,
      demand: c.scores ? c.scores.demand.value : null
    };
  }

  function buildShopObservation(extracted, computed) {
    const c = computed || {};
    return {
      t: Date.now(),
      sales: numOrNull(extracted && extracted.totalSales),
      reviews: numOrNull(extracted && extracted.reviewCount),
      rating: numOrNull(extracted && extracted.rating),
      listings: numOrNull(extracted && extracted.activeListings),
      avgPrice: numOrNull(extracted && extracted.avgPrice),
      monthlySalesMid: c.shopEstimate && c.shopEstimate.monthly ? c.shopEstimate.monthly.mid : null
    };
  }

  function numOrNull(v) {
    return Number.isFinite(v) ? v : null;
  }

  /**
   * Best 30-day review velocity: tracked snapshots (real observed deltas over
   * ≥7 days) beat on-page samples, which only show a handful of reviews.
   * @returns { value|null, source: 'tracked'|'page'|'none', spanDays }
   */
  function bestVelocity(history, pageRecent) {
    const obs = (history || [])
      .filter(o => o && Number.isFinite(o.t) && Number.isFinite(o.reviews))
      .sort((a, b) => a.t - b.t);
    let tracked = null;
    if (obs.length >= 2) {
      const spanDays = (obs[obs.length - 1].t - obs[0].t) / 86400000;
      const v = recentVelocity(history, 30);
      if (v !== null) tracked = { value: v, spanDays };
    }
    if (tracked && tracked.spanDays >= 7) {
      return { value: tracked.value, source: 'tracked', spanDays: Math.round(tracked.spanDays * 10) / 10 };
    }
    if (pageRecent !== null && pageRecent !== undefined && Number.isFinite(pageRecent)) {
      return { value: pageRecent, source: 'page', spanDays: 30 };
    }
    if (tracked) return { value: tracked.value, source: 'tracked', spanDays: Math.round(tracked.spanDays * 10) / 10 };
    return { value: null, source: 'none', spanDays: null };
  }

  EIP.tracking = {
    pruneObservations, summarizeHistory, trendOf, trendLabel, recentVelocity, bestVelocity,
    recordProductObservation, recordShopObservation, removeProduct, removeShop,
    buildProductObservation, buildShopObservation
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
