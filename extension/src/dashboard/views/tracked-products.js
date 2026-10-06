/* View: Tracked Products — list + 7/30/90-day detail charts */
(function () {
  'use strict';
  const EIP = window.EIP;
  EIP.views = EIP.views || {};
  let range = 30;
  const sortState = { key: 'demand', dir: -1 };

  EIP.views['tracked-products'] = {
    async render(el, ctx) {
      const D = EIP.dashboard;
      const map = await EIP.storage.loadProducts();
      const list = Object.values(map);
      const detailId = ctx.params[0] ? decodeURIComponent(ctx.params[0]) : null;

      if (detailId) return renderDetail(el, ctx, map[detailId]);
      if (!list.length) {
        el.innerHTML = D.empty('📌', 'No tracked products', 'Open an Etsy product page, analyse it, and press “Track this product”.');
        return;
      }
      el.innerHTML = `<div class="card"><h3>Tracked products (${list.length})</h3><div id="tbl"></div></div>`;
      const tbl = el.querySelector('#tbl');
      paint();
      function paint() {
        const rows = list.map(p => {
          const obs = p.observations || [];
          const last = obs[obs.length - 1] || {};
          const s30 = EIP.tracking.summarizeHistory(obs, 30);
          return { p, last, s30 };
        });
        const sorted = D.applySort(rows, sortState, {
          title: r => ((r.p.meta && r.p.meta.title) || r.p.id).toLowerCase(),
          price: r => r.last.price, reviews: r => r.last.reviews,
          sales: r => r.last.monthlySalesMid, demand: r => r.last.demand,
          growth: r => r.s30 && r.s30.reviewDelta, updated: r => r.last.t
        });
        tbl.innerHTML = D.table(sorted, [
          { key: 'title', label: 'Product', render: r => `<a href="#/tracked-products/${encodeURIComponent(r.p.id)}">${D.esc(((r.p.meta && r.p.meta.title) || r.p.id).slice(0, 60))}</a>` },
          { key: 'price', label: 'Price', num: true, render: r => r.last.price != null ? D.fmtMoney(r.last.price, r.last.currency || ctx.settings.currency) : '—' },
          { key: 'reviews', label: 'Reviews', num: true, render: r => r.last.reviews != null ? D.fmtInt(r.last.reviews) : '—' },
          { key: 'sales', label: 'Est. sales/mo', num: true, render: r => r.last.monthlySalesMid != null ? D.fmtCompact(r.last.monthlySalesMid) : '—' },
          { key: 'demand', label: 'Demand', num: true, render: r => r.last.demand != null ? r.last.demand : '—' },
          { key: 'growth', label: 'Rev Δ 30d', num: true, render: r => r.s30 && r.s30.reviewDelta != null ? (r.s30.reviewDelta >= 0 ? '+' : '') + r.s30.reviewDelta : '—' },
          { key: 'updated', label: 'Last seen', num: true, render: r => r.last.t ? EIP.utils.timeAgo(r.last.t) : '—' }
        ], sortState);
        D.bindSort(tbl, sortState, paint);
      }
    }
  };

  async function renderDetail(el, ctx, rec) {
    const D = EIP.dashboard;
    if (!rec) {
      el.innerHTML = `<div class="card"><p>This item is no longer tracked. <a href="#/tracked-products">Back to list</a></p></div>`;
      return;
    }
    const obs = rec.observations || [];
    const last = obs[obs.length - 1] || {};
    const meta = rec.meta || {};
    const s7 = EIP.tracking.summarizeHistory(obs, 7);
    const s30 = EIP.tracking.summarizeHistory(obs, 30);
    const s90 = EIP.tracking.summarizeHistory(obs, 90);

    el.innerHTML = `
      <div class="card">
        <div class="detail-head">
          <div><a href="#/tracked-products">← All tracked products</a>
            <h2 style="margin:6px 0 4px;text-transform:none;letter-spacing:0;font-size:18px;">${D.esc(meta.title || rec.id)}</h2>
            <div class="dim">${D.esc(meta.shopName || '')} · <a href="${D.esc(meta.url || '#')}" target="_blank" rel="noopener">Open on Etsy ↗</a> · ${obs.length} observations</div>
          </div>
          <div class="btn-row"><button class="btn btn-danger" id="btnRemove">Stop tracking</button></div>
        </div>
      </div>
      <div class="grid kpi">
        ${kpi('Price', last.price != null ? D.fmtMoney(last.price, last.currency || ctx.settings.currency) : '—', s30 && s30.priceChange != null ? `${s30.priceChange}% / 30d` : '—')}
        ${kpi('Reviews', last.reviews != null ? D.fmtInt(last.reviews) : '—', s30 && s30.reviewDelta != null ? `${s30.reviewDelta >= 0 ? '+' : ''}${s30.reviewDelta} / 30d` : '—')}
        ${kpi('Est. sales/mo', last.monthlySalesMid != null ? D.fmtCompact(last.monthlySalesMid) : '—', 'model midpoint')}
        ${kpi('Demand', last.demand != null ? last.demand + '/100' : '—', s30 ? EIP.tracking.trendLabel(s30.trend) : '—')}
      </div>
      <div class="card">
        <div class="toolbar"><h3 style="margin:0">Trends</h3>
          <div class="range-tabs" id="rangeTabs">
            ${[7, 30, 90].map(d => `<button data-range="${d}" class="${d === range ? 'active' : ''}">${d} days</button>`).join('')}
          </div>
        </div>
        <h3>Reviews</h3><canvas id="chReviews"></canvas>
        <h3 style="margin-top:14px">Estimated monthly sales (midpoint)</h3><canvas id="chSales"></canvas>
        <h3 style="margin-top:14px">Price</h3><canvas id="chPrice"></canvas>
        <h3 style="margin-top:14px">Demand score</h3><canvas id="chDemand"></canvas>
      </div>
      <div class="card"><h3>Change summary</h3>
        <div class="table-wrap"><table class="data"><thead><tr><th>Window</th><th class="num">Review Δ</th><th class="num">Price Δ %</th><th class="num">Sales Δ</th><th class="num">Trend</th></tr></thead>
        <tbody>${[s7, s30, s90].map(s => s ? `<tr><td>${s.days} days (${s.points} pts)</td><td class="num">${s.reviewDelta != null ? (s.reviewDelta >= 0 ? '+' : '') + s.reviewDelta : '—'}</td><td class="num">${s.priceChange != null ? s.priceChange + '%' : '—'}</td><td class="num">${s.salesDelta != null ? s.salesDelta : '—'}</td><td class="num">${EIP.tracking.trendLabel(s.trend)}</td></tr>` : '').join('')}</tbody></table></div>
      </div>`;

    el.querySelector('#btnRemove').addEventListener('click', async () => {
      if (!confirm('Stop tracking this product? Its history will be deleted.')) return;
      await EIP.tracking.removeProduct(rec.id);
      location.hash = '#/tracked-products';
    });
    el.querySelector('#rangeTabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-range]');
      if (!b) return;
      range = parseInt(b.getAttribute('data-range'), 10);
      el.querySelectorAll('#rangeTabs button').forEach(x => x.classList.toggle('active', x === b));
      drawCharts();
    });
    drawCharts();

    function kpi(label, value, sub) {
      return `<div class="kpi-card"><span>${D.esc(label)}</span><strong>${D.esc(String(value))}</strong><small>${D.esc(sub)}</small></div>`;
    }
    function drawCharts() {
      const cutoff = Date.now() - range * 86400000;
      const w = obs.filter(o => o.t >= cutoff);
      const pts = (f) => w.filter(o => Number.isFinite(o[f])).map(o => ({ t: o.t, v: o[f] }));
      EIP.charts.lineChart(el.querySelector('#chReviews'), [{ label: 'Reviews', points: pts('reviews') }], { height: 180 });
      EIP.charts.lineChart(el.querySelector('#chSales'), [{ label: 'Sales', points: pts('monthlySalesMid') }], { height: 180 });
      EIP.charts.lineChart(el.querySelector('#chPrice'), [{ label: 'Price', points: pts('price') }], { height: 180 });
      EIP.charts.lineChart(el.querySelector('#chDemand'), [{ label: 'Demand', points: pts('demand') }], { height: 180 });
    }
  }
})();
