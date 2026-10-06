/**
 * observe.js - turns a raw page scan into observed signals + a niche match.
 *
 * Deliberately DOM-free: the injected scanner (src/content/scanner.src.js) only
 * extracts {title, price, reviews, rating, badges, sponsored, hasVideo,
 * imageCount} per listing and the page's own result count. Everything numeric is
 * derived HERE, which means the derivation is unit-tested in Node instead of
 * being trusted to a regex inside a content script.
 *
 * Signals produced here all carry basis = 'observed' → High confidence.
 */

import { BASIS } from './metrics.js';
import {
  parsePrice, median, mean, priceClustering, coefficientOfVariation,
  titleSimilarity, dedupeListings, qualityShare, tokenize,
} from './parse.js';

export const OBSERVED_TTL_DAYS = 30;

/** Derive every competition/demand signal the detectors can use. */
export function deriveSignals(scan) {
  const listings = dedupeListings((scan?.listings || []).filter((l) => l && (l.title || Number.isFinite(l.price))));
  const prices = listings.map((l) => l.price).filter((p) => Number.isFinite(p) && p > 0);
  const reviews = listings.map((l) => l.reviews).filter((r) => Number.isFinite(r) && r >= 0);
  const favorites = listings.map((l) => l.favorites).filter((f) => Number.isFinite(f) && f > 0);

  const reviewMedian = median(reviews);
  const resultCount = Number.isFinite(scan?.resultCount) ? scan.resultCount : null;

  const badges = listings.map((l) => (l.badges || []).join(' ').toLowerCase());
  const salesLabelListings = badges.filter((b) => /sold|bestseller|best seller|bought|popular|trending|amazon'?s choice|choice/.test(b)).length;

  const strongCompetitors = countStrongCompetitors(listings);
  const established = reviewMedian == null ? null
    : listings.filter((l) => Number.isFinite(l.reviews) && l.reviews >= Math.max(200, reviewMedian * 1.5)).length / listings.length;

  const adsShare = listings.length
    ? listings.filter((l) => l.sponsored).length / listings.length
    : null;

  const clustering = priceClustering(prices, 0.15);
  const similarity = titleSimilarity(listings.map((l) => l.title).filter(Boolean));
  const spread = coefficientOfVariation(prices);

  const signals = {
    // competition inputs
    resultCount,
    strongCompetitors,
    reviewMoat: reviewMedian,
    listingQualityShare: qualityShare(listings.map((l) => ({
      hasVideo: l.hasVideo,
      imageCount: l.imageCount,
      titleLength: (l.title || '').length,
      rating: l.rating,
    }))),
    establishedSellerShare: established,
    adsShare,
    priceClustering: clustering,
    titleSimilarity: similarity,
    priceSpread: spread,
    searchResultDensity: Number.isFinite(resultCount) && Number.isFinite(reviewMedian) && reviewMedian > 0
      ? resultCount / reviewMedian
      : null,
    // demand inputs
    reviewsTop10Median: reviewMedian,
    salesLabelsRate: listings.length ? salesLabelListings / listings.length : null,
    favoritesAvg: favorites.length ? mean(favorites) : null,
    // price
    priceMedian: median(prices),
    priceLow: prices.length ? Math.min(...prices) : null,
    priceHigh: prices.length ? Math.max(...prices) : null,
    newListingShare: null, // marketplaces rarely expose listing age publicly
    recentActivityShare: null,
  };

  const observables = [
    'resultCount', 'strongCompetitors', 'reviewMoat', 'listingQualityShare',
    'establishedSellerShare', 'adsShare', 'priceClustering', 'titleSimilarity',
    'searchResultDensity', 'reviewsTop10Median', 'salesLabelsRate', 'favoritesAvg', 'priceMedian',
  ];
  const present = observables.filter((k) => Number.isFinite(signals[k]));
  // A page with a handful of cards cannot support Medium confidence, no matter
  // how many of those numbers happen to be readable.
  const enoughSample = listings.length >= 5;

  return {
    marketplaceId: scan?.marketplaceId || null,
    query: scan?.query || '',
    url: scan?.url || '',
    pageTitle: scan?.pageTitle || '',
    scannedAt: Number.isFinite(scan?.scannedAt) ? scan.scannedAt : Date.now(),
    listingSampleSize: listings.length,
    listings: listings.slice(0, 60),
    signals,
    observedFields: present,
    coverage: present.length / observables.length,
    basis: BASIS.OBSERVED,
    confidence: !enoughSample ? 'Low' : present.length >= 7 ? 'High' : present.length >= 4 ? 'Medium' : 'Low',
    notes: buildNotes(scan, listings, present),
  };
}

function countStrongCompetitors(listings) {
  // "Strong" = a listing with hundreds of reviews, a bestseller badge, or an
  // editorial badge. These are the listings a newcomer cannot outrank quickly.
  return listings.filter((l) => {
    const badgeText = (l.badges || []).join(' ').toLowerCase();
    if (/(bestseller|best seller|amazon'?s choice|top rated|#1)/.test(badgeText)) return true;
    return Number.isFinite(l.reviews) && l.reviews >= 500;
  }).length;
}

function buildNotes(scan, listings, present) {
  const notes = [];
  if (!listings.length) notes.push('No product cards were found on this page - open a search results page and try again.');
  if (listings.length < 5) notes.push(`Only ${listings.length} product card(s) could be read - too small a sample for Medium confidence.`);
  else if (present.length < 5) notes.push('Only a few signals could be read from this page, so the numbers stay at low confidence.');
  if (Number.isFinite(scan?.resultCount)) notes.push(`Page reported ${scan.resultCount.toLocaleString('en-US')} results for this search.`);
  return notes;
}

/**
 * Match a scanned page to the catalog niches it evidences.
 * Uses token overlap between the search query/listings and each niche's
 * keyword set - never a network call, never a guess at sales numbers.
 */
export function matchNiches(scan, catalog, { limit = 5 } = {}) {
  const queryTokens = new Set(tokenize(scan?.query || scan?.pageTitle || ''));
  const listingTokens = new Set();
  for (const listing of (scan?.listings || []).slice(0, 40)) {
    for (const token of tokenize(listing.title)) listingTokens.add(token);
  }

  const results = catalog.map((product) => {
    const seeds = new Set();
    for (const keyword of product.ideas?.keywords || []) {
      for (const token of tokenize(keyword)) seeds.add(token);
    }
    for (const token of tokenize(`${product.name} ${(product.ideas?.variations || []).join(' ')}`)) seeds.add(token);
    if (!seeds.size) return { productId: product.id, score: 0, matchedTokens: [] };

    const matchedTokens = [...seeds].filter((t) => queryTokens.has(t) || listingTokens.has(t));
    const queryHits = [...seeds].filter((t) => queryTokens.has(t)).length;
    const weighted = matchedTokens.length + queryHits * 1.5;
    const score = weighted / Math.sqrt(seeds.size);
    return { productId: product.id, name: product.name, score, matchedTokens, queryHits };
  }).sort((a, b) => b.score - a.score);

  return results.slice(0, limit).filter((r) => r.score > 0.35);
}

/** Storage key for one niche on one marketplace. */
export const observedKey = (productId, marketplaceId) => `${marketplaceId}:${productId}`;

/** Merge newly observed signals over stored ones (never downgrade to fewer fields). */
export function mergeObserved(previous, next) {
  if (!previous) return next;
  const merged = { ...previous, ...next, signals: { ...previous.signals, ...stripNulls(next.signals) } };
  merged.observedFields = Object.keys(merged.signals).filter((k) => Number.isFinite(merged.signals[k]));
  merged.coverage = merged.observedFields.length / 13;
  return merged;
}

const stripNulls = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => Number.isFinite(v)));

/** Expire stale observations so the UI can tell the user what is fresh. */
export function isFresh(observation, days = OBSERVED_TTL_DAYS, now = Date.now()) {
  if (!observation?.scannedAt) return false;
  return now - observation.scannedAt <= days * 86_400_000;
}

/** Plain-language summary of what a scan observed (shown in the UI). */
export function describeObservation(observation) {
  if (!observation) return 'No live page observed yet for this niche.';
  const s = observation.signals || {};
  const bits = [];
  if (Number.isFinite(s.resultCount)) bits.push(`${s.resultCount.toLocaleString('en-US')} listings in the search results`);
  if (Number.isFinite(s.priceMedian)) bits.push(`median price $${s.priceMedian.toFixed(2)}`);
  if (Number.isFinite(s.reviewMoat)) bits.push(`median ${Math.round(s.reviewMoat).toLocaleString('en-US')} reviews on the top listings`);
  if (Number.isFinite(s.strongCompetitors)) bits.push(`${s.strongCompetitors} strong competitors`);
  if (Number.isFinite(s.adsShare)) bits.push(`${Math.round(s.adsShare * 100)}% sponsored slots`);
  return bits.length
    ? `Observed on ${observation.query || observation.pageTitle || 'the scanned page'}: ${bits.join(', ')}.`
    : 'The scanned page did not expose usable signals.';
}
