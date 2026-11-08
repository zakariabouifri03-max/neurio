# Architecture

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  Chrome Extension (MV3)     │        │  Dashboard (Vite SPA)         │
│  ─ popup (React)            │        │  ─ welcome / new try-on      │
│  ─ content script (any page)│        │  ─ history / settings         │
│  ─ service worker           │        └──────────────┬───────────────┘
└───────┬────────────────────┘                   HTTP/JSON
        │ chrome.runtime messaging               ┌────────────────────────┐
        ▼                                       │  Backend (FastAPI)     │
┌─────────────────────────────┐                │  /api/upload           │
│  Product detection          │                │  /api/tryon            │
│  ─ OG/JSON-LD/img heuristics│────────────────▶│  /api/jobs/{id}        │
│  ─ on-page manual picker    │   fetch+upload  │  /api/history CRUD     │
│  ─ cross-origin handling    │                │  /api/files/{uuid}     │
└─────────────────────────────┘                └───────────┬────────────┘
                                                            │
                                              ┌─────────────▼────────────┐
                                              │  AI Engine (provider)    │
                                              │  ─ dev-composite (CPU)   │
                                              │  ─ idmvton (GPU server)  │
                                              └──────────────────────────┘
```

## Extension

**Three bundled surfaces** (`extension/dist/`):

1. `popup.html` + assets — React UI: scan → pick garment → upload photo →
   category → Try On → progress → result → download → history → settings.
2. `content.js` — runs on every page. Detects candidates (OG meta, JSON-LD
   Product, scored `<img>` elements), supports manual on-page picking
   (highlighted badges), drag-and-drop garment capture, and same-origin
   image→dataURL fetching. Built with esbuild as a self-contained IIFE.
3. `background.js` — service worker. Active-tab resolution, message relay
   between popup and content script, content-script injection fallback for
   pages loaded before install.

**Message flow (try-on):**

```
popup → background: {type:"get-candidates"}
background → content: {type:"get-candidates"} (active tab)
content → background → popup: {type:"candidates", candidates:[...]}
popup shows grid → user picks garment
popup → background → content: {type:"fetch-image", url}
   content tries canvas→dataURL (CORS-safe)
   ✓ same-origin → popup sends garment file to backend
   ✗ tainted      → popup sends garment URL; backend fetches server-side
popup POST /api/tryon → poll /api/jobs/{id} → render result
```

**Cross-origin strategy:** never rely on page-fetch alone. The popup first
attempts a canvas dataURL conversion (works for same-origin and
CORS-permitting hosts); on taint it falls back to sending the original URL
to the backend, which fetches it server-side with no CORS restrictions.
Manual garment upload is always available as the last-resort fallback.

## Backend

FastAPI app with a pluggable `TryOnProvider`:

- `POST /api/upload` — validate (type, size, Pillow parse, dimension limits)
  → store under UUID name → return opaque URL.
- `POST /api/tryon` — validate person + garment → create queued job →
  background worker thread runs the provider → status transitions
  `queued → running → succeeded | failed`.
- `GET /api/jobs/{id}` — status + result URL (polled by extension/dashboard).
- `GET /api/history` / `DELETE /api/history/{id}` — metadata list; delete
  removes person, garment and result files.
- `GET /api/files/{uuid}` — serves stored images; UUIDs are random 128-bit,
  not guessable; path-traversal safe (hex-only validation).
- `GET /api/health` — provider availability, GPU flag, queue depth, dev-mode.

Security: optional Bearer API key, configurable CORS allowlist, per-IP
sliding-window rate limiting, per-file size caps, and no secrets in the
extension bundle.

## AI engine

Provider factory (`get_provider()`) reads `AI_PROVIDER` / `AI_ENGINE_URL` /
`AI_ENGINE_API_KEY`. The backend imports the monorepo `anywear_ai` package
directly (with a `sys.path` shim), so no separate install is needed in the
monorepo; `pip install -e ../ai-engine` works for non-monorepo deployments.

See [AI_ENGINE.md](AI_ENGINE.md) for the model evaluation and GPU setup.
