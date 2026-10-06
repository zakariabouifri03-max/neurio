# Installation — Etsy Insight Pro

## Load the extension in Chrome (Developer Mode)

1. Download or clone this repository, so the `extension/` folder is on your computer.
2. Open Chrome and navigate to **`chrome://extensions`**.
3. Turn on **Developer mode** (toggle, top-right corner).
4. Click **Load unpacked** (top-left).
5. Select the **`extension/`** folder (the one containing `manifest.json`) → **Select**.
6. The extension appears in the list as **Etsy Insight Pro**. Click the puzzle-piece
   toolbar icon → pin **Etsy Insight Pro** for one-click access.

No build step, no `npm install`, no backend — the folder runs as-is.

## First run

1. Open any Etsy listing, e.g. search for “ceramic mug” on etsy.com and click a product.
2. A floating **Analyze Product** button appears (bottom-right). Click it — the
   side panel opens with verified data, estimates, and scores.
3. Open a shop page → **Analyze Shop**. Open a search page → **Analyze Results**.
4. Click the toolbar icon for quick actions, or **Open dashboard** for the full app
   (research tables, keywords, tracked history, settings).

On first install the dashboard opens automatically on the Overview tab.

## Updating

1. Pull the latest code (or replace the folder).
2. Go to `chrome://extensions` → find Etsy Insight Pro → click **Reload** (⟳).

Your tracked data and settings persist across reloads (they live in extension storage).

## Uninstalling

`chrome://extensions` → **Remove**. All locally stored extension data is deleted
with it. Export a backup first from Dashboard → Settings if you want to keep it.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No floating button on Etsy | Reload the Etsy page; ensure the URL is `*.etsy.com`; check the extension is enabled |
| Popup says “Could not start analysis” | The tab was open before install — reload it once so the content script attaches |
| Panel shows “—” for many fields | Etsy may have changed its layout or the page hasn’t finished loading — scroll, wait, press ↻ Re-analyse |
| Dashboard is empty | Analyse a search page first (Research/Keywords fill from saved sessions); track items to build history |
| Manifest error on load | Make sure you selected the inner `extension/` folder (containing `manifest.json`), not the repo root |
