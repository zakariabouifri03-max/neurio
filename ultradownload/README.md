# UltraDownload

**A professional Windows download manager that splits very large files
(40 GB, 80 GB games and more) into up to 40 byte ranges and downloads all
of them at the same time over separate HTTP connections.**

Built with Python 3.12 / PySide6, packaged into `UltraDownload.exe` with
PyInstaller. Real engine, real sockets, real files — no mockups, no fake
progress bars.

```
┌────────────────────────────────────────────────────────────────────┐
│  URL ──▶ Inspector (HEAD/1-byte probe, no body download)            │
│        ──▶ Byte-range planner (exact, gapless, non-overlapping)     │
│        ──▶ 40 part workers (threads) ──▶ preallocated .udpart file  │
│        ──▶ verify size + optional checksum ──▶ atomic os.replace()  │
└────────────────────────────────────────────────────────────────────┘
```

---

## Features

### Parallel download engine
* **Up to 40 simultaneous range workers per file** (1 / 4 / 8 / 16 / 24 /
  32 / 40 selectable; default 40). All workers start together and every
  part progresses independently — part 2 never waits for part 1.
* **Correct HTTP Range math**: inclusive endpoints (`Range: bytes=0-…`),
  exact coverage (every byte exactly once, no gaps, remainder handled),
  64-bit-safe offsets (files far beyond 4 GiB verified end-to-end).
* **Zero-duplication storage**: parts write *in place* into one
  preallocated temporary file (`<name>.udpart`) through per-worker file
  handles. No post-download merge copy → the extra disk space needed is
  exactly the file size (reported in the UI/logs before starting).
* **Bounded memory**: 256 KiB chunks streamed straight to disk; an 80 GB
  game never lives in RAM. ~10 MiB for 40 workers.
* **Strict response validation**: status codes, `Content-Range`
  (first/last/total), `Content-Length` consistency; a server that ignores
  `Range` (answers 200 to a ranged GET) is detected immediately and the
  engine **falls back to a single connection** — it never writes the whole
  file into every part.
* **Adaptive concurrency**: if a server pushes back with bursts of
  429/503/connection resets, active connections are halved (min 2) and the
  UI explains that the requested connection count could not be maintained.
* **Retries with exponential backoff + jitter**, honouring `Retry-After`;
  permanent errors (401/403/404/410, bad responses) are *not* retried
  endlessly.
* **Pause / Resume / Cancel / Retry**:
  * pause stops workers at the next chunk boundary and persists every
    part offset;
  * resume re-validates the remote file (size/ETag/Last-Modified) and
    requests only each part's *remaining* range, verifying the returned
    `Content-Range` before appending;
  * cancel asks whether to keep or delete partial data (configurable
    auto-cleanup);
  * retry re-runs **only failed parts** — completed parts are kept.
* **Speed limits**: per-download and global token-bucket limiters
  (0 = unlimited).
* **Integrity (Step D)**: every part must be complete and the assembled
  size must match; optional MD5/SHA-1/SHA-256/SHA-512 verification;
  `fsync`; **atomic rename** to the final name. Nothing is ever marked
  complete with missing/corrupt parts; on failure the valid temp data is
  preserved for resume.
* **Crash recovery**: SQLite (WAL) stores URLs, sizes, ranges, per-part
  progress, statuses and settings. After a forced shutdown the app
  validates temp files on start and restores recoverable downloads as
  *Paused*.

### Queue & multi-file
* Multiple simultaneous files (configurable limit), priority ordering,
  per-download speed limits + global bandwidth cap, pause-all /
  resume-all, queue persistence across restarts.

### Professional dark GUI (PySide6)
* **Dashboard** – total speed, total downloaded, active/completed counts,
  free disk space, live download cards, queue.
* **Add Download** – URL field with live validation, background server
  inspection (size / type / range-support badge), destination browser,
  optional filename, part-count selector (auto-disabled with a clear
  explanation when the server has no range support), optional checksum,
  headers, per-download limit and priority.
* **Download Details** – overall %, downloaded/remaining, speed, ETA,
  active connections, and a **grid of all 40 parts** with per-part
  progress bar, byte range, downloaded bytes, speed and status; plus an
  event log.
* **History** – completed/failed/cancelled records with *open location*,
  *restart* and *remove* actions.
* **Settings** – default folder, max simultaneous downloads, default
  parts, timeouts, retries, global speed limit, start-minimized, accent
  theme (purple/blue), temp-file cleanup with confirmation.

### Safety & correctness
* Filenames sanitized (path traversal, Windows reserved names, illegal
  characters); existing files are **never overwritten without explicit
  permission** (Overwrite / Keep-both / Cancel dialog).
* Credentials (Authorization/Cookie headers) are kept in memory only —
  never written to the database or logs (values are redacted).
* Downloaded files are **never executed automatically**; opening a folder
  or launching a file is always an explicit, confirmed user action.
* The tool only fetches what the server offers publicly to the client; it
  does not bypass DRM, paywalls or access controls.

---

## Project layout

```
ultradownload/
├── ultradownload/            # application package
│   ├── models.py             # tasks, parts, statuses (Qt-free)
│   ├── ranges.py             # byte-range math + Content-Range parsing
│   ├── speed.py              # sliding-window speed + token-bucket limiters
│   ├── inspector.py          # Step A: cheap URL inspection
│   ├── engine.py             # Steps B–D: parallel engine (Qt-free)
│   ├── db.py                 # SQLite persistence (WAL)
│   ├── manager.py            # queue/scheduler + Qt signal bridge
│   ├── main.py               # entry point (GUI)
│   └── gui/                  # theme, main window, pages, dialogs
├── tests/                    # 250+ automated tests + local range server
│   └── range_server.py       # RFC-7233 test server w/ 15 failure modes
├── tools/make_icon.py        # regenerates assets/icon.png + icon.ico
├── assets/                   # icon.png, icon.ico, version_info.txt
├── requirements.txt          # runtime deps
├── requirements-dev.txt      # pytest / pyinstaller / pillow
├── build.bat                 # Windows packaging (venv + PyInstaller)
├── run.bat                   # run from source on Windows
├── UltraDownload.spec        # onedir PyInstaller config (recommended)
└── UltraDownload-onefile.spec# single-exe PyInstaller config
```

---

## Run from source

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m ultradownload            # or: python -m ultradownload.main
```

Windows users can simply double-click **`run.bat`**.

## Build UltraDownload.exe (Windows)

```bat
build.bat            # → dist\UltraDownload\UltraDownload.exe  (onedir)
build.bat --onefile  # → dist\UltraDownload.exe                (single file)
```

The script creates a private virtualenv, installs dependencies and runs
PyInstaller with the bundled icon and Windows version-info resource.
Onedir is recommended (instant start); ship the whole
`dist\UltraDownload` folder. The resulting EXE needs **no Python
installation** on the target machine and runs on Windows 10 & 11.

> **Non-Windows build environments:** PyInstaller can only produce Windows
> executables *on Windows*. Everything else (source, tests, specs, icons,
> version info) is included here and the engine/GUI are fully tested on
> Linux; run `build.bat` on any Windows 10/11 machine to produce and smoke
> test the EXE.

## Automated tests

```bash
pip install -r requirements-dev.txt
python -m pytest                 # 251 tests, ~90 s, no internet needed
```

The suite drives the **real engine over loopback HTTP** against
`tests/range_server.py` (a threaded RFC 7233 server with modes for: no
range support, bad `Content-Range`, truncated bodies, 401/404/429/5xx,
throttling, redirects, zero-byte files, missing Content-Length, and a
*barrier mode* that refuses to serve until all N part connections are
open simultaneously — proving true concurrency).

Coverage highlights:

| Area | Test |
|---|---|
| exact/gapless/ordered ranges, 64-bit & >4 GB sizes | `test_ranges.py` |
| concurrent start of all parts (barrier + timestamp overlap) | `test_engine.py::TestConcurrency` |
| independent per-part progress | `test_engine.py::TestConcurrency` |
| progress/ETA/speed accuracy (real bytes) | `test_engine.py::TestProgress` |
| Range-ignored fallback to single stream | `test_engine.py::TestRangeIgnoredFallback` |
| invalid Content-Range / truncated responses | `test_engine.py::TestBadResponses` |
| pause / resume / cancel / retry (incl. cross-restart resume) | `test_engine.py::TestPauseResumeCancel` |
| checksum pass/fail, overwrite protection, permission & disk errors | `test_engine.py::TestAssembly` |
| zero-byte & unknown-size files | `test_engine.py::TestParallelDownload` |
| speed limits | `test_engine.py::TestSpeedLimit` |
| SQLite round-trips, WAL, 64-bit offsets, no secrets stored | `test_db.py` |
| queue limits, priority, pause/resume-all, crash recovery | `test_manager.py` |
| GUI end-to-end (dashboard, details grid, dialogs, settings) | `test_gui_smoke.py` |
| 5 GiB end-to-end download with 40 parts (opt-in) | `test_large_file.py` |

Opt-in multi-gigabyte run (needs ~6 GB free disk):

```bash
RUN_LARGE_FILE_TESTS=1 python -m pytest tests/test_large_file.py -s
# e.g. "5.12 GiB downloaded in 12.1s (452 MB/s, 40 parts)" on loopback
```

## Configuration & data locations

* Database, settings and logs: `%APPDATA%\UltraDownload\`
  (`~/.config/UltraDownload` on Linux/macOS).
* Temporary part files: `<destination>\<filename>.udpart`.
* Log file: `ultradownload.log` (rotating, credentials redacted).

## Honest performance notes

* 40 connections are **not a guarantee of 40× speed**: your bandwidth, the
  server's per-connection throttling and its concurrent-connection policy
  decide. If a server performs better with fewer connections, pick fewer
  parts — the UI says so.
* Servers that limit concurrency will see UltraDownload reduce its active
  connections automatically and report it in the log/Details view.
* The temporary file needs the same free space as the final file (it *is*
  the file being written); no second copy is created during assembly.

## Version

1.0.0 — see `assets/version_info.txt` (embedded in the EXE properties).
