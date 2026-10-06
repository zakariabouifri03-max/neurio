/**
 * app.js - the UI controller shared by the popup and the dashboard.
 *
 * State machine, rendering and event delegation in one place. Both surfaces use
 * the same sections; the popup shows a subset through tabs, the dashboard shows
 * everything with a sidebar. No framework, no build step for the UI itself.
 */

import { host, openTab, copyText, downloadFile, requestScanPermissions, hasScanPermissions, openDashboard, isExtension } from './platform.js';
import { reportToMarkdown } from '../core/report.js';
import * as R from './render.js';
import { normalizeOptions } from '../core/options.js';
import { timeAgo } from '../core/format.js';

const FIND_STEPS = [
  'Reading the public-data snapshot for every candidate niche…',
  'Scoring demand from review activity, sales labels and favourites…',
  'Measuring competition: listing density, review moats, ad pressure…',
  'Modelling margin, fees and sourcing routes…',
  'Fusing demand, competition, profit, trend and risk…',
  'Ranking the niches and picking ONE winner…',
];

const SCAN_STEPS = [
  'Collecting the niches for the selected category…',
  'Scoring each niche against the market…',
  'Ranking the opportunities…',
];

const PAGE_STEPS = [
  'Injecting the page reader into the tab you are viewing…',
  'Extracting listing titles, prices, review counts and badges…',
  'Deriving observed signals (median price, review moat, ad share)…',
  'Matching the page against the niche catalog…',
];

const state = {
  mode: 'popup',
  view: 'overview',
  busy: null,
  progressIndex: 0,
  error: null,
  toast: null,
  options: normalizeOptions({}),
  labels: {},
  result: null,
  report: null,
  scan: null,
  observation: null,
  matches: [],
  saved: [],
  reports: [],
  observed: [],
  stats: {},
  settings: {},
  local: false,
  version: '1.0.0',
};

let root = null;
let progressTimer = null;

/* ─────────────────────────── mount ─────────────────────────── */

export async function mount(element, { mode = 'popup' } = {}) {
  root = element;
  state.mode = mode;
  document.body.classList.add(mode);

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target?.dataset?.action === 'option') event.target.blur();
  });

  render();
  await loadState();

  const params = new URLSearchParams(location.search);
  if (params.get('scan') === '1') {
    await withProgress(PAGE_STEPS, async () => { await scanPage({ silent: true }); });
  } else if (params.get('welcome') === '1') {
    toast('Welcome! Open an Etsy/Amazon/eBay search page and press SCAN PAGE for observed, high-confidence numbers.');
  } else if (state.settings?.autoScanOnOpen && params.get('autoscan') === '1') {
    await findWinner();
  } else if (window.HWF_AUTORUN) {
    // Used only by the generated preview page so the dashboard opens populated.
    await scanPage({ silent: true });
    await findWinner();
  }
}

async function loadState() {
  try {
    const response = await host.getState();
    state.options = normalizeOptions(response.options || state.options);
    state.labels = response.labels || {};
    state.saved = response.saved || [];
    state.reports = response.reports || [];
    state.observed = response.observed || [];
    state.stats = response.stats || {};
    state.settings = response.settings || {};
    state.local = Boolean(response.local);
    state.version = response.version || state.version;
    if (response.lastResult && !state.result && !state.report) {
      // Reopening the popup shows the previous winner instead of an empty screen.
      state.report = response.lastResult;
    }
  } catch (error) {
    state.error = { message: error.message, hint: error.hint };
  }
  render();
}

/* ─────────────────────────── actions ─────────────────────────── */

async function withProgress(steps, task) {
  state.busy = steps;
  state.progressIndex = 0;
  state.error = null;
  render();
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    if (!state.busy) return;
    if (state.progressIndex < state.busy.length - 1) {
      state.progressIndex += 1;
      render();
    }
  }, 420);
  try {
    return await task();
  } catch (error) {
    state.error = { message: error.message || 'Something went wrong.', hint: error.hint };
    return null;
  } finally {
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = null;
    state.busy = null;
    render();
  }
}

/** Re-pull the lists that change as a side effect of an action (reports, stats, saved). */
async function refreshDerivedState() {
  try {
    const response = await host.getState();
    state.reports = response.reports || state.reports;
    state.saved = response.saved || state.saved;
    state.observed = response.observed || state.observed;
    state.stats = response.stats || state.stats;
    state.settings = response.settings || state.settings;
  } catch {
    /* derived state only - a failure here must never break the main flow */
  }
}

async function findWinner() {
  return withProgress(FIND_STEPS, async () => {
    const response = await host.findWinner({ options: state.options });
    state.result = response.result;
    state.report = response.report;
    await refreshDerivedState();
    state.view = 'overview';
    toast(response.result?.winner ? `Winner: ${response.result.winner.product}` : 'No winner found');
    return response;
  });
}

async function scanMarket() {
  return withProgress(SCAN_STEPS, async () => {
    const response = await host.scanMarket({ options: state.options });
    state.scan = response.scan;
    state.view = state.mode === 'dashboard' ? 'scan' : 'scan';
    toast(`${response.scan.rows.length} niches ranked`);
    return response;
  });
}

async function scanPage({ silent = false } = {}) {
  return withProgress(PAGE_STEPS, async () => {
    const response = await host.scanActiveTab({ options: state.options });
    state.observation = response.observation;
    state.matches = response.matches || [];
    state.scan = response.scan || state.scan;
    if (response.result) state.result = response.result;
    await refreshDerivedState();
    if (!silent) {
      toast(response.simulated
        ? 'Preview mode: a fixture page was scanned so you can explore the flow.'
        : `Observed ${response.observation.listingSampleSize} listings on ${response.observation.query || 'the page'}`);
    }
    return response;
  });
}

async function toggleSave(button) {
  const payload = {
    productId: button.dataset.productId,
    name: button.dataset.name,
    score: Number(button.dataset.score),
    confidence: button.dataset.confidence,
    marketplace: button.dataset.marketplace,
  };
  const response = await host.toggleSaved(payload);
  state.saved = response.saved || [];
  if (state.view === 'reports') state.reports = (await host.reports()).reports || state.reports;
  toast(state.saved.some((s) => s.productId === payload.productId) ? 'Saved to your products' : 'Removed from saved');
  render();
}

async function openReport(id) {
  const response = await host.report({ id });
  state.report = response.report;
  state.result = null;
  state.view = 'overview';
  render();
  toast(`Report: ${response.report.product.name}`);
}

async function deleteReport(id) {
  const response = await host.deleteReport({ id });
  state.reports = response.reports || [];
  if (state.report?.id === id) {
    state.report = null;
    if (!state.result) state.view = 'reports';
  }
  toast('Report deleted');
  render();
}

async function exportData() {
  const response = await host.exportData();
  downloadFile(`hidden-winner-finder-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(response.payload, null, 2));
  toast('Backup downloaded');
}

async function importData(file) {
  try {
    const text = await file.text();
    await host.importData({ payload: JSON.parse(text) });
    await loadState();
    toast('Backup imported');
  } catch (error) {
    toast(`Import failed: ${error.message}`, 'bad');
  }
}

async function copyMarkdown() {
  const report = state.report || (state.result ? await buildCurrentMarkdown() : null);
  if (!report) {
    toast('Run FIND MY WINNING PRODUCT first', 'bad');
    return;
  }
  const ok = await copyText(typeof report === 'string' ? report : reportToMarkdown(report));
  toast(ok ? 'Markdown copied to clipboard' : 'Copy failed - select the text manually', ok ? 'ok' : 'bad');
}

async function buildCurrentMarkdown() {
  const response = await host.findWinner({ options: state.options });
  state.report = response.report;
  return response.report;
}

async function copyKeywords() {
  const analysis = currentAnalysis();
  const list = analysis?.ideaPack?.keywords?.map((k) => k.keyword).join('\n') || '';
  const ok = await copyText(list);
  toast(ok ? 'Keywords copied' : 'Copy failed', ok ? 'ok' : 'bad');
}

function currentAnalysis() {
  return state.result?.winner?.analysis || state.reportAnalysis || state.scan?.rows?.[0]?.analysis || null;
}

/** Every report shape (live result or stored JSON) is normalised for rendering. */
function analysisFromReport(report) {
  if (!report) return null;
  return {
    id: report.product.id,
    product: { ...report.product, ideas: report.ideaPack, risks: report.product.risks, differentiation: report.product.differentiation },
    marketplace: { id: 'etsy', name: report.marketFit?.best?.name || report.selection?.marketplace, icon: report.marketFit?.best?.icon || '🛍️' },
    price: report.profit?.price ?? report.scores?.price ?? 0,
    demand: { ...report.demand, confidence: { id: report.confidence.demand, label: report.confidence.demand } },
    competition: { ...report.competition, confidence: { id: report.confidence.competition, label: report.confidence.competition } },
    trend: { ...report.trend, confidence: report.confidence.trend },
    profit: report.profit,
    sourcing: report.sourcing,
    marketFit: report.marketFit,
    channels: report.channels,
    risks: report.risks,
    beginner: report.beginner,
    ideaPack: report.ideaPack,
    opportunity: {
      ...report.opportunity,
      score: report.scores.opportunity,
      label: report.scores.label,
      rawScore: report.scores.raw,
      adjustments: report.opportunity?.adjustments || { items: [], total: report.scores.riskPenalty || 0 },
      confidence: report.opportunity?.confidence || { id: report.confidence.overall, label: report.confidence.overall },
    },
    budgetFit: report.budgetFit,
    why: report.why,
    verdict: report.verdict,
    observedLive: false,
  };
}

/* ─────────────────────────── events ─────────────────────────── */

async function onClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;

  switch (action) {
    case 'find':
      await findWinner();
      break;
    case 'scan-market':
      await scanMarket();
      break;
    case 'scan-page':
      await scanPage();
      break;
    case 'save':
    case 'unsave':
      await toggleSave(button);
      break;
    case 'open':
      if (button.dataset.url) await openTab(button.dataset.url);
      break;
    case 'copy-markdown':
      await copyMarkdown();
      break;
    case 'copy-keywords':
      await copyKeywords();
      break;
    case 'export-report': {
      const report = state.report;
      if (!report) { toast('Nothing to export yet', 'bad'); break; }
      downloadFile(`${report.product.id}-hotw-report.json`, JSON.stringify(report, null, 2));
      toast('Report exported');
      break;
    }
    case 'export-data':
      await exportData();
      break;
    case 'import-data': {
      // The hidden file input carries the same data-action; only forward the
      // click when it came from the surrounding label, never from the input.
      if (button.tagName !== 'INPUT') {
        document.querySelector('[data-action="import-data"]')?.click();
      }
      break;
    }
    case 'clear-observed':
      await host.clearObserved();
      state.observed = [];
      toast('Scanned pages forgotten');
      render();
      break;
    case 'delete-all':
      if (confirm('Delete every report, saved product and observation stored by Hidden Winner Finder?')) {
        await host.deleteAll();
        state.result = null; state.report = null; state.scan = null; state.saved = []; state.reports = []; state.observed = [];
        toast('All local data deleted');
        render();
      }
      break;
    case 'delete-report':
      await deleteReport(button.dataset.id);
      break;
    case 'open-report':
      await openReport(button.dataset.id);
      break;
    case 'grant': {
      const response = await requestScanPermissions();
      toast(response.granted ? 'Access granted for marketplaces' : 'Access not granted', response.granted ? 'ok' : 'bad');
      break;
    }
    case 'check-grant': {
      const granted = await hasScanPermissions();
      toast(granted ? 'Marketplace access granted' : 'Not granted yet', granted ? 'ok' : 'bad');
      break;
    }
    case 'dashboard':
      await openDashboard();
      if (state.mode === 'popup') window.close();
      break;
    case 'tab':
      state.view = button.dataset.target?.replace('#', '') || 'overview';
      render();
      break;
    case 'anchor': {
      const target = document.querySelector(button.dataset.target);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    }
    case 'inspect': {
      const productId = button.dataset.productId;
      const row = state.scan?.rows?.find((r) => r.productId === productId);
      try {
        // Re-derives the analysis for that niche on demand (extension host) or
        // reuses the one already computed in the page (standalone host).
        const response = row?.analysis
          ? { row }
          : await host.analyzeProduct({ options: state.options, productId });
        state.result = {
          winner: { ...response.row, analysis: response.row.analysis },
          alternatives: (state.scan?.rows || []).filter((r) => r.productId !== productId).slice(0, 4),
          meta: state.scan,
        };
        state.report = null;
        state.view = 'overview';
        toast(`Inspecting ${response.row.product}`);
      } catch (error) {
        toast(error.message || 'Could not open that niche', 'bad');
      }
      render();
      break;
    }
    default:
      break;
  }
}

async function onChange(event) {
  const target = event.target;

  if (target.dataset?.action === 'option') {
    state.options = normalizeOptions({ ...state.options, [target.dataset.key]: target.value });
    try {
      const response = await host.setOptions(state.options);
      state.labels = response.labels || state.labels;
    } catch (error) {
      toast(error.message, 'bad');
    }
    return;
  }

  if (target.dataset?.action === 'import-data' && target.files?.[0]) {
    await importData(target.files[0]);
  }
}

/* ─────────────────────────── rendering ─────────────────────────── */

function toast(message, kind = 'ok') {
  state.toast = { message, kind };
  render();
  setTimeout(() => {
    state.toast = null;
    render();
  }, 3200);
}

const POPUP_TABS = [
  ['overview', '🔥 Winner'],
  ['sell', '🛒 Where to sell'],
  ['source', '📦 Sourcing'],
  ['numbers', '📊 Numbers'],
  ['ideas', '💡 Ideas'],
  ['scan', '📋 Market scan'],
  ['data', '🔒 Data'],
];

const DASHBOARD_NAV = [
  ['group', 'Research'],
  ['overview', '🔥 Best opportunity'],
  ['scan', '📋 Market scan'],
  ['sell', '🛒 Where to sell'],
  ['source', '📦 Where to source'],
  ['group', 'The numbers'],
  ['demand', '📈 Demand detector'],
  ['competition', '🥊 Low-competition'],
  ['profit', '💰 Profit calculator'],
  ['trend', '📉 Trend analysis'],
  ['group', 'Execution'],
  ['ideas', '💡 Product ideas'],
  ['channels', '📣 Customers'],
  ['risks', '⚠️ Risks'],
  ['group', 'Your data'],
  ['saved', '⭐ Saved products'],
  ['reports', '🗂️ Reports'],
  ['honesty', '🔒 Data & honesty'],
  ['settings', '⚙️ Settings'],
];

function activeAnalysis() {
  if (state.result?.winner?.analysis) return state.result.winner.analysis;
  if (state.report) return analysisFromReport(state.report);
  return null;
}

function activeHeroRow() {
  if (state.result?.winner) return state.result.winner;
  if (state.report) {
    return {
      productId: state.report.product.id,
      product: state.report.product.name,
      opportunity: state.report.scores.opportunity,
      observed: false,
      restored: true,
    };
  }
  return null;
}

function isSaved(productId) {
  return state.saved.some((s) => s.productId === productId);
}

function viewContent(analysis, heroRow) {
  const view = state.view;
  const sections = {
    overview: () => [
      R.heroCard(heroRow, analysis, { saved: heroRow?.productId ? isSaved(heroRow.productId) : false, mode: state.mode }),
      analysis ? R.whyCard(analysis) : '',
      state.result?.alternatives?.length ? R.alternativesCard(state.result.alternatives) : '',
      analysis ? R.riskSection(analysis) : '',
    ].join(''),
    sell: () => (analysis ? R.marketSection(analysis) : R.emptyState('🛒', 'No analysis yet', 'Find your winning product first.')),
    source: () => (analysis ? R.sourcingSection(analysis) : R.emptyState('📦', 'No analysis yet', 'Find your winning product first.')),
    numbers: () => (analysis ? [R.profitSection(analysis), R.demandSection(analysis), R.competitionSection(analysis), R.trendSection(analysis)].join('') : R.emptyState('📊', 'No analysis yet', 'Find your winning product first.')),
    demand: () => (analysis ? R.demandSection(analysis) : R.emptyState('📈', 'No analysis yet', 'Find your winning product first.')),
    competition: () => (analysis ? R.competitionSection(analysis) : R.emptyState('🥊', 'No analysis yet', 'Find your winning product first.')),
    profit: () => (analysis ? R.profitSection(analysis) : R.emptyState('💰', 'No analysis yet', 'Find your winning product first.')),
    trend: () => (analysis ? R.trendSection(analysis) : R.emptyState('📉', 'No analysis yet', 'Find your winning product first.')),
    ideas: () => (analysis ? R.ideasSection(analysis) : R.emptyState('💡', 'No analysis yet', 'Find your winning product first.')),
    channels: () => (analysis ? R.channelsSection(analysis) : R.emptyState('📣', 'No analysis yet', 'Find your winning product first.')),
    risks: () => (analysis ? R.riskSection(analysis) : R.emptyState('⚠️', 'No analysis yet', 'Find your winning product first.')),
    scan: () => R.scanTable(state.scan, state.mode),
    saved: () => R.savedList(state.saved),
    reports: () => R.reportsList(state.reports),
    honesty: () => R.honestySection(analysis?.meta || state.result?.meta || state.report?.meta, { observed: state.observed, local: state.local }),
    settings: () => R.settingsSection(state.settings, { observed: state.observed }) + R.statsRow(state.stats, describeLastObservation()),
    data: () => [
      R.honestySection(analysis?.meta || state.result?.meta || state.report?.meta, { observed: state.observed, local: state.local }),
      R.statsRow(state.stats, describeLastObservation()),
      R.settingsSection(state.settings, { observed: state.observed }),
    ].join(''),
  };
  return (sections[view] || sections.overview)();
}

function describeLastObservation() {
  if (!state.observation) return null;
  return { summary: state.observation.summary || (state.observation.observedFields ? `${state.observation.observedFields.length} signals observed on ${state.observation.query || 'the page'}` : '') };
}

function tabs() {
  const items = state.mode === 'popup' ? POPUP_TABS : [];
  if (!items.length) return '';
  return `<div class="tabs" role="tablist">
    ${items.map(([id, label]) => `<button class="tab" role="tab" aria-selected="${state.view === id}" data-action="tab" data-target="#${id}">${esc(label)}</button>`).join('')}
  </div>`;
}

function nav() {
  if (state.mode !== 'dashboard') return '';
  return `<aside class="sidebar" role="navigation">
    ${DASHBOARD_NAV.map(([id, label]) => (id === 'group'
      ? `<div class="nav-group">${esc(label)}</div>`
      : `<button class="nav-item" data-action="tab" data-target="#${id}" aria-current="${state.view === id}">${esc(label)}</button>`)).join('')}
  </aside>`;
}

function topbar() {
  const analysis = activeAnalysis();
  const conf = analysis?.opportunity?.confidence?.label;
  return `<header class="topbar">
    <div class="brand">
      <div class="brand-mark">🔎</div>
      <div class="brand-text">
        <div class="brand-title">Hidden Winner Finder</div>
        <div class="brand-sub">One hidden product · demand ↑ competition ↓ profit ↑</div>
      </div>
    </div>
    <div class="topbar-spacer"></div>
    ${state.observation ? `<span class="chip good" title="A page you scanned is feeding observed signals">● Live page observed</span>` : ''}
    ${conf ? `<span class="chip ${conf === 'High' ? 'good' : conf === 'Medium' ? 'warn' : 'bad'}">${esc(conf)} confidence</span>` : ''}
    ${state.mode === 'popup' ? `<span class="chip">v${esc(state.version)}</span>` : ''}
  </header>`;
}

function actionsBar() {
  const busy = Boolean(state.busy);
  return `<div class="actions">
    <button class="btn-hero ${busy ? 'busy' : ''}" data-action="find" ${busy ? 'disabled' : ''}>
      ${busy ? '⏳ Analysing…' : '🔥 Find my winning product'}
    </button>
    <div class="row">
      <button class="btn" data-action="scan-market" ${busy ? 'disabled' : ''}>📊 Scan market</button>
      <button class="btn" data-action="scan-page" ${busy ? 'disabled' : ''}>🔎 Scan this page</button>
      ${state.mode === 'popup' ? '<button class="btn ghost" data-action="dashboard">🗂️ Dashboard</button>' : ''}
    </div>
  </div>`;
}

function render() {
  if (!root) return;
  const analysis = activeAnalysis();
  const heroRow = activeHeroRow();
  const content = state.busy
    ? R.progressPanel(state.busy, state.progressIndex)
    : `${state.error ? R.errorBox(state.error.message, state.error.hint) : ''}${viewContent(analysis, heroRow)}`;

  root.innerHTML = `
    <div class="app">
      ${topbar()}
      ${R.controls(state.options, state.mode)}
      ${actionsBar()}
      ${state.mode === 'popup' ? tabs() : ''}
      ${state.mode === 'dashboard'
        ? `<div class="layout">${nav()}<main class="main">${content}</main></div>`
        : `<div class="scroll-area">${content}</div>`}
      ${state.toast ? `<div class="toast ${state.toast.kind === 'bad' ? 'bad' : ''}">${esc(state.toast.message)}</div>` : ''}
    </div>`;
}

function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const appState = state;
export { isExtension, timeAgo };
