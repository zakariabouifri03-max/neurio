/**
 * Storage, scoring-band and error-handling tests.
 * Run: node --test tests/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import * as store from '../src/core/storage.js';
import { scoreBand, CONFIDENCE, shrinkToNeutral, aggregateConfidence, BASIS, basisConfidence } from '../src/core/metrics.js';
import { findWinner } from '../src/core/engine.js';
import { buildReport } from '../src/core/report.js';
import { MAX_REPORTS, pruneReports } from '../src/core/storage.js';

test('storage round-trips through the memory/local fallback', async () => {
  await store.clearAll();
  await store.set('probe', { a: 1 });
  assert.deepEqual(await store.get('probe'), { a: 1 });
  const patched = await store.patch('probe', (current) => ({ ...current, b: 2 }), {});
  assert.deepEqual(patched, { a: 1, b: 2 });
  await store.remove('probe');
  assert.equal(await store.get('probe', 'gone'), 'gone');
  await store.clearAll();
});

test('concurrent patches do not clobber each other', async () => {
  await store.clearAll();
  await Promise.all(Array.from({ length: 12 }, (_, i) => store.patch('counter', (list) => [...(list || []), i], [])));
  const value = await store.get('counter', []);
  assert.equal(value.length, 12);
  assert.equal(new Set(value).size, 12);
  await store.clearAll();
});

test('reports are saved, pruned and exportable', async () => {
  await store.clearAll();
  const result = findWinner({ marketplaceId: 'etsy', categoryId: 'any' });
  const report = buildReport(result, { category: 'Any', marketplace: 'Etsy' });
  await store.saveReport(report);
  const reports = await store.listReports();
  assert.equal(reports.length, 1);
  assert.equal(reports[0].product.name, report.product.name);
  assert.equal(pruneReports([...Array(MAX_REPORTS + 6)].map((_, i) => ({ createdAt: i }))).length, MAX_REPORTS);
  const backup = await store.exportAll();
  assert.equal(backup.app, 'hidden-winner-finder');
  await store.clearAll();
  await store.importAll(backup);
  assert.equal((await store.listReports()).length, 1);
  const bad = await store.importAll({ foo: 'bar' }).then(() => null).catch((e) => e);
  assert.equal(bad?.code, 'BAD_IMPORT');
  await store.clearAll();
});

test('saved products toggle cleanly', async () => {
  await store.clearAll();
  await store.toggleSaved({ productId: 'x', name: 'X', score: 90 });
  assert.equal((await store.getSaved()).length, 1);
  await store.toggleSaved({ productId: 'x', name: 'X', score: 90 });
  assert.equal((await store.getSaved()).length, 0);
  await store.clearAll();
});

test('stats accumulate and never go backwards on a fresh install', async () => {
  await store.clearAll();
  await store.bumpStat('scans');
  await store.bumpStat('scans');
  await store.bumpStat('winnerFinds');
  const stats = await store.get(store.STORAGE_KEYS.STATS, {});
  assert.equal(stats.scans, 2);
  assert.equal(stats.winnerFinds, 1);
  assert.ok(stats.lastScanAt > 0);
  await store.clearAll();
});

test('competition bands follow the documented mapping exactly', () => {
  assert.equal(scoreBand(0, 'competition'), 'Low');
  assert.equal(scoreBand(30, 'competition'), 'Low');
  assert.equal(scoreBand(31, 'competition'), 'Medium');
  assert.equal(scoreBand(60, 'competition'), 'Medium');
  assert.equal(scoreBand(61, 'competition'), 'High');
  assert.equal(scoreBand(80, 'competition'), 'High');
  assert.equal(scoreBand(81, 'competition'), 'Very High');
  assert.equal(scoreBand(100, 'competition'), 'Very High');
  // Non-competition metrics use the opportunity vocabulary.
  assert.equal(scoreBand(95), 'Excellent');
  assert.equal(scoreBand(72), 'Strong');
  assert.equal(scoreBand(20), 'Poor');
});

test('confidence shrinkage pulls weak-evidence scores toward neutral', () => {
  const high = shrinkToNeutral(90, CONFIDENCE.High);
  const medium = shrinkToNeutral(90, CONFIDENCE.Medium);
  const low = shrinkToNeutral(90, CONFIDENCE.Low);
  assert.ok(high > medium && medium > low, `${high} > ${medium} > ${low}`);
  assert.equal(low, 81.2);
  // A 50 score is neutral for every confidence level.
  assert.equal(shrinkToNeutral(50, CONFIDENCE.Low), 50);
});

test('basis maps to the right confidence label', () => {
  assert.equal(basisConfidence(BASIS.OBSERVED).id, 'High');
  assert.equal(basisConfidence(BASIS.SNAPSHOT).id, 'Medium');
  assert.equal(basisConfidence(BASIS.MODELLED).id, 'Low');
  assert.equal(aggregateConfidence([
    { confidence: CONFIDENCE.Medium, weight: 3 },
    { confidence: CONFIDENCE.Low, weight: 1 },
  ]).id, 'Medium');
});

test('the engine never throws on hostile options', () => {
  const weird = [
    {},
    { marketplaceId: null, categoryId: '../../etc', budgetId: 42, countryId: {} },
    { marketplaceId: 'etsy', categoryId: 'digital', budgetId: 'b0-100' },
    { marketplaceId: 'shopify', categoryId: 'sports', budgetId: 'b1500-plus' },
  ];
  for (const options of weird) {
    const result = findWinner(options);
    assert.ok(result.winner, `no winner for ${JSON.stringify(options)}`);
    assert.ok(Number.isFinite(result.winner.opportunity));
    assert.ok(result.winner.product);
  }
});

test('every recommendation carries an honest label trail', () => {
  const result = findWinner({ marketplaceId: 'etsy' });
  const report = buildReport(result, {});
  assert.ok(report.confidence.overall);
  assert.ok(['High', 'Medium', 'Low'].includes(report.confidence.overall));
  assert.ok(report.opportunity.adjustments.items !== undefined);
  assert.ok(report.demand.volume.model.includes('review rate'));
  assert.ok(report.meta.assumptions.some((a) => /not claimed|never counted|inferred/i.test(a)));
  for (const row of report.sourcing.rows) {
    assert.equal(row.confidence, 'Low', 'supplier costs must stay low-confidence estimates');
    assert.ok(row.dueDiligence.includes('Verify'));
  }
});
