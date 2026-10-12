# Voxora

A new Electron + React + TypeScript communication application, isolated from the original racing game in the repository root. Original branding; no seeded users, conversations, simulated media, or external UI assets.

**Status: functional chat MVP with a real backend; not production-ready or a completed Discord replacement.** See [verified status and limitations](docs/STATUS.md) before deploying. There is **no generated or tested Windows installer** in this checkout. The packaging command was attempted and failed downloading Electron due to the sandbox's certificate trust. Audio/video/screen-share end-to-end tests have **not passed**; no such claim is made.

## Architecture

```text
client/       React, Tailwind CSS 4, virtualized messages, lazy LiveKit UI
server/       Express 5, Socket.IO, Zod validation, Prisma PostgreSQL adapter
prisma/       Database schema and initial SQL migration
electron/     Sandboxed main process, narrow preload, encrypted session vault
assets/       Original SVG/PNG/ICO branding
infra/        Local/production LiveKit and reverse-proxy examples
tests/        Unit and real PostgreSQL/SMTP/Socket.IO integration tests
tools/        Optional sandbox PostgreSQL/mail helpers; icon generation
```

Node **22.12 or later**, npm, Docker Desktop with Compose v2. Electron and Prisma installation need access to their release/binary hosts in addition to the npm registry. A PostgreSQL server is shared backend infrastructure; the desktop does not install its own database.

## Local development

Run commands from `voxora/`:

```sh
cp .env.example .env
npm ci
npm run generate
docker compose up -d
npm run db:migrate
npm run dev
```

- Web client: `http://localhost:5173`
- API: `http://localhost:3001/api/health`
- Development email inbox: `http://localhost:8025` (Mailpit; no real emails leave your machine)
- SFU signaling: `ws://localhost:7880`

Register a new account, open its verification message in Mailpit, follow the link, and sign in. Create a second account in an independent browser profile. Connect by exact username, accept the friend request, and create a conversation. Create a server or join with its invitation code. Only owners/admins create channels and invites.

Start the desktop after both dev servers are ready:

```sh
npm run desktop
```

Development uses the Vite origin. Production packages bundle the renderer and use a secure `voxora://app` protocol. The packaged client **requires `VITE_API_URL=https://your-public-api` at build time**. The backend must serve the same browser assets and allow `voxora://app` as a CORS origin. The session token is encrypted using Electron `safeStorage` in the OS application-data directory; browsers instead use an HttpOnly session cookie. Cookies require same-origin deployment for browser production usage.

### Restricted sandbox fallback (no Docker / no Prisma binary host)

This fallback was used for verification in Arena. It runs actual PostgreSQL, not an in-memory database:

```sh
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
PRISMA_SCHEMA_ENGINE_BINARY=/bin/true PRISMA_QUERY_ENGINE_LIBRARY=/bin/true npm run generate
npx tsx tools/local-postgres.ts
# In another terminal, for a NEW EMPTY development database only:
node tools/apply-migration.cjs
npx tsx tools/dev-mail.ts
# In another terminal:
npm run dev
```

The `/bin/true` environment overrides are **only a client-generation workaround**, not database migration tools. Do not set them in production. `apply-migration.cjs` applies the checked-in SQL without Prisma migration history; never use it for an existing/production database. Normal environments must use `prisma migrate deploy`. Mail is saved to private ignored `storage/dev-mail/*.eml` files; open the verification URL in that file (MIME quoted-printable may encode `=` as `=3D` and wrap lines). Do not expose or commit this directory.

The sandbox preview uses a configured exact `APP_ORIGIN` / `EXTRA_ORIGINS` matching its forwarded HTTPS host. Browser API requests stay relative and Vite proxies `/api` and `/socket.io`; there are no browser calls to a separate localhost service.

### Voice/video locally

The Compose file uses LiveKit's integrated TURN service and explicit **development-only** credentials. The local SFU advertises loopback for same-computer development. This configuration will **not work for a second computer or network** without reachable media addresses and the setup in [deployment](docs/DEPLOYMENT.md). WebRTC needs HTTPS outside localhost. A preview's HTTP proxy does not expose UDP media ports.

Joining a room starts with microphone and camera off. Use LiveKit controls to enable media, choose input devices, show participants and screen tracks. The desktop requires **Choose screen / window** to explicitly select a capture source; browser sharing uses its native capture picker. Push-to-talk is window-focused, not a global system hotkey.

## Checks

```sh
npm run typecheck
npm test
npm run test:integration
npm run build
npm audit --omit=dev
npm audit
```

Integration tests provision an isolated real PostgreSQL cluster on port **55432**, an isolated SMTP receiver on **11026**, and a random-port API. They do not use the dev database or insert demo content into the application. Do not run concurrent copies on the same host. Artifacts are ignored under `test-results/`.

## Windows installer

On Windows 10/11, after provisioning public backend/media services:

```powershell
$env:VITE_API_URL = "https://chat.your-domain.example"
$env:LIVEKIT_URL = "wss://media.your-domain.example"
npm ci
npm run generate
npm run package:win
```

Expected artifact: `release/Voxora-0.1.0-x64-Setup.exe`. NSIS is configured for an installation directory chooser, desktop/Start Menu shortcuts, and uninstallation. The artifact is **not currently present**. A manual GitHub Actions Windows job is included; configure repository variables `VOXORA_API_URL` and `VOXORA_LIVEKIT_URL` first. Creating the workflow does not mean it has run or passed.

Use a trusted Windows signing identity before distributing. Electron Builder accepts `CSC_LINK` / `CSC_KEY_PASSWORD` through protected CI secrets; never put credentials into source. No update feed or automatic updater is configured: the current update mechanism is **manual signed installer replacement** with the same app ID. Verify publisher/signature and release SHA-256 before running a new version. See [deployment](docs/DEPLOYMENT.md) and [manual test plan](docs/TESTING.md).

## Further documentation

- [Implementation/verification status and remaining gaps](docs/STATUS.md)
- [Production deployment, TURN, security, backups](docs/DEPLOYMENT.md)
- [API and event reference](docs/API.md)
- [Manual and automated testing](docs/TESTING.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
