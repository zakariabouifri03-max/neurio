# Etsy Signal — Installation & Running

## Requirements

* Node.js ≥ 20, npm ≥ 10
* (Production history) PostgreSQL ≥ 13 — optional; a zero-dependency
  in-memory mode exists for trying it out

## 1. Install & build

```bash
npm install          # installs all workspaces
npm run build        # builds shared, engines, backend type-check, and the extension
```

The built unpacked extension lands in **`extension/dist/`**.

## 2. Load the extension in Chrome (Developer Mode)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/dist/` folder.
4. Pin the Etsy Signal icon if you like.

## 3. Backend — optional

By default the extension runs in **local mode**: the estimation engine executes
inside the browser service worker and history persists in
`chrome.storage.local`. No server, no setup, works immediately.

If you want durable / server-side history instead:

Zero-dependency demo (history lost on restart):

```bash
STORAGE=memory npm run start -w backend
# → etsy-signal backend listening on 0.0.0.0:8787 (storage=memory)
```

Production with PostgreSQL:

```bash
createdb etsy_signal
cp backend/.env.example backend/.env   # then edit DATABASE_URL
DATABASE_URL=postgres://localhost/etsy_signal npm run db:init -w backend
DATABASE_URL=postgres://localhost/etsy_signal STORAGE=postgres npm run start -w backend
```

Verify: `curl http://localhost:8787/health` → `{"ok":true,...}`.
Then in the popup → **Settings** → select **Self-hosted backend** and save the
API URL.

## 4. Use it

1. Go to `https://www.etsy.com` and search for something
   (e.g. `https://www.etsy.com/search?q=halloween+shirt`).
2. The **⚡ Etsy Signal** toolbar appears bottom-left and begins analyzing the
   visible listings; a compact panel is added under each product card with
   real data + labelled estimates. Use **Analyze more** to continue down the
   page, and the sort menu to reorder results by any metric.
3. Click **Why?** on any panel for the evidence, model breakdown and
   limitations behind that estimate.
4. Open a listing to get the full multi-section dashboard (Overview, Sales
   Intelligence, Demand, Competition, Opportunity, Evidence + history chart).
5. Click the extension icon for **Tracked / Compare / Settings** (mode and
   backend URL live in Settings).

> Estimates improve the longer you track: revisit searches over days/weeks and
> the extension builds real velocity, trend and confidence from your own
> observations.

## 5. Tests

```bash
npm test       # shared + estimation-engine + signal-engine + backend suites
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | backend port |
| `HOST` | `0.0.0.0` | bind address |
| `STORAGE` | `postgres` if `DATABASE_URL` set, else `memory` | storage backend |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `DATABASE_AUTO_MIGRATE` | `0` | `1` = apply schema at boot |
| `CORS_ORIGINS` | localhost + `chrome-extension://*` + etsy.com | allowed origins |
| `RATE_LIMIT_PER_MINUTE` | `240` | reserved for gateway deployments |

Extension-side configuration (popup → Settings): backend API URL
(stored in `chrome.storage.sync`).
