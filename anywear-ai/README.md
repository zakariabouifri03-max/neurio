# Anywear AI — Universal Virtual Try-On Chrome Extension

Try any clothing from any online store on your own photo. Inspired by
[Anywear by Decart](https://anywear.decart.ai/): point the extension at a
product page, pick the garment, upload your photo, and get an AI-generated
try-on — on Zara, H&M, ASOS, Amazon, Shein, or literally any ecommerce site.

```
┌──────────────────────────────────────────────────────────────┐
│  1. Shop online          2. Click the extension icon           │
│  3. Garment auto-detected 4. Upload your photo                 │
│  5. Try On  →  AI result  6. Download or save to history      │
└──────────────────────────────────────────────────────────────┘
```

## Monorepo layout

```
anywear-ai/
├── extension/         Chrome MV3 extension (React + TS + Tailwind)
├── backend/           FastAPI backend (uploads, jobs, history, files)
├── ai-engine/         Modular AI try-on provider system (IDM-VTON / dev composite)
├── dashboard/         Full-page web dashboard (React + Vite + Tailwind)
└── docs/              Architecture, AI model guide, testing guide
```

## What's real (and what isn't)

- **Real Chrome extension** — MV3, content scripts, service worker, message
  passing, product-image detection on any page, manual on-page picker,
  drag-and-drop garment capture, cross-origin handling with graceful fallback.
- **Real backend** — file validation, secure UUID-named storage, job queue,
  polling status, history CRUD, rate limiting, API-key auth, CORS control.
- **Real AI pipeline** — a provider interface with two implementations:
  - `dev-composite` (default): genuine CPU image processing (garment cutout,
    feathering, category-aware placement, alpha composite). Always labeled
    **DEV MODE** — no neural net, no fake result.
  - `idmvton`: production provider for a self-hosted IDM-VTON GPU inference
    server. Swap in with one env var; no code changes.
- **No hardcoded stores.** Detection uses generic signals (OG/JSON-LD/img
  heuristics), so it works on any product page.

## Quick start

### 1. Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # optional — defaults work out of the box
uvicorn app.main:app --reload --port 8000
```

Health check: `curl http://localhost:8000/api/health` →
`{"status":"ok","provider":"dev-composite","dev_mode":true,...}`

### 2. Extension

```bash
cd extension
npm install
npm run build                 # → dist/
```

Then in Chrome:
1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. **Load unpacked** → select `extension/dist/`
4. Pin the Anywear AI icon
5. Open any product page, click the icon, hit **Scan page**

Development with hot reload: `npm run dev` (builds to `dist/` via
`vite build`; the esbuild step for content/background scripts runs on each build).

### 3. Dashboard

```bash
cd dashboard
npm install
npm run dev                   # http://localhost:5173
```

Welcome page, new try-on, results gallery, history, settings — the dashboard
talks to the backend at `http://localhost:8000` (change in Settings).

## API

| Method | Endpoint              | Purpose                                  |
|--------|-----------------------|------------------------------------------|
| POST   | `/api/upload`         | Validate + store an image (person/garment) |
| POST   | `/api/tryon`          | Enqueue a try-on job (person + garment + category) |
| GET    | `/api/jobs/{id}`      | Job status + result URL                  |
| GET    | `/api/history`        | Recent generations (metadata)            |
| DELETE | `/api/history/{id}`   | Delete a generation + its files          |
| GET    | `/api/files/{id}`     | Serve stored images (opaque UUID names)  |
| GET    | `/api/health`         | Provider/queue health                    |

Interactive docs: `http://localhost:8000/docs` (Swagger UI).

## Connecting a real neural try-on model

Default `AI_PROVIDER=dev-composite` runs without a GPU. For production-quality
results, deploy IDM-VTON (see [docs/AI_ENGINE.md](docs/AI_ENGINE.md) for the
model evaluation) and set:

```bash
AI_PROVIDER=idmvton
AI_ENGINE_URL=http://localhost:8001   # your inference server
AI_ENGINE_API_KEY=...                 # optional
```

The backend then routes generations to the GPU server. Everything else
(extension, dashboard, jobs, history) stays identical.

## Security & privacy

- API key auth via `Authorization: Bearer` (optional, off by default in dev)
- CORS allowlist via `CORS_ORIGINS`
- File type/size validation (JPEG/PNG/WEBP, per-file MB limits)
- Uploads/results stored under opaque UUID filenames — not guessable
- Deleting history deletes the stored files
- Extension never embeds secrets; API key lives in extension storage only
- No third-party data collection; everything runs on your backend

## Testing

```bash
# backend (8 tests: upload validation, try-on e2e, history CRUD, errors)
cd backend && .venv/bin/python -m pytest tests/ -q

# AI engine (16 tests: categories, composite pipeline, background removal, factory)
cd ai-engine && python -m pytest tests/ -q

# extension detection heuristics (12 tests)
cd extension && npx vitest run
```

See [docs/TESTING.md](docs/TESTING.md) for the full checklist.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design & data flow
- [docs/AI_ENGINE.md](docs/AI_ENGINE.md) — model evaluation (IDM-VTON / CatVTON / StableVITON), GPU deployment
- [docs/TESTING.md](docs/TESTING.md) — test plan & manual verification steps

## License

MIT. The bundled IDM-VTON deployment instructions reference the respective
upstream model licenses — verify before commercial use.
