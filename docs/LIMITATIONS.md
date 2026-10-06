# Etsy Signal — Known Limitations (by design)

These are honest limits, not bugs. Where Etsy data cannot legitimately be
obtained, the extension says so instead of faking it.

## Data we cannot legitimately obtain

| Data | Status | What we do instead |
|---|---|---|
| Actual sales counts | ❌ Etsy never discloses them | Estimate ranges from review/favorite/velocity signals; always labelled `ESTIMATE` |
| Exact search volume | ❌ No legitimate public source | Demand score from rank, velocity, badges, cohort — never a fake "searches/month" |
| Conversion rate | ❌ Private | Not claimed anywhere |
| Favorites counts | ⚠ Only when Etsy displays them | Used when present, otherwise the component drops out |
| Listing age | ⚠ Only when Etsy shows "Listed on" | Fall back to "tracked since first seen" and label it as such |
| Historical data before install | ❌ We never fabricate it | Velocities/trends start counting from the first real observation |

## Statistical limitations

* The review→sales conversion relies on a **review-propensity prior**
  (median 3%, documented). Where a shop's public totals exist we calibrate to
  real data; otherwise intervals stay wide and confidence stays lower.
* Review counts lag sales by days/weeks; monthly estimates inherit that lag.
* Bestseller-badge floors are conservative assumptions (Etsy's thresholds are
  private) and only raise P10.
* Confidence is capped at 97% on purpose — no estimate is ever "certain".

## Operational limitations

* Etsy changes its markup periodically. The signal engine tries layered
  selector strategies and reports `fields_missing` per card; when a field
  breaks it shows "Insufficient public data" rather than guessing. If many
  fields go missing, the selectors in `signal-engine/src/extract-*.ts` need a
  refresh.
* The extension analyzes pages **the user is already viewing**. It performs no
  background scraping, no bulk crawling, no bypassing of rate limits,
  CAPTCHAs or auth. Respect Etsy's Terms of Service and robots policies.
* Competition scoring needs the listing to be observed **on a search page**;
  opening listings directly (without a SERP context) leaves competition
  unavailable until you see it in search.
* In-memory storage mode (`STORAGE=memory`) loses history on restart — use
  PostgreSQL for real tracking.
* **Local mode** (extension default) stores history in `chrome.storage.local`:
  it is per-browser, per-device, and clears if you uninstall the extension or
  clear extension storage. For durable cross-session history on a server, use
  the self-hosted backend.
* The same estimation code runs in both modes; results are identical for the
  same stored observations.
* Currency: prices are stored as displayed; revenue estimates use the observed
  number without FX conversion.

## What we will never do

Generate random numbers, invent products, fake history, claim official Etsy
data, or scrape behind authentication. "Insufficient evidence" is always a
valid output of this system.
