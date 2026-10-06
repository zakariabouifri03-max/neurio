/**
 * competition.js - the low-competition detector.
 *
 * A niche is NOT low-competition just because it has few listings. A niche with
 * 800 listings where 4 sellers own 90% of the reviews is harder to enter than a
 * niche with 8,000 thin, un-reviewed listings. So the score is a weighted blend
 * of eight independent pressures, each scaled logarithmically where the real
 * market behaves logarithmically.
 *
 * Score reading (as specified):
 *   0-30  Low      | 31-60 Medium | 61-80 High | 81-100 Very High
 *
 * Low score = easy to enter. High score = crowded / defended.
 */

import {
  BASIS, logScale, linearScale, shareScale, clampedRatio,
  weightedMeanDetailed, metric, scoreBand, aggregateConfidence,
} from './metrics.js';

/** Signal preference: a live observed value always beats the catalog snapshot. */
export function mergeSignal(snapshotValue, observedValue, observedBasis = BASIS.OBSERVED) {
  if (Number.isFinite(observedValue)) return { value: observedValue, basis: observedBasis };
  if (Number.isFinite(snapshotValue)) return { value: snapshotValue, basis: BASIS.SNAPSHOT };
  return { value: null, basis: null };
}

export function computeCompetition(product, observed = {}) {
  const s = product?.signals || {};
  const pick = (key) => mergeSignal(s[key], observed[key]);

  const listingCount = pick('resultCount');
  const strongCompetitors = pick('strongCompetitors');
  const reviewMoat = pick('reviewMoat');
  const quality = pick('listingQualityShare');
  const established = pick('establishedSellerShare');
  const ads = pick('adsShare');
  // Price clustering is normally computed from a live scan. When we only have
  // the snapshot we can derive it from the price-spread (coefficient of
  // variation) in the catalog - a narrow spread means prices are bunched up.
  const clusteringObserved = Number.isFinite(observed.priceClustering);
  const clustering = clusteringObserved
    ? { value: observed.priceClustering, basis: BASIS.OBSERVED }
    : Number.isFinite(s.priceSpread)
      ? { value: Math.max(0.05, 1 - Math.min(1, s.priceSpread / 0.8)), basis: BASIS.SNAPSHOT }
      : { value: null, basis: null };

  // Search-result density = listings per one review of visible proof. A page of
  // 40,000 thin listings for 300 reviews is far easier to enter than 8,000
  // listings where the median seller has 900 reviews.
  const densityObserved = Number.isFinite(observed.searchResultDensity);
  const reviewMoatForDensity = Number.isFinite(observed.reviewMoat) ? observed.reviewMoat : s.reviewMoat;
  const listingCountForDensity = Number.isFinite(observed.resultCount) ? observed.resultCount : s.resultCount;
  const salesDensity = densityObserved
    ? { value: observed.searchResultDensity, basis: BASIS.OBSERVED }
    : Number.isFinite(listingCountForDensity) && Number.isFinite(reviewMoatForDensity) && reviewMoatForDensity > 0
      ? { value: listingCountForDensity / reviewMoatForDensity, basis: BASIS.SNAPSHOT }
      : { value: null, basis: null };

  const similarity = pick('titleSimilarity');
  const newShare = pick('newListingShare');

  const metrics = [
    metric({
      id: 'listingCount',
      label: 'Number of competing listings',
      value: Number.isFinite(listingCount.value)
        ? logScale(listingCount.value, 1_000, 400_000, 5, 95)
        : null,
      weight: 0.8,
      basis: listingCount.basis,
      note: Number.isFinite(listingCount.value)
        ? `${Math.round(listingCount.value).toLocaleString('en-US')} listings in the niche`
        : 'Listing count unavailable',
      evidence: { raw: listingCount.value, scale: 'log10 1,000 → 400,000' },
    }),
    metric({
      id: 'strongCompetitors',
      label: 'Number of strong competitors',
      value: Number.isFinite(strongCompetitors.value)
        ? linearScale(strongCompetitors.value, 1, 24, 5, 100)
        : null,
      weight: 1.6,
      basis: strongCompetitors.basis,
      note: Number.isFinite(strongCompetitors.value)
        ? `${strongCompetitors.value} sellers with high review counts or bestseller badges`
        : 'Strong-competitor count unavailable',
      evidence: { raw: strongCompetitors.value, scale: 'linear 1 → 24 sellers' },
    }),
    metric({
      id: 'reviewMoat',
      label: 'Review moat (median reviews of ranked listings)',
      value: Number.isFinite(reviewMoat.value)
        ? logScale(reviewMoat.value, 20, 6_000, 5, 100)
        : null,
      weight: 1.7,
      basis: reviewMoat.basis,
      note: Number.isFinite(reviewMoat.value)
        ? `Top listings show a median of ~${Math.round(reviewMoat.value).toLocaleString('en-US')} reviews`
        : 'Review counts unavailable',
      evidence: { raw: reviewMoat.value, scale: 'log10 20 → 6,000 reviews' },
    }),
    metric({
      id: 'listingQuality',
      label: 'Listing quality of competitors',
      value: Number.isFinite(quality.value) ? shareScale(quality.value, 15, 95) : null,
      weight: 0.8,
      basis: quality.basis,
      note: Number.isFinite(quality.value)
        ? `${Math.round(quality.value * 100)}% of listings look professionally built (video, 8+ photos, long titles)`
        : 'Listing quality not measurable',
      evidence: { raw: quality.value },
    }),
    metric({
      id: 'establishedSellers',
      label: 'Established sellers holding the niche',
      value: Number.isFinite(established.value) ? shareScale(established.value, 5, 95) : null,
      weight: 1.1,
      basis: established.basis,
      note: Number.isFinite(established.value)
        ? `${Math.round(established.value * 100)}% of listings belong to sellers with hundreds of reviews`
        : 'Seller tenure not observable publicly',
      evidence: { raw: established.value },
    }),
    metric({
      id: 'adPressure',
      label: 'Paid-ad pressure',
      value: Number.isFinite(ads.value) ? shareScale(ads.value, 0, 100) : null,
      weight: 1.2,
      basis: ads.basis,
      note: Number.isFinite(ads.value)
        ? `${Math.round(ads.value * 100)}% of the search results page is sponsored inventory`
        : 'Ad density unavailable',
      evidence: { raw: ads.value },
    }),
    metric({
      id: 'priceCompetition',
      label: 'Price competition',
      value: Number.isFinite(clustering.value) ? shareScale(clustering.value, 10, 95) : null,
      weight: 0.7,
      basis: clustering.basis,
      note: Number.isFinite(clustering.value)
        ? `${Math.round(clustering.value * 100)}% of listings sit within ±15% of the median price (${clusteringObserved ? 'observed' : 'derived from the snapshot price spread'})`
        : 'Price spread unavailable',
      evidence: { raw: clustering.value },
    }),
    metric({
      id: 'productSimilarity',
      label: 'Product similarity between listings',
      value: Number.isFinite(similarity.value) ? linearScale(similarity.value, 0.15, 0.8, 10, 95) : null,
      weight: 0.6,
      basis: similarity.basis,
      note: Number.isFinite(similarity.value)
        ? `Title overlap index ${similarity.value.toFixed(2)} - ${similarity.value > 0.55 ? 'listings are near copies of each other' : 'sellers are differentiated'}`
        : 'Similarity not computed',
      evidence: { raw: similarity.value },
    }),
    metric({
      id: 'searchResultDensity',
      label: 'Search-result density',
      value: Number.isFinite(salesDensity.value)
        ? logScale(salesDensity.value, 3, 300, 80, 20)
        : null,
      weight: 0.6,
      basis: salesDensity.basis,
      note: Number.isFinite(salesDensity.value)
        ? `${Math.round(salesDensity.value)} listings for every review of visible proof - ${salesDensity.value > 60 ? 'mostly thin, easily outranked listings' : 'a page where the average listing has real proof behind it'}`
        : 'Density not measurable',
      evidence: { raw: salesDensity.value, scale: 'log10 3 → 300 listings per review, inverted' },
    }),
  ];

  const fused = weightedMeanDetailed(metrics);
  let value = fused.value;

  // Fresh listing turnover softens the score: new listings prove the niche is
  // still enterable (marketplaces rotate their ranking constantly).
  if (Number.isFinite(value) && Number.isFinite(newShare.value)) {
    const churnRelief = clampedRatio(newShare.value, 0.35) * 12; // up to 12 points easier
    value = Math.max(0, value - churnRelief);
  }

  const score = Number.isFinite(value) ? Math.round(value) : null;
  const confidence = aggregateConfidence(metrics);

  return {
    id: 'competition',
    score,
    band: scoreBand(score, 'competition'),
    label: score == null ? 'Unknown' : scoreBand(score, 'competition'),
    metrics,
    contributors: fused.contributors,
    missing: fused.missing,
    confidence,
    higherIsWorse: true,
    summary: buildSummary(score, metrics),
    note: 'Low score = easy to enter. Built from listing density, review moats, ad pressure, seller tenure, price clustering and listing similarity.',
  };
}

function buildSummary(score, metrics) {
  if (!Number.isFinite(score)) return 'Not enough public signal to judge competition for this niche.';
  const push = metrics
    .filter((m) => Number.isFinite(m.value))
    .map((m) => ({ ...m, pressure: (m.value / 100) * m.weight }))
    .sort((a, b) => b.pressure - a.pressure);
  const top = push.slice(0, 2).map((m) => m.label.toLowerCase());
  const band = scoreBand(score, 'competition');
  const driver = top.length ? ` Main pressure comes from: ${top.join(' and ')}.` : '';
  return `${band} competition (${score}/100).${driver}`;
}
