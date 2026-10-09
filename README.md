# Neurio · Your creator companion

A responsive, installable Instagram **planning prototype** with an English / Moroccan Darija interface. Built with plain JavaScript, local assets, and no runtime CDN dependencies.

> **Important:** this version does not connect to Instagram or an AI provider. Dashboard metrics and sample reel scores are explicitly illustrative. The coach is rule-based, writing tools use local templates, and personal video reviews use a transparent self-assessment checklist. It never promises follower growth.

## Android APK

A native offline wrapper is available in `android/`. It supports Android 8.0+ with an updated System WebView, native video selection, JSON export, and clipboard access. The CI workflow builds a development-signed preview APK; it does not add live Instagram or AI integration. See [`android/README.md`](android/README.md) for build and signing limitations.

## Run locally

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. The server binds to `0.0.0.0` and accepts the live preview host. There are no browser-facing localhost API calls. No build step is required; you can also run:

```bash
python3 -m http.server 3000 --bind 0.0.0.0
```

For deployment, serve the repository on an HTTPS static host. Relative asset paths support subdirectory hosting. Production hosting should publish only `index.html`, `src/neurio.js`, `src/neurio.css`, `assets/`, Neurio's icons, the manifest, and `sw.js`—not the test tooling or legacy game.

## Working features

- **Overview:** illustrative growth chart with two periods, sample metrics, personal daily tasks, recent content, and a goal roadmap.
- **Content library:** searchable/filterable sample reels and user drafts, private local video preview (MP4 / WebM / MOV, up to 100 MB), manually entered metrics, and a five-criterion review worth 20 points per criterion. Video playback depends on browser codec support.
- **Content planner:** date-aware weekly view, custom dates, adding/deleting tasks, task completion, and persisted plans. Times are manually chosen local wall-clock times. Nothing is automatically published.
- **Growth goals:** create/edit/delete goals, update numeric progress, automatically mark a target achieved when progress reaches it, and manually mark milestones complete. The 100K, 1M, and 10M milestones are editable ambitions, not predictions.
- **Guided coach:** local topic-based advice about posting frequency, stories, hooks, and goals; persisted chat history; English and Darija responses.
- **Six creator tools:** editable caption, hook, story, bio, hashtag, and research-plan templates. These do not browse Instagram or verify trends/accounts.
- **Profile checklist:** practical manual guidance on a recognizable picture, a clear name, a useful bio, and highlights. No visual profile-picture analysis is performed.
- **Settings:** edit local profile details, export a JSON backup, install instructions, and a confirmed workspace reset. Export is one-way; an import UI is not implemented.
- **Mobile / accessibility:** responsive layouts down to 320px, mobile bottom navigation, RTL support, local Arabic fonts, keyboard-focusable controls, dialog focus trapping and restoration, reduced-motion support, and live status messages.
- **PWA:** installable web manifest and local icons; offline application shell after one successful visit. Settings → Install Neurio provides platform-specific instructions. The browser version is a PWA; an optional Android preview wrapper is documented in [`android/README.md`](android/README.md).

## Data and privacy

Workspace state is stored under `neurio-workspace-v1` in browser `localStorage`. It includes profile details, draft metadata, manual ratings, goals, task status, and coach messages. It does not sync between devices and is not encrypted. Clearing site data removes it, so use JSON export to keep a copy.

Uploaded videos are previewed using revocable local object URLs. They are never transmitted, cached, or persisted. Returning to a saved draft restores its title/metrics/review, **not its video**. The workspace never requests an Instagram password or an access token.

The demo account name is customizable but editing it does not authenticate, fetch metrics, or alter the fixed sample analytics. Sample imagery was AI-generated for the interface; it does not represent imported Instagram content. Fonts are self-hosted and their licenses are included in `assets/fonts/`.

## Tests

```bash
npm run check
npm test
```

The Playwright suite covers all views, task persistence, chart periods, content searching/filtering, draft creation/review/deletion, file validation, cross-month planning, goal progress, every template tool, coach history, escaping user text, focus management, workspace export/reset, mobile/RTL layouts, and offline loading.

A packaged Chromium dev dependency supports the sandbox's Linux test environment without a browser CDN download. To use another compatible local Chromium installation, set `PLAYWRIGHT_EXECUTABLE_PATH`. The default test setup extracts bundled Chromium and its Linux libraries into the system temporary directory; these are not application assets and are not committed.

## What production integration still requires

1. A secure backend and user authentication, storage policy, and account/data deletion flows.
2. A Meta app with the appropriate Instagram API product, eligible professional account requirements, OAuth consent, approved permissions/review as applicable, and server-side token handling. Do not place app secrets or long-lived access tokens in client code.
3. Authorized media and Insights imports; rate limiting, token expiry handling, explicit data provenance, and reliable error/loading states.
4. An actual AI/video-analysis pipeline: user consent, secure uploads, retention limits, frame/audio processing, model integration, evidence-based scores, and human-editable recommendations.
5. Officially permitted discovery/research integrations. No credential scraping or unauthorized access to other creators' content.
6. Backend scheduling and separate explicit publishing permissions if automatic publication is added. Push reminders would also require a real notification service and consent.

These integrations are intentionally not simulated as successful in this prototype.

## Repository history

This checkout originally contained **Bash Baqi Racing**. Its source and assets remain intact. The former entry page is preserved as [`legacy-racing.html`](legacy-racing.html), the original documentation as [`LEGACY-RACING.md`](LEGACY-RACING.md), and the standalone game remains in `bash-baqi-racing.html`. The root entry page, manifest, and service worker now belong to Neurio; the old game's PWA installation/offline instructions no longer apply to that legacy entry.
