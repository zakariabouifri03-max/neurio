/* Etsy Insight Pro — popup.js */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const pageBadge = $('pageBadge'), pageLine = $('pageLine');
  const btnAnalyze = $('btnAnalyze'), btnTrack = $('btnTrack'), btnDashboard = $('btnDashboard');
  const quickStats = $('quickStats'), notEtsy = $('notEtsy');

  let tabId = null;
  let pageType = 'other';

  init().catch(err => {
    pageLine.textContent = 'Could not reach the current tab.';
    console.warn('[EtsyInsightPro popup]', err);
  });

  async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { pageLine.textContent = 'No active tab.'; return; }
    tabId = tab.id;
    const url = tab.url || '';
    pageType = detectType(url);
    paintType(url);

    if (pageType === 'other') {
      notEtsy.classList.remove('hidden');
      btnAnalyze.disabled = true;
      btnTrack.disabled = true;
      // Dashboard-only mode still useful.
    } else {
      btnAnalyze.textContent =
        pageType === 'product' ? 'Analyze product' :
        pageType === 'shop' ? 'Analyze shop' : 'Analyze results';
      // Ask the content script for live state (headline after analysis).
      try {
        const st = await chrome.tabs.sendMessage(tabId, { type: 'EIP_GET_STATE' });
        if (st && st.hasAnalysis) {
          quickStats.classList.remove('hidden');
          quickStats.innerHTML =
            stat('Status', 'Analysed ✓') +
            stat('Estimate', esc(st.headline || '—')) +
            stat('Tracked', st.tracked ? 'Yes' : 'No') +
            stat('Page', pageType);
          btnTrack.textContent = st.tracked ? '✓ Tracking' : '＋ Track';
        }
      } catch (e) { /* content script not ready yet */ }
    }

    btnAnalyze.addEventListener('click', async () => {
      btnAnalyze.disabled = true;
      btnAnalyze.textContent = 'Analyzing…';
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'EIP_ANALYZE' });
        window.close();
      } catch (e) {
        // Content script may not be injected (e.g. page open before install) — inject on demand.
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: contentFiles() });
          await new Promise(r => setTimeout(r, 600));
          await chrome.tabs.sendMessage(tabId, { type: 'EIP_ANALYZE' });
          window.close();
        } catch (e2) {
          pageLine.textContent = 'Could not start analysis. Reload the Etsy page and try again.';
          btnAnalyze.disabled = false;
        }
      }
    });

    btnTrack.addEventListener('click', async () => {
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'EIP_TRACK' });
        btnTrack.textContent = '✓ Tracking';
      } catch (e) {
        pageLine.textContent = 'Open the Etsy page first, then press Analyze.';
      }
    });

    btnDashboard.addEventListener('click', () => openDashboard('#/overview'));
    $('btnResearch').addEventListener('click', () => openDashboard('#/research'));
    $('btnKeywords').addEventListener('click', () => openDashboard('#/keywords'));
    $('btnTracked').addEventListener('click', () => openDashboard('#/tracked'));
    $('btnSettings').addEventListener('click', () => openDashboard('#/settings'));

    function stat(label, value) {
      return `<div class="stat"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
    }
  }

  function detectType(url) {
    if (/\/listing\/\d+/.test(url)) return 'product';
    if (/\/shop\//.test(url)) return 'shop';
    if (/\/(search|market)\b/.test(url) || /[?&](q|search_query)=/.test(url)) return 'search';
    if (/etsy\.com/.test(url)) return 'other';
    return 'other';
  }

  function paintType(url) {
    const labels = { product: 'Product', shop: 'Shop', search: 'Search', other: /etsy\.com/.test(url) ? 'Etsy' : 'Not Etsy' };
    pageBadge.textContent = labels[pageType];
    if (pageType !== 'other') pageBadge.classList.add('on');
    let short = url;
    try { short = new URL(url).pathname.slice(0, 60) || url; } catch (e) { /* keep */ }
    pageLine.textContent = `Current page: ${labels[pageType]} — ${short}`;
  }

  function contentFiles() {
    return [
      'src/lib/namespace.js', 'src/lib/utils.js', 'src/lib/settings.js', 'src/lib/storage.js',
      'src/lib/estimation.js', 'src/lib/scores.js', 'src/lib/keywords.js', 'src/lib/tracking.js',
      'src/lib/export.js', 'src/lib/charts.js',
      'src/content/extractors/common.js', 'src/content/extractors/product.js',
      'src/content/extractors/shop.js', 'src/content/extractors/search.js',
      'src/content/content.js'
    ];
  }

  function openDashboard(hash) {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html' + hash) });
    window.close();
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();
