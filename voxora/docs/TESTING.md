# Test plan and release gates

## Automated tests implemented

Run `npm test` and `npm run test:integration`. The latter creates real PostgreSQL, SMTP and HTTP/Socket.IO processes and removes the isolated test cluster afterward. Ports 55432 and 11026 must be free. Test users/files are fixtures in that isolated cluster only; no accounts are seeded in the product.

Coverage: registration/login/email verification, hashed sessions/passwords, reset single-use/revocation, friends/recipient acceptance, persistent DMs, invite consumption, fixed role permissions, private channel access changes, slow mode, socket chat delivery/edit/reaction, reconnection history, upload signature/association/access, call ring/accept authorization, media access denial and explicit missing configuration errors, block/ban, logout and untrusted Origin denial. Source-level shell checks are **not native startup tests**.

Not covered by passing automated tests: successful media token/room creation against an actual SFU; video publishing/subscribing; screen-sharing start/stop; device failures; Windows process startup/shutdown/installer lifecycle; UI interactions/accessibility; moderation under concurrent changes. The suite has an explicit skipped media/Windows gate to avoid presenting these as tested.

## Two-user / two-network manual checklist (NOT YET EXECUTED)

Prepare Windows 10 and Windows 11 computers. Use distinct accounts **A** and **B**, distinct cameras/headsets, and separate Internet connections (for example home broadband and a mobile hotspot). Provision the public API, SFU and TURN infrastructure first. Record date, commit, installer SHA, OS builds, device models, network types, relay mode and screenshots/logs with secrets redacted.

1. Install the signed EXE on both clean machines. Check publisher, shortcuts, install directory chooser, process count, and app-data location. Open a second instance: it should focus the original. Start/close/reopen and ensure renderer/media processes terminate. Test `--disable-gpu` fallback.
2. Register, verify through real email delivery, sign in, revoke another session, reset the password and reject old sessions. Verify no tokens/passwords in logs. DND and invisible preferences must not be mistaken for actual activity detection.
3. Send/accept a friend request; initiate a DM and a group DM. Send formatted messages, attachments and replies in both directions. Restart both apps and confirm history; page back, search, edit/delete/react/pin as permitted. Test keyboard composition and Shift+Enter. Confirm unsafe link protocols cannot execute.
4. Create a server with private and public text/voice channels. Owner invites B. Confirm private ACL denial, grant/revoke, role hierarchy, timeouts, kick/ban and exhausted/expired invite rejection. Attempt requests directly as an unauthorized user, not just through hidden UI. Race a membership revocation with message send/upload/media-token request; record any leak.
5. A rings B, B declines; repeat and accept. Confirm timeout/cancel behavior and two-way **audible speech**. Record actual SFU participant/tracks. Successful signaling or a green UI is not enough.
6. Test mute/unmute, speaker selection, input selection, focused PTT, echo cancellation/noise suppression, denied permission and missing microphone. Ensure mute prevents remote audio. Unplug/replug input and output devices.
7. Both enable cameras, switch cameras, disable one camera and continue voice. Confirm genuine live movement, correct participant tiles, active speaker and bandwidth adaptation. Deny permission and unplug the camera; the call should fall back to audio gracefully. Test layout/fullscreen controls supplied by SDK.
8. Share entire screen and then an application window. B verifies continuously changing real content. Stop sharing: the remote screen track disappears and the capture indicator clears. Close the shared window; test recovery. On Windows test supported system-audio sharing separately and document exactly which capture mode works. Repeat from B to A. No prerecorded streams.
9. Force UDP blocking / relay-only media paths and prove traffic uses TURN with server/ICE diagnostics. Test TURN/TLS on restrictive networks. Measure packet loss, bandwidth, relay egress and quality. Local/LAN success does not satisfy this gate.
10. Drop A's Internet for 10–30 seconds, restore it, and verify chat history refresh, no duplicated messages, and real media reconnection. Switch networks during a call; verify clean failure/rejoin if recovery is impossible.
11. Test 3+ participants and configured room limit, group video/screen tracks, per-session cleanup, and joining from an unauthorized user. Kick/timeout an active participant. Revoke a session during a call; **currently this is a known release-blocking lifecycle gap**.
12. Test background native notifications, Windows focus assist, DND, messages in muted conversations (currently incomplete; must be fixed before passing), block behavior, friend requests and ringing. Verify sensitive content is not displayed contrary to the chosen preferences.
13. Profile Task Manager/Performance Monitor at idle, 10k-message history, audio-only, camera, screen share, repeated join/leave, and after 30 minutes. Record actual working set, CPU, GPU and handle counts per process. Look for leaks and lingering captures. No fixed RAM claim.
14. Upgrade with a second signed installer; retain settings and server history; reject untrusted update links. Uninstall, verify shortcuts removal, document retained/deleted user data. Reinstall and re-authenticate as needed.
15. Restore a backup into isolated staging and validate messages and authorized files. Complete a security review and dependency-advisory triage.

## Performance observation in this sandbox

Only build sizes and a point-in-time Linux backend process RSS sample are recorded in STATUS.md/verification notes. No desktop CPU/RAM guarantee or two-network latency is established. The lazy LiveKit chunk is approximately 699 kB uncompressed / 190 kB gzip at the initial successful build; Vite warns about its size. Message DOM is virtualized, but client history retention and server substring search need stress testing.
