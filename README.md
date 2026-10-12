# Neurio

**A free, self-hosted, Discord-style desktop chat app for Windows** — text channels, direct
messages, roles and permissions, voice calls, video, screen sharing, file attachments and search.
Everything runs on your own machine: no cloud account, no API keys, no subscription, no external
AI service. MIT licensed.

```
Electron + React + TypeScript + Vite   ·   Node.js + WebSocket server   ·   SQLite   ·   WebRTC
```

---

## Download (no building required)

Every release is built by GitHub Actions on real Windows/Android toolchains and attached here:

**➡️ [Latest downloads](https://github.com/zakariabouifri03-max/neurio/releases/latest)** · [release page with all files](https://github.com/zakariabouifri03-max/neurio/releases/tag/neurio-latest)

| Platform | File | Install |
| --- | --- | --- |
| **Windows** (recommended) | `Neurio-Setup-1.0.0.exe` | Run it. Per-user install, no admin prompt, Start-menu + desktop shortcuts. |
| **Windows** (portable) | `Neurio-Portable-1.0.0.exe` | Run it — nothing is installed. Ideal for a USB stick. |
| **Android phone/tablet** | `Neurio-Android-1.0.0.apk` | Open the file on the phone → allow "install unknown apps" → install. |
| **Server** (for several people) | `neurio-server-1.0.0.zip` | Unzip on one machine, run `start-server.cmd` (Windows) or `start-server.sh`, then point everyone's app at that machine's address. |
| **Web UI** | `neurio-web-1.0.0.zip` | Static files; host them on any web server. The page is also installable as an app (PWA). |

All of them are **unsigned** (no certificate is bought for this project):

* Windows SmartScreen → *More info → Run anyway*.
* Android → the usual "app from outside the Play Store" warning.

The desktop EXE and the APK both contain the whole app. The EXE starts its own local server on
first run, so a single person can chat/video-test immediately; the APK asks for the address of
the server you want to use (the machine running `neurio-server.zip`, or any other Neurio server),
which is exactly the self-hosting model described in [docs/NETWORKING.md](docs/NETWORKING.md).

### Android app specifics

* The UI is bundled inside the APK, which makes it a *secure context*: microphone and camera
  capture work even when your server is plain `http://192.168.x.x:8790` on the LAN.
* On first launch it asks for the server address. **Long-press anywhere** to change it later, or
  to sign out and clear local data.
* Voice channels, video calls and screen sharing use the phone's microphone/camera — Android
  will ask for permission the first time.
* Built straight from `android/` by `.github/workflows/neurio-release.yml`; nothing device
  specific and no Google services involved.

---

## Quick start

```bash
# 1. install dependencies (Node 20.11+ / 22 LTS recommended)
npm install

# 2. create a demo workspace (optional but recommended the first time)
npm run seed

# 3. run the desktop app in development (server + renderer + Electron window)
npm run dev
```

No server? The desktop app **starts its own** Node server on `127.0.0.1:8790` and stores
everything in `%APPDATA%\Neurio` (`neurio.sqlite` + `uploads/`). You do not have to configure
anything to chat with yourself, and other people on your network can point the same app at your
machine's LAN address.

### Try it in a browser instead

```bash
npm run server           # API + WebSocket gateway on http://0.0.0.0:8790
npm run dev:web          # Vite dev server on http://localhost:5173 (proxies /api and /gateway)
```

Open <http://localhost:5173> — the same React app, no Electron needed. Handy for testing on a
phone or a second laptop on the same Wi-Fi.

### Build the Windows installer

```bash
npm run build:win            # dist/ + dist-electron/ + NSIS installer + portable EXE
npm run build:win:portable   # portable EXE only (no installation, runs from a USB stick)
npm run pack:dir             # unpacked build in release/win-unpacked (fastest smoke test)
```

Output lands in `release/`:

| Artefact | What it is |
| --- | --- |
| `Neurio-Setup-1.0.0.exe` | NSIS installer. Per-user by default (no admin prompt), lets you pick the folder, creates Start-menu and desktop shortcuts. |
| `Neurio-Portable-1.0.0.exe` | Single portable EXE. No installer, no registry, no leftover files — ideal for a USB stick. |

Both bundles contain the renderer, the Electron main process **and the server**, so the app works
offline on a machine with nothing else installed. See [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)
if you would rather run the server on a always-on machine or a VPS.

> **Status of the builds in this repository.** The renderer bundle, the Electron bundles, the
> server bundle, the test suite and the browser build were all built and executed in the Linux
> container this project was developed in. The Windows `.exe` files themselves were **not** built
> there: the container has no Windows/Wine tool-chain and its network policy blocks the Electron
> binary download (`github.com` release assets), so `electron-builder --win` cannot run. The
> commands above are the exact, standard ones — run them on Windows (or any machine with Wine +
> the Electron binary) and they produce the two artefacts. Nothing else is missing.

---

## The 16 requirements, and how each one is implemented

Every feature below is implemented in the code base and covered by automated tests
(`npm test` → **98 passing tests**). "Verified by" lists the test file that exercises it.

| # | Feature | Implementation | Verified by |
| --- | --- | --- | --- |
| 1 | Account creation & login | `POST /api/auth/register|login|logout`, scrypt password hashing, SHA-256 session tokens, session list + revoke, first account becomes server operator (`server/rest/auth.ts`) | `server.messaging.test.ts` (accounts), `unit.test.ts` (hashing) |
| 2 | Profiles & avatars | Display name, bio, custom status, avatar + server icon upload, shared `Avatar` component with presence ring | `server.uploads.test.ts` (avatars/icons), `renderer.test.tsx` |
| 3 | Friends & requests | Request/accept/ignore/unblock, blocks are enforced in DMs and invites, live `FRIEND_REQUEST_*` dispatches | `server.messaging.test.ts` (friends), `renderer.test.tsx` (pending tab) |
| 4 | Real-time DMs | DM + group-DM channels, per-recipient delivery, read states and unread counters | `server.messaging.test.ts` (direct messages) |
| 5 | Servers, channels, categories | Create/rename/delete servers, text + voice + category channels, channel topics, slowmode, drag-free reordering by position | `server.messaging.test.ts` (servers/channels) |
| 6 | Invites & member management | Invite codes (optional max uses/expiry), join via code, kick, ban/unban, leave, ownership transfer, nicknames | `server.permissions.test.ts` (moderation) |
| 7 | Roles & permissions | 17-bit permission set, role hierarchy guard (you cannot grant above yourself), per-channel role *and* member overwrites, `@everyone` fallback | `server.permissions.test.ts` (roles, overwrites), `unit.test.ts` (bitfield) |
| 8 | Attachments | Chunked multipart upload (no dependency), 25 MB default cap, MIME allow-list + magic-byte sniffing, byte-exact downloads with `Range` support, orphan sweep | `server.uploads.test.ts` |
| 9 | Edit / delete / react / reply | Message edits with `(edited)`, soft deletes + `MESSAGE_DELETE` dispatch, emoji reactions with counts, replies with an inline preview, pins | `server.messaging.test.ts` (messages), `renderer.test.tsx` |
| 10 | Presence & typing | Online/idle/DND/offline presence with custom status, typing indicators over the gateway with expiry timers | `server.messaging.test.ts` (presence, typing), `renderer.test.tsx` |
| 11 | Voice channels | Join/leave announcements, mute/deafen, live speaking detection (WebAudio analyser), call records in SQLite | `server.voice.test.ts` |
| 12 | Video & screen share | P2P WebRTC mesh signalled over the gateway (offer/answer/ICE relayed only between peers in the same channel), camera + `getDisplayMedia` screen sharing, per-peer tiles | `server.voice.test.ts` (signalling relay, refusals) |
| 13 | Notifications & unread counts | Windows toasts through Electron (`new Notification`), Web-Notification fallback in a browser, taskbar overlay badge + tray counter, per-channel mention badges | `renderer.test.tsx`, `src/lib/notifications.ts` |
| 14 | Search, settings, dark mode | SQLite FTS5 full-text search with filters (server/channel/author/pins), settings screen (profile, appearance, sessions, server admin), three themes + font size + compact mode | `server.messaging.test.ts` (search), `unit.test.ts` (snippets), `src/components/Modals.tsx` |
| 15 | Local data storage | SQLite (`node:sqlite`, WAL) with a versioned migration runner, uploads on disk, nothing leaves the machine unless you self-host it | `server/db.ts`, all server tests |
| 16 | Windows installer + portable EXE | electron-builder config in `package.json` (`nsis` + `portable`, x64), generated icon, no signing requirement | `npm run build:win` (see the status note above) |

---

## Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies (no native modules to compile). |
| `npm run dev` | Server + Vite + Electron window, all with hot reload. |
| `npm run dev:web` | Only the renderer dev server (open it in any browser). |
| `npm run dev:server` | Only the API server, restarting on change. |
| `npm run server` | Run the server as a standalone process (`--port`, `--host`, `--data-dir`, `--static`, `--no-registration`). |
| `npm run seed` | Create the demo workspace (`operator`, `alice`, `bob`, `carol`, `Neurio HQ`, invite code). |
| `npm test` | Run all 98 tests (backend, media, permissions, renderer). |
| `npm run test:coverage` | Same, with a coverage report. |
| `npm run typecheck` | `tsc --noEmit` over the whole project (strict mode). |
| `npm run build` | Renderer bundle + Electron/server bundles. |
| `npm run build:win` | Windows installer **and** portable EXE. |
| `npm run icons` | Regenerate `build/icon.ico` and the PNG icons (pure JS, no ImageMagick). |
| `npm run verify` | typecheck → build-config check → build → tests, the whole gate in one command. |
| `npm run check:build-config` | Validates the electron-builder configuration against its own schema. |

The server understands a few environment variables, all optional and local:
`NEURIO_DATA_DIR`, `NEURIO_ICE_SERVERS`, `NEURIO_TURN_USERNAME`, `NEURIO_TURN_CREDENTIAL`,
`NEURIO_TRUST_PROXY`, `NEURIO_SERVER_URL` (make the desktop app use an existing server).

---

## Where your data lives

| Platform | Default location | Contents |
| --- | --- | --- |
| Windows (desktop app) | `%APPDATA%\Neurio` | `neurio.sqlite`, `uploads/` |
| Linux | `~/.local/share/neurio` | same |
| macOS | `~/Library/Application Support/Neurio` | same |
| This repo (dev / preview) | `./.neurio-data` (git-ignored) | same |

Back up the folder and you have backed up the whole server. Deleting it resets the instance.
No credentials live in the repository, and there is no `.env` file to fill in.

---

## Architecture in one minute

```
┌────────────────────────── Electron desktop app ───────────────────────────┐
│  main process (electron/main.ts)                                          │
│    · spawns / attaches to the server      · tray, badge, notifications     │
│    · window, native dialogs, auto-launch  · "save attachment as…"          │
│  preload (contextBridge → window.neurio, no Node in the renderer)          │
│  renderer: React 19 + zustand store  ── HTTP ──┐   ── WebSocket ──┐        │
└────────────────────────────────────────────────┼──────────────────┼────────┘
                                                 ▼                  ▼
                                  ┌───────────────────────────────────────┐
                                  │ Neurio server (Node, no framework)    │
                                  │  REST /api/*   ·   gateway /gateway    │
                                  │  SQLite: users, guilds, channels,      │
                                  │  roles, messages+FTS5, uploads, calls  │
                                  │  files on disk under <data-dir>/uploads│
                                  └───────────────────────────────────────┘
                                                 ▲
                        WebRTC media (audio/video/screen) flows directly
                        between peers — the server only relays SDP/ICE
```

* **One process, no framework.** `server/app.ts` composes the stores, the REST router and the
  gateway; `server/index.ts` is the CLI wrapper. Tests boot the same app in-memory on port 0.
* **Gateway protocol v1** (`shared/protocol.ts`): `hello` → `identify` → `READY` dispatch, then
  heartbeats and dispatch events (`MESSAGE_CREATE`, `PRESENCE_UPDATE`, `TYPING_START`,
  `VOICE_STATE_UPDATE`, `VOICE_SPEAKING`, `VOICE_SIGNAL`, …).
* **WebRTC mesh.** Media never touches the server: it relays signalling only, and refuses to
  signal peers that are not in the same voice channel. The server advertises
  `recommended_max_mesh_peers: 6`; the UI warns above that.
* **Renderer** is one zustand store (`src/lib/store.ts`) behind typed clients (`api.ts`,
  `gateway.ts`, `voice.ts`) and 12 React components. It keeps working if a WebSocket drops — the
  gateway reconnects with exponential backoff and re-syncs through `READY`/`refreshGuildData()`.

Full detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Talking to people outside your house

This is the one thing that is genuinely not solvable from inside the code, so it is worth being
blunt about it:

* **Same Wi-Fi / same LAN — works out of the box.** The server binds `0.0.0.0`, prints its LAN URL
  at startup (`http://192.168.x.x:8790`), and anyone can add that address in the sign-in screen.
* **Across the internet — needs a machine that is reachable from the internet.** NAT means your
  friends cannot connect to a laptop behind a home router unless you forward a port, use a VPN
  overlay (Tailscale/WireGuard/ZeroTier), or run the server on a VPS. Then voice/video also want
  a **STUN** server (built into WebRTC clients) and ideally your own **TURN** server for stubborn
  NATs — `coturn` is free and open source, and Neurio accepts its credentials through
  `NEURIO_ICE_SERVERS`/`NEURIO_TURN_USERNAME`/`NEURIO_TURN_CREDENTIAL`. Text chat alone needs
  none of that.
* **No paid service is required for any of it.** If you do not want to run a VPS, the LAN and
  VPN-overlay routes give you the same result at zero cost.

Exact steps for both: [docs/NETWORKING.md](docs/NETWORKING.md) (and
[docs/SELF-HOSTING.md](docs/SELF-HOSTING.md) for the server side).

---

## Security posture (honest version)

* Passwords: scrypt (N=16384, r=8, p=1, 64-byte key) with a random salt per user; the plaintext
  never leaves the request handler.
* Sessions: 32-byte random tokens, **only a SHA-256 hash is stored** server-side; revocable one by
  one or all at once; the client keeps its token in the app's local storage (the renderer's
  `localStorage`), not in a file you would accidentally commit.
* Authorisation: every route re-checks membership and the relevant permission bit; channel
  visibility is applied when listing channels *and* when fetching a single one; files are served
  only to members who can see the channel that references them.
* Uploads: MIME allow-list, extension sanitising, size cap, `Content-Disposition` on download.
* Nothing phones home: no analytics, no update pings, no external API calls of any kind. The only
  optional outbound traffic is what *you* configure (a STUN/TURN server for calls).
* Not implemented (deliberately, to keep the dependency list tiny): end-to-end encryption, TLS
  termination (put it behind a reverse proxy such as Caddy — see the self-hosting guide), and
  code signing for the EXE.

---

## Repository layout

```
electron/      main process + preload bridge (window.neurio)
server/        Node server: db, stores, REST routes, gateway, uploads, seed, CLI
shared/        types, permission bitfield, gateway protocol (used by both sides)
src/           React renderer: lib clients (api/gateway/voice/store) + components + styles
android/       Android shell (WebView host) that packages the renderer into an APK
tools/         dev runner, esbuild bundler, icon generator, build-config checker
tests/         vitest suites: messaging, voice, uploads, permissions, units, renderer
docs/          ARCHITECTURE.md, SELF-HOSTING.md, NETWORKING.md
.github/       the release pipeline (Windows EXE, portable, APK, server + web bundles)
build/         generated icons (npm run icons)
legacy/        unrelated pre-existing project kept in the repo, untouched
```

## License

MIT — see [LICENSE](LICENSE). Do what you like with it.
