/* View: Tracked Shops */
(function () {
  'use strict';
  const EIP = window.EIP;
  EIP.views = EIP.views || {};
  let range = 30;
  const sortState = { key: 'sales', dir: -1 };

  EIP.views['tracked-shops'] = {
    async render(el, ctx) {
      const D = EIP.dashboard;
      const map = await EIP.storage.loadShops();
      const list = Object.values(map);
      const detailId = ctx.params[0] ? decodeURIComponent(ctx.params[0]) : null;
      if (detailId) return renderDetail(el, ctx, map[detailId.toLowerCase()] || map[detailId]);
      if (!list.length) {
        el.innerHTML = D.empty('🏪', 'No tracked shops', 'Open an Etsy shop page, analyse it, and press “Track this shop”.');
        return;
      }
      el.innerHTML = `<div class="card"><h3>Tracked shops (${list.length})</h3><div id="tbl"></div></div>`;
      const tbl = el.querySelector('#tbl');
      paint();
      function paint() {
        const rows = list.map(s => {
          const obs = s.observations || [];
          const last = obs[obs.length - 1] || {};
          const s30 = EIP.tracking.summarizeHistory(obs, 30);
          return { s, last, s30 };
        });
        const sorted = D.applySort(rows, sortState, {
          name: r => (r.s.name || r.s.id).toLowerCase(),
          sales: r => r.last.sales, reviews: r => r.last.reviews,
          listings: r => r.last.listings, est: r => r.last.monthlySalesMid,
          growth: r => r.s30 && r.s30.salesDelta, updated: r => r.last.t
        });
        tbl.innerHTML = D.table(sorted, [
          { key: 'name', label: 'Shop', render: r => `<a href="#/tracked-shops/${encodeURIComponent(r.s.id)}">${D.esc(r.s.name || r.s.id)}</a>` },
          { key: 'sales', label: 'Total sales', num: true, render: r => r.last.sales != null ? D.fmtInt(r.last.sales) : '—' },
          { key: 'reviews', label: 'Reviews', num: true, render: r => r.last.reviews != null ? D.fmtInt(r.last.reviews) : '—' },
          { key: 'listings', label: 'Listings', num: true, render: r => r.last.listings != null ? D.fmtInt(r.last.listings) : '—' },
          { key: 'est', label: 'Est. sales/mo', num: true, render: r => r.last.monthlySalesMid != null ? D.fmtCompact(r.last.monthlySalesMid) : '—' },
          { key: 'growth', label: 'Sales Δ 30d', num: true, render: r => r.s30 && r.s30.salesDelta != null ? (r.s30.salesDelta >= 0 ? '+' : '') + r.s30.salesDelta : '—' },
          { key: 'updated', label: 'Last seen', num: true, render: r => r.last.t ? EIP.utils.timeAgo(r.last.t) : '—' }
        ], sortState);
        D.bindSort(tbl, sortState, paint);
      }
    }
  };

  async function renderDetail(el, ctx, rec) {
    const D = EIP.dashboard;
    if (!rec) {
      el.innerHTML = `<div class="card"><p>Shop no longer tracked. <a href="#/tracked-shops">Back to list</a></p></div>`;
      return;
    }
    const obs = rec.observations || [];
    const last = obs[obs.length - 1] || {};
    const meta = rec.meta || {};
    el.innerHTML = `
      <div class="card"><div class="detail-head">
        <div><a href="#/tracked-shops">← All tracked shops</a>
          <h2 style="margin:6px 0 4px;text-transform:none;letter-spacing:0;font-size:18px;">${D.esc(rec.name || rec.id)}</h2>
          <div class="dim">${D.esc(meta.niche || '')} · <a href="${D.esc(meta.url || '#')}" target="_blank" rel="noopener">Open on Etsy ↗</a> · ${obs.length} observations</div>
        </div>
        <div class="btn-row"><button class="btn btn-danger" id="btnRemove">Stop tracking</button></div>
      </div></div>
      <div class="grid kpi">
        <div class="kpi-card"><span>Total sales</span><strong>${last.sales != null ? D.fmtInt(last.sales) : '—'}</strong></div>
        <div class="kpi-card"><span>Reviews</span><strong>${last.reviews != null ? D.fmtInt(last.reviews) : '—'}</strong></div>
        <div class="kpi-card"><span>Listings</span><strong>${last.listings != null ? D.fmtInt(last.listings) : '—'}</strong></div>
        <div class="kpi-card"><span>Est. sales/mo</span><strong>${last.monthlySalesMid != null ? D.fmtCompact(last.monthlySalesMid) : '—'}</strong></div>
      </div>
      <div class="card">
        <div class="toolbar"><h3 style="margin:0">Trends</h3>
          <div class="range-tabs" id="rangeTabs">${[7, 30, 90].map(d => `<button data-range="${d}" class="${d === range ? 'active' : ''}">${d} days</button>`).join('')}</div>
        </div>
        <h3>Total sales (verified snapshots)</h3><canvas id="chSales"></canvas>
        <h3 style="margin-top:14px">Reviews</h3><canvas id="chReviews"></canvas>
        <h3 style="margin-top:14px">Active listings</h3><canvas id="chListings"></canvas>
        <h3 style="margin-top:14px">Est. monthly sales (midpoint)</h3><canvas id="chEst"></canvas>
      </div>`;
    el.querySelector('#btnRemove').addEventListener('click', async () => {
      if (!confirm('Stop tracking this shop? Its history will be deleted.')) return;
      await EIP.tracking.removeShop(rec.name || rec.id);
      location.hash = '#/tracked-shops';
    });
    el.querySelector('#rangeTabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-range]');
      if (!b) return;
      range = parseInt(b.getAttribute('data-range'), 10);
      el.querySelectorAll('#rangeTabs button').forEach(x => x.classList.toggle('active', x === b));
      draw();
    });
    draw();
    function draw() {
      const cutoff = Date.now() - range * 86400000;
      const w = obs.filter(o => o.t >= cutoff);
      const pts = (f) => w.filter(o => Number.isFinite(o[f])).map(o => ({ t: o.t, v: o[f] }));
      EIP.charts.lineChart(el.querySelector('#chSales'), [{ label: 'Sales', points: pts('sales') }], { height: 180 });
      EIP.charts.lineChart(el.querySelector('#chReviews'), [{ label: 'Reviews', points: pts('reviews') }], { height: 180 });
      EIP.charts.lineChart(el.querySelector('#chListings'), [{ label: 'Listings', points: pts('listings') }], { height: 180 });
      EIP.charts.lineChart(el.querySelector('#chEst'), [{ label: 'Est', points: pts('monthlySalesMid') }], { height: 180 });
    }
  }
})();
