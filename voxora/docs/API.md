# HTTP and real-time reference

All paths below are under `/api`. JSON mutation bodies are Zod-validated. Auth uses an HttpOnly cookie in browsers or `Authorization: Bearer <opaque session>` for the native client. Desktop login requests include `X-Voxora-Desktop: 1` to receive the session token for the encrypted vault. Mutation Origin must be trusted; cookies without Origin are not accepted on mutations. Never include tokens in query strings.

| Route | Behavior |
|---|---|
| `GET /health` | Database readiness |
| `POST /auth/register` | `{email,username,displayName,password}`; sends SMTP verification |
| `POST /auth/login` | `{email,password}`; verified accounts only |
| `POST /auth/verify` | `{token}`; single use |
| `POST /auth/resend`, `/auth/forgot` | `{email}`; generic account-discovery-safe response |
| `POST /auth/reset` | `{token,password}`; revokes all sessions |
| `GET/PATCH /auth/me` | Own profile; displayName, bio, status, preferences |
| `POST /auth/logout` | Revoke current session |
| `GET /auth/sessions`, `DELETE /auth/sessions/:id` | Own sessions only |
| `GET/POST /friends` | List relationships / request by `{username}` |
| `PATCH/DELETE /friends/:id` | Recipient accepts / either party removes |
| `GET/POST /blocks`, `DELETE /blocks/:targetId` | Block/unblock `{targetId}` |
| `POST /dms` | `{userIds,name?}`; all invited peers must be accepted friends |
| `GET /workspace` | Authorized servers, visible channels and DMs |
| `POST /servers`, `PATCH /servers/:id` | Create/update name/description |
| `GET /servers/:id/members?q=&cursor=` | Member search, up to 100 |
| `POST /servers/:id/channels` | `{name,kind:text|voice,private?,category?}` |
| `PATCH /channels/:id` | Name, private, slowMode seconds, participantLimit, category, position, userIds allowlist |
| `POST /servers/:id/invites` | `{hours,maxUses}`; admin-only; returns code |
| `POST /invites/:code/join` | Atomic bounded invite consumption |
| `POST /servers/:id/leave` | Non-owner only |
| `POST /servers/:id/moderate` | `{targetId,action:kick|ban|unban|timeout|role|transfer,minutes?,role?}` |
| `GET /servers/:id/audit` | Moderator+, newest 100 |
| `POST /reports` | `{targetId,reason}`; stored, no triage UI yet |
| `GET /conversations/:id/messages?before=&q=&pinned=true&replyTo=` | Authorized history/search, up to 50, `{messages,nextCursor}` |
| `POST /conversations/:id/messages` | `{body,replyToId?,uploadIds?}` |
| `PATCH /messages/:id` | Own body edits; moderator server pins `{pinned}` |
| `DELETE /messages/:id` | Own messages or moderator; tombstones content |
| `POST /messages/:id/reactions` | Toggle `{emoji}` from supported six-emoji allowlist |
| `POST /conversations/:id/read` | Set own read timestamp; optional stored `{muted}` preference (delivery not wired yet) |
| `GET /unread` | Authorized conversation counts |
| `POST /conversations/:id/uploads` | Multipart `file`; checks write membership before parsing |
| `GET /uploads/:id` | Authorized attachment download; unassociated files only visible to owner |
| `POST /conversations/:id/media` | LiveKit room + short-lived scoped token; no secret returned |

## Socket.IO

Authenticate using browser session cookie or `auth.token` for desktop. The Origin must be trusted, including for WebSocket transport. HTTP remains the authoritative mutation/persistence path; sockets deliver updates and coordinate ringing.

Client events: `conversation:join` / `conversation:leave` (conversation ID), `typing` (ID), `call:ring` (DM/group ID), `call:respond` (`{id,accept}`), `call:end` (ID). Protected events return acknowledgment `{ok,data?}` or `{ok:false,error}`. The renderer joins all visible conversations again after reconnect and fetches persisted history to fill gaps.

Server events: `message:new`, `message:update`, `typing`, `workspace:changed`, `friend:request`, `call:incoming`, `call:response`, `call:ended`. Message authorization happens on subscription and membership-changing endpoints evict affected room subscriptions. Sessions are validated on inbound events and swept periodically for passive listeners.

Voice, camera and screen frames **do not travel over Socket.IO**. They are WebRTC tracks carried by the LiveKit SFU using its own signaling and temporary room/ICE credentials.
