/* View: Settings */
(function () {
  'use strict';
  const EIP = window.EIP;
  EIP.views = EIP.views || {};

  const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'MXN', 'BRL', 'SEK', 'PLN', 'TRY'];

  EIP.views.settings = {
    async render(el, ctx) {
      const D = EIP.dashboard;
      const s = ctx.settings;

      el.innerHTML = `
        <div class="card"><h3>Display</h3><div class="form">
          <div class="field"><label for="fCurrency">Display currency</label>
            <select id="fCurrency">${CURRENCIES.map(c => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select>
            <div class="hint">Used for revenue estimates. No conversion is applied — if a listing is priced in another currency its own currency is shown alongside.</div></div>
          <div class="field"><label for="fTheme">Theme</label>
            <select id="fTheme">${['auto', 'light', 'dark'].map(t => `<option value="${t}" ${t === s.theme ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        </div></div>

        <div class="card"><h3>Estimation assumptions <span class="pill est">transparent</span></h3><div class="form">
          <div class="field"><label for="fReviewRate">Review rate: <span id="reviewRateVal">${Math.round(s.reviewRate * 100)}%</span> of orders leave a review</label>
            <input type="range" id="fReviewRate" min="5" max="50" step="1" value="${Math.round(s.reviewRate * 100)}" />
            <div class="hint">Core assumption: estimated orders = observed reviews ÷ review rate. 10–20% is typical for Etsy; lower it for high-review categories. Shop calibration (when shop sales + reviews are both visible) blends this with observed data — always disclosed in “How was this estimated?”.</div></div>
          <div class="field"><label for="fSensitivity">Estimation sensitivity</label>
            <select id="fSensitivity">${['conservative', 'balanced', 'optimistic'].map(t => `<option ${t === s.sensitivity ? 'selected' : ''}>${t}</option>`).join('')}</select>
            <div class="hint">Widens/narrows estimate ranges. Conservative ×0.55–×1.25 · Balanced ×0.75–×1.6 · Optimistic ×0.9–×2.0.</div></div>
          <div class="field"><label for="fConv">Listing conversion rate: <span id="convVal">${(s.conversionRate * 100).toFixed(1)}%</span></label>
            <input type="range" id="fConv" min="0.5" max="10" step="0.5" value="${(s.conversionRate * 100).toFixed(1)}" />
            <div class="hint">Used only for view estimates: views ≈ orders ÷ conversion. 1–3% is typical for marketplaces.</div></div>
        </div></div>

        <div class="card"><h3>Tracking</h3><div class="form">
          <div class="switch-row"><input type="checkbox" id="fAutoAnalyze" ${s.autoAnalyze ? 'checked' : ''} /><label for="fAutoAnalyze">Automatic analysis on Etsy pages</label></div>
          <div class="switch-row"><input type="checkbox" id="fAutoTrack" ${s.autoTrack ? 'checked' : ''} /><label for="fAutoTrack">Record observations when revisiting tracked items</label></div>
          <div class="field"><label for="fInterval">Minimum hours between observations: <span id="intervalVal">${s.trackingMinIntervalHours}h</span></label>
            <input type="range" id="fInterval" min="1" max="168" step="1" value="${s.trackingMinIntervalHours}" /></div>
        </div></div>

        <div class="card"><h3>Your data</h3>
          <div class="btn-row">
            <button class="btn" id="btnExport">Export all data (JSON)</button>
            <button class="btn" id="btnImport">Import backup…</button>
            <input type="file" id="fileImport" accept="application/json" style="display:none" />
            <button class="btn btn-danger" id="btnWipe">Delete all local data</button>
          </div>
          <p class="dim" id="dataNote"></p>
        </div>
        <div class="card"><div class="btn-row"><button class="btn btn-primary" id="btnSave">Save settings</button><span class="dim" id="saveNote"></span></div></div>`;

      const $ = (id) => el.querySelector('#' + id);
      $('fReviewRate').addEventListener('input', e => { $('reviewRateVal').textContent = e.target.value + '%'; });
      $('fConv').addEventListener('input', e => { $('convVal').textContent = Number(e.target.value).toFixed(1) + '%'; });
      $('fInterval').addEventListener('input', e => { $('intervalVal').textContent = e.target.value + 'h'; });

      $('btnSave').addEventListener('click', async () => {
        const next = {
          ...ctx.settings,
          currency: $('fCurrency').value,
          theme: $('fTheme').value,
          reviewRate: parseInt($('fReviewRate').value, 10) / 100,
          sensitivity: $('fSensitivity').value,
          conversionRate: parseFloat($('fConv').value) / 100,
          autoAnalyze: $('fAutoAnalyze').checked,
          autoTrack: $('fAutoTrack').checked,
          trackingMinIntervalHours: parseInt($('fInterval').value, 10)
        };
        ctx.settings = await EIP.storage.saveSettings(next);
        $('saveNote').textContent = 'Saved ✓';
        setTimeout(() => { $('saveNote').textContent = ''; }, 2000);
      });

      $('btnExport').addEventListener('click', async () => {
        const payload = await EIP.storage.exportAll();
        EIP.exporter.downloadJSON(`etsy-insight-backup-${new Date().toISOString().slice(0, 10)}.json`, payload);
      });
      $('btnImport').addEventListener('click', () => $('fileImport').click());
      $('fileImport').addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          const payload = JSON.parse(await f.text());
          await EIP.storage.importAll(payload);
          ctx.settings = await EIP.storage.loadSettings();
          $('dataNote').textContent = 'Backup imported ✓';
          EIP.dashboard.rerender();
        } catch (err) {
          $('dataNote').textContent = 'Import failed: ' + (err.message || err);
        }
      });
      $('btnWipe').addEventListener('click', async () => {
        if (!confirm('Delete ALL Etsy Insight Pro data on this device (tracked items, research, settings)?')) return;
        await EIP.storage.clearAll();
        ctx.settings = await EIP.storage.loadSettings();
        EIP.dashboard.rerender();
      });

      try {
        const bytes = await EIP.storage.getBytesInUse();
        $('dataNote').textContent = `Currently using ${(bytes / 1024).toFixed(1)} KB of local extension storage.`;
      } catch (e) { /* ignore */ }
    }
  };
})();
