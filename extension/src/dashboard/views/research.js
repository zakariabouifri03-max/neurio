/* View: Research — sortable sessions table + export */
(function () {
  'use strict';
  const EIP = window.EIP;
  EIP.views = EIP.views || {};
  const sortState = { key: 'opportunity', dir: -1 };

  EIP.views.research = {
    async render(el, ctx) {
      const D = EIP.dashboard;
      const sessions = await EIP.storage.loadResearch();
      if (!sessions.length) {
        el.innerHTML = D.empty('🔍', 'No research yet', 'Open an Etsy search page and press “Analyze Results”. Sessions are saved here automatically.');
        return;
      }
      const idx = Math.min(parseInt(ctx.params[0] || '0', 10) || 0, sessions.length - 1);
      const s = sessions[idx];
      const items = s.items || [];

      el.innerHTML = `
        <div class="card">
          <div class="toolbar">
            <label class="dim" for="sessionSel">Session:</label>
            <select id="sessionSel">${sessions.map((x, i) =>
              `<option value="${i}" ${i === idx ? 'selected' : ''}>${D.esc(x.query || '(query)')} · ${(x.items || []).length} items · ${new Date(x.savedAt).toLocaleDateString()}</option>`).join('')}
            </select>
            <input type="search" id="q" placeholder="Filter products…" />
            <span class="dim">${s.totalResults != null ? D.fmtInt(s.totalResults) + ' total Etsy results · ' : ''}${items.length} visible analysed</span>
            <span style="flex:1"></span>
            <button class="btn" id="expCsv">Export CSV</button>
            <button class="btn" id="expJson">Export JSON</button>
          </div>
          <div id="tbl"></div>
          <p class="dim">Sales, revenue and scores are <strong>estimated</strong> from public signals (reviews, prices, badges). Confidence per row is included in exports.</p>
        </div>`;

      const tbl = el.querySelector('#tbl');
      const q = el.querySelector('#q');
      el.querySelector('#sessionSel').addEventListener('change', (e) => {
        location.hash = `#/research/${e.target.value}`;
      });
      q.addEventListener('input', paint);
      el.querySelector('#expCsv').addEventListener('click', () => {
        EIP.exporter.downloadCSV(`etsy-insight-research-${stamp()}.csv`, EIP.exporter.researchRows(s));
      });
      el.querySelector('#expJson').addEventListener('click', () => {
        EIP.exporter.downloadJSON(`etsy-insight-research-${stamp()}.json`, s);
      });

      paint();
      function paint() {
        const term = (q.value || '').toLowerCase();
        let rows = items.filter(it => !term || (it.title || '').toLowerCase().includes(term));
        rows = D.applySort(rows, sortState, {
          rank: r => r.rank, title: r => (r.title || '').toLowerCase(),
          price: r => r.price, reviews: r => r.reviews,
          sales: r => r.sales && r.sales.mid, revenue: r => r.revenue && r.revenue.monthly && r.revenue.monthly.mid,
          demand: r => r.scores && r.scores.demand.value,
          competition: r => r.scores && r.scores.competition.value,
          opportunity: r => r.scores && r.scores.opportunity.value
        });
        tbl.innerHTML = D.table(rows, [
          { key: 'rank', label: 'Rank', num: true, render: r => r.rank },
          { key: 'title', label: 'Product', render: r => `<a href="${D.esc(r.url || '#')}" target="_blank" rel="noopener">${D.esc((r.title || '').slice(0, 60))}</a>${r.isBestseller ? ' <span class="pill est">Bestseller</span>' : ''}` },
          { key: 'price', label: 'Price', num: true, render: r => r.price != null ? D.fmtMoney(r.price, r.currency || s.currency || ctx.settings.currency) : '—' },
          { key: 'reviews', label: 'Reviews', num: true, render: r => r.reviews != null ? D.fmtInt(r.reviews) : '—' },
          { key: 'sales', label: 'Est. sales/mo', num: true, render: r => r.sales ? D.fmtRange(r.sales.low, r.sales.high) : '—' },
          { key: 'revenue', label: 'Est. rev/mo', num: true, render: r => r.revenue && r.revenue.monthly ? D.fmtMoneyCompact(r.revenue.monthly.mid, r.currency || s.currency || ctx.settings.currency) : '—' },
          { key: 'demand', label: 'Demand', num: true, render: r => r.scores ? r.scores.demand.value : '—' },
          { key: 'competition', label: 'Comp.', num: true, render: r => r.scores ? r.scores.competition.value : '—' },
          { key: 'opportunity', label: 'Opp.', num: true, render: r => r.scores ? `<strong>${r.scores.opportunity.value}</strong>` : '—' }
        ], sortState);
        D.bindSort(tbl, sortState, paint);
      }
      function stamp() { return new Date().toISOString().slice(0, 10); }
    }
  };
})();
