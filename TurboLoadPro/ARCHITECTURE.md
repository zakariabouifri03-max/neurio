# Architecture and transfer invariants

## Transfer state machine

```text
Queued → Probing → Downloading → Completed
                    ├→ Paused → Queued
                    ├→ Failed → Queued (retry)
                    └→ Cancelled → Queued (retry/restart)
```

- The manager owns scheduling and changes the public status. The engine owns HTTP/disk transfer and only marks `Completed` after validation and finalization.
- Every worker has a disjoint inclusive segment. `BytesReceived` is advanced only after a disk write completes; checkpoints flush the part file before SQLite snapshots are committed.
- Resumed range work requires the exact saved segment plan, file length, byte sum, total size and stable representation validator. Any mismatch resets partial data instead of guessing.
- `If-Range` is used with ETag or Last-Modified. Every 206 response must contain a correct `Content-Range`; a 200 response to a range request cancels sibling workers and triggers a clean ordinary GET.
- A temporary file is opened with random-access semantics and preallocated to the known length. Each range uses `RandomAccess.WriteAsync` at its absolute offset; RAM usage is bounded by connection count × configured read buffer.
- Final move uses `overwrite: false`. Existing user files are preserved; a collision gets a numbered name.

## Persistence boundaries

SQLite stores download identity, status, URL, destination, validators, progress and segments. Writes are serialized and each download + its segment rows are committed in one transaction. The app recovers records that were `Probing`/`Downloading` after an unclean exit; whether queued records auto-resume is user-configurable. Explicitly paused rows are not auto-resumed.

Settings use an atomic JSON temp-file replace. Diagnostic logging records no URLs, query values, HTTP response bodies or exception messages; it records event name, item ID, exception type and HTTP status.

## UI / integration boundaries

The WPF window observes immutable snapshots and never performs HTTP or file hashing on the dispatcher. Clipboard polling is disabled by default; when enabled, only one direct HTTP(S) string is considered and the user must press **Import**. Browser handoff is the per-user `turbload:` protocol or `--url` argument; the sample Chromium helper has a single context-menu permission and no background history collection.

## Current verification boundary

The transfer tests are source-complete and run against a local TCP test server. This development sandbox has no .NET SDK and is Linux, so this branch has not produced or executed the Windows WPF binary here. A Windows .NET 10 build is the final verification step; use `build.ps1` or the included Windows Actions workflow.
