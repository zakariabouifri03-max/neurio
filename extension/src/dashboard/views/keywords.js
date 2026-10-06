/* View: Keywords — on-page keyword lab */
(function () {
  'use strict';
  const EIP = window.EIP;
  EIP.views = EIP.views || {};
  const sortState = { key: 'opportunity', dir: -1 };

  EIP.views.keywords = {
    async render(el, ctx) {
      const D = EIP.dashboard;
      const sessions = await EIP.storage.loadResearch();
      if (!sessions.length) {
        el.innerHTML = D.empty('🔑', 'No keywords yet', 'Analyse an Etsy search page — keywords are extracted from the visible listing titles.');
        return;
      }
      const idx = Math.min(parseInt(ctx.params[0] || '0', 10) || 0, sessions.length - 1);
      const s = sessions[idx];
      // Recompute from items so settings-agnostic stats stay fresh; fall back to stored rows.
      let kw = null;
      try {
        kw = EIP.keywords.analyzeKeywords(
          (s.items || []).map(i => ({ title: i.title, price: i.price, reviews: i.reviews, rating: i.rating })),
          { minFrequency: 2, maxRows: 60 }
        );
      } catch (e) { kw = null; }
      const rows = (kw && kw.rows) || ((s.keywords && s.keywords.rows) || []);
      const suggestions = (kw && kw.suggestions) || ((s.keywords && s.keywords.suggestions) || []);

      el.innerHTML = `
        <div class="card">
          <div class="toolbar">
            <label class="dim" for="sessionSel">Session:</label>
            <select id="sessionSel">${sessions.map((x, i) =>
              `<option value="${i}" ${i === idx ? 'selected' : ''}>${D.esc(x.query || '(query)')} · ${new Date(x.savedAt).toLocaleDateString()}</option>`).join('')}
            </select>
            <span style="flex:1"></span>
            <button class="btn" id="expCsv">Export CSV</button>
          </div>
          <h3>Suggestions <span class="pill est">from visible titles</span></h3>
          <div class="chips">${suggestions.map(k => `<span class="chip">${D.esc(k)}</span>`).join('') || '<span class="dim">—</span>'}</div>
          <p class="dim">${D.esc((kw && kw.coverage && kw.coverage.note) || '')} Frequency = share of visible listings using the term. The extension does not know Etsy’s private search volumes and does not claim to.</p>
        </div>
        <div class="card"><h3>Keyword table</h3><div id="tbl"></div></div>`;

      el.querySelector('#sessionSel').addEventListener('change', (e) => { location.hash = `#/keywords/${e.target.value}`; });
      el.querySelector('#expCsv').addEventListener('click', () => {
        EIP.exporter.downloadCSV(`etsy-insight-keywords-${new Date().toISOString().slice(0, 10)}.csv`, EIP.exporter.keywordRows({ rows }));
      });

      const tbl = el.querySelector('#tbl');
      paint();
      function paint() {
        const sorted = D.applySort(rows, sortState, {
          keyword: r => r.keyword, frequency: r => r.frequency, share: r => r.sharePct,
          price: r => r.avgPrice, reviews: r => r.avgReviews,
          demand: r => r.demand, competition: r => r.competition, opportunity: r => r.opportunity
        });
        tbl.innerHTML = D.table(sorted, [
          { key: 'keyword', label: 'Keyword', render: r => `${D.esc(r.keyword)}${r.longTail ? ' <span class="pill">long-tail</span>' : ''}` },
          { key: 'frequency', label: 'Freq.', num: true, render: r => r.frequency },
          { key: 'share', label: 'Share %', num: true, render: r => r.sharePct + '%' },
          { key: 'price', label: 'Avg price', num: true, render: r => r.avgPrice != null ? D.fmtMoney(r.avgPrice, s.currency || ctx.settings.currency) : '—' },
          { key: 'reviews', label: 'Avg reviews', num: true, render: r => r.avgReviews != null ? D.fmtInt(r.avgReviews) : '—' },
          { key: 'demand', label: 'Demand', num: true, render: r => r.demand },
          { key: 'competition', label: 'Comp.', num: true, render: r => r.competition },
          { key: 'opportunity', label: 'Opp.', num: true, render: r => `<strong>${r.opportunity}</strong>` }
        ], sortState);
        D.bindSort(tbl, sortState, paint);
      }
    }
  };
})();
