# Deployment guide

This guide describes required infrastructure, not a verified production deployment. Finish the release gates in STATUS.md first. Hosting, email, TURN relay bandwidth, media egress, domains, certificates, backups, and storage may incur costs. There is no promise of free worldwide communication.

## Topology

- `chat.YOUR_DOMAIN`: HTTPS backend and built browser assets behind a reverse proxy; WebSocket upgrades to Socket.IO.
- `media.YOUR_DOMAIN`: HTTPS/WSS reverse proxy to LiveKit signaling on 7880.
- `turn.YOUR_DOMAIN`: public LiveKit host with a trusted certificate for TURN/TLS. This is not HTTP and cannot be routed by an ordinary HTTP reverse-proxy route.
- Managed/private PostgreSQL, not exposed publicly.
- SMTP provider with verified sender/domain, SPF/DKIM/DMARC and TLS.
- Persistent private upload volume mounted at `UPLOAD_DIR`. Back it up alongside the database.

Use a publicly reachable host with stable addressing for LiveKit, preferably a separate media host. Clients must be able to reach all advertised media addresses; HTTP tunnel/preview URLs alone are insufficient.

## Environment and services

1. Copy `.env.example` into protected deployment environment configuration. Generate independent database and SFU credentials with a cryptographic generator. Never reuse the development values.
2. Set `NODE_ENV=production`, `DATABASE_URL` (TLS per your provider), `APP_ORIGIN=https://chat.YOUR_DOMAIN`, SMTP parameters, `LIVEKIT_URL=wss://media.YOUR_DOMAIN`, matching `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`, and storage limits. `EXTRA_ORIGINS` must list exact additional trusted browser origins, never `*`. Desktop `voxora://app` is explicitly allowed in the code.
3. `LIVEKIT_INTERNAL_URL=http://private-media-host:7880` optionally separates server control traffic from the public signaling URL. Keep it private; the backend alone has the media API secret.
4. Set `TRUST_PROXY_HOPS=1` only if exactly one trusted proxy fronts the API and direct access is firewalled. Do not blindly trust arbitrary forwarded headers. Choose the correct hop count for your topology.
5. Copy `infra/livekit.production.example.yaml` outside the repository or to ignored `infra/livekit.production.yaml`. Replace placeholders with the exact key/secret, TURN domain and real certificate/key files. Mount them read-only with restrictive ownership. The YAML does not interpolate shell placeholders automatically.
6. Deploy LiveKit and the backend with a supervisor/container restart policy. The development Compose file is not a production stack. Run `npm ci`, `npm run generate`, `npm run build`, then `npm run db:migrate` as a controlled release step and `npm start` as a non-root service. Alternatively build the included Dockerfile. Container storage must be persistent and writable by UID 1000. Do not mount host Docker sockets or credentials into the app.
7. Configure TLS proxying using the Caddy example. Do not expose raw API/database ports publicly. The browser is served at the same origin as `/api` and `/socket.io` so Strict HttpOnly cookies work. Set proxy upload limits above `MAX_UPLOAD_MB` but below your infrastructure cap.
8. For production desktop packaging set **public** `VITE_API_URL=https://chat.YOUR_DOMAIN` and `LIVEKIT_URL=wss://media.YOUR_DOMAIN` during the build. `desktop-config.json` contains public connection origins only; backend secrets are not copied. No frontend environment variable may contain a secret.

## Firewall and NAT

For this sample single-host LiveKit configuration:

| Port | Purpose |
|---|---|
| 443/TCP | HTTPS app and SFU WSS, at the relevant proxy hosts |
| 7881/TCP | LiveKit ICE/TCP fallback, public on media host |
| 7882/UDP | LiveKit UDP mux media, public on media host |
| 3478/UDP | Integrated TURN UDP, public on media host |
| 5349/TCP | Integrated TURN TLS with valid TURN-domain certificate |

LiveKit advertises its public IP with `use_external_ip: true`. If it is behind NAT, forward the media ports and verify its advertised candidates. If deploying in Docker, use a suitable host networking topology or expose all media ports correctly; WSL/Docker Desktop networking differs from a public Linux host. For restrictive enterprise firewalls that only permit 443/TCP, deploy TURN/TLS on **443 on a dedicated public IP/domain** and adjust `tls_port` and firewall accordingly. A separate HTTP listener cannot share that socket without a suitable layer-4 proxy.

LiveKit supplies short-lived connection credentials/ICE server details over its authenticated signaling path. The permanent SFU secret stays on the backend. There is no static TURN password in the renderer. Test relay-only connections; do not assume that a successfully issued room token proves reachable TURN/media.

## Security/operations

- Sessions: 256-bit opaque tokens, only SHA-256 hashes stored in PostgreSQL. Browser cookies are HttpOnly, Strict and Secure in production. Desktop tokens use the encrypted OS vault. Do not persist desktop tokens in localStorage.
- Email tokens are single-use and time-limited. SMTP failure on registration does not remove the account; users can resend after delivery is repaired.
- Do not log authorization headers, bodies, email/reset links, credential vault contents or SQL parameters. Logs currently include event/error categories, not personal message bodies.
- Uploads are never a public static directory. Authorization is performed before download. Content validation is intentionally limited; **add malware scanning and quarantine before a public launch**. Documents/media can still be malicious to native applications. HTML/SVG/executables are not accepted.
- Read STATUS.md for current revocation, concurrency, notification and presence limitations. Media token expiry does not automatically disconnect an already-connected participant. This requires lifecycle/revocation work before public deployment.
- Current rate limiting/call coordination/Socket.IO is one-process only. Multiple API nodes need Redis-backed rate limiting, event adapters and durable call state, not independent in-memory maps.
- Manually remove expired sessions/tokens after a documented retention window. Design orphan-upload cleanup to remove only unattached old files and corresponding database records atomically; no such job is installed yet.
- Endpoint `/api/health` checks PostgreSQL. Monitor separate media reachability, mail deliveries, storage/disk quotas, error rates, latency, relay egress and TLS expiry.

## Backups and recovery

1. Use managed point-in-time recovery where available. Otherwise run scheduled `pg_dump --format=custom` from a trusted host with credentials provided through protected environment/service configuration, not pasted into shell history.
2. Store encrypted backups off-host with a retention policy. Never commit dumps. Back up the private upload volume at a consistent point relative to the DB snapshot.
3. Restore to an isolated new database using `pg_restore`, restore upload objects, configure a non-public staging API, and verify historical messages and authorized downloads with test accounts.
4. Record restore time, recovery point, missing objects, and verification evidence. A backup is not validated until restored.
5. Forward-only migrations need database snapshots and a reviewed rollback plan. Never edit an applied SQL migration. `tools/apply-migration.cjs` is not a production migration mechanism.

## Distribution and updates

`npm run package:win` packages client assets only, not the API/database. Ship a signed NSIS EXE, publish its SHA-256 hash and changelog over HTTPS, and retain the same app ID for upgrades. Configure protected code-signing inputs in CI. The current update mechanism is manual download/verify/run of a new signed installer. User data lives in Electron's Windows app-data directory (`%APPDATA%/Voxora` or the app name returned by `app.getPath('userData')`); test the exact path in the built artifact. Logouts remove the session vault. Uninstallation behavior for retained app data must be verified on Windows. An auto-updater/feed is deliberately not installed or implied.
