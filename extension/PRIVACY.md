# Privacy Policy — Etsy Insight Pro

**Short version: your data never leaves your device.** There is no backend, no
account, no analytics SDK, and no remote call of any kind made by this extension.

## Data the extension processes

1. **Public Etsy page content you choose to analyse.** When you press “Analyze”
   (or enable automatic analysis), the extension reads information already
   displayed publicly on the etsy.com page in your browser: listing titles,
   visible prices, review counts, ratings, shop names, badges, and similar.
2. **Observations of items you explicitly track.** Pressing “Track” stores
   timestamped snapshots (date, price, reviews, rating, visible sales,
   favorites when shown) so trends can be drawn. If “record on revisit” is
   enabled, revisiting a tracked item adds another snapshot — never for items
   you didn’t track.
3. **Your settings** (theme, currency, estimation assumptions).

## Where it is stored

- Exclusively in **`chrome.storage.local`** on your device.
- Listing images are not persisted (only page URLs are kept).
- Settings → “Export all data” produces a JSON file with everything stored;
  “Delete all local data” wipes it. Uninstalling the extension removes it too.

## Data the extension never collects

- Passwords, cookies, payment details, private messages, or Etsy account data.
- Browsing history beyond pages you actively analyse or track.
- Anything from non-Etsy sites (content scripts only run on `*.etsy.com`).

## Data sharing

- **None.** No data is transmitted to any server by this extension.
  (Etsy itself still observes your normal browsing of etsy.com, as with any visit.)
- CSV/JSON/backup files are created only when you click export, and stay wherever
  you save them.

## Respecting Etsy

- The extension only reads pages you already opened; it performs no background
  crawling, no automated bulk requests, and doesn’t circumvent rate limits or
  access controls.
- Estimates are computed from visible signals and always labelled “Estimated”
  with confidence levels — never presented as official Etsy data.

## Contact / changes

This is a local-only tool with no data controller relationship: because no data
is collected by anyone, there is nothing to request or delete remotely. If the
extension is ever updated to include optional network features, this policy will
be updated first and the features will be opt-in.
