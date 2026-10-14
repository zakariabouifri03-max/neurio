# Verification record and release checklist

## Executed in this development session

Date: **2026-10-14**. Host: **Linux**, Python **3.11.2**, HTTPX **0.28.1**, PySide6 **6.8.3**, pytest **8.3.5**.

| Check | Result |
|---|---|
| Full pytest suite | **52 passed**; no skipped or expected-failure tests |
| Real PySide6 launch (`main.py --smoke-test`) | Passed, Qt offscreen platform |
| GUI-driven URL inspection → start → verified completion | Passed |
| Source-app end-to-end self-test (`main.py --self-test`) | Passed; report below |
| Ruff undefined-name/unused-import checks | Passed |
| Python compilation and spec/version-file syntax checks | Passed |
| Actual Windows PyInstaller build | **Not run on this Linux host** |
| Packaged Windows EXE launch/transfer | **Not run**; automated steps are provided |
| Interactive Windows 10 / Windows 11 validation | **Not run** |
| Physical 40–100 GiB WAN transfer | **Not run**; large-offset arithmetic is tested without allocating such files |

The local test server uses real TCP sockets and HTTP Range responses. The engine is not replaced by mocks. Tests use small deterministic byte sequences, including unique chunk contents that detect out-of-order or duplicate assembly. Disk-space/permission faults are injected at the filesystem boundary so the tests remain repeatable even under privileged CI accounts.

The source end-to-end test downloaded and verified:

```json
{
  "passed": true,
  "bytes": 12582922,
  "sha256": "120553f1c9e7c79db6d2ecc1fcf0d20d083603fbfc02d3301b5c64952e489913",
  "peak_requests": 10,
  "max_submitted": 10
}
```

This report is from **source execution**, not a Windows EXE. The same self-test module is included in the packaged application; the Windows build verification script requires a new passing report from the actual EXE.

### Reproduce

From `UltraDownload/`, using an environment with the required Qt native libraries:

```bash
python -m pytest -q
python -m pytest tests/test_parallel_downloads.py -s -q
python main.py --smoke-test --data-dir /path/to/disposable/profile
python main.py --self-test source-self-test.json
```

On headless Linux, set `QT_QPA_PLATFORM=offscreen` before pytest and launch checks. The sandbox needed additional native Qt runtime libraries; those environment-only libraries are **not bundled in the source project**. The README lists the standard distribution packages for a normal Linux development machine.

Optional source linting:

```bash
python -m pip install ruff==0.11.13
ruff check . --select F
ruff format --check .
python -m compileall -q app tests main.py
```

## Automated coverage

| Test module | Verified behavior |
|---|---|
| `test_chunk_ranges.py` | Inclusive endpoints, exact byte coverage, non-overlap, empty/small/exact/final-tail files, arithmetic beyond 4 GiB and 100 GiB |
| `test_parallel_downloads.py` | A server-side gate observes all ten first workers; peak request count and submitted futures equal ten; a replacement starts before slow first-wave workers finish; byte equality and bounded progress; zero-byte output |
| `test_pause_resume.py` | Consistent pause, completed chunk reuse, cancellation with owned-temp-only deletion |
| `test_retry.py` | 500/503 recovery, truncated body recovery, Retry-After/429 cooldown, server concurrency rejection, bounded read-timeout retry, permanent 404 failure, retry exhaustion |
| `test_assembly.py` | Missing, short, and same-size-corrupt chunks prevent successful assembly |
| `test_integrity.py` | Supplied-checksum mismatch prevents publication; SHA-256 input validation |
| `test_recovery.py` | New DB connection recovery, corrupt saved chunks, changed ETag, altered manifest, publication crash window, **actual child-process kill and recovery**, weak ETag/date changes, no-validator redownload policy, no per-chunk rewriting of a fresh plan |
| `test_http_and_disk.py` | Unsupported HEAD, ignored ranges, known/unknown-size single-stream fallback, wrong Content-Range, secret-query non-persistence, existing targets and publication races, disk-space/permission faults, filename/URL/cleanup safety, HTTP-date Retry-After |
| `test_manager.py` | Global connection cap across two files, file queue bound, pause all, priorities, persistent history, real elapsed bandwidth limiting, cancellation without stale throttle reservations |
| `test_gui.py` | Real widgets, async inspection, enabled-state validation, actual download/Qt progress delivery/completion, chunk model, filters, settings, invalid URL feedback, safe window shutdown |

### Concurrency test design

The server holds the initial chunk requests until ten have arrived. It records active-request counts and request start/end timestamps. One first-wave chunk completes quickly; the other nine are deliberately slower. Assertions require:

1. Exactly ten simultaneous chunk requests are observed.
2. No more than ten scheduler futures are submitted at once.
3. The replacement chunk starts **before** the slow first-wave chunks finish.
4. All chunks arrive exactly once in the no-failure case.
5. Assembled bytes match the unique-per-chunk source, including its final short tail.

The gate times out so a broken sequential implementation fails rather than hanging the test forever. Separate tests constrain multiple files with a smaller shared connection budget.

## Windows build validation supplied with the project

`build.bat`, or the GitHub Actions Windows workflow, performs:

1. Dependency installation into a Python 3.12 x64 environment.
2. Icon generation from the original SVG.
3. **Full test suite, before packaging.**
4. PyInstaller one-file executable generation.
5. Actual `UltraDownload.exe --smoke-test` launch using an isolated temporary profile.
6. Actual `UltraDownload.exe --self-test <report.json>` download, ten-worker observation, size/hash/byte comparison.
7. Executable SHA-256 artifact generation and CI artifact upload (workflow only).

`tools/verify_windows.ps1` has timeouts and checks both process exit codes and the generated report. A failed smoke test or transfer prevents a successful build result. No successful Windows result is implied until this pipeline actually runs and passes.

## Remaining interactive acceptance checklist

Run on **both Windows 10 and Windows 11**, without Python installed for EXE-only tests:

- [ ] Launch EXE as a non-administrator, including from a path with spaces/non-ASCII characters.
- [ ] Inspect a direct HTTPS URL and verify redirects, metadata, and TLS certificate validation.
- [ ] Download an authorized large file and compare a publisher-provided trusted SHA-256 independently.
- [ ] Transfer an actual file larger than 4 GiB; then test the intended 40–100 GiB workload.
- [ ] Verify responsiveness during long recovery hashing and file assembly, not just network transfer.
- [ ] Exercise multiple files, prioritization, global/per-file bandwidth limits, and server 429 restrictions.
- [ ] Pause during transfer and assembly; resume and verify the exact final bytes.
- [ ] Terminate from Task Manager, restart, accept recovery, and confirm intact chunk reuse.
- [ ] Disconnect/reconnect the network and test an expired authorized link.
- [ ] Test destination conflicts, read-only paths, full disks, removable media, and locked files.
- [ ] Check 100%, 150%, and 200% display scaling, keyboard navigation, resizing, and both accent themes.
- [ ] Confirm AppData profile isolation and single-instance behavior.
- [ ] Review Qt/PySide licensing and redistribution obligations.
- [ ] Sign the release EXE using the distributor's legitimate signing certificate; document signature verification. Do not disable SmartScreen/Defender to distribute it.

Known design limits and supported recovery semantics are documented in the main README. Passing small local tests establishes tested behavior, not a guarantee about arbitrary servers, storage hardware, or untested Windows environments.
