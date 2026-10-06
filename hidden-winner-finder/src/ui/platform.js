/**
 * platform.js - the only place the UI touches browser APIs.
 *
 * When the UI runs as a Chrome extension it talks to the service worker. When
 * the exact same UI is opened as a plain web page (the dashboard preview, a
 * design review, a screenshot run) it falls back to running the engine locally
 * with localStorage-backed storage. Same components, two hosts.
 */

import { findWinner, scanMarket, analyzeOne } from '../core/engine.js';
import { buildReport } from '../core/report.js';
import { normalizeOptions, optionLabels } from '../core/options.js';
import { CATALOG } from '../data/catalog.js';
import { deriveSignals, matchNiches, observedKey, describeObservation } from '../core/observe.js';
import * as store from '../core/storage.js';

export const isExtension = () =>
  typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id) && typeof chrome.runtime.sendMessage === 'function';

const send = (type, payload = {}) =>
  new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message || 'The extension background service is not responding.'));
        return;
      }
      if (!response) {
        reject(new Error('No response from the extension background service.'));
        return;
      }
      if (response.ok === false) {
        const error = new Error(response.error?.message || 'Request failed.');
        error.code = response.error?.code;
        error.hint = response.error?.hint;
        reject(error);
        return;
      }
      resolve(response);
    });
  });

/* ───────────────────────── local (non-extension) engine host ───────────────────────── */

const localHost = {
  async getState() {
    const state = await store.getAll();
    return {
      options: normalizeOptions(state[store.STORAGE_KEYS.OPTIONS]),
      labels: optionLabels(state[store.STORAGE_KEYS.OPTIONS]),
      saved: state[store.STORAGE_KEYS.SAVED] || [],
      stats: state[store.STORAGE_KEYS.STATS] || {},
      settings: state[store.STORAGE_KEYS.SETTINGS] || {},
      reports: (state[store.STORAGE_KEYS.REPORTS] || []).map(summariseReport),
      observed: Object.entries(state[store.STORAGE_KEYS.OBSERVED] || {}).map(([key, value]) => {
        const [marketplaceId, productId] = key.split(':');
        return { key, marketplaceId, productId, scannedAt: value.scannedAt, summary: describeObservation(value), fresh: true };
      }),
      lastResult: state[store.STORAGE_KEYS.LAST_RESULT] || null,
      version: 'preview',
      local: true,
    };
  },

  async setOptions(options) {
    const normalized = normalizeOptions(options);
    await store.setOptions(normalized);
    return { options: normalized, labels: optionLabels(normalized) };
  },

  async findWinner(payload) {
    const options = normalizeOptions(payload.options);
    const state = await store.getAll();
    const observedByProduct = observedMapFor(state, options.marketplaceId);
    const result = findWinner({ ...options, observedByProduct });
    const report = buildReport(result, optionLabels(options));
    if (report) await store.saveReport(report);
    await store.set(store.STORAGE_KEYS.LAST_RESULT, report);
    return {
      result: {
        winner: result.winner,
        runnerUp: result.runnerUp,
        alternatives: (result.alternatives || []).map((r) => ({
          rank: r.rank, productId: r.productId, product: r.product, opportunity: r.opportunity,
          demand: r.demand, competition: r.competition, competitionBand: r.competitionBand,
          profit: r.profit, trend: r.trend, trendBand: r.trendBand, confidence: r.confidence,
        })),
        meta: result.meta,
      },
      report,
    };
  },

  async scanMarket(payload) {
    const options = normalizeOptions(payload.options);
    const state = await store.getAll();
    const scan = scanMarket({ ...options, observedByProduct: observedMapFor(state, options.marketplaceId) });
    return {
      scan: {
        ...scan,
        rows: scan.rows.map((row) => ({
          rank: row.rank, productId: row.productId, product: row.product, category: row.category,
          demand: row.demand, competition: row.competition, competitionBand: row.competitionBand,
          profit: row.profit, margin: row.margin, trend: row.trend, trendBand: row.trendBand,
          opportunity: row.opportunity, opportunityLabel: row.opportunityLabel, confidence: row.confidence,
          blockers: row.blockers, observed: row.observed,
          analysis: row.analysis,
        })),
      },
    };
  },

  /** No page access outside the extension: simulate a scan of a fixture page. */
  async scanActiveTab() {
    const fixture = {
      marketplaceId: 'etsy',
      query: 'personalized pet ornament',
      url: 'https://www.etsy.com/search?q=personalized+pet+ornament',
      pageTitle: 'Personalized pet ornament - Etsy',
      resultCount: 4213,
      scannedAt: Date.now(),
      listings: Array.from({ length: 24 }, (_, i) => ({
        title: `Personalized ${['dog', 'cat', 'pet', 'puppy'][i % 4]} ornament, custom photo gift ${i}`,
        price: [11.99, 14.99, 16.5, 19.99, 9.5, 22][i % 6],
        reviews: [12, 84, 190, 640, 1420, 48][i % 6],
        rating: 4.8,
        badges: i % 5 === 0 ? ['bestseller'] : i % 7 === 0 ? ['sold'] : [],
        sponsored: i % 9 === 0,
        hasVideo: i % 6 === 0,
        imageCount: i % 3 === 0 ? 9 : 5,
      })),
    };
    const observation = deriveSignals(fixture);
    const matches = matchNiches(fixture, CATALOG, { limit: 5 });
    await store.patch(store.STORAGE_KEYS.OBSERVED, (current) => {
      const next = { ...(current || {}) };
      for (const match of matches) {
        next[observedKey(match.productId, 'etsy')] = { ...observation, matchedTokens: match.matchedTokens };
      }
      return next;
    }, {});
    const options = normalizeOptions((await store.getOptions()));
    const state = await store.getAll();
    const scan = scanMarket({ ...options, observedByProduct: observedMapFor(state, options.marketplaceId) });
    return {
      observation: { ...observation, summary: describeObservation(observation) },
      matches,
      scan: { ...scan, rows: scan.rows },
      result: (await localHost.findWinner({ options })).result,
      simulated: true,
    };
  },

  async analyzeProduct({ options, productId }) {
    const resolved = normalizeOptions(options);
    const state = await store.getAll();
    const observed = state[store.STORAGE_KEYS.OBSERVED] || {};
    const observedByProduct = observedMapFor(state, resolved.marketplaceId);
    const row = analyzeOne({ ...resolved, observedByProduct }, productId);
    if (!row) throw new Error('That niche is not in the catalog.');
    return { row };
  },

  async savedList() {
    return { saved: await store.getSaved(), options: normalizeOptions(await store.getOptions()) };
  },

  async toggleSaved(payload) {
    const saved = await store.toggleSaved({
      productId: payload.productId, name: payload.name, score: payload.score,
      confidence: payload.confidence, marketplace: payload.marketplace,
    });
    return { saved };
  },

  async reports() {
    return { reports: (await store.listReports()).map(summariseReport) };
  },

  async report({ id }) {
    const found = (await store.listReports()).find((r) => r.id === id);
    if (!found) throw new Error('That report is no longer stored.');
    return { report: found };
  },

  async deleteReport({ id }) {
    const reports = await store.patch(store.STORAGE_KEYS.REPORTS, (list) => (list || []).filter((r) => r.id !== id), []);
    return { reports: reports.map(summariseReport) };
  },

  async clearObserved() {
    await store.remove(store.STORAGE_KEYS.OBSERVED);
    await store.remove(store.STORAGE_KEYS.HISTORY);
    return { cleared: true };
  },

  async deleteAll() {
    await store.clearAll();
    return { cleared: true };
  },

  async exportData() {
    return { payload: await store.exportAll() };
  },

  async importData({ payload }) {
    await store.importAll(payload);
    return { imported: true };
  },
};

function observedMapFor(state, marketplaceId) {
  const map = {};
  for (const [key, value] of Object.entries(state[store.STORAGE_KEYS.OBSERVED] || {})) {
    const [market, productId] = key.split(':');
    if (market !== marketplaceId) continue;
    map[productId] = value.signals;
  }
  return map;
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

/* ─────────────────────────── public API ─────────────────────────── */

export const host = {
  getState: (payload) => (isExtension() ? send('getState', payload) : localHost.getState(payload)),
  setOptions: (options) => (isExtension() ? send('setOptions', { options }) : localHost.setOptions(options)),
  findWinner: (payload) => (isExtension() ? send('findWinner', payload) : localHost.findWinner(payload)),
  scanMarket: (payload) => (isExtension() ? send('scanMarket', payload) : localHost.scanMarket(payload)),
  scanActiveTab: (payload) => (isExtension() ? send('scanActiveTab', payload) : localHost.scanActiveTab(payload)),
  analyzeProduct: (payload) => (isExtension() ? send('analyzeProduct', payload) : localHost.analyzeProduct(payload)),
  savedList: (payload) => (isExtension() ? send('savedList', payload) : localHost.savedList(payload)),
  toggleSaved: (payload) => (isExtension() ? send('toggleSaved', payload) : localHost.toggleSaved(payload)),
  reports: (payload) => (isExtension() ? send('reports', payload) : localHost.reports(payload)),
  report: (payload) => (isExtension() ? send('report', payload) : localHost.report(payload)),
  deleteReport: (payload) => (isExtension() ? send('deleteReport', payload) : localHost.deleteReport(payload)),
  clearObserved: (payload) => (isExtension() ? send('clearObserved', payload) : localHost.clearObserved(payload)),
  deleteAll: (payload) => (isExtension() ? send('deleteAll', payload) : localHost.deleteAll(payload)),
  exportData: (payload) => (isExtension() ? send('exportData', payload) : localHost.exportData(payload)),
  importData: (payload) => (isExtension() ? send('importData', payload) : localHost.importData(payload)),
  isExtension: () => isExtension(),
};

/* ─────────────────────────── browser side effects ─────────────────────────── */

export async function openTab(url) {
  if (isExtension()) {
    await chrome.tabs.create({ url });
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs focus/permission - fall back to a hidden textarea.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand?.('copy');
    document.body.removeChild(area);
    return Boolean(ok);
  }
}

export function downloadFile(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Ask for optional host permissions so live scanning keeps working. */
export async function requestScanPermissions() {
  if (!isExtension()) return { granted: false, reason: 'not-extension' };
  const granted = await chrome.permissions.request({ origins: ['https://*/*'] });
  return { granted };
}

export async function hasScanPermissions() {
  if (!isExtension()) return false;
  return chrome.permissions.contains({ origins: ['https://*/*'] });
}

export function openDashboard(query = '') {
  const url = isExtension()
    ? chrome.runtime.getURL(`src/ui/dashboard.html${query}`)
    : `dashboard.html${query}`;
  return openTab(url);
}
