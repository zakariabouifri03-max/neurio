/**
 * Engine tests - run with: node --test hidden-winner-finder/tests/
 * These cover the pure core: parsing, scoring, fusion, sourcing, reports.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePrice, parseCount, parseResultCount, parseSalesText, priceClustering, titleSimilarity, dedupeListings } from '../src/core/parse.js';
import { logScale, linearScale, shrinkToNeutral, weightedMeanDetailed } from '../src/core/metrics.js';
import { computeCompetition } from '../src/core/competition.js';
import { computeDemand, estimateNicheVolume } from '../src/core/demand.js';
import { computeTrend, trendBandFromScore, seasonalityRead } from '../src/core/trend.js';
import { analyzeNiche, compareAnalyses, OPPORTUNITY_WEIGHTS } from '../src/core/opportunity.js';
import { scanMarket, findWinner, analyzeAll } from '../src/core/engine.js';
import { buildSourcingPlan, landedUnitCost, budgetFit } from '../src/core/sourcing.js';
import { computeProfit } from '../src/core/profit.js';
import { getMarketplace, estimateFees } from '../src/data/marketplaces.js';
import { CATALOG, getProduct } from '../src/data/catalog.js';
import { buildReport, reportSummary } from '../src/core/report.js';
import { suggestPrice, buildTitles, buildKeywords } from '../src/core/ideas.js';
import { normalizeOptions, getBudget, getCountry } from '../src/core/options.js';

const petOrnament = getProduct('personalized-pet-ornament');
const sunsetLamp = getProduct('sunset-led-lamp');
const animeMat = getProduct('anime-desk-mat');

test('parsePrice handles international formats', () => {
  assert.equal(parsePrice('$14.99'), 14.99);
  assert.equal(parsePrice('US $1,299.00'), 1299);
  assert.equal(parsePrice('12,50 €'), 12.5);
  assert.equal(parsePrice('1.234,56'), 1234.56);
  assert.equal(parsePrice('Free'), null);
  assert.equal(parsePrice(''), null);
});

test('parseCount expands compact numbers', () => {
  assert.equal(parseCount('1.2k'), 1200);
  assert.equal(parseCount('3.4K reviews'), 3400);
  assert.equal(parseCount('12K+'), 12000);
  assert.equal(parseCount('1,234'), 1234);
  assert.equal(parseCount('2M'), 2000000);
});

test('parseResultCount reads search headers', () => {
  assert.equal(parseResultCount('1,482 results'), 1482);
  assert.equal(parseResultCount('1-48 of over 2,000 results'), 2000);
  assert.equal(parseResultCount('About 3,000 listings'), 3000);
  assert.equal(parseResultCount('no numbers here'), null);
});

test('parseSalesText detects badges and counts', () => {
  const sold = parseSalesText('300+ sold');
  assert.equal(sold.count, 300);
  assert.equal(sold.bestSeller, false);
  assert.equal(parseSalesText('Amazon\'s Choice').bestSeller, true);
  assert.equal(parseSalesText('nothing'), null);
});

test('statistics helpers behave', () => {
  assert.equal(priceClustering([10, 10.5, 11, 40]), 0.75);
  assert.ok(titleSimilarity(['pet ornament dog', 'pet ornament cat']) >= 0.5);
  assert.equal(dedupeListings([
    { title: 'A', price: 10 }, { title: 'A', price: 10 }, { title: 'A', price: 12 },
  ]).length, 2);
});

test('scalers are bounded', () => {
  assert.equal(logScale(0, 100, 100000, 0, 100), 0);
  assert.equal(logScale(1e9, 100, 100000, 0, 100), 100);
  assert.equal(linearScale(50, 0, 100, 0, 100), 50);
  assert.equal(Math.round(shrinkToNeutral(95, { shrinkFactor: 0.72 })), 82);
});

test('weightedMeanDetailed renormalises over present metrics', () => {
  const fused = weightedMeanDetailed([
    { id: 'a', label: 'A', value: 100, weight: 1, basis: 'observed' },
    { id: 'b', label: 'B', value: null, weight: 5, basis: 'snapshot' },
  ]);
  assert.equal(fused.value, 100);
  assert.deepEqual(fused.missing, ['B']);
});

test('competition: saturated niche scores higher than a hidden one', () => {
  const hidden = computeCompetition(petOrnament, {});
  const saturated = computeCompetition(sunsetLamp, {});
  assert.ok(hidden.score < saturated.score, `${hidden.score} should be < ${saturated.score}`);
  assert.equal(hidden.band, 'Low');
  assert.ok(['High', 'Very High'].includes(saturated.band));
});

test('observed signals override the catalog snapshot and raise confidence', () => {
  const snapshot = computeCompetition(petOrnament, {});
  const observed = computeCompetition(petOrnament, {
    resultCount: 1200,
    strongCompetitors: 1,
    reviewMoat: 40,
    listingQualityShare: 0.1,
    establishedSellerShare: 0.05,
    adsShare: 0.02,
    priceClustering: 0.2,
    titleSimilarity: 0.2,
  });
  assert.ok(observed.score < snapshot.score);
  assert.equal(observed.confidence.label, 'High');
  assert.equal(observed.metrics.find((m) => m.id === 'listingCount').basis, 'observed');
});

test('demand: volume estimate stays inside a sane band', () => {
  const volume = estimateNicheVolume(petOrnament, {}, 80);
  assert.ok(volume.nicheUnits.low >= 1);
  assert.ok(volume.nicheUnits.high > volume.nicheUnits.low);
  assert.ok(volume.nicheRevenue.high > volume.nicheRevenue.low);
  assert.ok(volume.newSellerUnits.high < volume.nicheUnits.high);
});

test('trend bands and seasonality', () => {
  assert.equal(trendBandFromScore(80).id, 'rising');
  assert.equal(trendBandFromScore(50).id, 'stable');
  assert.equal(trendBandFromScore(20).id, 'declining');
  const october = seasonalityRead([10, 11, 12], 9); // ctx month is 0-based → October
  assert.equal(october.id, 'in-season');
  assert.ok(october.adjustment > 0);
  const june = seasonalityRead([10, 11, 12], 5);
  assert.equal(june.id, 'off-season');
});

test('trend uses scan history when two snapshots exist', () => {
  const now = Date.now();
  const t = computeTrend(petOrnament, {
    history: [
      { at: now - 40 * 86400000, reviewsTop10Median: 200 },
      { at: now, reviewsTop10Median: 320 },
    ],
  });
  assert.equal(t.basis, 'observed');
  assert.equal(t.confidence, 'High');
  assert.ok(t.score >= 68);
});

test('sourcing: MOQ, cost bands and budget fit are coherent', () => {
  const familyCost = landedUnitCost(petOrnament, { costFactor: 1, shippingFactor: 1 });
  assert.ok(familyCost.landedHigh >= familyCost.landedLow);
  const plan = buildSourcingPlan(petOrnament, { price: petOrnament.price.median, feesPerUnit: 3, budget: getBudget('b0-100') });
  assert.ok(plan.rows.length >= 5);
  const pod = plan.rows.find((r) => r.id === 'printful');
  assert.ok(pod && pod.moq === 1);
  const alibaba = plan.rows.find((r) => r.id === 'alibaba');
  assert.ok(alibaba.moq >= 50);
  assert.ok(alibaba.landedCost[0] < familyCost.landedLow || alibaba.landedCost[0] <= familyCost.landedHigh);
  assert.ok(plan.recommended);
  const fit = budgetFit(petOrnament, getBudget('b0-100'), plan);
  assert.equal(typeof fit.startable, 'boolean');
});

test('profit: fees, margin and break-even are consistent', () => {
  const profit = computeProfit(petOrnament, { marketplace: getMarketplace('etsy'), price: 14.99 });
  assert.ok(profit.unit.estimatedProfit > 0);
  assert.ok(profit.unit.profitMargin > 0.3 && profit.unit.profitMargin < 0.9);
  const sum = profit.unit.productCost + profit.unit.shipping + profit.unit.fees + profit.unit.estimatedProfit;
  assert.ok(Math.abs(sum - profit.unit.sellingPrice) < 0.02);
  assert.equal(profit.priceBands.length, 3);
});

test('marketplace fees are positive and rate-based', () => {
  const fees = estimateFees(getMarketplace('etsy'), 20, { monthlyUnits: 100 });
  assert.ok(fees.total > 0 && fees.total < 20);
  const shopify = estimateFees(getMarketplace('shopify'), 20, { monthlyUnits: 10 });
  assert.ok(shopify.platform > 0);
});

test('analyzeNiche produces a complete, self-consistent analysis', () => {
  const a = analyzeNiche(petOrnament, { marketplaceId: 'etsy', budget: getBudget('b100-500'), country: getCountry('US') });
  assert.ok(a.opportunity.score >= 0 && a.opportunity.score <= 100);
  assert.ok(a.demand.score > 0 && a.competition.score >= 0 && a.trend.score > 0);
  assert.ok(a.why.length >= 5);
  assert.ok(a.ideaPack.variations.length === 5);
  assert.ok(a.ideaPack.titles.length === 5);
  assert.ok(a.ideaPack.keywords.length === 10);
  assert.ok(a.marketFit.best);
  assert.ok(a.channels.best);
  assert.ok(a.risks.risks.length >= 1);
  const weights = a.opportunity.weights;
  const total = Object.values(weights).reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test('higher risk and saturation lower the opportunity score', () => {
  const ornament = analyzeNiche(petOrnament, { marketplaceId: 'etsy' });
  const lamp = analyzeNiche(sunsetLamp, { marketplaceId: 'etsy' });
  assert.ok(ornament.opportunity.score > lamp.opportunity.score);
  assert.ok(lamp.risks.risks.length > 0);
});

test('IP risk is surfaced for the anime desk mat', () => {
  const a = analyzeNiche(animeMat, { marketplaceId: 'etsy' });
  assert.ok(a.risks.risks.some((r) => r.id === 'ip'));
  assert.ok(a.opportunity.blockers.length >= 1);
});

test('findWinner returns exactly one recommendation plus alternatives', () => {
  const result = findWinner({ marketplaceId: 'etsy', categoryId: 'any', countryId: 'US', budgetId: 'b100-500' });
  assert.ok(result.winner);
  assert.equal(typeof result.winner.product, 'string');
  assert.ok(result.scan.rows.length > 5);
  assert.ok(result.alternatives.length <= 4);
  assert.ok(result.meta.assumptions.length >= 3);
  // The runner-up must not outrank the winner.
  assert.ok(result.winner.opportunity >= (result.runnerUp?.opportunity ?? 0));
});

test('scanMarket ranks all candidates and keeps confidence per row', () => {
  const scan = scanMarket({ marketplaceId: 'etsy', categoryId: 'pet', budgetId: 'b0-100' });
  assert.ok(scan.rows.length >= 1);
  assert.equal(scan.rows[0].rank, 1);
  assert.ok(scan.rows.every((r) => r.confidence));
  const sorted = scan.rows.every((r, i, arr) => i === 0 || (arr[i - 1].opportunity ?? -1) >= (r.opportunity ?? -1));
  assert.ok(sorted);
});

test('live observed signals beat the snapshot end-to-end', () => {
  const live = {
    'plant-propagation-station': {
      resultCount: 900, strongCompetitors: 1, reviewMoat: 35, listingQualityShare: 0.12,
      establishedSellerShare: 0.08, adsShare: 0.03, priceClustering: 0.2, titleSimilarity: 0.18,
      reviewsTop10Median: 420, salesLabelsRate: 0.35, favoritesAvg: 1500, newListingShare: 0.3,
      priceMedian: 29.5, sourceMarketplace: 'etsy', scannedAt: Date.now(),
    },
  };
  const plain = scanMarket({ marketplaceId: 'etsy', categoryId: 'outdoor' });
  const observed = scanMarket({ marketplaceId: 'etsy', categoryId: 'outdoor', observedByProduct: live });
  const before = plain.rows.find((r) => r.productId === 'plant-propagation-station');
  const after = observed.rows.find((r) => r.productId === 'plant-propagation-station');
  assert.ok(after.observed);
  assert.ok(after.opportunity >= before.opportunity);
  assert.ok(after.competition < before.competition);
});

test('report is JSON-serialisable and formats to Markdown', () => {
  const result = findWinner({ marketplaceId: 'etsy', categoryId: 'home-decor' });
  const report = buildReport(result, { category: 'Home & Living', marketplace: 'Etsy' });
  const json = JSON.stringify(report);
  assert.ok(json.length > 2000);
  assert.ok(report.marketFit.best);
  assert.ok(report.sourcing.rows.length > 0);
  assert.ok(report.ideaPack.keywords.length === 10);
  const md = reportSummary(report);
  assert.ok(md.includes(report.product.name));
});

test('idea generators respond to the marketplace and price', () => {
  const etsy = buildTitles(petOrnament, { marketplaceId: 'etsy', price: 14.99 });
  const amazon = buildTitles(petOrnament, { marketplaceId: 'amazon', price: 14.99 });
  assert.equal(etsy.length, 5);
  assert.notDeepEqual(etsy.map((t) => t.title), amazon.map((t) => t.title));
  const keywords = buildKeywords(petOrnament);
  assert.equal(keywords.length, 10);
  assert.ok(keywords.every((k) => k.volumeNote.includes('not claimed')));
  const price = suggestPrice(petOrnament, { costBand: [2.1, 4.4], shippingBand: [0.9, 2.2], feeRate: 0.1 });
  assert.ok(price.entry.price < price.target.price);
  assert.ok(price.target.price < price.premium.price);
});

test('options normalize safely against corrupt input', () => {
  const normalized = normalizeOptions({ categoryId: 'nope', marketplaceId: 'nope', budgetId: 'nope', countryId: 'nope' });
  assert.deepEqual(normalized, { categoryId: 'any', marketplaceId: 'etsy', countryId: 'US', budgetId: 'b100-500' });
});

test('catalog integrity: every niche has the fields the engine needs', () => {
  for (const p of CATALOG) {
    assert.ok(p.id && p.name, 'id/name');
    assert.ok(p.price.low <= p.price.median && p.price.median <= p.price.high, `${p.id} price band`);
    assert.ok(p.ideas.keywords.length >= 10, `${p.id} keywords`);
    assert.ok(p.ideas.variations.length >= 5, `${p.id} variations`);
    assert.ok(p.ideas.angles.length >= 5, `${p.id} angles`);
    assert.ok(p.ideas.audiences.length >= 5, `${p.id} audiences`);
  }
});

test('every catalog niche can be fully analysed on every marketplace', () => {
  for (const marketplaceId of ['etsy', 'amazon', 'ebay', 'walmart', 'tiktok', 'shopify']) {
    const { analyses } = analyzeAll({ marketplaceId, categoryId: 'any' });
    for (const a of analyses) {
      assert.ok(Number.isFinite(a.opportunity.score), `${a.product.id} on ${marketplaceId}`);
      assert.ok(a.marketFit.rows.length === 6);
      assert.ok(a.sourcing.rows.length >= 1);
    }
  }
});

test('compareAnalyses is a stable, deterministic sort', () => {
  const { analyses } = analyzeAll({ marketplaceId: 'etsy' });
  const shuffled = [...analyses].reverse();
  const sorted = shuffled.sort(compareAnalyses);
  assert.deepEqual(sorted.map((a) => a.product.id), analyses.map((a) => a.product.id));
});
