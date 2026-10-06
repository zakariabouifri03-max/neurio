/**
 * service-worker.js - the extension's brain (MV3, module service worker).
 *
 * Responsibilities:
 *   • own the message contract between the UI and the analysis engine
 *   • inject the page scanner on demand (activeTab / optional host permission)
 *   • store observed signals + a rolling history so trend can become *observed*
 *   • keep defaults, context menu, keyboard shortcut and badge in sync
 *
 * It never performs network requests: the extension has no remote endpoint.
 */

import { findWinner, scanMarket, analyzeOne } from '../core/engine.js';
import { buildReport } from '../core/report.js';
import { normalizeOptions, optionLabels } from '../core/options.js';
import { CATALOG } from '../data/catalog.js';
import { deriveSignals, observedKey, matchNiches, isFresh, describeObservation } from '../core/observe.js';
import * as store from '../core/storage.js';

const VERSION = chrome.runtime.getManifest().version;
const SCANNER_FILE = 'src/content/scanner.js';
const DASHBOARD_URL = 'src/ui/dashboard.html';

/* ─────────────────────────── lifecycle ─────────────────────────── */

chrome.runtime.onInstalled.addListener(async (details) => {
  await store.patch(store.STORAGE_KEYS.STATS, (stats) => ({
    scans: stats?.scans || 0,
    winnerFinds: stats?.winnerFinds || 0,
    firstRunAt: stats?.firstRunAt || Date.now(),
    lastScanAt: stats?.lastScanAt || null,
  }), store.DEFAULTS[store.STORAGE_KEYS.STATS]);

  chrome.contextMenus.create({
    id: 'hwf-scan-page',
    title: 'Scan this page for hidden winners',
    contexts: ['page'],
    documentUrlPatterns: ['http://*/*', 'https://*/*'],
  });

  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL(`${DASHBOARD_URL}?welcome=1`) });
  }
});

chrome.runtime.onStartup?.addListener(() => { /* nothing to restore: storage is the state */ });

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'hwf-scan-page' || !tab?.id) return;
  try {
    const result = await scanTab(tab.id);
    await store.set('lastScanSummary', {
      at: Date.now(),
      marketplaceId: result.observation.marketplaceId,
      query: result.observation.query,
      matches: result.matches.slice(0, 3),
      summary: describeObservation(result.observation),
    });
    await chrome.tabs.create({ url: chrome.runtime.getURL(`${DASHBOARD_URL}?scan=1`) });
  } catch (error) {
    console.warn('[HWF] context-menu scan failed:', error?.message);
  }
});

chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== 'scan-market') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await scanTab(tab.id);
  } catch (error) {
    console.warn('[HWF] shortcut scan failed:', error?.message);
  }
});

/* ─────────────────────────── messaging ─────────────────────────── */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((payload) => sendResponse({ ok: true, ...payload }))
    .catch((error) => {
      console.warn('[HWF] message failed:', message?.type, error);
      sendResponse({
        ok: false,
        error: {
          code: error?.code || 'INTERNAL',
          message: error?.message || 'Something went wrong inside the extension.',
          hint: hintFor(error),
        },
      });
    });
  return true; // async response
});

function hintFor(error) {
  switch (error?.code) {
    case 'INJECTION_BLOCKED':
      return 'Open a normal marketplace search page (not a chrome:// or PDF tab), or grant access to marketplaces from the dashboard.';
    case 'NO_DATA':
      return 'Run a scan on a search results page first, then try FIND MY WINNING PRODUCT again.';
    case 'STORAGE_FULL':
      return 'Clear old reports from the dashboard to free up storage.';
    default:
      return null;
  }
}

async function handleMessage(message = {}, sender) {
  switch (message.type) {
    case 'ping':
      return { version: VERSION, catalog: CATALOG.length };

    case 'getState': {
      const state = await store.getAll();
      const observed = state[store.STORAGE_KEYS.OBSERVED] || {};
      return {
        version: VERSION,
        options: normalizeOptions(state[store.STORAGE_KEYS.OPTIONS]),
        labels: optionLabels(state[store.STORAGE_KEYS.OPTIONS]),
        saved: state[store.STORAGE_KEYS.SAVED] || [],
        stats: state[store.STORAGE_KEYS.STATS] || {},
        settings: state[store.STORAGE_KEYS.SETTINGS] || {},
        reports: (state[store.STORAGE_KEYS.REPORTS] || []).map(summariseReport),
        observed: summariseObserved(observed),
        lastResult: state[store.STORAGE_KEYS.LAST_RESULT] || null,
      };
    }

    case 'setOptions': {
      const options = normalizeOptions(message.options);
      await store.setOptions(options);
      return { options, labels: optionLabels(options) };
    }

    case 'findWinner': {
      const options = normalizeOptions(message.options || (await store.getOptions()));
      const observedMap = await buildObservedMap(options.marketplaceId);
      const historyMap = await buildHistoryMap(options.marketplaceId);
      const result = findWinner({
        ...options,
        observedByProduct: observedMap,
        historyByProduct: historyMap,
      });
      const report = buildReport(result, optionLabels(options));
      if (report) await store.saveReport(report);
      await store.set(store.STORAGE_KEYS.LAST_RESULT, report);
      await store.bumpStat('winnerFinds');
      await setBadge(result.winner?.opportunity);
      return { result: slimResult(result), report };
    }

    case 'scanMarket': {
      const options = normalizeOptions(message.options || (await store.getOptions()));
      const observedMap = await buildObservedMap(options.marketplaceId);
      const historyMap = await buildHistoryMap(options.marketplaceId);
      const scan = scanMarket({
        ...options,
        observedByProduct: observedMap,
        historyByProduct: historyMap,
      });
      await store.bumpStat('scans');
      return { scan: slimScan(scan) };
    }

    case 'analyzeProduct': {
      const options = normalizeOptions(message.options || (await store.getOptions()));
      const observedMap = await buildObservedMap(options.marketplaceId);
      const historyMap = await buildHistoryMap(options.marketplaceId);
      const row = analyzeOne(
        { ...options, observedByProduct: observedMap, historyByProduct: historyMap },
        message.productId,
      );
      if (!row) throw typedError('NO_DATA', 'That niche is not in the catalog.');
      return { row };
    }

    case 'scanActiveTab': {
      const tabId = message.tabId || (await activeTabId());
      if (!tabId) throw typedError('NO_DATA', 'No active tab to scan.');
      const scanned = await scanTab(tabId);
      const options = normalizeOptions(message.options || (await store.getOptions()));
      const observedMap = await buildObservedMap(options.marketplaceId);
      const scan = scanMarket({ ...options, observedByProduct: observedMap });
      const winner = findWinner({
        ...options,
        observedByProduct: observedMap,
      });
      return {
        observation: {
          ...scanned.observation,
          summary: describeObservation(scanned.observation),
        },
        matches: scanned.matches,
        scan: slimScan(scan),
        result: slimResult(winner),
      };
    }

    case 'savedList': {
      const options = normalizeOptions(await store.getOptions());
      const saved = await store.getSaved();
      return { saved, options };
    }

    case 'toggleSaved': {
      const saved = await store.toggleSaved({
        productId: message.productId,
        name: message.name,
        score: message.score,
        confidence: message.confidence,
        marketplace: message.marketplace,
      });
      return { saved };
    }

    case 'reports': {
      const reports = await store.listReports();
      return { reports: reports.map(summariseReport) };
    }

    case 'report': {
      const reports = await store.listReports();
      const found = reports.find((r) => r.id === message.id);
      if (!found) throw typedError('NO_DATA', 'That report is no longer stored.');
      return { report: found };
    }

    case 'deleteReport': {
      const reports = await store.patch(store.STORAGE_KEYS.REPORTS, (list) => (list || []).filter((r) => r.id !== message.id), []);
      return { reports: reports.map(summariseReport) };
    }

    case 'clearObserved': {
      await store.remove(store.STORAGE_KEYS.OBSERVED);
      await store.remove(store.STORAGE_KEYS.HISTORY);
      return { cleared: true };
    }

    case 'deleteAll': {
      await store.clearAll();
      await setBadge(null);
      return { cleared: true };
    }

    case 'exportData': {
      const payload = await store.exportAll();
      return { payload };
    }

    case 'importData': {
      await store.importAll(message.payload);
      return { imported: true };
    }

    default:
      return { ignored: true, reason: `Unknown message type "${message?.type}"` };
  }
}

/* ─────────────────────────── scanning ─────────────────────────── */

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id || null;
}

async function scanTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    throw typedError('INJECTION_BLOCKED', 'This tab is not a normal web page, so it cannot be scanned.');
  }

  let injection;
  try {
    injection = await chrome.scripting.executeScript({
      target: { tabId },
      files: [SCANNER_FILE],
    });
  } catch (error) {
    throw typedError('INJECTION_BLOCKED', `Chrome blocked the page scan (${error?.message || 'permission denied'}).`, error);
  }

  const pageResult = injection?.find((frame) => frame?.result)?.result;
  if (!pageResult) throw typedError('NO_DATA', 'The scanner returned nothing for this page.');
  if (pageResult.ok === false) throw typedError('NO_DATA', pageResult.error || 'Nothing on this page could be read.');

  const observation = deriveSignals(pageResult);
  const matches = matchNiches(pageResult, CATALOG, { limit: 5 });

  const key = observation.marketplaceId || 'generic';
  await store.patch(store.STORAGE_KEYS.OBSERVED, (current) => {
    const next = { ...(current || {}) };
    for (const match of matches) {
      const k = observedKey(match.productId, key);
      next[k] = { ...observation, matchedTokens: match.matchedTokens, matchScore: match.score };
    }
    return next;
  }, {});

  // Rolling history: one point per day per niche, used to prove trend with the
  // user's own repeated observations instead of a snapshot claim.
  await store.patch(store.STORAGE_KEYS.HISTORY, (current) => {
    const next = { ...(current || {}) };
    for (const match of matches) {
      const k = observedKey(match.productId, key);
      const points = next[k] || [];
      const last = points[points.length - 1];
      const point = {
        at: observation.scannedAt,
        reviewsTop10Median: observation.signals.reviewsTop10Median,
        resultCount: observation.signals.resultCount,
        priceMedian: observation.signals.priceMedian,
        strongCompetitors: observation.signals.strongCompetitors,
      };
      if (last && observation.scannedAt - last.at < 20 * 3_600_000) points[points.length - 1] = point;
      else points.push(point);
      next[k] = points.slice(-store.MAX_HISTORY_POINTS);
    }
    return next;
  }, {});

  await store.patch(store.STORAGE_KEYS.STATS, (stats) => ({
    ...(stats || {}),
    scans: (stats?.scans || 0) + 1,
    lastScanAt: Date.now(),
    firstRunAt: stats?.firstRunAt || Date.now(),
  }), store.DEFAULTS[store.STORAGE_KEYS.STATS]);

  return { observation, matches };
}

/** Observed signals per product for the selected marketplace (fresh ones only). */
async function buildObservedMap(marketplaceId) {
  const observed = await store.getObserved();
  const map = {};
  for (const [key, value] of Object.entries(observed || {})) {
    const [market, productId] = key.split(':');
    if (market !== marketplaceId) continue;
    if (!isFresh(value)) continue;
    map[productId] = value.signals;
  }
  return map;
}

async function buildHistoryMap(marketplaceId) {
  const history = await store.getHistory();
  const map = {};
  for (const [key, points] of Object.entries(history || {})) {
    const [market, productId] = key.split(':');
    if (market !== marketplaceId || !Array.isArray(points)) continue;
    map[productId] = points;
  }
  return map;
}

/* ─────────────────────────── payload shaping ─────────────────────────── */

/** The popup and dashboard only need the winner's analysis + light rows. */
function slimResult(result) {
  if (!result?.winner) return { winner: null, error: result?.error || 'No winner could be determined.' };
  return {
    winner: result.winner,
    runnerUp: result.runnerUp,
    alternatives: (result.alternatives || []).map((row) => ({
      rank: row.rank,
      productId: row.productId,
      product: row.product,
      opportunity: row.opportunity,
      demand: row.demand,
      competition: row.competition,
      competitionBand: row.competitionBand,
      profit: row.profit,
      trend: row.trend,
      trendBand: row.trendBand,
      confidence: row.confidence,
    })),
    meta: result.meta,
  };
}

function slimScan(scan) {
  return {
    ...scan,
    rows: scan.rows.map((row) => ({
      rank: row.rank,
      productId: row.productId,
      product: row.product,
      category: row.category,
      demand: row.demand,
      competition: row.competition,
      competitionBand: row.competitionBand,
      profit: row.profit,
      margin: row.margin,
      trend: row.trend,
      trendBand: row.trendBand,
      opportunity: row.opportunity,
      opportunityLabel: row.opportunityLabel,
      confidence: row.confidence,
      blockers: row.blockers,
      observed: row.observed,
    })),
  };
}

function summariseReport(report) {
  return {
    id: report.id,
    createdAt: report.createdAt,
    product: report.product?.name,
    emoji: report.product?.emoji,
    score: report.scores?.opportunity,
    demand: report.scores?.demand,
    competition: report.scores?.competition,
    trend: report.scores?.trend,
    confidence: report.confidence?.overall,
    marketplace: report.marketFit?.best?.name || report.selection?.marketplace,
    selection: report.selection,
  };
}

function summariseObserved(observed) {
  return Object.entries(observed || {}).map(([key, value]) => {
    const [marketplaceId, productId] = key.split(':');
    return {
      key,
      marketplaceId,
      productId,
      scannedAt: value.scannedAt,
      query: value.query,
      coverage: value.coverage,
      confidence: value.confidence,
      fresh: isFresh(value),
      summary: describeObservation(value),
    };
  }).sort((a, b) => (b.scannedAt || 0) - (a.scannedAt || 0));
}

async function setBadge(score) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: score == null ? '#3a3f52' : score >= 70 ? '#22c55e' : score >= 55 ? '#f59e0b' : '#ef4444' });
    await chrome.action.setBadgeText({ text: score == null ? '' : String(Math.round(score)) });
  } catch { /* badge is cosmetic */ }
}

function typedError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  error.cause = cause;
  return error;
}
