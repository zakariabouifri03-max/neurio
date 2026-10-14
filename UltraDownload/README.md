# UltraDownload

A real Python/PySide6 desktop download manager for Windows, with bounded parallel HTTP transfers, SQLite recovery state, a virtualized chunk inspector, and a reproducible Windows packaging workflow. The existing browser game at the repository root is unchanged.

**Version:** 1.0.0 · **Python:** 3.12 recommended (3.11 compatible) · **Platform target:** Windows 10/11 x64

**[Download the verified Windows EXE (ZIP)](https://github.com/zakariabouifri03-max/neurio/actions/runs/38536392228/artifacts/11880705546)** — 67 Windows tests passed; packaged EXE launch passed. See [validation, checksum, and release limitations](VALIDATION.md). GitHub sign-in may be required; artifact retention is 30 days.

## Run from source

```bat
cd UltraDownload
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python main.py
```

No administrator rights are needed. Choose a writable destination. Only direct HTTP/HTTPS file links are supported—not web pages, magnet links, DRM-protected content, or browser login flows. TLS certificate verification is always enabled. HTTP sources are allowed and are not automatically upgraded to potentially nonexistent HTTPS endpoints.

On Linux, create a Python virtual environment, install the same requirements, and run `python main.py`. Qt needs native libraries (`libgl1`, `libegl1`, `libxkbcommon0`, `libdbus-1-3`, plus the XCB libraries for an X11 desktop). For actual downloads, Linux also needs an unlocked Secret Service keyring/session D-Bus; macOS uses Keychain. Headless tests use an explicitly injected in-memory test vault, never a production plaintext fallback.

## Build the Windows EXE

Run **`build.bat` on Windows with Python 3.12 x64 installed**. It:

1. Creates a project-local virtual environment and installs pinned direct dependencies.
2. Runs the entire pytest suite, including offscreen GUI and Windows credential-store tests.
3. Smoke-tests the source application.
4. Packages a real, windowed, one-file `dist\UltraDownload.exe` using PyInstaller.
5. Launches the EXE in smoke-test mode and fails the build if it cannot exit successfully.
6. Prints the EXE's SHA-256.

End users need only the EXE, not Python. One-file bundles extract their runtime to a temporary folder on launch. The executable has an application icon, version metadata, and **no administrator manifest**. It is unsigned; Windows SmartScreen may warn. A public release should be Authenticode-signed by its publisher. Never disable antivirus to run an untrusted binary.

The GitHub Actions workflow **UltraDownload Windows** (`.github/workflows/ultradownload-windows.yml`) builds on `windows-2022` and uploads **UltraDownload-Windows-x64** containing the EXE, its checksum, README, and resolved dependency versions. Linux CI independently runs engine and GUI tests. Artifacts expire after 30 days. Direct dependencies are pinned; the artifact records transitive versions for exact environment reconstruction. Builds are reproducible by process, not promised bit-for-bit identical or hermetically locked.

**Validation boundary:** A Windows Server CI build/smoke test is not interactive Windows 10/11 certification. PyInstaller cannot cross-compile a Windows EXE on Linux. Before release, perform the manual Windows 10 and Windows 11 checklist below. See `VALIDATION.md` for the latest recorded execution results.

## Use

1. Select **Add download**, paste a direct URL, and select **Inspect source**.
2. Review the discovered name, size, and real range support. Choose a destination and filename. Existing files are never overwritten.
3. Optionally paste a SHA-256 from an independently trusted publisher. A hash computed by UltraDownload alone is only an identifier, not proof of authenticity.
4. Start the download. For non-range servers, explicitly confirm the clearly labeled **single-stream fallback**. Unknown-length single streams are supported, without a meaningful percentage until their size becomes known.
5. Select a row for actual received bytes, recent speed, ETA, connection count, chunk counts, and destination. **Show chunks** opens a virtual table; it does not allocate one widget per chunk.
6. Pause/resume, retry failed work, cancel and choose to keep/delete temporary data, or open the containing folder. Downloaded executables are **never launched automatically**.
7. Use **Move to queue top** to prioritize queued files. Pause/resume all affects active/paused/interrupted items; failed and cancelled entries require an explicit retry/resume.
8. If the resource changes, the transfer fails safely. **Restart from source** re-inspects it and deletes only its own saved chunks after confirmation through the restart dialog. Supply a new trusted checksum if the file version changed. Expired links can be added again with a fresh URL and a different destination name.

## Transfer and integrity contract

- `CHUNK_SIZE = 1_048_576` exactly. Inclusive ranges are `[i * CHUNK_SIZE, min((i+1)*CHUNK_SIZE-1, N-1)]`.
- The final chunk contains only remaining bytes. Empty files have **zero** chunks. Integer arithmetic supports offsets beyond 4 GiB.
- Up to **10 active chunk workers per file**, default 10. The scheduler keeps only the configured number of futures, starts pending work as soon as a worker finishes, and never submits a full file's chunk list to an unbounded executor queue.
- Defaults: 2 simultaneous files, 20 global connections. All file requests and UI inspections share the manager's global semaphore. There is no guarantee that 10 connections outperform one.
- HEAD gathers metadata when available; a streamed one-byte GET verifies actual range behavior. Inspections never buffer the remote file. Non-range responses are closed without downloading their bodies.
- Every range response must be HTTP 206 with an exactly matching `Content-Range`, compatible length, identity encoding, and unchanged validators when supplied. HTTP 200 is **never** accepted as a range chunk. Invalid headers are rejected before opening a chunk output stream. Truncated bodies are never committed.
- Transfers use 64 KiB buffers. `.tmp` chunks are flushed, fsynced, size-checked, SHA-256 recorded, atomically renamed to `.part`, then marked complete in SQLite. Each chunk has only one worker.
- Retries are bounded exponential backoff with jitter (up to 60 seconds for the exponential component). HTTP 429 and selected transient statuses honor `Retry-After`, even when longer. Pausing interrupts backoff. Permanent 401/403/404 responses are not repeatedly retried.
- A shared connection semaphore bounds all files; global and per-file bandwidth pacing is measured in bytes, not fake progress. Limits use bounded buffers and may undershoot the configured maximum.
- Resume re-inspects the original URL, checks size and validators, verifies the manifest, and re-hashes recorded local chunks. Same-size corruption is detected. Only affected chunks are redownloaded. Safe partial continuation uses a validated range beginning at the saved offset and strong ETag or Last-Modified preconditions.
- If no usable remote validator exists, **saved chunks are restarted on resume** rather than trusting potentially mixed versions. A server that changes bytes without changing its validators cannot be reliably detected without a trusted final checksum.
- A single-stream fallback uses one temporary stream, not fictitious range chunks. Incomplete single streams restart from zero. It supports retry/cancel/recovery but not resumable byte-range continuation.
- Pause is cooperative: no new chunks are scheduled, active streams stop between buffers, and completion waits for consistent state. A stalled socket can take up to the configured connect/read timeout to stop. Pausing during revalidation or assembly is also supported.
- Assembly streams verified chunks in numeric order into an application-owned staging file, checks per-chunk digests and final size, computes SHA-256, and compares a supplied checksum before atomic, **no-overwrite** publication. Missing/corrupt chunks prevent completion.
- Publication intent is persisted before renaming. After a crash between publication and marking complete, recovery identifies the final file by its stored hash instead of overwriting it.

### Disk space and performance

Temporary files live in `<destination-folder>/.ultradownload/<UUID>/`, ensuring staging and final output are on the same volume. `manifest.json` contains identity, size, mode, chunk size, and destination, **not URLs or authentication secrets**. Numbered files live in `chunks/`.

The initial implementation uses separate chunk files plus assembled output: allow up to **2× the file size** in free space at the beginning (about 200 GiB for a 100 GiB file), plus a small reserve. Existing valid chunks are accounted for on resume. Chunks are removed after successful publication by default. Keeping completed temporary data is configurable. Unknown-length transfers cannot have a reliable upfront disk-space estimate; disk-write failures stop them safely.

Only one assembled output is created; no extra final copy is made during atomic publication. Revalidation hashes saved chunks once per resume; assembly hashes while streaming. GUI progress does not read/hash payload files. Metadata is proportional to chunk count, but outstanding futures, network buffers, and visible GUI rows are bounded. Hashing and assembling 100 GiB still require substantial disk I/O; the GUI runs independently.

## State, privacy, and recovery

Settings and SQLite are per-user, never in the installation directory:

- Windows: `%LOCALAPPDATA%\UltraDownload\`
- Linux/macOS source fallback: `~/.local/share/UltraDownload/`

SQLite uses WAL mode, transactions, and FULL synchronization. It records file identity, status, size, validators, output hash, priorities, limits, chunk state, retry counts, partial lengths, and chunk hashes. A process lock prevents two application instances from using the same state concurrently.

Original and resolved URLs are stored in **Windows Credential Manager** (Secret Service / Keychain on other supported desktops), not plaintext SQLite or JSON. The production backend is explicitly selected; there is no fallback to plaintext. If the OS store cannot accept a URL, adding the download fails safely. Browser cookies and arbitrary authentication headers are intentionally not implemented. Embedded `user:password@host` URLs are rejected. HTTP errors are sanitized to avoid putting signed URLs into error/history text.

After a crash, in-progress entries become **Interrupted**, not automatically restarted. The UI offers Resume and revalidates saved files before reusing them. Startup dashboard bytes are last-saved metadata estimates until resume verifies disk contents. Corrupt/missing manifests cause a safe failure; use Restart from source. Never manually edit the database or temporary files during a transfer.

Cancelled entries remain in history. Cleanup verifies UUID ownership and refuses unowned/symlinked temporary roots. It never removes the final output or arbitrary paths. Destination filenames are sanitized against traversal and Windows device names.

## Tests

```bat
.venv\Scripts\python -m pytest -q
```

For Linux headless Qt: `QT_QPA_PLATFORM=offscreen python -m pytest -q`.

The local `ThreadingHTTPServer` supports HEAD, 206, validators, delays, delayed chunk zero, transient statuses, rate-limited connection counts, truncated responses, invalid range headers, ignored ranges, and unknown lengths. It records real active requests and their start/end times.

Tests cover chunk math through 100 GiB, exact coverage, final partial/empty files, **exactly ten real concurrent requests**, replacement scheduling before a slow initial chunk finishes, bounded futures, the global limit across files, actual assembled bytes, pause/partial resume, cancellation ownership, bounded retry/manual retry, 429 delay, range lies, fallback, corruption repair, missing files, changed remote validators, process/database restart, publication-window recovery, trusted-checksum comparison, disk/permission failures, filenames, and Qt dialogs/virtualized models/queue ordering. Windows adds a real Credential Manager round-trip. Fixtures use small deterministic payloads, not 100 GiB test artifacts.

### Manual Windows release checklist (not implied by automated CI)

- [ ] On clean Windows 10 x64 and Windows 11 x64, run the EXE without Python or admin privileges.
- [ ] Inspect and download an authorized HTTPS file larger than 4 GiB; compare its publisher-provided hash.
- [ ] Verify 10 connections on a capable server, smaller final chunk, and global cap across two files.
- [ ] Pause, exit, relaunch, resume; then force-terminate during transfer and repeat recovery.
- [ ] Disconnect/reconnect the network; verify bounded retries and retained valid chunks.
- [ ] Try a non-range server, an expired link, a bad checksum, a full disk, and a read-only destination.
- [ ] Verify Unicode paths, 125–200% display scaling, resizing, dark theme, and folder opening.
- [ ] Sign the release binary and verify publisher identity/signature on both Windows versions.

## Troubleshooting

- **Build cannot find Python:** install Python 3.12 x64 including the `py` launcher. Python is needed only on the build machine.
- **Credential-store error:** unlock/sign in to the OS credential store. Do not install a plaintext keyring backend. Very long signed URLs may exceed OS credential size limits.
- **HTTP 401/403/404:** obtain an authorized, fresh direct link. UltraDownload does not bypass access restrictions.
- **Range no longer supported / resource changed:** inspect again using Restart from source. Do not manually concatenate saved chunks from different versions.
- **Destination conflict:** choose a different name. Atomic publication refuses races with files created by other applications.
- **Insufficient space:** free space for both chunks and output, or choose another destination before adding the file.
- **Checksum mismatch:** output is not published. Verify the trusted reference/source. Retrying intentionally retains locally valid chunks; to redownload everything, use Restart from source.
- **GUI library import failure on Linux:** install native Qt prerequisites; this does not diagnose Windows support.
- **Damaged settings JSON:** exit the app, back up the per-user directory, and rename only `settings.json`; defaults will be recreated.

## Modules

`models.py` (range math), `http_client.py` (inspection/validation/pacing), `chunk_scheduler.py` (bounded futures), `download_engine.py` (transfer/recovery/retry), `assembler.py` / `integrity.py` (verification/publication), `database.py` (SQLite + secure URL vault), `file_utils.py` (owned paths), `download_manager.py` (queue/global controls), `main_window.py` / `dialogs.py` / `ui_models.py` / `theme.py` / `signals.py` (Qt), `settings.py`, `tests/`, and Windows packaging files.
