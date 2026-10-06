/**
 * demand.js - the demand detector.
 *
 * Demand is judged from publicly observable marketplace signals only:
 * review activity (the most reliable public proxy for sales), sales/bestseller
 * labels, favourites when the page exposes them, search-result depth, listing
 * growth, recent activity and trend movement. Nothing here claims to be exact
 * order volume - the estimates are explicitly derived and labelled.
 */

import {
  BASIS, logScale, linearScale, clampedRatio,
  weightedMeanDetailed, metric, scoreBand, aggregateConfidence,
} from './metrics.js';
import { REVIEW_TO_SALES_BAND } from '../data/taxonomy.js';

export function computeDemand(product, observed = {}, trendScore = null, marketplaceFit = 1) {
  const s = product?.signals || {};
  const pick = (key) => {
    if (Number.isFinite(observed?.[key])) return { value: observed[key], basis: BASIS.OBSERVED };
    if (Number.isFinite(s[key])) return { value: s[key], basis: BASIS.SNAPSHOT };
    return { value: null, basis: null };
  };

  const reviews = pick('reviewsTop10Median');
  const salesLabels = pick('salesLabelsRate');
  const favorites = pick('favoritesAvg');
  const resultCount = pick('resultCount');
  const newShare = pick('newListingShare');
  const recent = pick('recentActivityShare');

  const trendValue = Number.isFinite(trendScore) ? trendScore : null;

  const metrics = [
    metric({
      id: 'reviewActivity',
      label: 'Review activity on ranked listings',
      value: Number.isFinite(reviews.value) ? logScale(reviews.value, 3, 1_200, 35, 100) : null,
      weight: 1.5,
      basis: reviews.basis,
      note: Number.isFinite(reviews.value)
        ? `Top listings show a median of ~${Math.round(reviews.value).toLocaleString('en-US')} reviews - buyers are actively reviewing this product`
        : 'Review counts unavailable for this niche',
      evidence: { raw: reviews.value, scale: 'log10 3 → 1,200 reviews' },
    }),
    metric({
      id: 'salesSignals',
      label: 'Sales signals on the search page',
      value: Number.isFinite(salesLabels.value) ? linearScale(salesLabels.value, 0.02, 0.5, 15, 100) : null,
      weight: 1.3,
      basis: salesLabels.basis,
      note: Number.isFinite(salesLabels.value)
        ? `${Math.round(salesLabels.value * 100)}% of indexed listings carry a "sold", "bestseller" or popularity badge`
        : 'No public sales labels available',
      evidence: { raw: salesLabels.value },
    }),
    metric({
      id: 'favorites',
      label: 'Favourites / wishlist activity',
      value: Number.isFinite(favorites.value) ? logScale(favorites.value, 80, 4_000, 25, 100) : null,
      weight: 0.8,
      basis: favorites.basis,
      note: Number.isFinite(favorites.value)
        ? `Listings average ~${Math.round(favorites.value).toLocaleString('en-US')} favourites where the marketplace shows them publicly`
        : 'Favourites are not published for most listings',
      evidence: { raw: favorites.value },
    }),
    metric({
      id: 'marketDepth',
      label: 'Search-result depth',
      value: Number.isFinite(resultCount.value) ? logScale(resultCount.value, 500, 150_000, 30, 100) : null,
      weight: 0.7,
      basis: resultCount.basis,
      note: Number.isFinite(resultCount.value)
        ? `${Math.round(resultCount.value).toLocaleString('en-US')} listings means the marketplace keeps this niche well stocked`
        : 'Result depth unknown',
      evidence: { raw: resultCount.value },
    }),
    metric({
      id: 'listingGrowth',
      label: 'New-listing growth',
      value: Number.isFinite(newShare.value) ? linearScale(newShare.value, 0.05, 0.4, 20, 100) : null,
      weight: 0.9,
      basis: newShare.basis,
      note: Number.isFinite(newShare.value)
        ? `${Math.round(newShare.value * 100)}% of ranked listings are recent - sellers keep adding inventory`
        : 'Listing age not observable on this marketplace',
      evidence: { raw: newShare.value },
    }),
    metric({
      id: 'recentActivity',
      label: 'Recent buyer activity',
      value: Number.isFinite(recent.value) ? linearScale(recent.value, 0.05, 0.6, 15, 100) : null,
      weight: 0.8,
      basis: recent.basis,
      note: Number.isFinite(recent.value)
        ? `${Math.round(recent.value * 100)}% of listings show reviews or popularity badges from the last 90 days`
        : 'Recent-activity share not available publicly',
      evidence: { raw: recent.value },
    }),
    metric({
      id: 'trendMomentum',
      label: 'Trend momentum',
      value: trendValue,
      weight: 1.1,
      basis: BASIS.SNAPSHOT,
      note: Number.isFinite(trendValue)
        ? `Interest momentum scores ${Math.round(trendValue)}/100 over the last 90 days`
        : 'No trend data',
      evidence: { raw: trendValue },
    }),
  ];

  const fused = weightedMeanDetailed(metrics);
  let value = fused.value;

  // A niche that only works on one marketplace carries marketplace risk, so the
  // demand score is scaled by how well the niche fits the selected marketplace.
  if (Number.isFinite(value) && Number.isFinite(marketplaceFit) && marketplaceFit < 1) {
    value = value - (1 - marketplaceFit) * 12;
  }

  const score = Number.isFinite(value) ? Math.round(Math.max(0, Math.min(100, value))) : null;
  const confidence = aggregateConfidence(metrics);

  return {
    id: 'demand',
    score,
    label: scoreBand(score),
    metrics,
    contributors: fused.contributors,
    missing: fused.missing,
    confidence,
    reasons: buildReasons(metrics, score),
    volume: estimateNicheVolume(product, observed, trendValue),
    note: 'Demand is inferred from review activity, public sales labels, favourites, listing growth and trend - never from private analytics.',
  };
}

/**
 * Estimate how many units the whole niche appears to absorb per month.
 *
 * Model (deliberately conservative and fully disclosed in the UI):
 *   monthlyReviews ≈ medianReviews / assumed listing lifetime (18 months)
 *   monthlyUnits   ≈ monthlyReviews / reviewRate, reviewRate ∈ [2%, 8%]
 *   the top-ranked listings are assumed to take the bulk of that volume, so the
 *   niche figure is scaled by a concentration factor rather than multiplied up.
 */
export function estimateNicheVolume(product, observed = {}, trendScore = null) {
  const reviewsRaw = Number.isFinite(observed.reviewsTop10Median)
    ? observed.reviewsTop10Median
    : product?.signals?.reviewsTop10Median;
  const basis = Number.isFinite(observed.reviewsTop10Median) ? BASIS.OBSERVED : BASIS.SNAPSHOT;
  if (!Number.isFinite(reviewsRaw) || reviewsRaw <= 0) return null;

  const lifetimeMonths = 18;
  const monthlyReviews = reviewsRaw / lifetimeMonths;
  const low = monthlyReviews / REVIEW_TO_SALES_BAND.high; // 8% review rate → fewer sales
  const high = monthlyReviews / REVIEW_TO_SALES_BAND.low; // 2% review rate → more sales
  const concentration = 0.55; // share of niche volume a ranked cluster represents
  let lo = low * concentration;
  let hi = high * concentration;

  if (Number.isFinite(trendScore)) {
    const momentum = 0.85 + (trendScore / 100) * 0.5; // 0.85x (declining) → 1.35x (rising)
    lo *= momentum;
    hi *= momentum;
  }

  const price = product?.price || {};
  const avgPrice = Number.isFinite(price.median) ? price.median : null;
  const units = {
    low: Math.max(1, Math.round(lo)),
    high: Math.max(2, Math.round(hi)),
    basis,
    confidence: basis === BASIS.OBSERVED ? 'Medium' : 'Low',
    model: `median reviews ÷ ${lifetimeMonths}-month listing life ÷ ${REVIEW_TO_SALES_BAND.low * 100}-${REVIEW_TO_SALES_BAND.high * 100}% review rate × ${concentration} concentration`,
  };
  const revenue = avgPrice
    ? { low: Math.round(units.low * avgPrice), high: Math.round(units.high * avgPrice) }
    : null;

  // Realistic share for a brand-new seller with a strong listing and no history.
  const newSellerShare = { low: 0.02, high: 0.06 };
  const sellerUnits = {
    low: Math.max(1, Math.round(units.low * newSellerShare.low)),
    high: Math.max(2, Math.round(units.high * newSellerShare.high)),
  };
  const sellerRevenue = avgPrice
    ? { low: Math.round(sellerUnits.low * avgPrice), high: Math.round(sellerUnits.high * avgPrice) }
    : null;

  return {
    nicheUnits: units,
    nicheRevenue: revenue,
    newSellerUnits: sellerUnits,
    newSellerRevenue: sellerRevenue,
    avgPrice,
    // Mirrored at the top level so every consumer (report, markdown, UI) can
    // print the model and its confidence without reaching into nicheUnits.
    model: units.model,
    confidence: units.confidence,
    basis: units.basis,
  };
}

function buildReasons(metrics, score) {
  const usable = metrics.filter((m) => Number.isFinite(m.value));
  const strong = usable.filter((m) => m.value >= 65).sort((a, b) => b.value - a.value);
  const weak = usable.filter((m) => m.value < 45).sort((a, b) => a.value - b.value);
  const out = [];
  for (const m of strong.slice(0, 3)) out.push({ tone: 'positive', text: m.note });
  if (strong.length) out.push({ tone: 'positive', text: `Composite demand score of ${score}/100 across ${usable.length} public signals.` });
  for (const m of weak.slice(0, 2)) out.push({ tone: 'caution', text: m.note });
  if (!out.length) out.push({ tone: 'neutral', text: 'Demand signals are mixed - treat this niche as unproven.' });
  return out;
}

/** Marketplace-fit multiplier used to nudge demand for the chosen marketplace. */
export function marketplaceFit(product, marketplaceId) {
  const fit = product?.markets?.[marketplaceId];
  if (Number.isFinite(fit)) return fit;
  const tags = product?.tags || [];
  // Fall back to tag affinity from the marketplace definition.
  const affinity = {
    etsy: ['personalized', 'handmade', 'digital-download', 'gifts', 'decor', 'jewelry', 'seasonal', 'memorial'],
    amazon: ['utility', 'repeat-purchase', 'kit', 'consumer-goods', 'home', 'pet', 'problem-solving'],
    ebay: ['collectible', 'bundle', 'parts', 'utility', 'late-saturation'],
    walmart: ['household', 'bulk', 'utility', 'seasonal', 'problem-solving'],
    tiktok: ['novelty', 'viral-gadget', 'demo-able', 'beauty', 'low-price', 'stocking-filler'],
    shopify: ['premium', 'brandable', 'marketing-driven', 'subculture', 'emotional'],
  }[marketplaceId] || [];
  if (!affinity.length) return 0.9;
  const overlap = tags.filter((t) => affinity.includes(t)).length;
  return Math.min(1, 0.78 + overlap * 0.06);
}
