# Test instructions — Etsy Insight Pro

## A. Automated tests (no browser needed)

```bash
cd extension
node test/run-tests.mjs
```

This runs three suites and exits non-zero on any failure:

1. **Manifest validation** — JSON parses, `manifest_version: 3`, required keys
   present, every referenced file (worker, popup, content scripts, icons) exists,
   content scripts match `*.etsy.com` only, no remote script URLs.
2. **Syntax** — `node --check` on every shipped `.js` file (lib, content,
   extractors, background, popup, dashboard, views).
3. **Unit tests** — pure modules loaded directly:
   - `utils`: count/price/rating parsing (incl. `1.2k`, `€12,99`), ranges, escaping
   - `settings`: sanitizer clamps/rejects bad values
   - `estimation`: range ordering (`low ≤ mid ≤ high`), High confidence on rich
     evidence, Low on empty signals, revenue = sales × price, views > orders,
     zero-reviews → zero-sales, disclaimers present
   - `scores`: all four in 0–100 with formulas, opportunity = 45/25/30 blend
   - `keywords`: extraction + opportunity per row, suggestions, no fake volume field
   - `exporter`: CSV quoting/headers, JSON shape
   - `tracking`: deltas, trends, 30-day velocity
   - `storage`: settings round-trip, observation record, backup shape (memory fallback)

## B. Manual checks on live Etsy pages

Etsy’s markup changes over time, so verify against the real site:

**Product page** (`etsy.com/listing/…`)
- [ ] Floating **Analyze Product** button appears; panel opens in place.
- [ ] Verified card shows title, price, reviews, rating, shop; estimates show
      ranges with **Estimated** + confidence pills and “How was this estimated?”.
- [ ] Scores render 0–100 with formulas on hover; Track button saves; Export works.
- [ ] Reload page → tracked item auto-snapshots (visible in dashboard history).

**Shop page** (`etsy.com/shop/…`)
- [ ] **Analyze Shop** → verified sales/listings/reviews/rating, estimated
      revenue, sortable listing table (click every column header), top picks.

**Search page** (`etsy.com/search?q=…`)
- [ ] **Analyze Results** → research table + keyword suggestions; CSV/JSON export
      downloads; session appears in Dashboard → Research/Keywords.

**Popup & dashboard**
- [ ] Toolbar popup shows Product/Shop/Search badge and quick actions.
- [ ] Dashboard tabs all load; theme toggle cycles auto/light/dark; Settings save;
      Export/Delete local data work; Privacy tab renders.

**Robustness**
- [ ] Non-entity Etsy pages (cart, homepage) show no button and no console errors.
- [ ] With network throttled / partially loaded page: panel degrades to “—”,
      never fabricated values, no uncaught exceptions.
- [ ] `chrome://extensions` → service worker → no errors; context menu
      “Analyze with Etsy Insight Pro” appears on Etsy pages.

## C. Sample data

`sample-data/*.json` contains mock extractor output (clearly labelled, not real
Etsy data) for driving UI logic during development — e.g. feed
`sample-search.json` items through `EIP.keywords.analyzeKeywords` in a scratch
script to preview the keyword lab without opening Etsy.
