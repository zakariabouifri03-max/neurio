# 🔎 Hidden Winner Finder — Google Chrome Extension (Manifest V3)

**Hidden Winner Finder** is a professional AI-driven e-commerce product research Chrome Extension. Unlike traditional spy tools that return thousands of saturated bestsellers, its sole purpose is to isolate **one undisputed winning product opportunity** that combines:

* **High Demand** ↑
* **Strong Sales Potential** ↑
* **Low Competition** ↓
* **Good Profit Margin** ↑
* **Room for a New Seller to Enter**

---

## ⚡ Core Features

### 1. `[ FIND MY WINNING PRODUCT ]`
One click analyzes available marketplace data across search density, review barriers, seller monopolization, and profit margins, returning **ONLY the #1 best opportunity**:
* **Product:** "Personalized Halloween Pet Ornament"
* **Demand Score:** `94/100` (High)
* **Competition:** `Low (21/100)`
* **Estimated Monthly Sales:** `300–500 units`
* **Estimated Monthly Revenue:** `$4,500–$7,500`
* **Average Price:** `$14.99`
* **Estimated Profit Margin:** `65%`
* **Trend:** `🔥 Rising`
* **Opportunity Score:** `95/100`

### 2. 💡 "WHY THIS PRODUCT?"
Beginner-friendly breakdown of why this product won:
* Strong customer buying velocity (active "in cart" signals)
* Few strong competitors (top review median is under 30)
* Healthy selling price and gross margin
* Surging seasonal and holiday search interest
* Low return rates and non-breakable fulfillment

### 3. 🏬 "FIND WHERE TO SELL IT"
Cross-platform opportunity evaluation:
* **Best Marketplace:** Etsy (`Opportunity: Excellent`, `Demand: High`, `Competition: Low`)
* Compares Etsy, Amazon, eBay, Walmart Marketplace, TikTok Shop, and Shopify stores with platform fee schedules and pros/cons.

### 4. 📦 "FIND WHERE TO SOURCE IT" (SOURCE IT)
Instant matching to 8 sourcing channels with estimated costs, shipping, MOQs, profit margins, and direct search links:
1. **Alibaba** (Wholesale / Private Label)
2. **AliExpress** (Zero MOQ / Dropshipping test)
3. **CJdropshipping** (Warehoused API dropshipping)
4. **Printful** (Premium on-demand printing)
5. **Printify** (Competitive print-on-demand network)
6. **Local Manufacturers** (Domestic US/UK fabricators)
7. **Handmade / Custom Suppliers** (Unfinished blanks)
8. **Digital-Product Alternatives** (Templates & downloads with 90%+ margins)

### 5. 🛡️ LOW-COMPETITION DETECTOR
Evaluates 8 observable marketplace signals:
* Number of competing listings
* Number of strong competitors (>100 reviews)
* Median review count of top listings
* Listing quality deficit (unoptimized competitor listings)
* Established seller dominance ratio
* Search result density and ad load
* Price competition / price war risk
* Product similarity

**Scoring Scale:**
* `0–30`: **Low Competition** (Prime Sweet Spot)
* `31–60`: **Medium Competition**
* `61–80`: **High Competition**
* `81–100`: **Very High Competition**

### 6. 📈 DEMAND DETECTOR
Calculates demand scores (0–100) using:
* Sales volume signals
* Review accumulation velocity
* Public favorites and "in cart" urgency indicators
* Search presence and impression breadth
* Listing growth rate

### 7. 📊 PRODUCT DISCOVERY (`[ SCAN MARKET ]`)
Scans any niche or category and produces a ranked leaderboard of opportunities (`#1`, `#2`, `#3`...). Clicking any item opens its complete dossier.

### 8. 🧮 INTERACTIVE PROFIT CALCULATOR
Real-time calculator accounting for:
* Selling Price
* Product Cost (COGS)
* Packaging & Shipping
* Marketplace Fees (Etsy 6.5%+3%+$0.45, Amazon 15%, eBay 13.25%, TikTok Shop 6%, Shopify)
* Net Profit, Margin %, and Return on Investment (ROI)

### 9. 🔥 TREND ANALYSIS
* Trajectory: `🔥 Rising`, `➡️ Stable`, `📉 Declining`
* 30-Day and 90-Day growth tracking (`+28%`, `+74%`)
* Sparkline historical momentum

### 10. 🎨 PRODUCT IDEAS & DIFFERENTIATION
* 5 Product Variations (e.g. Dog breed, Cat edition, Memorial, Festive)
* 5 Unique Angles & Value Propositions
* 5 Target Customer Avatars
* 5 SEO Title Ideas (with one-click copy)
* 10 Keyword Ideas (with search volume & intent tags)
* Suggested Price Range & Sweet Spot

### 11. 📣 WHERE TO FIND CUSTOMERS
Evaluates 7 acquisition channels (Etsy Search, Pinterest, TikTok, Instagram, Google, YouTube Shorts, Facebook Groups) and highlights the **#1 primary traffic source** with marketing strategies.

### 12. 💾 SAVED WINNERS & LOCAL STORAGE
Persists saved winning products locally using `chrome.storage.local` with quick JSON export.

---

## 🚀 How to Install & Load in Google Chrome

1. Clone or download this repository.
2. In Google Chrome, go to `chrome://extensions` in the address bar.
3. Turn on the **"Developer mode"** toggle (top-right corner).
4. Click the **"Load unpacked"** button (top-left corner).
5. Select the `extension` folder inside this repository:
   ```
   /home/user/neurio/extension
   ```
6. The **Hidden Winner Finder** icon will appear in your Chrome toolbar!

---

## 📁 Project Architecture

```
extension/
├── manifest.json              # Chrome Manifest V3 configuration
├── background.js              # Service worker (context menus, side panel, messages)
├── content.js                 # In-page marketplace scraper & floating widget
├── content.css                # Styling for floating in-page badge
├── popup.html                 # Main extension popup interface
├── popup.css                  # Modern dark glassmorphism styling
├── popup.js                   # Popup UI controller & state management
├── sidepanel.html             # Chrome Side Panel interface
├── sidepanel.css              # Side panel responsive styles
├── icons/                     # Extension icons (16px, 32px, 48px, 128px)
├── engine/
│   ├── storage_adapter.js     # Unified Chrome storage & localStorage wrapper
│   ├── competition.js         # Low-Competition Detector (0–100 score)
│   ├── demand.js              # Demand Detector (0–100 score & revenue)
│   ├── profit.js              # Multi-marketplace fee & profit calculator
│   ├── trend.js               # Trend analysis & momentum tracker
│   ├── sourcing.js            # 8-channel supplier discovery engine
│   ├── marketplaces.js        # Cross-marketplace comparison engine
│   ├── ideas.js               # Product ideas, angles & keyword generator
│   ├── channels.js            # Customer acquisition traffic analyzer
│   └── scanner.js             # Discovery ranking & #1 winner isolation
└── data/
    └── curated_database.js    # Curated opportunity catalog & on-the-fly analyzer
```

---

## 🧪 Testing the Extension

Run the verification test suite:
```bash
node -e '
const StorageAdapter = require("./extension/engine/storage_adapter.js");
const CompetitionDetector = require("./extension/engine/competition.js");
const DemandDetector = require("./extension/engine/demand.js");
const ProfitCalculator = require("./extension/engine/profit.js");
const TrendAnalyzer = require("./extension/engine/trend.js");
const SourcingEngine = require("./extension/engine/sourcing.js");
const MarketplaceAnalyzer = require("./extension/engine/marketplaces.js");
const ProductIdeasGenerator = require("./extension/engine/ideas.js");
const CustomerChannelsEngine = require("./extension/engine/channels.js");
global.CompetitionDetector = CompetitionDetector;
global.DemandDetector = DemandDetector;
global.ProfitCalculator = ProfitCalculator;
global.TrendAnalyzer = TrendAnalyzer;
global.SourcingEngine = SourcingEngine;
global.MarketplaceAnalyzer = MarketplaceAnalyzer;
global.ProductIdeasGenerator = ProductIdeasGenerator;
global.CustomerChannelsEngine = CustomerChannelsEngine;
const CuratedDatabase = require("./extension/data/curated_database.js");
global.CuratedDatabase = CuratedDatabase;
const MarketScanner = require("./extension/engine/scanner.js");
console.log(MarketScanner.findWinningProduct({ marketplace: "etsy" }));
'
```

To run the live interactive browser preview server:
```bash
node server.js
```
Open `http://localhost:3000` to interact with the Extension Popup Simulator, Side Panel Split-View, and Live In-Page Scanner.
