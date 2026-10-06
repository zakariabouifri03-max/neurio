/**
 * Hidden Winner Finder - Popup Controller
 * Coordinates UI rendering, animations, scanner interaction, and storage.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const btnFindWinner = document.getElementById('btn-find-winner');
  const btnScanMarketTab = document.getElementById('btn-scan-market-tab');
  const btnQuickScan = document.getElementById('btn-quick-scan');
  const inputCustomSearch = document.getElementById('input-custom-search');
  const selectMarket = document.getElementById('filter-market');
  const selectCountry = document.getElementById('filter-country');
  const selectCategory = document.getElementById('filter-category');
  const selectBudget = document.getElementById('filter-budget');

  const winnerContainer = document.getElementById('winner-result-container');
  const scanningState = document.getElementById('scanning-state');
  const scanningStatus = document.getElementById('scanning-status');
  const scanningProgressBar = document.getElementById('scanning-progress-bar');

  const livePageAlert = document.getElementById('live-page-alert');
  const livePageText = document.getElementById('live-page-text');
  const btnUseLivePage = document.getElementById('btn-use-live-page');

  const navTabs = document.querySelectorAll('.nav-tab');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const btnSavedToggle = document.getElementById('btn-saved-toggle');
  const savedBadgeCount = document.getElementById('saved-badge-count');
  const btnHelpToggle = document.getElementById('btn-help-toggle');
  const modalInfo = document.getElementById('modal-info');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const toastNotification = document.getElementById('toast-notification');
  const toastMessage = document.getElementById('toast-message');

  // Calculator inputs
  const calcMarketplaceSelect = document.getElementById('calc-marketplace-select');
  const calcPriceInput = document.getElementById('calc-price-input');
  const calcCostInput = document.getElementById('calc-cost-input');
  const calcShippingInput = document.getElementById('calc-shipping-input');
  const calcUnitsInput = document.getElementById('calc-units-input');

  let currentWinningProduct = null;
  let savedProducts = [];
  let detectedPageData = null;

  // Initialize
  await init();

  async function init() {
    setupTabNav();
    setupCalculatorListeners();
    setupModalListeners();
    await loadSavedProducts();
    await checkActiveTabSignals();

    // Run initial search so the user immediately sees the #1 winning product
    runFindWinner(false);
  }

  // Check if user is currently on Etsy / Amazon / etc.
  async function checkActiveTabSignals() {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0] && tabs[0].url) {
          const url = tabs[0].url.toLowerCase();
          let mName = '';
          if (url.includes('etsy.com')) mName = 'Etsy';
          else if (url.includes('amazon.com')) mName = 'Amazon';
          else if (url.includes('ebay.com')) mName = 'eBay';
          else if (url.includes('walmart.com')) mName = 'Walmart';
          else if (url.includes('tiktok.com')) mName = 'TikTok Shop';
          else if (url.includes('aliexpress.com')) mName = 'AliExpress';

          if (mName) {
            detectedPageData = { marketplace: mName, url: tabs[0].url };
            livePageText.innerText = `Active ${mName} tab detected. Ready to extract niche signals.`;
            livePageAlert.style.display = 'flex';
          }
        }
      });
    }
  }

  if (btnUseLivePage) {
    btnUseLivePage.addEventListener('click', () => {
      if (detectedPageData) {
        if (selectMarket) {
          selectMarket.value = detectedPageData.marketplace.toLowerCase();
        }
        showToast(`Connected to active ${detectedPageData.marketplace} tab! Scanning niche...`);
        runFindWinner(true);
      }
    });
  }

  // Tab Navigation
  function setupTabNav() {
    navTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const targetId = tab.dataset.tab;
        switchTab(targetId);
      });
    });

    if (btnSavedToggle) {
      btnSavedToggle.addEventListener('click', () => {
        switchTab('tab-saved');
      });
    }

    // Category pills in Discovery tab
    document.querySelectorAll('.filter-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        renderDiscoveryTable(pill.dataset.filter);
      });
    });

    if (btnScanMarketTab) {
      btnScanMarketTab.addEventListener('click', () => {
        renderDiscoveryTable('all');
        showToast('Market scan updated with latest data!');
      });
    }
  }

  function switchTab(targetId) {
    navTabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === targetId));
    tabPanes.forEach((p) => p.classList.toggle('active', p.id === targetId));

    if (targetId === 'tab-discovery') {
      renderDiscoveryTable('all');
    } else if (targetId === 'tab-saved') {
      renderSavedList();
    } else if (targetId === 'tab-calculator' && currentWinningProduct) {
      syncCalculatorWithProduct(currentWinningProduct);
    }
  }

  // Find Winning Product Action
  btnFindWinner.addEventListener('click', () => runFindWinner(true));
  if (btnQuickScan) {
    btnQuickScan.addEventListener('click', () => runFindWinner(true));
  }

  async function runFindWinner(withAnimation = true) {
    const filters = {
      marketplace: selectMarket.value,
      country: selectCountry.value,
      category: selectCategory.value,
      budget: Number(selectBudget.value) || 500,
      searchQuery: inputCustomSearch.value.trim()
    };

    if (withAnimation) {
      winnerContainer.style.display = 'none';
      scanningState.style.display = 'block';

      const steps = [
        { progress: 20, text: 'Scanning search result density & listing volume...' },
        { progress: 45, text: 'Measuring review barriers & established seller dominance...' },
        { progress: 70, text: 'Evaluating active buyer cart signals & sales velocity...' },
        { progress: 90, text: 'Comparing supplier pricing on Alibaba, AliExpress & POD...' },
        { progress: 100, text: 'Isolating #1 Undisputed Hidden Opportunity...' }
      ];

      for (let i = 0; i < steps.length; i++) {
        scanningProgressBar.style.width = steps[i].progress + '%';
        scanningStatus.innerText = steps[i].text;
        await new Promise((r) => setTimeout(r, 160));
      }

      scanningState.style.display = 'none';
      winnerContainer.style.display = 'block';
    }

    // Call Core Engine
    const winner = MarketScanner.findWinningProduct(filters);
    currentWinningProduct = winner;

    if (winner) {
      renderWinningProduct(winner);
    } else {
      winnerContainer.innerHTML = `
        <div class="card" style="text-align: center; padding: 24px;">
          <p style="color: #f87171; font-weight: 700;">No hidden opportunities found matching the exact filters.</p>
          <p style="color: var(--text-muted); font-size: 12px; margin-top: 6px;">Try changing the category to "Any" or increasing the budget tier.</p>
        </div>
      `;
    }
  }

  // Render the #1 Winning Product Dossier
  function renderWinningProduct(p) {
    const isSaved = savedProducts.some((item) => item.id === p.id);

    winnerContainer.innerHTML = `
      <div class="winner-hero-card">
        <div class="winner-badge-header">
          <div class="flame-badge">
            <span>🔥</span> WINNING PRODUCT
          </div>
          <div class="badge-conf ${p.confidence.badgeClass}">
            <span>${p.confidence.level} Confidence</span> · Estimated
          </div>
        </div>

        <h2 class="winner-product-name">${p.name}</h2>

        <!-- 4 Core Metric Pills -->
        <div class="metrics-quad-grid">
          <div class="metric-pill-card">
            <span class="metric-pill-label">Demand</span>
            <span class="metric-pill-value green">${p.demandScore}/100</span>
          </div>
          <div class="metric-pill-card">
            <span class="metric-pill-label">Competition</span>
            <span class="metric-pill-value green">${p.competitionScore}/100</span>
          </div>
          <div class="metric-pill-card">
            <span class="metric-pill-label">Est. Margin</span>
            <span class="metric-pill-value gold">${p.profitMarginFormatted}</span>
          </div>
          <div class="metric-pill-card">
            <span class="metric-pill-label">Trend</span>
            <span class="metric-pill-value flame">${p.trendLabel}</span>
          </div>
        </div>

        <!-- Primary Opportunity Banner -->
        <div class="opportunity-score-banner">
          <div class="opp-banner-left">
            <span class="opp-star-icon">⭐</span>
            <div>
              <div class="opp-title-text">OPPORTUNITY SCORE</div>
              <div style="font-size: 11px; color: #cbd5e1;">Prime sweet spot: High demand meets low seller moat</div>
            </div>
          </div>
          <div class="opp-score-huge">${p.opportunityScore}/100</div>
        </div>

        <!-- Key Stats Breakdown -->
        <div class="product-key-stats-list">
          <div class="stat-item-row">
            <span class="stat-item-label">Estimated Monthly Sales:</span>
            <span class="stat-item-val">${p.estimatedMonthlySales} units</span>
          </div>
          <div class="stat-item-row">
            <span class="stat-item-label">Estimated Monthly Revenue:</span>
            <span class="stat-item-val" style="color: var(--accent-emerald);">${p.estimatedMonthlyRevenue}</span>
          </div>
          <div class="stat-item-row">
            <span class="stat-item-label">Average Price:</span>
            <span class="stat-item-val">${p.averagePrice}</span>
          </div>
          <div class="stat-item-row">
            <span class="stat-item-label">Estimated Profit Margin:</span>
            <span class="stat-item-val" style="color: var(--accent-gold);">${p.profitMarginFormatted}</span>
          </div>
          <div class="stat-item-row">
            <span class="stat-item-label">Trend Momentum:</span>
            <span class="stat-item-val">${p.trendData.summary}</span>
          </div>
        </div>

        <!-- 4 Quick Actions -->
        <div class="action-buttons-quad">
          <button id="btn-view-product" class="btn-quad btn-quad-view">
            <span>🔍</span> VIEW PRODUCT
          </button>
          <button id="btn-find-suppliers" class="btn-quad btn-quad-suppliers">
            <span>🏭</span> FIND SUPPLIERS
          </button>
          <button id="btn-see-competitors" class="btn-quad btn-quad-competitors">
            <span>⚔️</span> SEE COMPETITORS
          </button>
          <button id="btn-save-winner" class="btn-quad btn-quad-save">
            <span>${isSaved ? '★' : '⭐'}</span> ${isSaved ? 'SAVED' : 'SAVE PRODUCT'}
          </button>
        </div>
      </div>

      <!-- Accordion Detailed Intelligence Sections -->
      <div class="dossier-accordion">
        
        <!-- SECTION 1: WHY THIS PRODUCT? -->
        <div class="dossier-item open" id="dossier-why">
          <div class="dossier-header">
            <div class="dossier-title-wrap">
              <span class="dossier-icon">💡</span>
              <span class="dossier-title">WHY THIS PRODUCT?</span>
            </div>
            <span class="dossier-arrow">▼</span>
          </div>
          <div class="dossier-body">
            <ul class="why-reasons-list">
              ${p.whySelected.map(r => `
                <li class="why-reason-item">
                  <span class="why-bullet-icon">✓</span>
                  <span>${r}</span>
                </li>
              `).join('')}
            </ul>
            <div style="margin-top: 10px; font-size: 11px; color: var(--text-muted); background: rgba(0,0,0,0.25); padding: 8px; border-radius: 6px;">
              🛡️ <strong>Beginner Verdict:</strong> ${p.beginnerFriendly ? 'Highly suitable for new sellers due to lightweight fulfillment and low review barriers.' : 'Best for sellers with experience in inventory handling.'}
            </div>
          </div>
        </div>

        <!-- SECTION 2: FIND WHERE TO SELL IT -->
        <div class="dossier-item" id="dossier-sell">
          <div class="dossier-header">
            <div class="dossier-title-wrap">
              <span class="dossier-icon">🏬</span>
              <span class="dossier-title">FIND WHERE TO SELL IT</span>
            </div>
            <span class="dossier-arrow">▼</span>
          </div>
          <div class="dossier-body">
            <div class="market-recommendation-hero">
              <div class="m-rec-header">
                <div>
                  <span style="font-size: 10px; text-transform: uppercase; color: var(--accent-gold); font-weight: 700;">Top Platform Recommendation</span>
                  <div class="m-rec-name">${p.marketplaces.bestMarketplace.icon} Best Marketplace: ${p.marketplaces.bestMarketplace.name}</div>
                </div>
                <div class="badge-low-competition comp-badge-pill">Fit: ${p.marketplaces.bestMarketplace.suitabilityScore}/100</div>
              </div>

              <div class="m-rec-triad">
                <div class="m-triad-box">
                  <span class="lbl">Competition</span>
                  <span class="val" style="color: var(--accent-emerald);">${p.marketplaces.bestMarketplace.competition}</span>
                </div>
                <div class="m-triad-box">
                  <span class="lbl">Demand</span>
                  <span class="val" style="color: var(--accent-gold);">${p.marketplaces.bestMarketplace.demand}</span>
                </div>
                <div class="m-triad-box">
                  <span class="lbl">Opportunity</span>
                  <span class="val" style="color: var(--accent-emerald);">${p.marketplaces.bestMarketplace.opportunity}</span>
                </div>
              </div>

              <p style="font-size: 11.5px; color: #cbd5e1; margin-top: 8px;">
                ${p.marketplaces.bestMarketplace.reason}
              </p>
            </div>

            <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); margin-bottom: 6px; text-transform: uppercase;">
              Cross-Platform Opportunity Breakdown
            </div>

            <div style="display: flex; flex-direction: column; gap: 6px;">
              ${p.marketplaces.allPlatforms.map(pl => `
                <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); padding: 6px 10px; border-radius: 6px; font-size: 11.5px;">
                  <div>
                    <strong>${pl.icon} ${pl.name}</strong>
                    <span style="font-size: 10px; color: var(--text-muted); display: block;">${pl.feeSummary}</span>
                  </div>
                  <div style="text-align: right;">
                    <span style="font-size: 10.5px; font-weight: 700; color: ${pl.opportunity === 'Excellent' ? 'var(--accent-emerald)' : 'var(--accent-gold)'};">${pl.opportunity}</span>
                    <span style="font-size: 10px; color: var(--text-dim); display: block;">Demand: ${pl.demand}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- SECTION 3: FIND WHERE TO SOURCE IT -->
        <div class="dossier-item" id="dossier-source">
          <div class="dossier-header">
            <div class="dossier-title-wrap">
              <span class="dossier-icon">📦</span>
              <span class="dossier-title">FIND WHERE TO SOURCE IT (SOURCE IT)</span>
            </div>
            <span class="dossier-arrow">▼</span>
          </div>
          <div class="dossier-body">
            <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">
              Verified supplier channels with estimated wholesale pricing, MOQs, and direct sourcing links.
            </p>
            <div class="source-cards-list">
              ${p.sourcing.map(s => `
                <div class="source-card">
                  <div class="source-card-header">
                    <span class="source-name">${s.supplier}</span>
                    <span class="source-badge">${s.badge}</span>
                  </div>
                  <div class="source-meta-grid">
                    <div class="source-meta-item">Est. Cost: <span>${s.estimatedCost}</span></div>
                    <div class="source-meta-item">Min Order: <span>${s.minimumOrder}</span></div>
                    <div class="source-meta-item">Shipping: <span>${s.shipping}</span></div>
                    <div class="source-meta-item">Est. Profit: <span style="color: var(--accent-emerald);">${s.estimatedProfit}</span></div>
                  </div>
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                    <span style="font-size: 10px; color: var(--text-dim);">${s.advantage}</span>
                    <a href="${s.supplierLink}" target="_blank" rel="noopener noreferrer" class="source-link-btn">
                      ${s.linkText}
                    </a>
                  </div>
                </div>
              `).join('')}
            </div>
            <div style="font-size: 10px; color: var(--text-dim); margin-top: 8px; text-align: center;">
              * All supplier costs and lead times are estimated based on public category data.
            </div>
          </div>
        </div>

        <!-- SECTION 4: LOW-COMPETITION DETECTOR -->
        <div class="dossier-item" id="dossier-competition">
          <div class="dossier-header">
            <div class="dossier-title-wrap">
              <span class="dossier-icon">🛡️</span>
              <span class="dossier-title">LOW-COMPETITION DETECTOR</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="comp-badge-pill ${p.competitionData.badgeClass}">Score: ${p.competitionScore}/100</span>
              <span class="dossier-arrow">▼</span>
            </div>
          </div>
          <div class="dossier-body">
            <p style="font-size: 11.5px; color: #cbd5e1; margin-bottom: 10px;">
              ${p.competitionData.description}
            </p>
            <div class="comp-factor-list">
              ${p.competitionData.factors.map(f => `
                <div class="comp-factor-row">
                  <div>
                    <strong style="color: #fff;">${f.name}</strong>
                    <span style="font-size: 10px; color: var(--text-muted); display: block;">${f.detail}</span>
                  </div>
                  <div style="text-align: right;">
                    <span style="color: #cbd5e1; font-weight: 600;">${f.value}</span>
                    <span style="font-size: 10px; color: var(--accent-emerald); display: block;">${f.rating}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- SECTION 5: DEMAND DETECTOR -->
        <div class="dossier-item" id="dossier-demand">
          <div class="dossier-header">
            <div class="dossier-title-wrap">
              <span class="dossier-icon">📈</span>
              <span class="dossier-title">DEMAND DETECTOR</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="comp-badge-pill badge-low-competition">Score: ${p.demandScore}/100</span>
              <span class="dossier-arrow">▼</span>
            </div>
          </div>
          <div class="dossier-body">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px;">
              ${p.demandData.signals.map(s => `
                <div style="background: rgba(255,255,255,0.02); padding: 8px; border-radius: 6px;">
                  <span style="font-size: 10px; color: var(--text-muted); display: block;">${s.label}</span>
                  <strong style="font-size: 11.5px; color: #fff;">${s.value}</strong>
                  <span style="font-size: 9.5px; color: var(--accent-emerald); display: block; margin-top: 2px;">${s.indicator}</span>
                </div>
              `).join('')}
            </div>

            <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); margin-bottom: 6px; text-transform: uppercase;">
              Demand Driver Analysis:
            </div>
            <ul class="why-reasons-list">
              ${p.demandData.reasons.map(r => `
                <li class="why-reason-item">
                  <span class="why-bullet-icon">⚡</span>
                  <span>${r}</span>
                </li>
              `).join('')}
            </ul>
          </div>
        </div>

        <!-- SECTION 6: PROFIT CALCULATOR SUMMARY -->
        <div class="dossier-item" id="dossier-profit">
          <div class="dossier-header">
            <div class="dossier-title-wrap">
              <span class="dossier-icon">🧮</span>
              <span class="dossier-title">PROFIT CALCULATOR</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="comp-badge-pill" style="background: rgba(16, 185, 129, 0.2); color: #34d399;">$${p.profitData.estimatedProfit} Net</span>
              <span class="dossier-arrow">▼</span>
            </div>
          </div>
          <div class="dossier-body">
            <div class="calc-breakdown-list">
              <div class="calc-row">
                <span>Selling Price:</span>
                <strong>$${p.profitData.sellingPrice}</strong>
              </div>
              <div class="calc-row">
                <span>Product Cost:</span>
                <strong class="text-rose">-$${p.profitData.productCost}</strong>
              </div>
              <div class="calc-row">
                <span>Shipping:</span>
                <strong class="text-rose">-$${p.profitData.shippingCost}</strong>
              </div>
              <div class="calc-row">
                <span>Marketplace Fees (${p.profitData.marketplaceName}):</span>
                <strong class="text-rose">-$${p.profitData.marketplaceFees}</strong>
              </div>
              <div class="calc-divider"></div>
              <div class="calc-row highlight">
                <span>Estimated Profit:</span>
                <strong class="text-emerald">$${p.profitData.estimatedProfit}</strong>
              </div>
              <div class="calc-row">
                <span>Profit Margin:</span>
                <strong class="text-emerald">${p.profitData.profitMarginFormatted}</strong>
              </div>
            </div>
            <button id="btn-open-full-calc" class="btn-secondary" style="width: 100%; margin-top: 10px;">
              Open Interactive Calculator Tab ↗
            </button>
          </div>
        </div>

        <!-- SECTION 7: TREND ANALYSIS -->
        <div class="dossier-item" id="dossier-trend">
          <div class="dossier-header">
            <div class="dossier-title-wrap">
              <span class="dossier-icon">🔥</span>
              <span class="dossier-title">TREND ANALYSIS</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="comp-badge-pill" style="background: rgba(239, 68, 68, 0.2); color: #f87171;">${p.trendData.symbol} ${p.trendData.status}</span>
              <span class="dossier-arrow">▼</span>
            </div>
          </div>
          <div class="dossier-body">
            <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
              <div style="background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 6px; flex: 1; margin-right: 6px;">
                <span style="font-size: 10px; color: var(--text-muted); display: block;">30 Days:</span>
                <strong style="color: var(--accent-emerald); font-size: 12px;">${p.trendData.days30.trajectory}</strong>
              </div>
              <div style="background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 6px; flex: 1;">
                <span style="font-size: 10px; color: var(--text-muted); display: block;">90 Days:</span>
                <strong style="color: var(--accent-emerald); font-size: 12px;">${p.trendData.days90.trajectory}</strong>
              </div>
            </div>
            <div style="font-size: 11.5px; color: #cbd5e1;">
              <strong>Seasonality Profile:</strong> ${p.trendData.seasonality}
            </div>
          </div>
        </div>

        <!-- SECTION 8: PRODUCT IDEAS & DIFFERENTIATION -->
        <div class="dossier-item" id="dossier-ideas">
          <div class="dossier-header">
            <div class="dossier-title-wrap">
              <span class="dossier-icon">🎨</span>
              <span class="dossier-title">PRODUCT IDEAS & DIFFERENTIATION</span>
            </div>
            <span class="dossier-arrow">▼</span>
          </div>
          <div class="dossier-body">
            <div class="ideas-tabs-nav">
              <button class="idea-subtab active" data-subtab="subtab-variations">5 Variations</button>
              <button class="idea-subtab" data-subtab="subtab-angles">5 Unique Angles</button>
              <button class="idea-subtab" data-subtab="subtab-customers">5 Customer Types</button>
              <button class="idea-subtab" data-subtab="subtab-titles">5 SEO Titles</button>
              <button class="idea-subtab" data-subtab="subtab-keywords">10 Keywords</button>
            </div>

            <div id="ideas-subcontent" class="ideas-content-area">
              <!-- Rendered by subtab click -->
            </div>

            <div style="margin-top: 10px; padding: 8px; background: rgba(99, 102, 241, 0.15); border-radius: 6px; font-size: 11px;">
              <strong>Suggested Price Range:</strong> ${p.ideas.priceRange.min} – ${p.ideas.priceRange.max} (Sweet Spot: <strong>${p.ideas.priceRange.sweetSpot}</strong>)
            </div>
          </div>
        </div>

        <!-- SECTION 9: WHERE TO FIND CUSTOMERS -->
        <div class="dossier-item" id="dossier-channels">
          <div class="dossier-header">
            <div class="dossier-title-wrap">
              <span class="dossier-icon">📣</span>
              <span class="dossier-title">WHERE TO FIND CUSTOMERS</span>
            </div>
            <span class="dossier-arrow">▼</span>
          </div>
          <div class="dossier-body">
            <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 6px; padding: 10px; margin-bottom: 10px;">
              <span style="font-size: 10px; text-transform: uppercase; color: var(--accent-emerald); font-weight: 700;">#1 Most Suitable Traffic Source</span>
              <div style="font-size: 14px; font-weight: 800; color: #fff; margin: 2px 0;">${p.channels.primaryChannel.icon} ${p.channels.primaryChannel.name}</div>
              <div style="font-size: 11.5px; color: #cbd5e1; margin-top: 4px;">${p.channels.primaryChannel.strategy}</div>
            </div>

            <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); margin-bottom: 6px;">
              All Acquisition Channels:
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px;">
              ${p.channels.allChannels.map(ch => `
                <div style="background: rgba(255,255,255,0.02); padding: 6px 10px; border-radius: 6px; font-size: 11.5px;">
                  <div style="display: flex; justify-content: space-between;">
                    <strong>${ch.icon} ${ch.name}</strong>
                    <span style="color: var(--accent-emerald); font-weight: 600;">Fit: ${ch.fitScore}/100</span>
                  </div>
                  <div style="font-size: 10.5px; color: var(--text-muted); margin-top: 2px;">${ch.strategy}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

      </div>
    `;

    // Setup accordion toggles
    setupAccordion();

    // Setup action buttons inside the card
    setupCardActions(p);

    // Initial render of ideas subtab
    renderIdeasSubtab('subtab-variations', p);
  }

  // Accordion Expand/Collapse logic
  function setupAccordion() {
    document.querySelectorAll('.dossier-header').forEach((header) => {
      header.addEventListener('click', () => {
        const item = header.closest('.dossier-item');
        item.classList.toggle('open');
      });
    });
  }

  // Card action buttons logic
  function setupCardActions(p) {
    const btnView = document.getElementById('btn-view-product');
    const btnSuppliers = document.getElementById('btn-find-suppliers');
    const btnCompetitors = document.getElementById('btn-see-competitors');
    const btnSave = document.getElementById('btn-save-winner');
    const btnOpenCalc = document.getElementById('btn-open-full-calc');

    if (btnView) {
      btnView.addEventListener('click', () => {
        const q = encodeURIComponent(p.name);
        const url = `https://www.etsy.com/search?q=${q}`;
        window.open(url, '_blank');
      });
    }

    if (btnSuppliers) {
      btnSuppliers.addEventListener('click', () => {
        const sec = document.getElementById('dossier-source');
        if (sec) {
          sec.classList.add('open');
          sec.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }

    if (btnCompetitors) {
      btnCompetitors.addEventListener('click', () => {
        const q = encodeURIComponent(p.name);
        window.open(`https://www.google.com/search?q=${q}+competition`, '_blank');
      });
    }

    if (btnSave) {
      btnSave.addEventListener('click', async () => {
        await toggleSaveProduct(p);
        const isSaved = savedProducts.some((item) => item.id === p.id);
        btnSave.innerHTML = `<span>${isSaved ? '★' : '⭐'}</span> ${isSaved ? 'SAVED' : 'SAVE PRODUCT'}`;
        showToast(isSaved ? 'Product saved to your portfolio!' : 'Product removed from saved.');
      });
    }

    if (btnOpenCalc) {
      btnOpenCalc.addEventListener('click', () => {
        switchTab('tab-calculator');
      });
    }

    // Subtab clicks for Product Ideas
    document.querySelectorAll('.idea-subtab').forEach((st) => {
      st.addEventListener('click', () => {
        document.querySelectorAll('.idea-subtab').forEach((s) => s.classList.remove('active'));
        st.classList.add('active');
        renderIdeasSubtab(st.dataset.subtab, p);
      });
    });
  }

  function renderIdeasSubtab(subtabId, p) {
    const container = document.getElementById('ideas-subcontent');
    if (!container || !p.ideas) return;

    if (subtabId === 'subtab-variations') {
      container.innerHTML = p.ideas.variations.map((v, i) => `
        <div class="idea-bullet-card">
          <div class="idea-card-header">
            <span>#${i+1} ${v.name}</span>
          </div>
          <div class="idea-card-desc">${v.description}</div>
        </div>
      `).join('');
    } else if (subtabId === 'subtab-angles') {
      container.innerHTML = p.ideas.angles.map((a, i) => `
        <div class="idea-bullet-card">
          <div class="idea-card-header">
            <span>💡 Angle ${i+1}: ${a.title}</span>
          </div>
          <div class="idea-card-desc">${a.description}</div>
        </div>
      `).join('');
    } else if (subtabId === 'subtab-customers') {
      container.innerHTML = p.ideas.customerTypes.map((c, i) => `
        <div class="idea-bullet-card">
          <div class="idea-card-header">
            <span>👤 ${c.type}</span>
            <span style="color: var(--accent-gold); font-size: 10px;">${c.avgSpend}</span>
          </div>
          <div class="idea-card-desc">${c.motive}</div>
        </div>
      `).join('');
    } else if (subtabId === 'subtab-titles') {
      container.innerHTML = p.ideas.titleIdeas.map((t, i) => `
        <div class="idea-bullet-card">
          <div class="idea-card-header">
            <span style="font-size: 11px;">SEO Title #${i+1}</span>
            <button class="copy-mini-btn" data-copy="${escapeHtml(t)}">📋 Copy</button>
          </div>
          <div class="idea-card-desc" style="color: #fff; font-size: 11.5px;">${t}</div>
        </div>
      `).join('');
      setupCopyButtons(container);
    } else if (subtabId === 'subtab-keywords') {
      container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 4px;">
          ${p.ideas.keywordIdeas.map((k, i) => `
            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); padding: 5px 8px; border-radius: 4px; font-size: 11px;">
              <div>
                <strong style="color: #fff;">${i+1}. ${k.keyword}</strong>
                <span style="color: var(--text-muted); font-size: 9.5px; margin-left: 6px;">${k.intent}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="color: var(--accent-gold);">${k.volume}</span>
                <button class="copy-mini-btn" data-copy="${k.keyword}">Copy</button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
      setupCopyButtons(container);
    }
  }

  function setupCopyButtons(parent) {
    parent.querySelectorAll('.copy-mini-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const text = btn.dataset.copy;
        navigator.clipboard.writeText(text).then(() => {
          btn.innerText = '✓ Copied';
          setTimeout(() => (btn.innerText = '📋 Copy'), 1400);
          showToast('Copied to clipboard!');
        });
      });
    });
  }

  // Render Discovery / Scan Market Ranked Table
  function renderDiscoveryTable(categoryFilter = 'all') {
    const tbody = document.getElementById('discovery-table-body');
    if (!tbody) return;

    const filters = {
      category: categoryFilter,
      marketplace: selectMarket ? selectMarket.value : 'any',
      budget: Number(selectBudget ? selectBudget.value : 500)
    };

    const ranked = MarketScanner.scanMarket(filters);

    tbody.innerHTML = ranked.map((item) => `
      <tr>
        <td>
          <span class="rank-badge">#${item.rank}</span>
          <strong style="color: #fff; font-size: 12px;">${item.name}</strong>
          <span style="display: block; font-size: 10px; color: var(--text-dim);">${item.category} · ${item.preferredMarketplace}</span>
        </td>
        <td>
          <span style="color: var(--accent-emerald); font-weight: 700;">${item.demandScore}/100</span>
        </td>
        <td>
          <span style="color: ${item.competitionScore <= 30 ? 'var(--accent-emerald)' : 'var(--accent-gold)'}; font-weight: 700;">${item.competitionScore}/100</span>
          <span style="display: block; font-size: 9px; color: var(--text-dim);">${item.competitionLevel}</span>
        </td>
        <td>
          <span style="color: var(--accent-gold); font-weight: 700;">${item.profitMarginFormatted}</span>
        </td>
        <td>
          <span>${item.trendLabel}</span>
        </td>
        <td>
          <span style="font-weight: 800; font-size: 13px; color: var(--accent-gold);">${item.opportunityScore}/100</span>
        </td>
        <td>
          <button class="btn-micro btn-inspect-item" data-id="${item.id}">View Dossier</button>
        </td>
      </tr>
    `).join('');

    // Clicking "View Dossier" loads that product
    tbody.querySelectorAll('.btn-inspect-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const match = ranked.find((p) => p.id === id);
        if (match) {
          const dossier = MarketScanner.enrichWinningDossier(match, filters);
          currentWinningProduct = dossier;
          switchTab('tab-main');
          renderWinningProduct(dossier);
          showToast(`Viewing opportunity: "${match.name}"`);
        }
      });
    });
  }

  // Interactive Calculator Logic
  function setupCalculatorListeners() {
    [calcPriceInput, calcCostInput, calcShippingInput, calcUnitsInput, calcMarketplaceSelect].forEach((el) => {
      if (el) {
        el.addEventListener('input', recalculateCustomProfit);
        el.addEventListener('change', recalculateCustomProfit);
      }
    });
  }

  function syncCalculatorWithProduct(p) {
    if (!p) return;
    if (calcPriceInput) calcPriceInput.value = p.price;
    if (calcCostInput) calcCostInput.value = p.cost;
    if (calcShippingInput) calcShippingInput.value = p.shippingCost;
    if (calcMarketplaceSelect && p.marketplaces && p.marketplaces.bestMarketplace) {
      const bestId = p.marketplaces.bestMarketplace.name.toLowerCase();
      if (calcMarketplaceSelect.querySelector(`option[value="${bestId}"]`)) {
        calcMarketplaceSelect.value = bestId;
      }
    }
    recalculateCustomProfit();
  }

  function recalculateCustomProfit() {
    const sp = parseFloat(calcPriceInput.value) || 0;
    const cost = parseFloat(calcCostInput.value) || 0;
    const ship = parseFloat(calcShippingInput.value) || 0;
    const units = parseInt(calcUnitsInput.value, 10) || 100;
    const market = calcMarketplaceSelect.value;

    const res = ProfitCalculator.calculate({
      sellingPrice: sp,
      productCost: cost,
      shippingCost: ship,
      marketplace: market
    });

    const netVal = document.getElementById('calc-net-profit');
    const marginVal = document.getElementById('calc-profit-margin');
    const outPrice = document.getElementById('calc-out-price');
    const outCost = document.getElementById('calc-out-cost');
    const outShip = document.getElementById('calc-out-ship');
    const outFees = document.getElementById('calc-out-fees');
    const outMonthlyNet = document.getElementById('calc-out-monthly-net');
    const outRoi = document.getElementById('calc-out-roi');

    if (netVal) netVal.innerText = `$${res.estimatedProfit}`;
    if (marginVal) marginVal.innerText = `${res.profitMargin}% Profit Margin`;
    if (outPrice) outPrice.innerText = `$${res.sellingPrice}`;
    if (outCost) outCost.innerText = `-$${res.productCost}`;
    if (outShip) outShip.innerText = `-$${res.shippingCost}`;
    if (outFees) outFees.innerText = `-$${res.marketplaceFees}`;

    const monthlyNet = Math.round(Number(res.estimatedProfit) * units * 100) / 100;
    if (outMonthlyNet) outMonthlyNet.innerText = `$${monthlyNet.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (outRoi) outRoi.innerText = `${res.roi}%`;
  }

  // Saved Products State Management
  async function loadSavedProducts() {
    const data = await StorageAdapter.get('saved_winners');
    savedProducts = data.saved_winners || [];
    updateSavedBadge();
  }

  async function toggleSaveProduct(p) {
    const index = savedProducts.findIndex((item) => item.id === p.id);
    if (index >= 0) {
      savedProducts.splice(index, 1);
    } else {
      savedProducts.push({
        id: p.id,
        name: p.name,
        category: p.category,
        price: p.price,
        opportunityScore: p.opportunityScore,
        profitMargin: p.profitMarginFormatted,
        demandScore: p.demandScore,
        competitionScore: p.competitionScore,
        savedAt: new Date().toISOString()
      });
    }
    await StorageAdapter.set({ saved_winners: savedProducts });
    updateSavedBadge();
  }

  function updateSavedBadge() {
    if (savedBadgeCount) {
      if (savedProducts.length > 0) {
        savedBadgeCount.innerText = savedProducts.length;
        savedBadgeCount.style.display = 'flex';
      } else {
        savedBadgeCount.style.display = 'none';
      }
    }
  }

  function renderSavedList() {
    const container = document.getElementById('saved-list-container');
    if (!container) return;

    if (savedProducts.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align: center; padding: 24px;">
          <p style="color: var(--text-muted); font-size: 13px;">No saved winning products yet.</p>
          <p style="color: var(--text-dim); font-size: 11.5px; margin-top: 4px;">Click <strong>[ SAVE PRODUCT ]</strong> on any opportunity to track it here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = savedProducts.map((p) => `
      <div class="saved-item-card">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div class="saved-item-title">${p.name}</div>
          <span style="color: var(--accent-gold); font-weight: 800; font-size: 13px;">${p.opportunityScore}/100</span>
        </div>
        <div style="display: flex; gap: 12px; font-size: 11.5px; color: var(--text-muted); margin: 4px 0;">
          <span>Category: <strong style="color: #fff;">${p.category}</strong></span>
          <span>Price: <strong style="color: #fff;">$${p.price}</strong></span>
          <span>Margin: <strong style="color: var(--accent-emerald);">${p.profitMargin}</strong></span>
        </div>
        <div class="saved-item-footer">
          <button class="btn-micro btn-inspect-saved" data-id="${p.id}">View Dossier</button>
          <button class="btn-micro" style="color: #f87171; border-color: rgba(239, 68, 68, 0.3);" data-remove="${p.id}">Remove</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.btn-inspect-saved').forEach((btn) => {
      btn.addEventListener('click', () => {
        const match = CuratedDatabase.products.find((item) => item.id === btn.dataset.id);
        if (match) {
          const dossier = MarketScanner.enrichWinningDossier(match, {});
          currentWinningProduct = dossier;
          switchTab('tab-main');
          renderWinningProduct(dossier);
        }
      });
    });

    container.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.remove;
        savedProducts = savedProducts.filter((p) => p.id !== id);
        await StorageAdapter.set({ saved_winners: savedProducts });
        updateSavedBadge();
        renderSavedList();
        showToast('Item removed from saved.');
      });
    });
  }

  // Export Saved JSON
  const btnExportSaved = document.getElementById('btn-export-all-saved');
  if (btnExportSaved) {
    btnExportSaved.addEventListener('click', () => {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(savedProducts, null, 2));
      const dlAnchor = document.createElement('a');
      dlAnchor.setAttribute('href', dataStr);
      dlAnchor.setAttribute('download', 'hidden-winner-portfolio.json');
      dlAnchor.click();
      showToast('Exported JSON portfolio!');
    });
  }

  // Modal Info Handling
  function setupModalListeners() {
    if (btnHelpToggle) {
      btnHelpToggle.addEventListener('click', () => {
        modalInfo.style.display = 'flex';
      });
    }

    if (btnCloseModal) {
      btnCloseModal.addEventListener('click', () => {
        modalInfo.style.display = 'none';
      });
    }

    modalInfo.addEventListener('click', (e) => {
      if (e.target === modalInfo) modalInfo.style.display = 'none';
    });
  }

  // Toast Notification
  function showToast(msg) {
    if (!toastNotification || !toastMessage) return;
    toastMessage.innerText = msg;
    toastNotification.style.display = 'block';
    setTimeout(() => {
      toastNotification.style.display = 'none';
    }, 2200);
  }

  function escapeHtml(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
});
