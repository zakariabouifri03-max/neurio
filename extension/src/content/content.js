/* Etsy Insight Pro — content/content.js
 * Page router + floating button + analysis side panel (Shadow DOM).
 * Lightweight by design: extraction + estimation run on demand (button,
 * popup action, or one auto-run per page when enabled in Settings).
 */
(function initContent(root) {
  if (root.__EIP_CONTENT_LOADED__) return;
  root.__EIP_CONTENT_LOADED__ = true;

  const EIP = root.EIP || (root.EIP = {});
  const U = () => EIP.utils;
  const state = {
    settings: null,
    page: { type: 'other' },
    href: '',
    analyzing: false,
    analysis: null,
    panelOpen: false,
    tracked: false,
    error: null
  };

  let shadowHost = null, shadowRoot = null, fabEl = null, panelEl = null;

  boot().catch(err => console.warn('[EtsyInsightPro] boot failed:', err));

  async function boot() {
    state.settings = await loadSettingsSafe();
    state.href = location.href;
    state.page = EIP.extract.common.detectPageType(location.href);
    if (state.page.type === 'other') {
      watchNavigation();
      return; // stay dormant on non-Etsy-entity pages (cart, checkout…)
    }
    ensureShell();
    renderFab();
    watchNavigation();
    if (state.settings.autoAnalyze) {
      // Let Etsy finish rendering, then analyse once.
      await EIP.extract.common.waitForAny(['h1', '[data-listing-id]', '.v2-listing-card', 'main'], 7000).catch(() => null);
      await analyze({ reason: 'auto' });
    }
    // Record an observation if this item is already tracked.
    maybeAutoTrack().catch(() => {});
  }

  function watchNavigation() {
    let last = location.href;
    setInterval(() => {
      if (location.href !== last) {
        last = location.href;
        state.href = last;
        state.page = EIP.extract.common.detectPageType(last);
        state.analysis = null; state.error = null; state.tracked = false;
        if (state.page.type === 'other') { destroyShell(); }
        else {
          ensureShell(); renderFab(); closePanel();
          if (state.settings && state.settings.autoAnalyze) analyze({ reason: 'auto-nav' });
          maybeAutoTrack().catch(() => {});
        }
      }
    }, 1000);
  }

  // ---------------- shell (shadow DOM) ----------------

  function ensureShell() {
    if (shadowHost && document.body.contains(shadowHost)) return;
    destroyShell();
    shadowHost = document.createElement('div');
    shadowHost.id = 'etsy-insight-pro-host';
    shadowHost.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;';
    try {
      shadowRoot = shadowHost.attachShadow({ mode: 'open' });
    } catch (e) {
      shadowRoot = shadowHost; // very old fallback
    }
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    shadowRoot.appendChild(style);
    fabEl = document.createElement('div');
    fabEl.className = 'eip-fab-wrap';
    shadowRoot.appendChild(fabEl);
    panelEl = document.createElement('div');
    panelEl.className = 'eip-panel-wrap eip-hidden';
    shadowRoot.appendChild(panelEl);
    document.documentElement.appendChild(shadowHost);
    applyTheme();
    fabEl.addEventListener('click', onFabClick);
    panelEl.addEventListener('click', onPanelClick);
    panelEl.addEventListener('change', onPanelChange);
  }

  function destroyShell() {
    try { if (shadowHost) shadowHost.remove(); } catch (e) { /* ignore */ }
    shadowHost = null; shadowRoot = null; fabEl = null; panelEl = null;
  }

  function applyTheme() {
    if (!shadowHost) return;
    const pref = (state.settings && state.settings.theme) || 'auto';
    let dark = false;
    if (pref === 'dark') dark = true;
    else if (pref === 'auto') {
      try { dark = window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { dark = false; }
    }
    shadowHost.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

  // ---------------- FAB ----------------

  function fabLabel() {
    if (state.page.type === 'product') return 'Analyze Product';
    if (state.page.type === 'shop') return 'Analyze Shop';
    if (state.page.type === 'search') return 'Analyze Results';
    return 'Analyze';
  }

  function renderFab() {
    if (!fabEl) return;
    const u = U();
    fabEl.innerHTML =
      `<button class="eip-fab" data-action="toggle" title="Etsy Insight Pro — ${u.escapeHtml(fabLabel())}" aria-label="Open Etsy Insight Pro">` +
      `<span class="eip-fab-dot" aria-hidden="true">EI</span><span class="eip-fab-text">${u.escapeHtml(fabLabel())}</span>` +
      (state.analysis ? `<span class="eip-fab-badge">${u.escapeHtml(String(state.analysis.headline || ''))}</span>` : '') +
      `</button>`;
    fabEl.style.pointerEvents = 'none';
    const btn = fabEl.querySelector('.eip-fab');
    if (btn) btn.style.pointerEvents = 'auto';
  }

  function onFabClick(e) {
    const btn = e.target && e.target.closest ? e.target.closest('[data-action="toggle"]') : null;
    if (!btn) return;
    if (state.panelOpen) closePanel();
    else openPanel();
  }

  // ---------------- panel ----------------

  function openPanel() {
    state.panelOpen = true;
    if (panelEl) { panelEl.classList.remove('eip-hidden'); panelEl.style.pointerEvents = 'auto'; }
    if (!state.analysis && !state.analyzing) analyze({ reason: 'manual' });
    else renderPanel();
  }

  function closePanel() {
    state.panelOpen = false;
    if (panelEl) { panelEl.classList.add('eip-hidden'); panelEl.style.pointerEvents = 'none'; }
  }

  function onPanelClick(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el) return;
    const action = el.getAttribute('data-action');
    if (action === 'close') closePanel();
    else if (action === 'refresh') analyze({ reason: 'manual', force: true });
    else if (action === 'track') trackCurrent();
    else if (action === 'untrack') untrackCurrent();
    else if (action === 'dashboard') openDashboard('');
    else if (action === 'dashboard-tracked') openDashboard('#/tracked');
    else if (action === 'export-csv') exportCurrent('csv');
    else if (action === 'export-json') exportCurrent('json');
    else if (action === 'sort') sortCurrent(el.getAttribute('data-key'));
    else if (action === 'how') toggleHow(el);
  }

  function onPanelChange(e) {
    // Reserved for future in-panel controls (range selectors).
  }

  function toggleHow(el) {
    const box = el.closest('.eip-how');
    if (box) box.classList.toggle('eip-open');
  }

  function openDashboard(hash) {
    try {
      const url = chrome.runtime.getURL('src/dashboard/dashboard.html' + (hash || ''));
      window.open(url, '_blank');
    } catch (e) { /* ignore */ }
  }

  // ---------------- analysis ----------------

  async function analyze(opts) {
    opts = opts || {};
    if (state.analyzing) return;
    if (state.analysis && !opts.force && opts.reason === 'auto') return;
    state.analyzing = true;
    state.error = null;
    renderPanelLoading();
    try {
      state.settings = await loadSettingsSafe();
      applyTheme();
      const type = state.page.type;
      let analysis = null;
      if (type === 'product') analysis = await analyzeProduct();
      else if (type === 'shop') analysis = await analyzeShop();
      else if (type === 'search') analysis = await analyzeSearch();
      else throw new Error('This Etsy page type is not supported yet.');
      state.analysis = analysis;
      state.sort = state.sort || { key: null, dir: 1 };
      renderFab();
      if (state.panelOpen || opts.reason !== 'auto') { state.panelOpen = true; if (panelEl) { panelEl.classList.remove('eip-hidden'); panelEl.style.pointerEvents = 'auto'; } }
      renderPanel();
      updateTrackedFlag().catch(() => {});
    } catch (err) {
      console.warn('[EtsyInsightPro] analysis failed:', err);
      state.error = friendlyError(err);
      renderPanel();
    } finally {
      state.analyzing = false;
      renderFab();
    }
  }

  async function analyzeProduct() {
    const extracted = EIP.extract.product.extractProduct(document);
    const settings = state.settings;
    const history = await getProductHistory(extracted.listingId);
    const historyPoints = history ? history.length : 0;
    const trackedVel = historyPoints >= 2 ? EIP.tracking.recentVelocity(history, 30) : null;

    const signals = {
      listingReviews: extracted.reviews,
      recentReviews30d: extracted.recentReviews30d !== null ? extracted.recentReviews30d : trackedVel,
      hasRecentActivity: extracted.recentReviews30d !== null || trackedVel !== null,
      listingAgeDays: extracted.listingAgeDays,
      favorites: extracted.favorites !== null ? extracted.favorites : extracted.inCarts,
      shopSales: extracted.shopTotalSales,
      shopReviews: null,
      historyPoints
    };
    const sales = EIP.estimation.estimateMonthlySales(signals, settings);
    const revenue = EIP.estimation.estimateRevenue(sales, extracted.price, extracted.currency || settings.currency);
    const views = EIP.estimation.estimateViews({
      monthlyOrdersMid: sales.mid, monthlyOrdersLo: sales.low, monthlyOrdersHi: sales.high,
      favorites: signals.favorites, isBestseller: extracted.isBestseller, isPopular: extracted.isPopular,
      historyPoints
    }, settings);
    const reviewGrowth = historyPoints >= 2 ? growthPct(history, 'reviews') : null;
    const scores = EIP.scores.allScores({
      reviews: extracted.reviews, rating: extracted.rating, favorites: signals.favorites,
      recentReviews30d: signals.recentReviews30d, isBestseller: extracted.isBestseller,
      isPopular: extracted.isPopular, monthlyOrdersMid: sales.mid, reviewGrowthPct: reviewGrowth,
      searchResults: null, avgCompetitorReviews: null, shopListings: null,
      price: extracted.price, monthlySalesMid: sales.mid
    });
    return {
      type: 'product', extracted, sales, revenue, views, scores, history,
      headline: sales.mid !== null ? `${U().formatRange(sales.low, sales.high)}/mo` : 'Analysed'
    };
  }

  async function analyzeShop() {
    const extracted = EIP.extract.shop.extractShop(document);
    const settings = state.settings;
    const enriched = extracted.listings.map(l => {
      const sales = EIP.estimation.estimateMonthlySales({
        listingReviews: l.reviews, listingAgeDays: null, favorites: null,
        shopSales: extracted.totalSales, shopReviews: extracted.reviewCount, historyPoints: 0
      }, settings);
      const revenue = EIP.estimation.estimateRevenue(sales, l.price, l.currency || extracted.currency || settings.currency);
      const scores = EIP.scores.allScores({
        reviews: l.reviews, rating: l.rating, isBestseller: l.isBestseller,
        monthlyOrdersMid: sales.mid, price: l.price, monthlySalesMid: sales.mid,
        searchResults: extracted.activeListings, avgCompetitorReviews: mean(extracted.listings.map(x => x.reviews)),
        shopListings: extracted.activeListings
      });
      return { ...l, sales, revenue, scores };
    });
    const shopEst = EIP.estimation.estimateShopMonthly(
      enriched.map(l => l.sales),
      { avgPrice: extracted.avgPrice, currency: extracted.currency || settings.currency, totalListings: extracted.activeListings },
      settings
    );
    const byReviews = [...enriched].sort((a, b) => (b.reviews || 0) - (a.reviews || 0));
    const byOpp = [...enriched].sort((a, b) => ((b.scores && b.scores.opportunity.value) || 0) - ((a.scores && a.scores.opportunity.value) || 0));
    const history = await getShopHistory(extracted.shopName);
    return {
      type: 'shop', extracted: { ...extracted, listings: enriched },
      shopEst, top: byOpp.slice(0, 5), mostReviewed: byReviews.slice(0, 5),
      bestsellers: enriched.filter(l => l.isBestseller).slice(0, 10),
      history, headline: shopEst.monthly ? `${U().formatRange(shopEst.monthly.low, shopEst.monthly.high)}/mo` : 'Analysed'
    };
  }

  async function analyzeSearch() {
    const extracted = EIP.extract.search.extractSearch(document);
    const settings = state.settings;
    const avgRev = mean(extracted.items.map(i => i.reviews));
    const prices = extracted.items.map(i => i.price).filter(Number.isFinite);
    const medianPrice = median(prices);
    const enriched = extracted.items.map(item => {
      const sales = EIP.estimation.estimateMonthlySales({
        listingReviews: item.reviews, listingAgeDays: null, favorites: null, historyPoints: 0
      }, settings);
      const revenue = EIP.estimation.estimateRevenue(sales, item.price, item.currency || settings.currency);
      const pricePosition = !Number.isFinite(item.price) || !Number.isFinite(medianPrice) ? null
        : item.price > medianPrice * 1.15 ? 'undercut' : item.price < medianPrice * 0.85 ? 'value' : 'mid';
      const scores = EIP.scores.allScores({
        reviews: item.reviews, rating: item.rating, isBestseller: item.isBestseller,
        monthlyOrdersMid: sales.mid, price: item.price, monthlySalesMid: sales.mid,
        searchResults: extracted.totalResults, avgCompetitorReviews: avgRev, pricePosition,
        shopListings: extracted.totalResults
      });
      return { ...item, sales, revenue, scores };
    });
    const keywords = EIP.keywords.analyzeKeywords(
      enriched.map(i => ({ title: i.title, price: i.price, reviews: i.reviews, rating: i.rating })),
      { minFrequency: 2, maxRows: 40 }
    );
    // Persist session for the dashboard (Research + Keywords tabs).
    const session = {
      query: extracted.query || '(unknown query)', url: extracted.url,
      totalResults: extracted.totalResults, itemCount: enriched.length,
      currency: settings.currency, items: enriched.slice(0, 80).map(stripForStorage),
      keywords: { rows: keywords.rows.slice(0, 40), suggestions: keywords.suggestions }
    };
    try { await EIP.storage.pushResearch(session); } catch (e) { /* non-fatal */ }
    return {
      type: 'search', extracted: { ...extracted, items: enriched },
      keywords, session, headline: `${enriched.length} listings`
    };
  }

  function stripForStorage(it) {
    return {
      rank: it.rank, title: it.title, price: it.price, currency: it.currency,
      reviews: it.reviews, rating: it.rating, shop: it.shop, url: it.url,
      isBestseller: it.isBestseller, sales: it.sales ? { low: it.sales.low, mid: it.sales.mid, high: it.sales.high, confidence: it.sales.confidence } : null,
      revenue: it.revenue && it.revenue.monthly ? { monthly: it.revenue.monthly } : null,
      scores: it.scores ? {
        demand: { value: it.scores.demand.value }, competition: { value: it.scores.competition.value },
        revenue: { value: it.scores.revenue.value }, opportunity: { value: it.scores.opportunity.value }
      } : null
    };
  }

  // ---------------- tracking ----------------

  async function updateTrackedFlag() {
    try {
      const a = state.analysis;
      if (!a) { state.tracked = false; return; }
      if (a.type === 'product' && a.extracted.listingId) {
        const map = await EIP.storage.loadProducts();
        state.tracked = !!map[String(a.extracted.listingId)];
      } else if (a.type === 'shop' && a.extracted.shopName) {
        const map = await EIP.storage.loadShops();
        state.tracked = !!map[String(a.extracted.shopName).toLowerCase()];
      }
      if (state.panelOpen) renderPanel();
    } catch (e) { /* ignore */ }
  }

  async function maybeAutoTrack() {
    const s = state.settings;
    if (!s || !s.autoTrack) return;
    if (state.page.type === 'product') {
      const id = EIP.extract.common.listingIdFromUrl(location.href);
      if (!id) return;
      const map = await EIP.storage.loadProducts().catch(() => ({}));
      if (!map[String(id)]) return; // only items the user already chose to track
      const a = state.analysis && state.analysis.type === 'product' ? state.analysis : await analyzeProduct().catch(() => null);
      if (!a) return;
      const obs = EIP.tracking.buildProductObservation(a.extracted, { sales: a.sales, scores: a.scores });
      await EIP.tracking.recordProductObservation(id, productMeta(a.extracted), obs, s).catch(() => {});
    } else if (state.page.type === 'shop') {
      const name = state.page.shopName || EIP.extract.common.shopNameFromUrl(location.href);
      if (!name) return;
      const map = await EIP.storage.loadShops().catch(() => ({}));
      if (!map[String(name).toLowerCase()]) return;
      const a = state.analysis && state.analysis.type === 'shop' ? state.analysis : await analyzeShop().catch(() => null);
      if (!a) return;
      const obs = EIP.tracking.buildShopObservation(a.extracted, { shopEstimate: a.shopEst });
      await EIP.tracking.recordShopObservation(name, shopMeta(a.extracted), obs, s).catch(() => {});
    }
  }

  async function trackCurrent() {
    const a = state.analysis;
    if (!a) return;
    try {
      if (a.type === 'product' && a.extracted.listingId) {
        const obs = EIP.tracking.buildProductObservation(a.extracted, { sales: a.sales, scores: a.scores });
        await EIP.tracking.recordProductObservation(a.extracted.listingId, productMeta(a.extracted), obs, state.settings);
      } else if (a.type === 'shop' && a.extracted.shopName) {
        const obs = EIP.tracking.buildShopObservation(a.extracted, { shopEstimate: a.shopEst });
        await EIP.tracking.recordShopObservation(a.extracted.shopName, shopMeta(a.extracted), obs, state.settings);
      } else return;
      state.tracked = true;
      renderPanel();
    } catch (e) {
      state.error = friendlyError(e);
      renderPanel();
    }
  }

  async function untrackCurrent() {
    const a = state.analysis;
    if (!a) return;
    try {
      if (a.type === 'product' && a.extracted.listingId) await EIP.tracking.removeProduct(a.extracted.listingId);
      else if (a.type === 'shop' && a.extracted.shopName) await EIP.tracking.removeShop(a.extracted.shopName);
      state.tracked = false;
      renderPanel();
    } catch (e) { /* ignore */ }
  }

  function productMeta(x) {
    return { title: x.title, url: x.url, image: state.settings.storeImages ? x.image : null, shopName: x.shopName, currency: x.currency };
  }
  function shopMeta(x) {
    return { title: x.shopTitle, url: x.url, currency: x.currency, niche: x.niche };
  }

  async function getProductHistory(listingId) {
    try {
      if (!listingId) return [];
      const map = await EIP.storage.loadProducts();
      const rec = map[String(listingId)];
      return rec ? (rec.observations || []) : [];
    } catch (e) { return []; }
  }

  async function getShopHistory(shopName) {
    try {
      if (!shopName) return [];
      const map = await EIP.storage.loadShops();
      const rec = map[String(shopName).toLowerCase()];
      return rec ? (rec.observations || []) : [];
    } catch (e) { return []; }
  }

  // ---------------- export / sort ----------------

  function exportCurrent(format) {
    const a = state.analysis;
    if (!a) return;
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      if (a.type === 'search') {
        const rows = EIP.exporter.researchRows(a.session);
        if (format === 'csv') EIP.exporter.downloadCSV(`etsy-insight-research-${stamp}.csv`, rows);
        else EIP.exporter.downloadJSON(`etsy-insight-research-${stamp}.json`, a.session);
      } else if (a.type === 'shop') {
        const rows = EIP.exporter.shopRows(a.extracted);
        if (format === 'csv') EIP.exporter.downloadCSV(`etsy-insight-shop-${stamp}.csv`, rows);
        else EIP.exporter.downloadJSON(`etsy-insight-shop-${stamp}.json`, { extracted: a.extracted, shopEst: a.shopEst });
      } else {
        const payload = { extracted: a.extracted, sales: a.sales, revenue: a.revenue, views: a.views, scores: a.scores };
        if (format === 'csv') EIP.exporter.downloadCSV(`etsy-insight-product-${stamp}.csv`, EIP.exporter.researchRows({ items: [productAsRow(a)], currency: state.settings.currency }));
        else EIP.exporter.downloadJSON(`etsy-insight-product-${stamp}.json`, payload);
      }
    } catch (e) { /* ignore */ }
  }

  function productAsRow(a) {
    const x = a.extracted;
    return { rank: 1, title: x.title, price: x.price, currency: x.currency, reviews: x.reviews, rating: x.rating, shop: x.shopName, url: x.url, sales: a.sales, revenue: a.revenue, scores: a.scores };
  }

  function sortCurrent(key) {
    const a = state.analysis;
    if (!a || !key) return;
    state.sort = state.sort || {};
    if (state.sort.key === key) state.sort.dir = -state.sort.dir;
    else state.sort = { key, dir: key === 'title' ? 1 : -1 };
    const dir = state.sort.dir;
    const val = (obj, k) => {
      if (k === 'price') return obj.price;
      if (k === 'reviews') return obj.reviews;
      if (k === 'sales') return obj.sales && obj.sales.mid;
      if (k === 'revenue') return obj.revenue && obj.revenue.monthly && obj.revenue.monthly.mid;
      if (k === 'demand') return obj.scores && obj.scores.demand.value;
      if (k === 'competition') return obj.scores && obj.scores.competition.value;
      if (k === 'opportunity') return obj.scores && obj.scores.opportunity.value;
      if (k === 'title') return (obj.title || '').toLowerCase();
      return null;
    };
    const list = a.type === 'shop' ? a.extracted.listings : a.extracted.items;
    if (Array.isArray(list)) {
      list.sort((x, y) => {
        const vx = val(x, key), vy = val(y, key);
        if (vx === null || vx === undefined) return 1;
        if (vy === null || vy === undefined) return -1;
        if (typeof vx === 'string') return vx.localeCompare(vy) * dir;
        return (vx - vy) * dir;
      });
    }
    renderPanel();
  }

  // ---------------- rendering ----------------

  function renderPanelLoading() {
    if (!panelEl || !state.panelOpen) return;
    panelEl.innerHTML =
      `<div class="eip-panel"><div class="eip-head"><div><div class="eip-brand">Etsy Insight Pro</div>` +
      `<div class="eip-sub">${U().escapeHtml(fabLabel())}</div></div>` +
      `<button class="eip-icon-btn" data-action="close" aria-label="Close">✕</button></div>` +
      `<div class="eip-body"><div class="eip-loading"><div class="eip-spinner"></div><p>Reading public page data…</p></div></div></div>`;
  }

  function renderPanel() {
    if (!panelEl) return;
    if (!state.panelOpen) return;
    const u = U();
    if (state.error) {
      panelEl.innerHTML =
        `<div class="eip-panel"><div class="eip-head"><div><div class="eip-brand">Etsy Insight Pro</div>` +
        `<div class="eip-sub">${u.escapeHtml(fabLabel())}</div></div>` +
        `<button class="eip-icon-btn" data-action="close" aria-label="Close">✕</button></div>` +
        `<div class="eip-body"><div class="eip-error"><strong>Couldn’t analyse this page</strong><p>${u.escapeHtml(state.error)}</p>` +
        `<button class="eip-btn eip-btn-primary" data-action="refresh">Try again</button></div>` +
        `<div class="eip-foot">${footHTML()}</div></div></div>`;
      return;
    }
    const a = state.analysis;
    if (!a) { renderPanelLoading(); return; }
    let body = '';
    if (a.type === 'product') body = productHTML(a);
    else if (a.type === 'shop') body = shopHTML(a);
    else if (a.type === 'search') body = searchHTML(a);
    panelEl.innerHTML =
      `<div class="eip-panel"><div class="eip-head"><div><div class="eip-brand">Etsy Insight Pro</div>` +
      `<div class="eip-sub">${u.escapeHtml(fabLabel())}</div></div>` +
      `<div class="eip-head-actions"><button class="eip-icon-btn" data-action="refresh" title="Re-analyse" aria-label="Re-analyse">↻</button>` +
      `<button class="eip-icon-btn" data-action="close" aria-label="Close">✕</button></div></div>` +
      `<div class="eip-body">${body}</div>` +
      `<div class="eip-foot">${footHTML()}</div></div>`;
  }

  function footHTML() {
    return `<button class="eip-link" data-action="dashboard">Open dashboard</button><span>·</span>` +
      `<button class="eip-link" data-action="dashboard-tracked">Tracked items</button>` +
      `<span class="eip-foot-note">Local-first · Estimates are labelled</span>`;
  }

  // ----- product panel -----

  function productHTML(a) {
    const u = U();
    const x = a.extracted;
    const cur = x.currency || state.settings.currency;
    const verifiedRows = [
      ['Title', x.title || '—', true],
      ['Price', x.price !== null ? u.formatMoney(x.price, cur) : '—'],
      ['Currency', cur],
      ['Reviews', x.reviews !== null ? u.formatInt(x.reviews) : '—'],
      ['Rating', x.rating !== null ? `${x.rating} ★` : '—'],
      ['Shop', x.shopName ? `${x.shopName}${x.shopAgeYears !== null ? ` · on Etsy ${x.shopAgeYears}y` : ''}` : '—'],
      ['Shop sales (visible)', x.shopTotalSales !== null ? u.formatInt(x.shopTotalSales) : '—'],
      ['Favorites', x.favorites !== null ? u.formatInt(x.favorites) : (x.inCarts !== null ? `${u.formatInt(x.inCarts)} in carts` : '—')],
      ['Category', x.category || '—'],
      ['Format', x.isDigital === true ? 'Digital download' : x.isDigital === false ? 'Physical' : '—'],
      ['Badges', [x.isBestseller && 'Bestseller', x.isPopular && 'Popular', x.isStarSeller && 'Star Seller'].filter(Boolean).join(' · ') || '—']
    ];
    const s = a.sales, r = a.revenue, v = a.views;
    const pills = (est) => `<span class="eip-pill eip-est">Estimated</span> ${confPill(est.confidence)}`;
    return `
      <div class="eip-title-block"><div class="eip-listing-title">${u.escapeHtml(x.title || 'Untitled listing')}</div>
      <div class="eip-track-row">${state.tracked
        ? `<button class="eip-btn eip-btn-ghost" data-action="untrack">✓ Tracking — stop</button>`
        : `<button class="eip-btn eip-btn-primary" data-action="track">＋ Track this product</button>`}
      <button class="eip-btn" data-action="export-json">Export</button></div></div>
      ${scoreGaugesHTML(a.scores)}
      <div class="eip-card"><div class="eip-card-head"><h3>Verified Etsy data</h3><span class="eip-pill eip-verified">On-page</span></div>
        <dl class="eip-dl">${verifiedRows.map(row => `<div class="eip-dl-row"><dt>${u.escapeHtml(row[0])}</dt><dd>${u.escapeHtml(String(row[1]))}</dd></div>`).join('')}</dl></div>
      <div class="eip-card"><div class="eip-card-head"><h3>Sales estimate</h3>${pills(s)}</div>
        <div class="eip-big">${s.mid !== null ? `${u.formatRange(s.low, s.high)} <span>/ month</span>` : '—'}</div>
        <div class="eip-mini-grid">
          <div><span>Daily</span><strong>${s.daily ? u.formatRange(s.daily.low, s.daily.high) : '—'}</strong></div>
          <div><span>Weekly</span><strong>${s.weekly ? u.formatRange(s.weekly.low, s.weekly.high) : '—'}</strong></div>
          <div><span>Revenue/mo</span><strong>${r.monthly ? u.formatMoneyCompact(r.monthly.mid, cur) + ' (' + u.formatRange(r.monthly.low, r.monthly.high, n => u.formatMoneyCompact(n, cur)) + ')' : '—'}</strong></div>
          <div><span>Revenue/yr</span><strong>${r.yearly ? u.formatMoneyCompact(r.yearly.mid, cur) : '—'}</strong></div>
        </div>
        ${howHTML('How was this estimated?', s.steps, s.disclaimer, s.evidence)}
      </div>
      <div class="eip-card"><div class="eip-card-head"><h3>Views estimate</h3>${pills(v)}</div>
        <div class="eip-big">${v.mid !== null ? `${u.formatRange(v.low, v.high)} <span>/ month</span>` : '—'}</div>
        <div class="eip-mini-grid">
          <div><span>Today</span><strong>${v.daily ? u.formatRange(v.daily.low, v.daily.high) : '—'}</strong></div>
          <div><span>This week</span><strong>${v.weekly ? u.formatRange(v.weekly.low, v.weekly.high) : '—'}</strong></div>
        </div>
        ${howHTML('How was this estimated?', v.steps, v.disclaimer, v.evidence)}
      </div>
      ${historyHTML(a.history, 'reviews')}`;
  }

  // ----- shop panel -----

  function shopHTML(a) {
    const u = U();
    const x = a.extracted;
    const cur = x.currency || state.settings.currency;
    const se = a.shopEst;
    const trackBtn = state.tracked
      ? `<button class="eip-btn eip-btn-ghost" data-action="untrack">✓ Tracking — stop</button>`
      : `<button class="eip-btn eip-btn-primary" data-action="track">＋ Track this shop</button>`;
    return `
      <div class="eip-title-block"><div class="eip-listing-title">${u.escapeHtml(x.shopTitle || x.shopName || 'Shop')}</div>
      <div class="eip-track-row">${trackBtn}<button class="eip-btn" data-action="export-csv">CSV</button><button class="eip-btn" data-action="export-json">JSON</button></div></div>
      <div class="eip-card"><div class="eip-card-head"><h3>Verified Etsy data</h3><span class="eip-pill eip-verified">On-page</span></div>
        <div class="eip-mini-grid">
          <div><span>Total sales</span><strong>${x.totalSales !== null ? u.formatInt(x.totalSales) : '—'}</strong></div>
          <div><span>Active listings</span><strong>${x.activeListings !== null ? u.formatInt(x.activeListings) : '—'}</strong></div>
          <div><span>Reviews</span><strong>${x.reviewCount !== null ? u.formatInt(x.reviewCount) : '—'}</strong></div>
          <div><span>Rating</span><strong>${x.rating !== null ? x.rating + ' ★' : '—'}</strong></div>
          <div><span>Avg. price</span><strong>${x.avgPrice !== null ? u.formatMoney(x.avgPrice, cur) : '—'}</strong></div>
          <div><span>Niche</span><strong class="eip-small">${u.escapeHtml(x.niche || '—')}</strong></div>
        </div></div>
      <div class="eip-card"><div class="eip-card-head"><h3>Shop estimate</h3><span class="eip-pill eip-est">Estimated</span> ${confPill(se.confidence)}</div>
        <div class="eip-big">${se.monthly ? `${u.formatRange(se.monthly.low, se.monthly.high)} <span>/ month</span>` : '—'}</div>
        <div class="eip-mini-grid">
          <div><span>Revenue/mo</span><strong>${se.revenue ? u.formatMoneyCompact(se.revenue.mid, cur) : '—'}</strong></div>
          <div><span>Revenue/yr</span><strong>${se.revenue ? u.formatMoneyCompact(se.revenue.mid * 12, cur) : '—'}</strong></div>
          <div><span>Sales / listing</span><strong>${se.perListing ? u.formatRange(se.perListing.low, se.perListing.high) : '—'}</strong></div>
          <div><span>Listings analysed</span><strong>${se.counted}</strong></div>
        </div>
        ${howHTML('How was this estimated?', se.steps, se.disclaimer, se.evidence)}
      </div>
      ${topListHTML('Top opportunities', a.top)}
      ${topListHTML('Most reviewed', a.mostReviewed)}
      <div class="eip-card"><div class="eip-card-head"><h3>All visible listings (${x.listings.length})</h3></div>
        <div class="eip-table-wrap">${listingTableHTML(x.listings)}</div></div>
      ${historyHTML(a.history, 'sales')}`;
  }

  // ----- search panel -----

  function searchHTML(a) {
    const u = U();
    const x = a.extracted;
    return `
      <div class="eip-title-block"><div class="eip-listing-title">“${u.escapeHtml(x.query || 'Search results')}”</div>
      <div class="eip-sub">${x.totalResults !== null ? u.formatInt(x.totalResults) + ' total results · ' : ''}${x.items.length} visible listings analysed</div>
      <div class="eip-track-row"><button class="eip-btn" data-action="export-csv">Export CSV</button><button class="eip-btn" data-action="export-json">Export JSON</button></div></div>
      <div class="eip-note">Session saved — open the dashboard for the full sortable research table and keyword lab.</div>
      <div class="eip-card"><div class="eip-card-head"><h3>Top opportunities</h3></div>
        <div class="eip-table-wrap">${listingTableHTML(top10(x.items))}</div></div>
      <div class="eip-card"><div class="eip-card-head"><h3>Keyword suggestions</h3><span class="eip-pill eip-est">From visible titles</span></div>
        <div class="eip-chips">${a.keywords.suggestions.map(k => `<span class="eip-chip">${u.escapeHtml(k)}</span>`).join('') || '<span class="eip-dim">Not enough titles yet.</span>'}</div>
        <div class="eip-dim eip-tiny">${u.escapeHtml(a.keywords.coverage.note)} No private Etsy search-volume data is claimed.</div></div>
      <div class="eip-card"><div class="eip-card-head"><h3>All visible listings (${x.items.length})</h3></div>
        <div class="eip-table-wrap">${listingTableHTML(x.items)}</div></div>`;
  }

  // ----- shared fragments -----

  function confPill(conf) {
    const c = (conf || 'Low').toLowerCase();
    return `<span class="eip-pill eip-conf-${c}">Confidence: ${conf || 'Low'}</span>`;
  }

  function scoreGaugesHTML(scores) {
    if (!scores) return '';
    const g = EIP.charts.gaugeSVG;
    const card = (title, s, extra) =>
      `<div class="eip-gauge-card" title="${U().escapeHtml(s.formula)}"><div class="eip-gauge-title">${title}</div>${g(s.value, { size: 76 })}` +
      `<div class="eip-gauge-label">${U().escapeHtml(s.label)}</div></div>`;
    return `<div class="eip-card"><div class="eip-card-head"><h3>Scores <span class="eip-dim">(0–100, hover for formula)</span></h3><span class="eip-pill eip-est">Estimated</span></div>` +
      `<div class="eip-gauges">${card('Demand', scores.demand)}${card('Competition', scores.competition)}${card('Revenue', scores.revenue)}${card('Opportunity', scores.opportunity)}</div></div>`;
  }

  function howHTML(title, steps, disclaimer, evidence) {
    const u = U();
    return `<div class="eip-how"><button class="eip-link" data-action="how">${u.escapeHtml(title)} ▸</button>` +
      `<div class="eip-how-body"><ol>${(steps || []).map(s => `<li>${u.escapeHtml(s)}</li>`).join('')}</ol>` +
      (evidence && evidence.length ? `<div class="eip-tiny"><strong>Evidence used:</strong> ${u.escapeHtml(evidence.join(' · '))}</div>` : '') +
      (disclaimer ? `<div class="eip-tiny eip-dim">${u.escapeHtml(disclaimer)}</div>` : '') + `</div></div>`;
  }

  function topListHTML(title, items) {
    const u = U();
    if (!items || !items.length) return '';
    return `<div class="eip-card"><div class="eip-card-head"><h3>${u.escapeHtml(title)}</h3></div><ol class="eip-top">` +
      items.map(l => `<li><a href="${u.escapeHtml(l.url || '#')}" target="_blank" rel="noopener">${u.escapeHtml((l.title || '').slice(0, 60))}</a>` +
        `<span class="eip-dim">${l.price !== null && l.price !== undefined ? u.formatMoneyCompact(l.price, l.currency || state.settings.currency) : ''} · Opp ${l.scores ? l.scores.opportunity.value : '—'}</span></li>`).join('') +
      `</ol></div>`;
  }

  function listingTableHTML(list) {
    const u = U();
    const sort = state.sort || {};
    const arrow = (k) => sort.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
    const th = (label, key) => `<th><button class="eip-th" data-action="sort" data-key="${key}">${label}${arrow(key)}</button></th>`;
    const rows = (list || []).slice(0, 60).map(l =>
      `<tr><td class="eip-t-title"><a href="${u.escapeHtml(l.url || '#')}" target="_blank" rel="noopener">${u.escapeHtml((l.title || '').slice(0, 48))}</a></td>` +
      `<td class="eip-num">${l.price !== null && l.price !== undefined ? u.formatMoneyCompact(l.price, l.currency || state.settings.currency) : '—'}</td>` +
      `<td class="eip-num">${l.reviews !== null && l.reviews !== undefined ? u.formatCompact(l.reviews) : '—'}</td>` +
      `<td class="eip-num">${l.sales && l.sales.mid !== null ? u.formatRange(l.sales.low, l.sales.high) : '—'}</td>` +
      `<td class="eip-num">${l.revenue && l.revenue.monthly ? u.formatMoneyCompact(l.revenue.monthly.mid, l.currency || state.settings.currency) : '—'}</td>` +
      `<td class="eip-num">${l.scores ? l.scores.opportunity.value : '—'}</td></tr>`
    ).join('');
    return `<table class="eip-table"><thead><tr>${th('Product', 'title')}${th('Price', 'price')}${th('Reviews', 'reviews')}${th('Est. sales', 'sales')}${th('Est. rev.', 'revenue')}${th('Opp.', 'opportunity')}</tr></thead><tbody>${rows || '<tr><td colspan="6">No listings found.</td></tr>'}</tbody></table>`;
  }

  function historyHTML(history, metric) {
    const u = U();
    if (!history || !history.length) {
      return `<div class="eip-card"><div class="eip-card-head"><h3>History</h3></div><div class="eip-dim">No tracked history yet. Press “Track” and revisit this page — observations build 7/30/90-day charts in the dashboard.</div></div>`;
    }
    const s7 = EIP.tracking.summarizeHistory(history, 7);
    const s30 = EIP.tracking.summarizeHistory(history, 30);
    const trend = s30 ? EIP.tracking.trendLabel(s30.trend) : '—';
    return `<div class="eip-card"><div class="eip-card-head"><h3>Tracked history (${history.length} observations)</h3></div>
      <div class="eip-mini-grid">
        <div><span>Trend (30d)</span><strong>${u.escapeHtml(trend)}</strong></div>
        <div><span>Review Δ (30d)</span><strong>${s30 && s30.reviewDelta !== null ? (s30.reviewDelta >= 0 ? '+' : '') + s30.reviewDelta : '—'}</strong></div>
        <div><span>Review Δ (7d)</span><strong>${s7 && s7.reviewDelta !== null ? (s7.reviewDelta >= 0 ? '+' : '') + s7.reviewDelta : '—'}</strong></div>
        <div><span>Price Δ (30d)</span><strong>${s30 && s30.priceChange !== null ? s30.priceChange + '%' : '—'}</strong></div>
      </div>
      <div class="eip-tiny eip-dim">Last observed ${u.timeAgo(history[history.length - 1].t)}. Full charts live in the dashboard.</div></div>`;
  }

  // ---------------- messaging (popup / dashboard) ----------------

  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      (async () => {
        if (!msg || !msg.type) return null;
        if (msg.type === 'EIP_GET_STATE') {
          return {
            page: state.page, analyzing: state.analyzing,
            hasAnalysis: !!state.analysis, tracked: state.tracked,
            headline: state.analysis ? state.analysis.headline : null,
            title: state.analysis && state.analysis.extracted ? (state.analysis.extracted.title || state.analysis.extracted.shopTitle || state.analysis.extracted.query) : null
          };
        }
        if (msg.type === 'EIP_ANALYZE') {
          state.panelOpen = true;
          if (panelEl) { panelEl.classList.remove('eip-hidden'); panelEl.style.pointerEvents = 'auto'; }
          await analyze({ reason: 'manual', force: true });
          return { ok: true };
        }
        if (msg.type === 'EIP_TRACK') {
          if (!state.analysis) await analyze({ reason: 'manual' });
          await trackCurrent();
          return { ok: true, tracked: state.tracked };
        }
        if (msg.type === 'EIP_OPEN_PANEL') {
          openPanel();
          return { ok: true };
        }
        return null;
      })().then(sendResponse).catch(err => sendResponse({ error: String(err && err.message || err) }));
      return true; // async
    });
  } catch (e) { /* messaging unavailable */ }

  // ---------------- helpers ----------------

  async function loadSettingsSafe() {
    try {
      if (EIP.storage) return await EIP.storage.loadSettings();
    } catch (e) { /* fall through */ }
    return { ...(EIP.settings ? EIP.settings.DEFAULTS : { theme: 'auto', currency: 'USD', reviewRate: 0.15, sensitivity: 'balanced', conversionRate: 0.02, viewsPerFavorite: 25, autoAnalyze: true, autoTrack: true, trackingMinIntervalHours: 6, historyRetentionDays: 365 }) };
  }

  function mean(arr) {
    const nums = (arr || []).filter(Number.isFinite);
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  }

  function median(arr) {
    const nums = (arr || []).filter(Number.isFinite).sort((a, b) => a - b);
    if (!nums.length) return null;
    const mid = Math.floor(nums.length / 2);
    return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  }

  function growthPct(history, field) {
    if (!history || history.length < 2) return null;
    const first = history[0][field], last = history[history.length - 1][field];
    if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
    if (first === 0) return last > 0 ? 100 : 0;
    return Math.round(((last - first) / Math.abs(first)) * 1000) / 10;
  }

  function friendlyError(err) {
    const m = String((err && err.message) || err || '');
    if (/not supported/i.test(m)) return 'This page isn’t a product, shop, or search page. Navigate to one and try again.';
    return 'Etsy’s layout may have changed or the page hasn’t finished loading. Scroll, wait a moment, then press “Try again”.';
  }

  // ---------------- panel CSS (scoped to shadow DOM) ----------------

  const PANEL_CSS = `
    :host { all: initial; }
    .eip-hidden { display: none !important; }
    #etsy-insight-pro-host, :host { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .eip-fab-wrap { position: fixed; right: 20px; bottom: 20px; z-index: 1; }
    .eip-fab { pointer-events: auto; display: flex; align-items: center; gap: 8px; border: 0; cursor: pointer;
      background: #ea580c; color: #fff; font-weight: 700; font-size: 13px; border-radius: 999px; padding: 10px 16px 10px 10px;
      box-shadow: 0 8px 28px rgba(234,88,12,.45); transition: transform .15s ease, box-shadow .15s ease; }
    .eip-fab:hover { transform: translateY(-1px); box-shadow: 0 12px 32px rgba(234,88,12,.55); }
    .eip-fab-dot { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px;
      border-radius: 50%; background: rgba(255,255,255,.22); font-size: 11px; }
    .eip-fab-badge { background: rgba(255,255,255,.22); border-radius: 999px; padding: 2px 8px; font-size: 11px; font-weight: 600; }
    .eip-panel-wrap { position: fixed; top: 0; right: 0; bottom: 0; width: min(400px, 94vw); z-index: 2; }
    .eip-panel { pointer-events: auto; height: 100%; display: flex; flex-direction: column;
      background: var(--eip-bg, #fff); color: var(--eip-ink, #0f172a);
      border-left: 1px solid var(--eip-line, #e2e8f0); box-shadow: -12px 0 40px rgba(2,6,23,.18);
      animation: eip-in .22s ease; font-size: 13px; }
    @keyframes eip-in { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }
    :host([data-theme="dark"]) .eip-panel { --eip-bg: #0f172a; --eip-ink: #e2e8f0; --eip-line: #1e293b;
      --eip-card: #1e293b; --eip-dim: #94a3b8; --eip-track: #334155; }
    .eip-panel { --eip-card: #f8fafc; --eip-dim: #64748b; --eip-track: #e2e8f0; --eip-ink: #0f172a; }
    .eip-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
      padding: 14px 14px 10px; border-bottom: 1px solid var(--eip-line, #e2e8f0); }
    .eip-brand { font-weight: 800; font-size: 14px; }
    .eip-sub { font-size: 11px; color: var(--eip-dim); margin-top: 2px; }
    .eip-head-actions { display: flex; gap: 6px; }
    .eip-icon-btn { border: 1px solid var(--eip-line); background: transparent; color: inherit; border-radius: 8px;
      width: 28px; height: 28px; cursor: pointer; font-size: 14px; line-height: 1; }
    .eip-icon-btn:hover { background: var(--eip-card); }
    .eip-body { overflow-y: auto; padding: 12px 14px 16px; display: flex; flex-direction: column; gap: 10px; }
    .eip-foot { border-top: 1px solid var(--eip-line); padding: 8px 14px; display: flex; align-items: center; gap: 8px; font-size: 11px; }
    .eip-foot-note { margin-left: auto; color: var(--eip-dim); }
    .eip-link { background: none; border: 0; color: #ea580c; cursor: pointer; font-size: 12px; padding: 0; font-weight: 600; }
    .eip-card { background: var(--eip-card); border: 1px solid var(--eip-line); border-radius: 12px; padding: 10px 12px; }
    .eip-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .eip-card-head h3 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    .eip-pill { display: inline-block; font-size: 10px; font-weight: 700; border-radius: 999px; padding: 2px 8px; white-space: nowrap; }
    .eip-verified { background: #dcfce7; color: #166534; }
    .eip-est { background: #ffedd5; color: #9a3412; }
    .eip-conf-high { background: #dcfce7; color: #166534; }
    .eip-conf-medium { background: #fef9c3; color: #854d0e; }
    .eip-conf-low { background: #fee2e2; color: #991b1b; }
    .eip-dl { margin: 0; display: flex; flex-direction: column; }
    .eip-dl-row { display: flex; gap: 10px; padding: 4px 0; border-top: 1px dashed var(--eip-line); }
    .eip-dl-row:first-child { border-top: 0; }
    .eip-dl dt { flex: 0 0 118px; color: var(--eip-dim); font-size: 12px; }
    .eip-dl dd { margin: 0; flex: 1; font-weight: 600; font-size: 12px; overflow-wrap: anywhere; }
    .eip-big { font-size: 24px; font-weight: 800; margin: 2px 0 8px; }
    .eip-big span { font-size: 12px; font-weight: 500; color: var(--eip-dim); }
    .eip-mini-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .eip-mini-grid > div { background: var(--eip-bg, #fff); border: 1px solid var(--eip-line); border-radius: 8px; padding: 6px 8px; }
    .eip-mini-grid span { display: block; font-size: 10px; color: var(--eip-dim); text-transform: uppercase; letter-spacing: .03em; }
    .eip-mini-grid strong { font-size: 13px; }
    .eip-small { font-size: 11px !important; font-weight: 600 !important; }
    .eip-how-body { display: none; margin-top: 6px; }
    .eip-how.eip-open .eip-how-body { display: block; }
    .eip-how ol { margin: 6px 0; padding-left: 18px; font-size: 12px; display: flex; flex-direction: column; gap: 4px; }
    .eip-tiny { font-size: 11px; margin-top: 4px; }
    .eip-dim { color: var(--eip-dim); }
    .eip-gauges { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .eip-gauge-card { text-align: center; background: var(--eip-bg, #fff); border: 1px solid var(--eip-line); border-radius: 10px; padding: 8px 4px; }
    .eip-gauge-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
    .eip-gauge-label { font-size: 11px; color: var(--eip-dim); margin-top: 2px; }
    .eip-gauge { --eip-track: var(--eip-track); }
    .eip-title-block { display: flex; flex-direction: column; gap: 6px; }
    .eip-listing-title { font-weight: 700; font-size: 13px; line-height: 1.35; }
    .eip-track-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .eip-btn { border: 1px solid var(--eip-line); background: var(--eip-bg, #fff); color: inherit; border-radius: 8px;
      padding: 6px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .eip-btn:hover { border-color: #ea580c; }
    .eip-btn-primary { background: #ea580c; border-color: #ea580c; color: #fff; }
    .eip-btn-ghost { background: transparent; }
    .eip-table-wrap { overflow-x: auto; }
    .eip-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .eip-table th, .eip-table td { text-align: left; padding: 5px 6px; border-top: 1px solid var(--eip-line); vertical-align: top; }
    .eip-table thead th { border-top: 0; }
    .eip-table a { color: inherit; text-decoration: none; }
    .eip-table a:hover { color: #ea580c; }
    .eip-num { text-align: right !important; white-space: nowrap; }
    .eip-t-title { max-width: 130px; }
    .eip-th { background: none; border: 0; color: inherit; font: inherit; font-weight: 700; cursor: pointer; padding: 0; white-space: nowrap; }
    .eip-top { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
    .eip-top a { color: inherit; text-decoration: none; }
    .eip-top a:hover { color: #ea580c; }
    .eip-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .eip-chip { background: var(--eip-bg, #fff); border: 1px solid var(--eip-line); border-radius: 999px; padding: 3px 10px; font-size: 11px; font-weight: 600; }
    .eip-note { background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; border-radius: 10px; padding: 8px 10px; font-size: 12px; }
    :host([data-theme="dark"]) .eip-note { background: #1e3a8a33; border-color: #1e40af; color: #bfdbfe; }
    :host([data-theme="dark"]) .eip-verified, :host([data-theme="dark"]) .eip-conf-high { background: #14532d; color: #bbf7d0; }
    :host([data-theme="dark"]) .eip-est { background: #431407; color: #fdba74; }
    :host([data-theme="dark"]) .eip-conf-medium { background: #422006; color: #fde68a; }
    :host([data-theme="dark"]) .eip-conf-low { background: #450a0a; color: #fecaca; }
    .eip-loading { text-align: center; padding: 30px 10px; color: var(--eip-dim); }
    .eip-spinner { width: 28px; height: 28px; margin: 0 auto 10px; border-radius: 50%;
      border: 3px solid var(--eip-track); border-top-color: #ea580c; animation: eip-spin 0.8s linear infinite; }
    @keyframes eip-spin { to { transform: rotate(360deg); } }
    .eip-error { background: var(--eip-card); border: 1px solid var(--eip-line); border-radius: 12px; padding: 14px; }
    .eip-error p { color: var(--eip-dim); font-size: 12px; }
  `;
})(typeof globalThis !== 'undefined' ? globalThis : this);
