# Implementation and verification ledger

Updated 2026-10-11. This is a substantial MVP, **not completion of all seven requested phases** and not suitable for an unrestricted public launch yet.

## What is implemented

| Area | Implemented behavior | Verification |
|---|---|---|
| Foundation | Electron shell; React/TS/Tailwind; Express/Socket.IO; PostgreSQL + Prisma; initial migration | Typecheck and production web/API compilation pass. Initial SQL applied to real PostgreSQL. Native Electron startup unverified. |
| Accounts | Registration, unique usernames/email, bcrypt passwords, SMTP verification, single-use reset, hashed opaque sessions, logout/revoke, display name/status/preferences | Real HTTP/SMTP/PostgreSQL integration tests pass, including reset token replay and revocation. |
| Relationships | Request/accept/decline/remove friends; block/unblock; accepted-friend-only DM/group creation | Integration tests pass for request permissions, DM persistence and blocking. Group-specific UI not browser-tested. |
| Communities | Create/edit/join/leave; bounded/expiring invitation codes; text/voice channels; categories/order metadata; fixed owner/admin/moderator/member roles | Permission, invitation, private membership and slow-mode integration tests pass. |
| Chat | Persisted paginated messages, cross-client events, edit/delete, reply references, six backend reactions (UI quick reaction: thumbs up), search/pins, Markdown, typing, read timestamps/unread counts | Persistence, delivery, edit, reaction and reconnect tests pass. Search/pagination/unread boundaries need more tests. |
| Attachments | Local filesystem storage; size/quota limits; signature/extension checks; conversation-scoped authorization; progress; authorized preview/download | Upload/association/download permissions and mismatched image rejection tested. No antivirus guarantee. |
| Media | LiveKit room coordination, short-lived tokens, SFU-enforced room limits, LiveKit conference controls, manual ringing/accept/decline, source chooser IPC, PTT and playback volume | Call **signaling** and unauthorized/unconfigured media endpoint tests pass. Actual SFU audio/video/screen transport NOT tested. |
| Moderation | Role hierarchy; kick/ban/unban/timeout; owner transfer; audit endpoint; reports endpoint | Ban/private access checks tested. Role transfer/audit/report UI completeness unverified. |
| UX | Original branding/icons, dark/light selector, three-panel workspace, virtualized loaded messages, lazy media, resizable channel sidebar, dialogs, empty/error/loading states, toasts, search shortcut, native notification bridge | Compile-tested only; no browser automation/accessibility audit or native notification test yet. |
| Packaging | NSIS config, icon assets, Windows CI job, encrypted OS credential vault, single-instance lock, logs, secure protocol/CSP/IPC | Packaging attempted and failed. No EXE artifact; no Windows install/uninstall test. |

## Actual checks run

- `npm run build`: passed, including strict TypeScript and server compilation.
- `npm test`: **3 passed** (token helper, role matrix, desktop configuration source checks).
- `npm run test:integration`: **10 passed, 1 explicitly skipped**, against real isolated PostgreSQL and SMTP. Not mocks. The skipped test identifies two-network media and Windows lifecycle requirements; it is not a passing test.
- `npm audit --omit=dev`: **0 reported vulnerabilities** at verification time. This is not a security certification.
- Full `npm audit`: **8 moderate, 0 high/critical** remaining in Electron Builder's `@electron/get → global-agent → roarr → sprintf-js` toolchain. `npm audit fix` did not resolve them. Builds remain release-gated pending review/update. Electron and Tailwind were upgraded after the initial audit found high-severity advisories. The Prisma config deepmerge override is documented in `package.json` and client generation was retested.
- `npm run package:win`: attempted; Electron binary retrieval failed certificate validation. No installer was produced. TLS verification was not disabled. Windows and Wine are not available here.
- Performance sample: Linux development API process RSS was 130,048 KiB (about 127 MiB) immediately after a watcher restart. This excludes the watcher, database, Vite and desktop; it is a one-time observation, not an idle or total-system memory claim. No Windows measurements were possible.
- Docker Compose and production infrastructure examples were written, **not executed** (Docker absent).
- Live preview starts the actual Vite/API/PostgreSQL stack. The dev mail helper writes private local mail files; it does not deliver mail to an external provider. No demo account/data is prepopulated.

## Missing / partial scope, by phase

1. **Foundation:** no tested Windows runtime; no native lifecycle automation; no migration-upgrade/rollback test. Avatar/banner columns exist but upload/edit/display features do not. No account deletion/export or advanced session device metadata.
2. **Chat/communities:** replies are flat references, not full nested threaded UI. No semantic user/role/channel mention parsing or mention-only routing. Links are safe rendered anchors, not fetched rich previews. No group participant add/remove/leave management. No custom permission bitsets/role definitions; fixed roles plus private allowlists only. No channel deletion UI, onboarding/welcome automation, community discovery, server icon upload, dedicated category/order editor, or complete administration UI. Search uses bounded substring queries, not full-text indexes. The member list is capped at 100 in the UI; paginated backend search is available.
3. **Voice:** no proven two-network transport, TURN fallback, PTT global shortcut, microphone gain slider, per-user volume UI, accurate live voice occupancy, sound/ringtone assets, or complete multi-recipient call lifecycle. Ring state is single-process/ephemeral. Presence is a **manually selected preference**, not accurate online/idle activity tracking. All channels subscribe on reconnect; large workspaces need subscription batching/presence scaling.
4. **Video/screen:** SDK-integrated tiles, devices, adaptive media and sharing exist, but no actual camera/microphone/share test. Windows system-audio capture is only requested for entire-screen loopback and depends on OS support. Desktop sharing must use the explicit source chooser. PTT/volume controls need device testing. No custom quality/frame-rate settings UI. No claims of working calls.
5. **Files/notifications/moderation:** local storage only, no configurable S3/provider interface; no image optimization/scanning/quarantine; abandoned uploads count toward quota with no automated cleanup. Notifications are basic background messages/friend requests/calls; per-channel mute is stored via API but is **not yet wired into notification delivery**. No reliable per-server mute, mention/reply-specific routing, sound preferences, or confirmed Windows taskbar overlay. Reports/audit routes exist but no report triage/moderation console.
6. **Hardening/performance:** not audited. Backend checks permissions, but distributed revocation, account/session abuse protections, moderator media eviction retries, durable moderation jobs, and uniform transaction locking across simultaneous membership changes still need work. Existing authorized media can outlive a revoked account session until disconnected; newly minted room tokens expire after two minutes. Revoked Socket.IO sessions are swept within 15 seconds. No distributed rate limiter, Redis adapter, multi-node deployment, retention policy, per-user client-side blocked-message filtering, accessibility conformance audit, or measured desktop/large-history performance. Light theme is partial for media and decorative surfaces. Loaded history DOM is virtualized but loaded data remains in memory.
7. **Release:** no generated/tested/signed installer, automatic update channel, release SBOM, reproducible image digests, Windows SmartScreen validation, media E2E evidence, load tests, or tested disaster recovery.

## Release gates

Do not mark production-ready until missing security controls and notification privacy are resolved; the Windows artifact is signed and installed/uninstalled on clean Windows 10/11 VMs; two-network media and forced TURN pass; restore drills and load/performance tests pass; unresolved dependency advisories are reviewed/fixed; and all manual gates in TESTING.md have recorded evidence.
