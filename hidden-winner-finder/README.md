# 🔎 Hidden Winner Finder

A **Manifest V3 Chrome Extension** that behaves like a product researcher: instead of dumping
hundreds of products on you, it finds **ONE** hidden opportunity with strong demand, low competition
and real profit potential — then tells you **why** it is promising, **where to sell it** and **where to
source it**.

```
🔥 FIND MY WINNING PRODUCT  →  1 recommendation, fully explained
📊 SCAN MARKET              →  the ranked shortlist behind that decision
```

No build step, no npm dependencies, no network calls. Everything runs on your machine.

---

## Install (Developer mode)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select the `hidden-winner-finder/` folder
4. Pin the extension, then press **FIND MY WINNING PRODUCT**

Optional but recommended: open the dashboard once (extension icon → **Dashboard** → *Settings* →
**Grant marketplace access**) so page scanning does not re-prompt for permissions.

> Preview the UI without installing: `npm run preview` (or `python3 -m http.server`) and open
> `preview.html`. The same interface runs as a plain page with a simulated page scan.

---

## How to use it

| Step | What you do | What happens |
| --- | --- | --- |
| 1 | Pick **Market / Country / Category / Budget** | These change the fee model, the competition read and which sourcing routes fit your budget |
| 2 | Press **🔥 FIND MY WINNING PRODUCT** | Every candidate niche is scored; **one** winner is returned with its opportunity score, verdict, risks and score deductions |
| 3 | Press **📊 SCAN MARKET** | The ranked table (Product · Demand · Competition · Profit · Trend · Opportunity) behind the decision |
| 4 | Press **🔎 SCAN THIS PAGE** on any marketplace search page | Reads publicly visible listing cards in your tab and upgrades demand/competition/trend from *snapshot* to **observed (High confidence)** |
| 5 | Use **VIEW PRODUCT / FIND SUPPLIERS / SEE COMPETITORS / SAVE PRODUCT** | Opens public search pages for the niche, the sourcing section, competitor pages, or saves it locally |

Trend becomes genuinely *observed* once you scan the same niche twice — the extension compares your own
two scans and reports the measured change instead of a snapshot claim.

---

## What the result looks like

```
🔥 BEST OPPORTUNITY — Personalized Pet Ornament          [Etsy · Medium confidence]

Estimated monthly sales (whole niche)   300 – 500 units      [Public-data based]
Estimated monthly revenue               $4,500 – $7,500      [Estimated]
Average price                           $14.99
Estimated profit margin                 65%

Demand 91/100   Competition 23/100 (Low)   Profit 88/100   Trend 92/100 (🔥 Rising)
⭐ OPPORTUNITY SCORE 95/100
```

Followed by sections that are each independently honest about their evidence:

| Section | Answers |
| --- | --- |
| **Why this product?** | Strong demand · few strong competitors · good average selling price · growing interest · multiple ways to differentiate · suitable for beginners — each with the number behind it |
| **Where to sell it** | Etsy · Amazon · eBay · Walmart Marketplace · TikTok Shop · Shopify — fit, demand, competition, opportunity, estimated fees per unit, one best marketplace |
| **Where to source it** | Alibaba · AliExpress · CJdropshipping · Printful · Printify · local manufacturers · handmade/custom suppliers · digital alternative — estimated cost, shipping, MOQ, selling price, profit, supplier link |
| **Low-competition detector** | Competition score with the documented bands (0–30 Low · 31–60 Medium · 61–80 High · 81–100 Very High) from 8+ independent pressures |
| **Demand detector** | Demand score from review activity, sales labels, favourites, search depth, listing growth, recent activity, trend |
| **Profit calculator** | Selling price · product cost · shipping · marketplace fees · estimated profit · margin · break-even · what-if pricing at three price points |
| **Trend analysis** | 🔥 Rising / ➡️ Stable / 📉 Declining, 30-day and 90-day movement, seasonality position, momentum sparkline |
| **Product ideas** | 5 variations · 5 angles · 5 customer types · 5 title ideas · 10 keywords · suggested entry/target/premium price |
| **Where to find customers** | Etsy Search · Amazon · Pinterest · TikTok · Instagram · Google · YouTube Shorts · Facebook Groups, with a best-channel verdict and a first-week plan |
| **Risks & score adjustments** | IP, saturation, compliance, shipping, returns, thin margin, labour intensity — plus the exact points deducted from the score and why |

---

## Honesty model (read this part)

The spec for this extension says: *never claim sales, demand, views or search volume are exact unless
verified through an authorized data source.* That rule is enforced structurally, not with a footnote.

**Every number carries a basis, and the basis decides its confidence:**

| Basis | Label in the UI | Confidence | Where it comes from |
| --- | --- | --- | --- |
| `observed` | *Observed on page* | **High** | Read from the marketplace page in your own browser by the page scanner |
| `snapshot` | *Public-data based* | **Medium** | The curated per-niche signal snapshot in `src/data/catalog.js` (typical listing counts, review moats, price bands, seasonality) |
| `modelled` | *Estimated / Modelled* | **Low** | Published fee schedules, wholesale cost bands, and the sales-inference model |

Additional guarantees built into the code:

* **Search volume is never claimed anywhere.** Keyword rows explicitly say so
  (`volumeNote: 'Search volume is not claimed…'`).
* **Sales are inferred, never counted.** The model, printed in the UI, is:
  `median reviews ÷ 18-month listing life ÷ 2–8% review rate × 0.55 concentration`,
  and always shown as a range. A separate, lower range is quoted for a brand-new seller.
* **Low-confidence scores are shrunk toward neutral** (`shrinkToNeutral`) so an estimate can never
  outrank observed data by accident.
* **Deductions are itemised.** The opportunity score is the weighted blend minus a printed list of
  point deductions (risks, saturation, thin margin, declining trend) minus the confidence shrink.
* **Supplier costs are always Low confidence** and every row links to a public search page plus a
  "before you pay any supplier" checklist.
* **The page scanner never logs in, never paginates, never bypasses a paywall**, and the extension
  makes **zero network requests** — verified by checking `manifest.json` for host permissions the UI
  depends on (there are none; the optional one exists only for tab scanning).

Confidence tags appear on the winner card, on every metric row, on each marketplace row, in the
Markdown export and in the JSON report.

---

## Architecture

```
hidden-winner-finder/
├── manifest.json                  MV3: storage, scripting, activeTab, contextMenus, optional https host
├── icons/                         16/32/48/128 PNGs (procedurally generated)
├── src/
│   ├── core/                      PURE logic — no DOM, no Chrome APIs, unit-tested in Node
│   │   ├── parse.js               price/count/result-count parsing, statistics, similarity
│   │   ├── metrics.js             scalers, confidence model, shrinkage, weighted fusion, bands
│   │   ├── competition.js         low-competition detector (8+ weighted pressures)
│   │   ├── demand.js              demand detector + the documented sales-inference model
│   │   ├── trend.js               momentum, seasonality, observed-change detection
│   │   ├── profit.js              unit economics, break-even, what-if pricing
│   │   ├── sourcing.js            sourcing routes, MOQ, budget fit
│   │   ├── markets.js             marketplace fit ranking (audience, fees, room, reachability)
│   │   ├── channels.js            customer-channel ranking + first-week plans
│   │   ├── risk.js                risk taxonomy, penalties, beginner suitability
│   │   ├── ideas.js               variations/angles/titles/keywords/price range
│   │   ├── opportunity.js         the fusion layer: scores → adjustments → verdict → "why"
│   │   ├── engine.js              candidate selection (FIND ONE vs SCAN ALL)
│   │   ├── observe.js             DOM-free derivation of observed signals from a raw page scan
│   │   ├── report.js              storable report + Markdown/JSON export
│   │   ├── format-report.js       the Markdown serialiser
│   │   ├── format.js              currency/percent/estimate labelling helpers
│   │   ├── options.js             validation + fallbacks for the UI selections
│   │   └── storage.js             the only persistence module (chrome.storage → localStorage → memory)
│   ├── data/                      curated public-data layer
│   │   ├── catalog.js             20 niche archetypes with signals, trends, ideas
│   │   ├── marketplaces.js        fee schedules + URL builders + fee estimator
│   │   ├── suppliers.js           sourcing families, platforms, MOQ + diligence checklist
│   │   └── taxonomy.js            categories, countries, budgets, data-source registry
│   ├── background/service-worker.js   message contract, injection, history, badge, context menu
│   ├── content/
│   │   ├── scanner.src.js         page reader SOURCE (adapters for Etsy/Amazon/eBay/Walmart/TikTok + generic)
│   │   └── scanner.js             GENERATED by tools/build-scanner.mjs (inlines the shared parsers)
│   └── ui/
│       ├── popup.html             the 400px popup
│       ├── dashboard.html         the full research dashboard (also the options page)
│       ├── app.js                 state machine, events, views
│       ├── render.js              pure render functions (state → HTML string)
│       ├── platform.js            extension host vs standalone-page host
│       └── styles.css             the design system
├── tools/                         build, preview and validation scripts (no runtime dependencies)
│   ├── lib/scanner-build.mjs      the single scanner-build implementation (shared by build + validate)
│   └── validate.mjs               extension pre-flight: manifest, import graph, HTML refs, drift, remote code
└── tests/                         46 Node tests over the engine, observation layer and storage
```

**Separation of concerns that matters:** `src/core` never imports from `src/ui`, and the only module
that touches a browser API in the UI is `platform.js`. That is what makes the analysis testable in
Node and the whole dashboard runnable as a plain web page.

---

## Commands

```bash
npm test                # 46 tests: engine, observation layer, storage, bands, error handling
npm run build:scanner   # regenerate src/content/scanner.js (self-checks the inlined parsers)
npm run build:icons     # regenerate the icon set
npm run build:preview   # regenerate preview.html
npm run preview         # static server on :8080 → preview.html
npm run validate        # manifest + module graph + generated-file pre-flight (no Chrome needed)
npm run verify          # build → validate → test
```

No dependencies are required for the extension itself; the scripts only use the Node standard library.

---

## Permissions & privacy

| Permission | Why it is needed | When it is used |
| --- | --- | --- |
| `storage` | Save options, reports, saved products and observed signals locally | Constantly (local only) |
| `scripting` + `activeTab` | Inject the page scanner into the tab you are looking at | Only when you press **SCAN THIS PAGE** / the shortcut |
| `optional_host_permissions: https://*/*` | Remember marketplace access so scanning does not re-prompt | Only if you press **Grant marketplace access** |
| `contextMenus` | Right-click → "Scan this page for hidden winners" | On demand |
| `commands` (`Alt+Shift+S`) | Keyboard shortcut for the same scan | On demand |

There is **no `host_permissions` entry**, no remote endpoint, no analytics, no background fetching.
The page scanner reads the DOM of the page already open in your browser and returns plain numbers to
the extension. Clear everything at any time with **Settings → Forget scanned pages / Delete everything**.

---

## Extending it

* **Add a niche** — append an object to `CATALOG` in `src/data/catalog.js` (price band, cost band,
  family, signals, trend, risks, ideas). The test suite validates every entry.
* **Add a marketplace** — append to `MARKETPLACES` in `src/data/marketplaces.js` with its published
  fee rates and a `searchUrl` builder. It immediately appears in the fit ranking, the fee model and the
  sourcing table.
* **Add a page adapter** — extend `adapters` in `src/content/scanner.src.js`, then run
  `npm run build:scanner`.
* **Re-tune the scoring** — weights live in `OPPORTUNITY_WEIGHTS` (`src/core/opportunity.js`); the
  documented competition bands live in `scoreBand()` (`src/core/metrics.js`).

---

## Known limitations

* Sales, demand and profit are **estimates**. Only an authorized data source (or your own sales data)
  can confirm them — this extension is designed to narrow 20 candidates down to 1 before you spend money.
* Marketplace HTML changes; the generic adapter degrades gracefully and tells you when it could not read
  a page, but a redesign may need a selector update in `scanner.src.js`.
* The catalog is a curated snapshot (`CATALOG_VERSION`), not a live feed. Running **SCAN THIS PAGE**
  on a real search page is what makes a niche's numbers observed and High-confidence.
* Fee schedules and MOQs change; each one links to the official public page so you can verify before pricing.

## License

MIT
