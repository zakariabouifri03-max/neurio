# UltraDownload — Professional Windows Download Manager

UltraDownload is a real, functional desktop download manager for **Windows 10/11**
built with **Python 3.12+** and **PySide6**. It is designed for very large files —
PC games of 40 GB, 80 GB or more.

**The core feature is genuine parallel downloading:** when you paste a direct
download URL, UltraDownload inspects the file and splits it into up to **40
logical byte ranges** (1, 4, 8, 16, 24, 32 or 40). All parts start **at the
same time** and download simultaneously over separate HTTP connections
whenever the server supports HTTP Range Requests (RFC 9110).

```
 ┌────────────────────────────────────────────────────────────┐
 │  Part 1   ████████████░░░░░░░░   12.4 MB/s                 │
 │  Part 2   ██████████████░░░░░   13.1 MB/s                  │
 │  …        (all 40 workers run concurrently)                │
 │  Part 40  ██████████░░░░░░░░░   11.8 MB/s                  │
 └────────────────────────────────────────────────────────────┘
```

---

## Features

### Parallel download engine
- Splits files into 1–40 byte-range parts; **every part starts concurrently**
  (thread pool sized to the part count — proven by an automated overlap test).
- Streams each chunk straight to disk — **never loads the file into RAM**
  (bounded 64 KiB buffers, so 80 GB games work on modest memory).
- Validates every `206` response's `Content-Range` before appending a byte.
- Confirms received byte counts match the expected range length.
- Detects servers that **ignore Range headers** and safely falls back to a
  single-stream download, clearly reporting that the requested number of
  connections could not be maintained.
- Configurable exponential-backoff retries for transient failures
  (timeouts, HTTP 408/429/5xx, dropped connections, truncated responses).
- 64-bit-safe offsets — files larger than 4 GiB are fully supported (covered
  by automated tests).

### Full download control
- **Pause** — stops transfers safely, keeps all partial data, persists state.
- **Resume** — continues from saved byte positions after re-validating that
  the remote file (size/ETag) is unchanged; requests only the remaining range.
- **Cancel** — stops workers and lets you keep or delete temporary data.
- **Retry** — retries only failed parts; completed parts are never re-fetched.

### Queue & multiple files
- Multiple downloads in a persistent queue with configurable simultaneous
  downloads, per-download part counts, per-download speed limits and a global
  bandwidth limit (token bucket).
- Priority ordering (▲/▼), pause-all / resume-all.
- Queue and progress survive application restarts and crashes.

### Safety & integrity
- Optional checksum verification (MD5/SHA-1/SHA-256/SHA-512) during assembly.
- Atomic finalization: parts are assembled into a temp file, verified
  (size + checksum), then atomically renamed with `os.replace`.
- If assembly fails, **valid temporary parts are preserved** — no re-download.
- Never overwrites existing files without explicit permission.
- Filenames from servers are sanitized (path traversal, Windows reserved
  names like `CON`, invalid characters).
- Downloaded files are **never executed automatically**.
- Auth headers/cookies you provide are kept **in memory only** and never
  written to the database or logs.
- Supports only content you are authorized to download; it does not bypass
  DRM, paywalls or access controls.

### Professional dark UI
- Dark charcoal theme with blue or purple accents (switchable), rounded
  panels, animated progress bars, live per-part status grid.
- **Dashboard** — total speed, total downloaded, active/completed counts,
  free disk space, active download cards, queue with priorities.
- **Add Download** — URL validation, folder picker, custom filename,
  part-count selector (1–40, default 40), optional checksum, optional
  auth headers, live URL inspection (size, MIME, range support).
- **Download Details** — progress %, downloaded/remaining, speed, ETA, active
  connections, Pause/Resume/Cancel/Retry, and a grid of **all parts** each with
  its own progress bar, status, byte counts and live speed.
- **History** — completed/cancelled/failed downloads with Open Folder and
  Restart actions.
- **Settings** — default folder, simultaneous downloads, default parts,
  timeouts, retries, speed limit, start minimized, theme/accent, temporary
  file cleanup with confirmation.

---

## Project layout

```
ultradownload/
├── __main__.py            # python -m ultradownload
├── app.py                 # QApplication bootstrap
├── config.py              # settings model (persisted in SQLite)
├── manager.py             # download queue, scheduling, crash recovery
├── utils.py               # filename sanitization, formatting, redaction
├── engine/                # Qt-free download engine (fully unit-tested)
│   ├── ranges.py          # byte-range math (exact coverage, no overlap)
│   ├── inspector.py       # HEAD/probe-GET URL inspection
│   ├── task.py            # parallel workers, pause/resume/cancel/retry
│   ├── merger.py          # assembly, checksums, atomic rename
│   ├── bandwidth.py       # token-bucket speed limits
│   ├── speed.py           # sliding-window speed metering
│   └── errors.py          # typed transient/permanent errors
├── storage/
│   └── database.py        # SQLite: downloads, parts, settings, recovery
└── gui/                   # PySide6 interface (dark theme)
    ├── main_window.py
    ├── theme.py           # QSS stylesheets
    ├── widgets.py
    └── pages/             # dashboard, add, details, history, settings

tests/                     # automated tests + local Range HTTP test server
assets/                    # application icon (.png / .ico)
requirements.txt           # runtime dependencies
requirements-dev.txt       # + pytest, pyinstaller, pillow
build.bat                  # one-command Windows build
UltraDownload.spec         # PyInstaller configuration
file_version_info.txt      # Windows version resource
```

---

## Running from source

```bash
python -m venv .venv
# Windows:  .venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt
python -m ultradownload
```

Python **3.12+** is recommended (3.10+ works).

---

## Building UltraDownload.exe (Windows)

> **The Windows executable must be built and tested on Windows.**
> PyInstaller produces binaries for the OS it runs on; this repository
> includes everything needed, but run the build on a Windows 10/11 machine
> with 64-bit Python 3.12+ installed.

```bat
build.bat
```

This will:

1. create a virtual environment,
2. install `requirements.txt` + PyInstaller,
3. run the full automated test suite (build aborts if tests fail),
4. invoke PyInstaller with `UltraDownload.spec`,
5. produce **`dist\UltraDownload.exe`** — a single, windowed executable with
   the application icon and version resource embedded. Users do **not** need
   Python installed.

Manual build:

```bat
pip install -r requirements.txt pyinstaller pillow
pyinstaller --clean --noconfirm UltraDownload.spec
```

Test the resulting executable on both Windows 10 and Windows 11 before
distributing it.

---

## Automated tests

The test suite includes a **local HTTP test server with full Range support**
plus fault-injection modes (Range ignored, wrong `Content-Range`, truncated
responses, HTTP 500/429, auth, slow drip feeds). No external websites are
used. Run:

```bash
pip install -r requirements-dev.txt
python -m pytest tests -q
```

Covered scenarios include:

| Area | Tests |
|---|---|
| Range math | exact coverage, no overlap, remainder handling, >4 GiB offsets, part count > file size |
| Concurrency | a barrier-locked server proves **all parts are in flight at once**; request windows overlap in time |
| Progress | real byte counts, aggregated multi-part progress, speed/ETA |
| Pause/Resume | partial data preserved, resume requests only remaining ranges, remote-change detection |
| Cancel | keep or delete temporary data |
| Retry | transient 500s/429s retried with backoff, `Retry-After` honored, bounded retries, failed-part-only retry |
| Server quirks | Range ignored → safe single-stream fallback, invalid `Content-Range` rejected, truncated responses recovered or failed cleanly |
| Files | zero-byte files, unknown size (chunked), >4 GiB (opt-in `UD_RUN_LARGE=1`), checksum verification, atomic assembly |
| Recovery | crash simulation → queue/part state restored from SQLite |
| Security | filename sanitization, path traversal, credential redaction, no secrets in DB |
| Disk/permissions | insufficient space rejected, permission errors surfaced |
| GUI | offscreen smoke tests for every page, live updates, theming |

Large-file test (writes ~4 GiB through loopback — needs disk space):

```bash
UD_RUN_LARGE=1 python -m pytest tests/test_large_files.py -q
```

---

## Using UltraDownload

1. **Add Download** — paste a direct URL (e.g. a game ISO or installer),
   pick the folder, optionally set a filename, part count and checksum,
   then click **Check URL** (to inspect) or **Start Download**.
2. Open **Details** to watch every part download live.
3. Use **Pause / Resume / Cancel / Retry** as needed — progress is saved.
4. Find finished downloads under **History** (Open Folder / Restart).
5. Tune limits and appearance in **Settings**.

Tips:
- 40 parts is the default for large files, but some servers/CDNs perform
  better with fewer connections — adjust per download if needed.
- If the server ignores Range requests, UltraDownload automatically uses a
  single stream and tells you so.
- Keep at least as much free disk space as the file size during the final
  assembly step (parts are deleted after successful assembly).

---

## Data storage

- Database: `%LOCALAPPDATA%\UltraDownload\ultradownload.sqlite3` (Windows),
  `~/.local/share/UltraDownload/` on Linux.
- Log file: next to the database (`ultradownload.log`) — credentials are
  redacted in all log output.
- Temporary parts: `<destination>\.ultradownload\<id>\part_*.part` — removed
  automatically after successful assembly (configurable).

## License

Provided as-is for authorized downloads only. You are responsible for
complying with the terms of service of any content you download.
