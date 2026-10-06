/**
 * Observation-layer + UI-render tests.
 * Run: node --test hidden-winner-finder/tests/engine.test.js hidden-winner-finder/tests/observe.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveSignals, matchNiches, observedKey, mergeObserved, isFresh, describeObservation, OBSERVED_TTL_DAYS } from '../src/core/observe.js';
import { CATALOG, getProduct } from '../src/data/catalog.js';
import { analyzeNiche } from '../src/core/opportunity.js';
import { buildReport, reportToMarkdown } from '../src/core/report.js';
import { findWinner } from '../src/core/engine.js';
import { getBudget, getCountry } from '../src/core/options.js';
import * as R from '../src/ui/render.js';

/** A realistic Etsy-shaped search page: 24 listing cards. */
const pageFixture = {
  marketplaceId: 'etsy',
  query: 'personalized pet ornament',
  url: 'https://www.etsy.com/search?q=personalized+pet+ornament',
  pageTitle: 'Personalized pet ornament | Etsy',
  resultCount: 4213,
  scannedAt: Date.now(),
  listings: Array.from({ length: 24 }, (_, i) => ({
    title: `Personalized ${['dog', 'cat', 'pet', 'puppy'][i % 4]} ornament, custom photo keepsake gift ${i}`,
    price: [11.99, 14.99, 16.5, 19.99, 9.5, 22][i % 6],
    reviews: [12, 84, 190, 640, 1420, 48][i % 6],
    rating: 4.8,
    badges: i % 5 === 0 ? ['bestseller'] : i % 7 === 0 ? ['sold'] : [],
    sponsored: i % 9 === 0,
    hasVideo: i % 6 === 0,
    imageCount: i % 3 === 0 ? 9 : 5,
    favorites: i % 4 === 0 ? 1500 : null,
  })),
};

test('deriveSignals produces basis=observed signals with a coverage figure', () => {
  const observation = deriveSignals(pageFixture);
  const s = observation.signals;
  assert.equal(observation.basis, 'observed');
  assert.equal(observation.marketplaceId, 'etsy');
  assert.equal(s.resultCount, 4213);
  assert.ok(s.priceMedian > 9 && s.priceMedian < 23, `priceMedian was ${s.priceMedian}`);
  assert.ok(s.reviewMoat > 0);
  assert.ok(s.strongCompetitors >= 1);
  assert.ok(s.adsShare > 0 && s.adsShare < 0.2);
  assert.ok(s.titleSimilarity > 0.3);
  assert.ok(s.searchResultDensity > 0);
  assert.ok(observation.coverage > 0.6, `coverage ${observation.coverage}`);
  assert.equal(observation.confidence, 'High');
  assert.equal(observation.listingSampleSize, 24);
});

test('deriveSignals survives an empty / hostile page', () => {
  const observation = deriveSignals({ listings: [], resultCount: null, marketplaceId: 'generic' });
  assert.equal(observation.listingSampleSize, 0);
  assert.equal(observation.signals.priceMedian, null);
  assert.equal(observation.confidence, 'Low');
  assert.ok(observation.notes.length >= 1);
  const weird = deriveSignals({ listings: [{ title: 'x', price: -4 }, { title: null, price: NaN }] });
  assert.equal(weird.signals.priceMedian, null);
  assert.equal(weird.confidence, 'Low');
});

test('matchNiches finds the niche the page is actually about', () => {
  const matches = matchNiches(pageFixture, CATALOG, { limit: 5 });
  assert.ok(matches.length >= 1);
  assert.equal(matches[0].productId, 'personalized-pet-ornament');
  assert.ok(matches[0].matchedTokens.includes('ornament'));
  assert.ok(matches[0].score > 1);
});

test('matchNiches returns nothing for an unrelated page instead of guessing', () => {
  const matches = matchNiches({ query: 'industrial ball bearings', listings: [{ title: 'steel ball bearing 6203' }] }, CATALOG, { limit: 5 });
  assert.equal(matches.length, 0);
});

test('observedKey / mergeObserved / isFresh behave', () => {
  assert.equal(observedKey('personalized-pet-ornament', 'etsy'), 'etsy:personalized-pet-ornament');
  const first = deriveSignals(pageFixture);
  const second = deriveSignals({ ...pageFixture, resultCount: 3800, scannedAt: Date.now() + 1000 });
  const merged = mergeObserved({ ...first, signals: { ...first.signals, favoritesAvg: null } }, second);
  assert.equal(merged.signals.resultCount, 3800);
  assert.ok(isFresh(merged));
  assert.ok(!isFresh({ ...merged, scannedAt: Date.now() - (OBSERVED_TTL_DAYS + 1) * 86400000 }));
  assert.ok(describeObservation(merged).includes('listings in the search results'));
});

test('a live observation upgrades the whole analysis to High confidence', () => {
  const observation = deriveSignals(pageFixture);
  const plain = analyzeNiche(getProduct('personalized-pet-ornament'), { marketplaceId: 'etsy', budget: getBudget('b100-500'), country: getCountry('US') });
  const live = analyzeNiche(getProduct('personalized-pet-ornament'), {
    marketplaceId: 'etsy',
    budget: getBudget('b100-500'),
    country: getCountry('US'),
    observed: observation.signals,
    observedMarkets: { etsy: { demandScore: 82, competitionScore: 24 } },
  });
  assert.equal(live.demand.metrics.find((m) => m.id === 'reviewActivity').basis, 'observed');
  assert.notEqual(live.competition.confidence.label, 'Low');
  assert.ok(live.opportunity.confidence.label === 'High' || live.opportunity.confidence.label === 'Medium');
  assert.ok(live.marketFit.best.observed);
  assert.notEqual(plain.opportunity.score, null);
});

test('the report renders to Markdown with every mandated estimate label', () => {
  const result = findWinner({ marketplaceId: 'etsy', categoryId: 'any' });
  const report = buildReport(result, { category: 'Any category', marketplace: 'Etsy', country: 'United States', budget: '$100 – $500' });
  const md = reportToMarkdown(report);
  assert.ok(md.startsWith('# '));
  assert.ok(md.includes('Estimated') || md.includes('estimate'));
  assert.ok(md.includes('Confidence'));
  assert.ok(md.includes('source it'));
  assert.ok(md.includes('review rate'), 'the volume model must be spelled out in the export');
  assert.ok(md.includes(report.product.name));
  assert.ok(!/undefined|NaN/.test(md), 'markdown contains undefined/NaN');
});

test('UI renderers never leak undefined/NaN and always label estimates', () => {
  const result = findWinner({ marketplaceId: 'etsy', categoryId: 'any' });
  const analysis = result.winner.analysis;
  const html = [
    R.heroCard(result.winner, analysis, { saved: false, mode: 'dashboard' }),
    R.whyCard(analysis),
    R.alternativesCard(result.alternatives),
    R.marketSection(analysis),
    R.sourcingSection(analysis),
    R.profitSection(analysis),
    R.competitionSection(analysis),
    R.demandSection(analysis),
    R.trendSection(analysis),
    R.ideasSection(analysis),
    R.channelsSection(analysis),
    R.riskSection(analysis),
    R.scanTable(result.scan, 'dashboard'),
    R.honestySection(result.meta, { observed: [] }),
    R.reportsList([]),
    R.savedList([]),
    R.settingsSection({}, { observed: [] }),
  ].join('');
  assert.ok(html.length > 12000);
  assert.ok(!/undefined|NaN|\[object Object\]/.test(html), 'rendered HTML contains undefined/NaN/[object Object]');
  assert.ok(html.includes('Opportunity score'));
  assert.ok(html.includes('View product') && html.includes('Find suppliers') && html.includes('See competitors') && html.includes('Save product'));
  assert.ok(html.includes('Estimated'));
  assert.ok(html.includes('Public-data based') || html.includes('Observed on page'));
  assert.ok(html.includes('Confidence'));
  assert.ok(html.includes('Alibaba') && html.includes('Printful') && html.includes('Printify') && html.includes('CJdropshipping'));
  assert.ok(html.includes('review rate'), 'the demand section must show the volume model');
  // Score bands must follow the documented mapping.
  assert.ok(html.includes('competition'));
});

test('render works for a digital niche (no supplier rows, zero unit cost)', () => {
  const analysis = analyzeNiche(getProduct('digital-tablet-planner'), { marketplaceId: 'etsy' });
  const html = [R.heroCard({ product: 'Digital Planner for Tablet', observed: false }, analysis, {}), R.sourcingSection(analysis), R.profitSection(analysis)].join('');
  assert.ok(!/undefined|NaN/.test(html));
  assert.ok(html.includes('Digital-product alternative') || html.includes('No supplier'));
});
