/* Etsy Insight Pro — dashboard.js (router + shared view helpers) */
(function () {
  'use strict';
  const EIP = window.EIP;
  const U = EIP.utils;

  const TITLES = {
    overview: 'Overview', research: 'Research', keywords: 'Keywords',
    'tracked-products': 'Tracked Products', 'tracked-shops': 'Tracked Shops',
    settings: 'Settings', privacy: 'Privacy'
  };
  const ctx = { settings: null, U, EIP, route: 'overview', params: {} };

  boot().catch(err => {
    document.getElementById('view').innerHTML =
      `<div class="card"><h3>Something went wrong</h3><p class="dim">${U.escapeHtml(String(err && err.message || err))}</p></div>`;
  });

  async function boot() {
    ctx.settings = await EIP.storage.loadSettings();
    applyTheme(ctx.settings.theme);
    paintThemeToggle(ctx.settings.theme);
    document.getElementById('themeToggle').addEventListener('click', async () => {
      const order = ['auto', 'light', 'dark'];
      const next = order[(order.indexOf(ctx.settings.theme) + 1) % order.length];
      ctx.settings = await EIP.storage.saveSettings({ ...ctx.settings, theme: next });
      applyTheme(next);
      paintThemeToggle(next);
      render(); // re-render charts with new palette
    });
    window.addEventListener('hashchange', render);
    await refreshStorageNote();
    render();
  }

  function applyTheme(pref) {
    const root = document.documentElement;
    if (pref === 'dark') root.setAttribute('data-theme', 'dark');
    else if (pref === 'light') root.setAttribute('data-theme', 'light');
    else root.setAttribute('data-theme', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }

  function paintThemeToggle(pref) {
    document.getElementById('themeToggle').textContent = `Theme: ${pref}`;
  }

  async function refreshStorageNote() {
    try {
      const bytes = await EIP.storage.getBytesInUse();
      document.getElementById('storageNote').textContent =
        `Local data: ${(bytes / 1024).toFixed(1)} KB · nothing leaves this device`;
    } catch (e) { /* ignore */ }
  }

  function currentRoute() {
    const h = (location.hash || '#/overview').replace(/^#\/?/, '');
    const [name, ...rest] = h.split('/');
    return { name: TITLES[name] ? name : 'overview', params: rest };
  }

  async function render() {
    const { name, params } = currentRoute();
    ctx.route = name;
    ctx.params = params;
    document.querySelectorAll('#sideNav a').forEach(a => {
      a.classList.toggle('active', a.getAttribute('data-route') === name);
    });
    document.getElementById('viewTitle').textContent = TITLES[name];
    const view = document.getElementById('view');
    view.innerHTML = '<div class="card">Loading…</div>';
    try {
      const mod = (EIP.views || {})[name];
      if (!mod || typeof mod.render !== 'function') throw new Error(`View “${name}” is missing.`);
      await mod.render(view, ctx);
      await refreshStorageNote();
    } catch (err) {
      console.warn('[dashboard]', err);
      view.innerHTML = `<div class="card"><h3>Couldn’t load this view</h3><p class="dim">${U.escapeHtml(String(err && err.message || err))}</p></div>`;
    }
  }

  // ---- shared helpers for views ----
  EIP.dashboard = {
    rerender: render,
    esc: U.escapeHtml,
    fmtInt: U.formatInt,
    fmtCompact: U.formatCompact,
    fmtRange: U.formatRange,
    fmtMoney: U.formatMoney,
    fmtMoneyCompact: U.formatMoneyCompact,
    confPill(conf) {
      const c = String(conf || 'Low').toLowerCase();
      return `<span class="pill ${c}">Confidence: ${U.escapeHtml(conf || 'Low')}</span>`;
    },
    empty(icon, title, hint) {
      return `<div class="card"><div class="empty"><div class="big">${icon}</div><h3>${U.escapeHtml(title)}</h3><p>${U.escapeHtml(hint)}</p></div></div>`;
    },
    /** Sortable table. columns: [{key,label,num,render(row)}]. */
    table(rows, columns, sortState, onSortKey) {
      const arrow = (k) => sortState && sortState.key === k ? (sortState.dir === 1 ? ' ▲' : ' ▼') : '';
      const head = columns.map(c =>
        `<th class="${c.num ? 'num' : ''}"><button data-sort="${U.escapeHtml(c.key)}">${U.escapeHtml(c.label)}${arrow(c.key)}</button></th>`
      ).join('');
      const body = rows.map(r =>
        `<tr>${columns.map(c => `<td class="${c.num ? 'num' : ''}">${c.render(r)}</td>`).join('')}</tr>`
      ).join('') || `<tr><td colspan="${columns.length}">No rows.</td></tr>`;
      return `<div class="table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    },
    bindSort(scopeEl, sortState, rerender) {
      scopeEl.querySelectorAll('[data-sort]').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.getAttribute('data-sort');
          if (sortState.key === key) sortState.dir = -sortState.dir;
          else { sortState.key = key; sortState.dir = 1; }
          rerender();
        });
      });
    },
    applySort(rows, sortState, getters) {
      if (!sortState.key || !getters[sortState.key]) return rows;
      const g = getters[sortState.key];
      return [...rows].sort((a, b) => {
        const va = g(a), vb = g(b);
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        if (typeof va === 'string') return va.localeCompare(vb) * sortState.dir;
        return (va - vb) * sortState.dir;
      });
    }
  };
})();
