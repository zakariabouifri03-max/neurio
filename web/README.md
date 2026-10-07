# Prism Studio

An all-in-one visual design platform: a real editor for social graphics, presentations, documents, video and print — with layers, smart guides, brand kits, an AI assistant that edits the canvas, a timeline video editor, collaboration and high-resolution export.

This is not a mock-up. Every panel, dialog and button in the product is wired to real state, real persistence and real rendering.

```bash
npm install
npm run db:migrate     # creates dev.db from db/schema.sql
npm run db:seed        # optional: warms the template + element catalogue (356 templates, 205 elements)
npm run dev            # http://localhost:3000
```

Sign in with an existing account or create one — the first account matching `SEED_ADMIN_EMAIL` (`.env`: `demo@prism.studio`) is promoted to administrator.

---

## 1. What is implemented

### Editor
- **Infinite canvas** with pan (space/middle drag/hand tool), zoom (ctrl+wheel, pinch, keyboard), rulers, grid, margins and fit-to-screen.
- **Layers**: nested groups and frames with clipping, lock/hide, drag-reorder, multi-select (shift/marquee), alignment, distribution, z-order, duplicate, rename inline.
- **Transform**: rotation-aware resize with 8 handles, shift for aspect lock, rotation snapping (15°), numeric position/size, flip.
- **Smart guides**: edge/centre/spacing snapping against other objects, page bounds and margins.
- **Styling**: solid/gradient/image fills, strokes (solid/dashed/dotted), corner radius, shadows, blur, blend modes, opacity, masks and frames.
- **Typography**: 250+ Google families + uploaded fonts, gradient text, outline, glow, shadow, highlight, underline/strike, tracking, line-height, vertical alignment, curved text on a path, typography systems and font pairings.
- **Nodes**: rectangle, ellipse, line, arrow, polygon, star, path, SVG, sticker, image, video, chart (10 kinds), table, text, frame, group.
- **Inline text editing** on double-click, with full history.
- **Undo/redo** with a real history stack (coalesced drags), plus server-side **version history** with restore.

### Image editing (local, in-browser)
Crop (manual + saliency-based smart crop), background removal (flood fill + edge matting), 2×/3×/4× upscaling (bicubic + unsharp), auto-enhance (histogram stretch), 22 filters, posterize, and full adjustments (brightness, contrast, saturation, temperature, hue, gamma, vignette). Everything runs in a **web worker** with a main-thread fallback — images never leave the browser.

### Video
A real timeline: tracks, clips, trim, split at playhead, speed, reverse, volume, fade in/out, transitions, keyframes, subtitles, live scrubbing and playback. Export renders the composition frame-by-frame and encodes it in the browser (WebM/MP4 depending on browser support) with WebAudio-mixed soundtracks.

### Presentations
Slide-based pages with per-node entrance animation presets (16, plus none), slide transitions, speaker notes, slide grid navigator and a fullscreen **present mode** with a timer and keyboard/laser-free control.

### Documents & print
Multi-page documents with A4/A3/Letter presets, margins, bleed, tables, headers/footers via page frames, and PDF export at up to 300 dpi.

### AI (works offline, upgradeable)
- **Assistant commands** that genuinely edit the document: recolor, apply brand kit, typography systems, layout cleanup, smart resize, variations, suggestions — every action is one undo step.
- **AI image generation**: procedural art engine by default; OpenAI/Stability/Replicate/FAL when a key is configured.
- **AI writing**: captions, headlines, rewrites, hashtags, product copy through a local model, or an LLM provider when configured.
- Provider keys are read **server-side only** and are never exposed to the browser. `/api/ai/status` reports exactly what is configured.

### Export
PNG (transparent, up to 4×), JPG, WebP, SVG (true vector with embedded images), PDF (multi-page, print quality), ZIP of per-page images, GIF, and video. All rendered from the same scene model with the same style helpers as the editor, so output matches the screen.

### Account, storage and collaboration
- Email + password auth (scrypt), sessions, password reset, optional Google sign-in.
- Projects with folders, favourites, trash, duplicates, search, grid/list views and sorting.
- Media library with uploads (progress), kind filters, favourites and reuse across designs; pluggable storage drivers (local disk or S3-compatible via SigV4).
- Brand kits: colours, fonts, logos, guidelines — applied in one click and used by the assistant.
- Sharing: view/edit roles, link access, per-email invites, threaded comments with resolve, activity feed and an op log with SSE/long-poll for live collaboration.
- Admin panel: platform metrics, users, catalogue health and AI provider status.
- Subscriptions: plan limits enforced server-side through the subscription layer; no payment provider is hardcoded.

### Platform
- English + Arabic with full RTL mirroring.
- Dark and light themes from one token set.
- Keyboard-first editor (Figma/Illustrator-style map plus Canva-style additions) with an in-app shortcut reference.
- Virtualised galleries, worker-based image processing, lazy-loaded catalogue, debounced autosave with visibility/unload flush.
- Accessibility: focus rings, ARIA labels on canvas nodes, contrast checking in the colour picker, keyboard operation.

---

## 2. Architecture

```
web/
├─ db/schema.sql              Canonical schema (SQLite now, Postgres path documented)
├─ scripts/migrate.mjs        Idempotent schema application
├─ scripts/seed.ts            Catalogue seed (uses the same code as the app)
└─ src/
   ├─ engine/                 Framework-agnostic core (no React, no Next)
   │  ├─ types.ts             Document model — the single source of truth
   │  ├─ geometry.ts          Matrices, hit-testing, snapping, resize maths
   │  ├─ scene.ts             Tree operations, grouping, alignment, reordering
   │  ├─ factory.ts           Node constructors
   │  ├─ color.ts             Colour conversion, harmonies, palettes, contrast
   │  ├─ history.ts           Undo/redo stack with coalescing
   │  ├─ resize.ts            Smart resize (scale + row reflow)
   │  ├─ apply-command.ts     Assistant commands → document edits
   │  ├─ assistant.ts         Natural-language → structured command (EN + AR)
   │  ├─ ai-art.ts            Procedural artwork generator
   │  ├─ image/process.ts     Pixel pipelines (pure functions)
   │  ├─ render/
   │  │  ├─ paint.ts          Shared style helpers (DOM + Canvas2D)
   │  │  ├─ canvas2d.ts       Export/thumbnail renderer
   │  │  ├─ svg.ts            Vector serializer
   │  │  └─ chart.ts          Chart geometry → SVG
   │  └─ export/index.ts      PNG/JPG/WebP/SVG/PDF/ZIP/GIF/video writers
   ├─ components/
   │  ├─ editor/              Canvas, panels, inspector, timeline, dialogs
   │  ├─ app/                 Dashboard shell and project management
   │  ├─ marketing/           Landing page
   │  ├─ template/            Live template renderer
   │  └─ ui/                  Design-system primitives
   ├─ store/editor.ts         Zustand store (single source of editor truth)
   ├─ lib/                    db, auth, repo (SQL), storage, ai providers, rbac, api
   ├─ hooks/                  useAutosave, useShortcuts
   ├─ i18n/                   Dictionary + provider (EN/AR, RTL)
   ├─ data/                   Templates, elements, fonts, sizes, content, icons
   └─ app/                    Next.js App Router (pages + API routes)
```

**Rules the codebase follows**

1. One renderer contract: every visual property has a helper in `engine/render/paint.ts`, consumed by both the DOM editor and the Canvas2D/SVG exporters. Screen and output cannot drift.
2. Every mutation goes through `commitPages()` in `store/editor.ts`, which pushes a history entry and marks the document dirty. Nothing mutates state silently.
3. The database is the only source of truth for persistence; `src/lib/repo.ts` is the only module that writes SQL.
4. Secrets stay server-side. The browser talks to `/api/*` only.
5. No fake controls: if a feature needs configuration (payments, email, an AI key, S3), the UI says so and the code path degrades to a working local implementation.

---

## 3. Data model

Documents are plain JSON so they round-trip through Postgres/SQLite, the op log and future native clients without migration. See `src/engine/types.ts` for every field: nodes, paints, gradients, text styles, animations, keyframes, timeline tracks/clips, pages and document settings.

Tables (29): `users`, `sessions`, `verification_tokens`, `projects`, `pages`, `versions`, `collab_ops`, `assets`, `media_folders`, `folders`, `shares`, `comments`, `activity`, `brand_kits`, `templates`, `elements`, `favorites`, `teams`, `team_members`, `subscriptions`, `usage`, `reports`, FTS5-backed `search_index*`, `schema_meta`.

---

## 4. Configuration

Copy `.env.example` → `.env.local` and adjust. Everything is optional; defaults work offline.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` / `DATABASE_FILE` | SQLite file (default `dev.db`). `db/schema.sql` documents the Postgres migration path. |
| `AUTH_SECRET` | Session signing secret. **Change for production.** |
| `STORAGE_DRIVER` | `local` (default) or `s3`. S3 uses hand-rolled SigV4 — no SDK. |
| `S3_*` | Bucket, region, keys, endpoint (R2/MinIO compatible). |
| `AI_PROVIDER`, `AI_IMAGE_PROVIDER` | `auto` (default) or a specific provider. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`, `REPLICATE_API_TOKEN`, `STABILITY_API_KEY`, `FAL_API_KEY` | Optional quality upgrades for AI. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Google sign-in. |
| `SMTP_URL` | Optional password-reset delivery (links are logged when unset). |
| `SEED_ADMIN_EMAIL` | Account promoted to administrator. |

Degradation is explicit: with no AI key the studio uses its local model and procedural art engine; with no S3 credentials uploads go to `./storage`; with no SMTP, reset links are printed to the server log and shown in the UI during development.

---

## 5. Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Dev server on `0.0.0.0:3000` |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | `tsc --noEmit` (clean) |
| `npm run db:migrate` | Apply `db/schema.sql` (idempotent) |
| `npm run db:seed` | Seed templates + elements |
| `npm run gen:assets` | Regenerate `src/data/icons.json` from `lucide-static` |

---

## 6. Keyboard shortcuts

Press `?` in the editor (or open the menu → Keyboard shortcuts) for the full list. Highlights: `V/H/T/C` tools, `Ctrl/⌘+Z`/`Shift+Z`, `Ctrl/⌘+G`/`Shift+G`, `Ctrl/⌘+D`, `Ctrl/⌘+C/V/X`, arrows to nudge (`Shift` = 10 px), `Ctrl/⌘+A`, `Delete`, `Ctrl/⌘+S` (save + snapshot), `Ctrl/⌘+E` (export), `Ctrl/⌘+0` fit, `Ctrl/⌘+±` zoom, `Ctrl/⌘+Enter` present.

---

## 7. Known limitations

- **Video container**: encoding uses the browser's MediaRecorder, so the container is WebM (VP9/Opus) unless the browser supports MP4 (recent Chrome/Safari). Resolution up to 4K is supported; the bitrate presets control quality. Server-side ffmpeg is not used.
- **Fonts**: webfonts are fetched from Google Fonts by the browser at runtime, so a fully offline deployment should self-host the families it needs.
- **Payments**: the subscription layer stores plans, limits and usage, but no provider is integrated — wire one behind `src/lib/` (see `subscriptions` table) and the UI will reflect it.
- **Collaboration transport**: presence, comments and an op log are implemented; CRDT-level concurrent text merging is not. Concurrent edits resolve last-writer-wins per op.
