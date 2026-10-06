/* View: Privacy */
(function () {
  'use strict';
  const EIP = window.EIP;
  EIP.views = EIP.views || {};

  EIP.views.privacy = {
    async render(el) {
      el.innerHTML = `
        <div class="card"><h3>Privacy at a glance</h3>
          <p><strong>Etsy Insight Pro is local-first.</strong> All analysis happens on your device, in your browser. There is no backend server, no analytics SDK, and no account.</p>
        </div>
        <div class="card"><h3>What is collected</h3>
          <ul>
            <li><strong>Public Etsy page content you choose to analyse</strong> — listing titles, visible prices, review counts, ratings, shop names and other information already displayed publicly on etsy.com.</li>
            <li><strong>Observations of items you explicitly track</strong> — timestamped snapshots (price, reviews, rating, visible sales) so trends can be drawn. Observations are recorded only for items you pressed “Track” on (plus automatic re-snapshots when <em>you</em> revisit them, if enabled in Settings).</li>
            <li><strong>Your settings</strong> — theme, currency, estimation assumptions.</li>
          </ul>
        </div>
        <div class="card"><h3>What is stored, and where</h3>
          <ul>
            <li>Everything is stored in <strong>chrome.storage.local on this device only</strong>. Use Settings → “Export all data” to inspect every byte, or “Delete all local data” to wipe it.</li>
            <li>Listing images are <strong>not</strong> persisted — only the page URL is kept, and images load from Etsy when you browse.</li>
          </ul>
        </div>
        <div class="card"><h3>What is never collected</h3>
          <ul>
            <li>No passwords, cookies, payment details, private messages, or Etsy account information.</li>
            <li>No browsing history beyond the Etsy pages you actively analyse or track.</li>
            <li>No data is sent to any external server by this extension. (Etsy itself still sees your normal browsing, as with any visit.)</li>
          </ul>
        </div>
        <div class="card"><h3>Respecting Etsy</h3>
          <p>The extension only reads pages you already opened in your browser — it does not scrape in the background, bypass rate limits, or circumvent access controls. Estimates are computed from visible signals and are always labelled as estimates.</p>
        </div>`;
    }
  };
})();
