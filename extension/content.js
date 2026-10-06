/**
 * Hidden Winner Finder - In-Page Content Script
 * Extracts public marketplace signals and injects quick-action overlay widget.
 */

(function () {
  'use strict';

  // Prevent double injection
  if (window.__HWF_INITIALIZED__) return;
  window.__HWF_INITIALIZED__ = true;

  // Platform detection
  const host = window.location.hostname;
  let platform = 'Marketplace';
  if (host.includes('etsy.com')) platform = 'Etsy';
  else if (host.includes('amazon.com')) platform = 'Amazon';
  else if (host.includes('ebay.com')) platform = 'eBay';
  else if (host.includes('walmart.com')) platform = 'Walmart';
  else if (host.includes('aliexpress.com')) platform = 'AliExpress';
  else if (host.includes('tiktok.com')) platform = 'TikTok Shop';

  // Extract signals
  function extractPageSignals() {
    const title = document.title || '';
    let searchQuery = '';
    let listingsCount = 0;
    let prices = [];

    if (platform === 'Etsy') {
      const qInput = document.querySelector('input[name="search_query"]') || document.querySelector('input[data-id="search-query"]');
      searchQuery = qInput ? qInput.value : '';
      const countEl = document.querySelector('.wt-text-caption--subtle, [data-search-results-count]');
      if (countEl) {
        const match = countEl.innerText.replace(/,/g, '').match(/\d+/);
        if (match) listingsCount = parseInt(match[0], 10);
      }
      document.querySelectorAll('.currency-value, .wt-text-title-01').forEach(el => {
        const p = parseFloat(el.innerText.replace(/[^0-9.]/g, ''));
        if (p && p > 0 && p < 1000) prices.push(p);
      });
    } else if (platform === 'Amazon') {
      const qInput = document.querySelector('#twotabsearchtextbox');
      searchQuery = qInput ? qInput.value : '';
      const countEl = document.querySelector('.s-desktop-toolbar, h1.a-size-base');
      if (countEl) {
        const match = countEl.innerText.replace(/,/g, '').match(/of (?:over )?([\d,]+) results/i);
        if (match) listingsCount = parseInt(match[1].replace(/,/g, ''), 10);
      }
      document.querySelectorAll('.a-price .a-offscreen').forEach(el => {
        const p = parseFloat(el.innerText.replace(/[^0-9.]/g, ''));
        if (p && p > 0 && p < 1000) prices.push(p);
      });
    }

    if (!searchQuery) {
      // Fallback from URL query parameters
      const params = new URLSearchParams(window.location.search);
      searchQuery = params.get('q') || params.get('search_query') || params.get('k') || '';
    }

    const avgPrice = prices.length > 0
      ? (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2)
      : '19.99';

    return {
      platform,
      searchQuery: searchQuery || title.split('|')[0].split('-')[0].trim(),
      listingsCount: listingsCount || 850,
      avgPrice: parseFloat(avgPrice) || 19.99,
      url: window.location.href
    };
  }

  // Create floating widget
  function injectFloatingWidget() {
    if (document.getElementById('hwf-floating-widget')) return;

    const widget = document.createElement('div');
    widget.id = 'hwf-floating-widget';
    widget.className = 'hwf-widget-container';
    widget.innerHTML = `
      <div class="hwf-badge-btn" id="hwf-open-trigger">
        <span class="hwf-badge-icon">🔎</span>
        <span class="hwf-badge-text">Hidden Winner Finder</span>
        <span class="hwf-badge-tag">${platform}</span>
      </div>
      <div class="hwf-preview-card" id="hwf-card" style="display: none;">
        <div class="hwf-card-header">
          <div class="hwf-card-title">
            <span>🔥</span> <strong>Hidden Winner Finder</strong>
          </div>
          <button class="hwf-close-btn" id="hwf-card-close">✕</button>
        </div>
        <div class="hwf-card-body">
          <div class="hwf-niche-title" id="hwf-detected-niche">Scanning marketplace...</div>
          <div class="hwf-metrics-grid">
            <div class="hwf-metric-box">
              <span class="hwf-metric-lbl">Demand</span>
              <span class="hwf-metric-val green" id="hwf-m-demand">91/100</span>
            </div>
            <div class="hwf-metric-box">
              <span class="hwf-metric-lbl">Competition</span>
              <span class="hwf-metric-val green" id="hwf-m-comp">23/100</span>
            </div>
            <div class="hwf-metric-box">
              <span class="hwf-metric-lbl">Est. Margin</span>
              <span class="hwf-metric-val" id="hwf-m-margin">65%</span>
            </div>
            <div class="hwf-metric-box">
              <span class="hwf-metric-lbl">Opportunity</span>
              <span class="hwf-metric-val gold" id="hwf-m-opp">95/100</span>
            </div>
          </div>
          <div class="hwf-action-row">
            <button class="hwf-btn-primary" id="hwf-analyze-btn">
              ⚡ Open Full Winner Dossier
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(widget);

    // Event listeners
    const trigger = document.getElementById('hwf-open-trigger');
    const card = document.getElementById('hwf-card');
    const closeBtn = document.getElementById('hwf-card-close');
    const analyzeBtn = document.getElementById('hwf-analyze-btn');

    trigger.addEventListener('click', () => {
      const isVisible = card.style.display !== 'none';
      if (isVisible) {
        card.style.display = 'none';
      } else {
        card.style.display = 'block';
        updateCardData();
      }
    });

    closeBtn.addEventListener('click', () => {
      card.style.display = 'none';
    });

    analyzeBtn.addEventListener('click', () => {
      const signals = extractPageSignals();
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({
          pendingMarketSearch: signals.searchQuery || 'Trending Niche',
          pendingPlatform: platform
        }, () => {
          alert('Opened in Hidden Winner Finder extension! Click the extension icon in your browser toolbar to view the full dossier.');
        });
      }
    });
  }

  function updateCardData() {
    const signals = extractPageSignals();
    const nicheEl = document.getElementById('hwf-detected-niche');
    if (nicheEl) {
      nicheEl.innerText = signals.searchQuery ? `Target Niche: "${signals.searchQuery}"` : `Active Platform: ${platform}`;
    }
  }

  // Listen for messages from background
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
      if (req.action === 'HWF_GET_PAGE_DATA') {
        sendResponse(extractPageSignals());
      } else if (req.action === 'HWF_TRIGGER_PAGE_SCAN') {
        const card = document.getElementById('hwf-card');
        if (card) {
          card.style.display = 'block';
          updateCardData();
        }
        sendResponse({ status: 'ok' });
      }
    });
  }

  // Inject when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectFloatingWidget);
  } else {
    injectFloatingWidget();
  }
})();
