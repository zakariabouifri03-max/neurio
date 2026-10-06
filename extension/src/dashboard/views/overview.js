/* View: Overview */
(function () {
  'use strict';
  const EIP = window.EIP;
  EIP.views = EIP.views || {};

  EIP.views.overview = {
    async render(el, ctx) {
      const D = EIP.dashboard;
      const [products, shops, research, meta] = await Promise.all([
        EIP.storage.loadProducts(), EIP.storage.loadShops(),
        EIP.storage.loadResearch(), EIP.storage.loadMeta()
      ]);
      const pList = Object.values(products);
      const sList = Object.values(shops);
      const obsCount = pList.reduce((a, p) => a + (p.observations || []).length, 0) +
        sList.reduce((a, s) => a + (s.observations || []).length, 0);

      const latestResearch = research[0];
      const topTracked = pList
        .map(p => ({ p, last: (p.observations || [])[(p.observations || []).length - 1] }))
        .filter(x => x.last)
        .sort((a, b) => (b.last.demand || 0) - (a.last.demand || 0))
        .slice(0, 5);

      el.innerHTML = `
        <div class="grid kpi">
          ${kpi('Tracked products', pList.length, 'local observations over time')}
          ${kpi('Tracked shops', sList.length, 'shop-level history')}
          ${kpi('Research sessions', research.length, 'saved search analyses')}
          ${kpi('Observations', obsCount || (meta.observationCount || 0), 'timestamped snapshots')}
        </div>
        <div class="grid two">
          <div class="card">
            <h3>Getting started</h3>
            <ol class="steps">
              <li>Open any <strong>Etsy product page</strong> and press <strong>Analyze Product</strong>.</li>
              <li>Open a <strong>shop page</strong> for shop analytics, or a <strong>search page</strong> for research mode.</li>
              <li>Press <strong>Track</strong> on anything important — revisit it and this dashboard builds 7/30/90-day charts.</li>
            </ol>
            <p class="dim">Green “Verified” = read directly from the Etsy page. Orange “Estimated” = calculated from public signals with a confidence level and a written explanation. Estimates are never exact.</p>
          </div>
          <div class="card">
            <h3>Latest research ${latestResearch ? `<span class="dim">· ${D.esc(latestResearch.query || '')}</span>` : ''}</h3>
            ${latestResearch ? latestResearchHTML(latestResearch) : '<p class="dim">No research yet. Analyse an Etsy search page to fill this in.</p>'}
          </div>
        </div>
        <div class="card">
          <h3>Tracked products by demand</h3>
          ${topTracked.length ? EIP.charts.barListHTML(topTracked.map(x => ({
            label: (x.p.meta && x.p.meta.title) || x.p.id,
            value: x.last.demand || 0, display: `${x.last.demand || 0}/100`
          }))) : '<p class="dim">Nothing tracked yet.</p>'}
        </div>`;

      function kpi(label, value, sub) {
        return `<div class="kpi-card"><span>${D.esc(label)}</span><strong>${D.fmtInt(value)}</strong><small>${D.esc(sub)}</small></div>`;
      }
      function latestResearchHTML(s) {
        const items = (s.items || []).slice(0, 5);
        return `<div class="table-wrap"><table class="data"><thead><tr><th>#</th><th>Product</th><th class="num">Est. sales/mo</th><th class="num">Opp.</th></tr></thead><tbody>` +
          items.map(it => `<tr><td>${it.rank}</td><td><a href="${D.esc(it.url || '#')}" target="_blank" rel="noopener">${D.esc((it.title || '').slice(0, 50))}</a></td>` +
            `<td class="num">${it.sales ? D.fmtRange(it.sales.low, it.sales.high) : '—'}</td>` +
            `<td class="num">${it.scores ? it.scores.opportunity.value : '—'}</td></tr>`).join('') +
          `</tbody></table></div><p class="dim">Full table in <a href="#/research">Research</a>.</p>`;
      }
    }
  };
})();
