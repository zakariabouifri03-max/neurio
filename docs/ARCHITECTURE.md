# Neurio architecture

How the pieces fit together, why they were chosen, and where to look when you want to change
something. Read this with the file tree open next to you.

---

## 1. Processes

```
needed at runtime
─────────────────
Electron main process            electron/main.ts
  └─ child: Node server          dist-electron/server/index.cjs   (or tsx server/index.ts in dev)
  └─ BrowserWindow → renderer    dist/index.html                  (or the Vite dev server)
  └─ preload bridge              dist-electron/electron/preload.cjs → window.neurio

renderer (Chromium)
  └─ HTTP  /api/*                REST
  └─ WS    /gateway              dispatches + client ops
  └─ WebRTC                      media, peer to peer
```

The desktop app is self-contained: `electron/main.ts` forks the bundled server (a CommonJS file
produced by `tools/build-electron.mjs`), waits for `listening on` in its output (6 s fallback),
then loads the window. Two switches change that:

* `NEURIO_SERVER_URL` — attach to an already running server instead of spawning one.
* `NEURIO_LOAD_LOCAL` — in development, load the built `dist/` instead of the Vite dev server.

The server is a normal Node program and runs equally well on its own
(`node dist-electron/server/index.cjs --port 8790 --host 0.0.0.0`), which is what
[docs/SELF-HOSTING.md](SELF-HOSTING.md) is about.

## 2. Server internals

| File | Responsibility |
| --- | --- |
| `server/index.ts` | CLI: flags, env, shutdown signals, startup banner. |
| `server/app.ts` | Composition root. `createApp()` wires DB → stores → presence → gateway → router → HTTP server. `createTestApp()` is the same thing for tests (in-memory, ephemeral port). |
| `server/config.ts` | `parseArgs`, `buildConfig`, `defaultDataDir`, ICE-server parsing. |
| `server/db.ts` | Thin wrapper over `node:sqlite`'s `DatabaseSync`: `run/get/all/tx`, WAL, foreign keys, a versioned migration runner, `stats()`. |
| `server/gateway.ts` | WebSocket endpoint at `/gateway`: identify/auth, heartbeat, sequence numbers, per-user and per-guild audiences, dispatch fan-out. |
| `server/presence.ts` | Who is online/idle/dnd/offline, custom statuses, and the broadcast of changes. |
| `server/http.ts` | Tiny HTTP plumbing: JSON body parsing, multipart body collection, static files, CORS for web mode, error mapping. |
| `server/rest/*.ts` | Route groups (`auth`, `users`, `guilds`, `channels`, `messages`, `files`, `admin`), a small router with per-route auth/rate-limit options, and `requireX` helpers. |
| `server/store/*.ts` | The data layer: `users`, `guilds`, `messages`, `voice`. All SQL lives here. |
| `server/permissions.ts` | Permission resolution: base bits from roles, channel overwrites (role then member), administrator bypass, ownership. |
| `server/uploads.ts` | Chunked file writes, size/type checks, orphan sweep. |
| `server/media.ts` | Image dimension sniffing (PNG/JPEG/GIF/WebP), filename sanitising, MIME allow-list. |
| `server/crypto.ts` | scrypt hashing/verification, session tokens, invite codes, SHA-256 helpers. |
| `server/ids.ts` | Snowflake generator (48-bit ms timestamp + counter + worker), monotonic even if the clock steps back. |
| `server/serialize.ts` | Row → DTO mappers (`toPublicUser`, `channelDto`, `serializeMessage`, …) so the wire shape is defined in one place. |
| `server/seed.ts` | The demo workspace (`npm run seed`). |

### Data model (SQLite)

```
users ──< sessions            relationships (friends/blocks, one row per direction)
users ──< guild_members >── guilds ──< roles ──< member_roles
guilds ──< channels ──< permission_overwrites       (role or member, allow/deny bitmask)
channels ──< messages ──< attachments >── uploads
                    └──< message_reactions
                    └──< message_mentions        (visibility rules for @mentions)
channels ──< read_states      channels ──< invites      guilds ──< bans
channels ──< voice_states     calls ──< call_participants
meta (schema version)         messages_fts (FTS5 mirror of message content)
```

* Messages are **soft-deleted** (`deleted_at`), so replies keep their context; list payloads drop
  them (`unit.test.ts > drops deleted messages`).
* `messages_fts` is an FTS5 external-content table kept in sync by triggers; search returns
  `snippet()`-based excerpts centred on the match.
* Migrations are numbered and applied in `db.tx()`; the runner is idempotent, so shipping a new
  version over an existing database is safe.

### REST surface

`GET /api/health`, `GET /api/config` · auth: `POST /api/auth/{register,login,logout}`,
`GET /api/auth/session` · profile: `GET|PATCH /api/users/@me`, `POST /api/users/@me/password`,
`POST|DELETE /api/users/@me/avatar`, `GET /api/users/@me/sessions`,
`DELETE /api/users/@me/sessions/:id`, `POST /api/users/@me/sessions/revoke-all`, `GET /api/users`,
`GET /api/users/:id` · relationships: `GET /api/relationships`,
`POST /api/relationships/requests`, `POST /api/relationships/requests/:id/accept`,
`DELETE /api/relationships/:id`, `POST|DELETE /api/relationships/:id/block` · guilds:
`GET|POST /api/guilds`, `GET|PATCH|DELETE /api/guilds/:id`, `POST /api/guilds/:id/icon`,
`GET|POST /api/guilds/:id/channels`, roles, `GET|PATCH /api/guilds/:id/members/:userId`,
bans, `GET|POST /api/guilds/:id/invites`, `POST /api/guilds/:id/transfer`,
`POST /api/guilds/:id/leave`, `GET /api/guilds/:id/voice-states` · invites:
`GET|DELETE /api/invites/:code`, `POST /api/invites/:code/accept` · channels:
`GET|PATCH|DELETE /api/channels/:id`, overwrites, `GET|POST /api/dms`,
`POST /api/dms/group`, recipients · messages: `GET|POST /api/channels/:id/messages`,
`GET|PATCH|DELETE /api/messages/:id`, bulk delete, reactions, pins, `POST /api/channels/:id/ack`,
`GET /api/read-states`, `GET /api/search` · files: `POST /api/uploads`, `GET /api/files/:id`,
`GET /api/files/:id/download` · admin: `GET /api/admin/overview`, `PATCH /api/admin/config`,
`GET /api/admin/users`, `GET /api/admin/whoami`.

## 3. Gateway protocol

`shared/protocol.ts` is the single source of truth (version `1`).

```
client → server
  { op: 'identify', d: { token, capabilities } }        once, as the first frame
  { op: 'heartbeat', d: { seq } }                       every hello.heartbeat_interval_ms
  { op: 'typing', d: { channel_id } }
  { op: 'presence.update', d: { status, custom_status } }
  { op: 'voice.join', d: { channel_id, self_mute, self_deaf, self_video, self_stream } }
  { op: 'voice.state', d: { self_mute, self_deaf, self_video, self_stream } }
  { op: 'voice.speaking', d: { channel_id, speaking } }
  { op: 'voice.signal', d: { channel_id, target_user_id, payload } }
  { op: 'voice.leave', d: {} }
  { op: 'subscribe', d: { channel_ids } }

server → client
  { op: 'hello', d: { heartbeat_interval_ms, protocol_version, server } }
  { op: 'dispatch', t: 'READY', s: 1, d: { user, guilds, dm_channel_ids, … } }
  { op: 'heartbeat_ack', d: { seq } }
  { op: 'invalid_session' }        → the client clears its token and shows the sign-in screen
  { op: 'error', d: { code, message, fatal } }
```

Dispatch events: `READY`, `MESSAGE_CREATE|UPDATE|DELETE|DELETE_BULK`, `TYPING_START`,
`PRESENCE_UPDATE`, `FRIEND_REQUEST_CREATE|REMOVE`, `GUILD_CREATE|UPDATE|DELETE`,
`GUILD_MEMBER_ADD|REMOVE|UPDATE`, `GUILD_ROLE_CREATE|UPDATE|DELETE`, `CHANNEL_CREATE|UPDATE|DELETE`,
`VOICE_STATE_UPDATE`, `VOICE_SPEAKING`, `VOICE_SIGNAL`, `READ_STATE_UPDATE`, plus admin notices.

Notes that matter when you touch the code:

* **`READY` arrives as a dispatch**, not as `{ op: 'ready' }`.
* `VOICE_STATE_UPDATE` always carries the full `states` roster for the channel (the first version
  only carried the delta, which made clients join/leave the wrong tiles).
* The gateway keeps a per-user audience set (`gateway.audienceForGuild`, `dispatchToUser`), so
  private channels never leak events to outsiders — this is enforced server-side, not in the UI.

## 4. WebRTC mesh

```
join channel ──► VOICE_STATE_UPDATE (everyone re-syncs their peer list)
offer/answer ──► VOICE_SIGNAL relayed to one target user id (must share the channel)
ICE candidates ► same path, trickled as they appear
media ─────────► direct peer-to-peer (audio, video, screen), never through the server
```

* `src/lib/voice.ts` (`VoiceEngine`) owns the peer connections, local/screen streams, the speaking
  analyser and the microphone level meter.
* Perfect-negotiation-style politeness: the lexicographically larger user id yields, so glare
  cannot deadlock the negotiation.
* `iceServers` come from `GET /api/config` (from `NEURIO_ICE_SERVERS` etc.); the default is empty,
  which is fine on a LAN and needs a STUN/TURN entry across the internet.
* Screen sharing uses `getDisplayMedia` — in Electron the main process installs a
  `setDisplayMediaRequestHandler`, and in a browser the user gets the standard picker.

## 5. Renderer

```
src/main.tsx      mount
src/App.tsx       theme + bootstrap, auth gate, focus-driven read acks
src/lib/api.ts    typed REST client (one method per endpoint, throws ApiError)
src/lib/gateway.ts WebSocket client: heartbeat, reconnect/backoff, typed handlers
src/lib/voice.ts  VoiceEngine (WebRTC)
src/lib/store.ts  zustand store: state + every action, gateway dispatch reducer
src/lib/notifications.ts  toasts/badges (Electron bridge, Web-Notification fallback)
src/lib/format.ts markdown tokeniser, emoji data, formatters, colours
src/components/*  Avatar, Markdown, AuthScreen, GuildRail, ChannelSidebar, MessageList
                  (+ Composer), MemberList, FriendsView, VoiceView, Toasts, Modals
                  (+ AppShell, which composes them)
src/styles/index.css   all styling; three themes via `data-theme` on <html>
```

Two rules keep this layer predictable:

1. **The renderer never imports from `server/**` or `node:*`.** It shares types through
   `shared/**` only, so the same bundle runs in Electron and in a plain browser.
2. **Components talk to the store, the store talks to the network.** Components may call store
   actions and read state; they never call `fetch`/`WebSocket` themselves (the modal that previews
   an invite goes through `store.acceptInvite`/`api` accessed via the store for exactly this
   reason).

`useShallow` is used for every multi-field selector: zustand v5 compares snapshots by reference,
and a selector returning a fresh object (or a fresh `[]`) re-renders forever. The same reason is
why `EMPTY_MESSAGES` / `EMPTY_MEMBERS` / `EMPTY_TYPING` constants exist in `MessageList.tsx` and
`MemberList.tsx` — do not replace them with inline `?? []`.

## 6. Testing

```
tests/helpers/harness.ts        startHarness() boots the real app in-memory on port 0 and
                                exposes ApiClient + GatewayClient helpers
tests/server.messaging.test.ts  accounts, friends, presence, servers, channels, messages,
                                reactions, pins, search, unread, DMs (31 tests)
tests/server.voice.test.ts      voice state, signalling relay + refusals, call bookkeeping (10)
tests/server.uploads.test.ts    uploads, range requests, access control, avatars, sweep (13)
tests/server.permissions.test.ts roles, overwrites, hierarchy, kick/ban/leave (14)
tests/unit.test.ts              ids, hashing, tokens, media helpers, bitfield, config, FTS (23)
tests/renderer.test.tsx         the React UI against a real server in jsdom (7)
```

The renderer suite is deliberately end-to-end: it registers through the sign-in form, creates a
server, sends a message from the composer, watches a second user's typing indicator and message
arrive over a real WebSocket, reacts/edits/deletes, accepts a friend request and generates an
invite code. If any of that regresses, `npm test` fails.

Known environment caveats: `node:sqlite` prints an experimental warning on Node 22 (harmless), and
`tests/server.voice.test.ts` exercises the *signalling* path, not real media (no camera in CI).

## 7. Build pipeline

```
npm run build:renderer   vite build           → dist/            (index.html + assets)
npm run build:electron   tools/build-electron.mjs (esbuild)       → dist-electron/
                                                                            electron/main.cjs
                                                                            electron/preload.cjs
                                                                            server/index.cjs
npm run icons            tools/make-icons.mjs → build/icon.ico + PNGs + public/icon.png
npm run build:win        electron-builder --win --x64  → release/*.exe
```

`tools/build-electron.mjs` keeps `node:*` and the optional native modules of `ws`
(`bufferutil`, `utf-8-validate`) external, and bundles everything else, including `ws` itself, so
the shipped app needs no `node_modules` at runtime.

`tools/make-icons.mjs` writes PNG chunks (CRC32 + zlib deflate) and an ICO container by hand —
7 sizes from 16 to 256 px — so producing release icons needs no image tooling.
