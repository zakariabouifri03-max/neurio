# Validation record

Date: 2026-10-14

## Local Linux sandbox

- Python 3.11.2, HTTPX 0.28.1, pytest 8.3.5.
- `python -m pytest -q`: **60 passed, 2 skipped** (23.52 seconds).
- The skips are the Qt test module (native Linux `libGL.so.1` is missing) and the Windows-only credential-store integration.
- Ten-connection and replacement-scheduling assertions passed against actual local HTTP requests.
- Byte-exact assembly, 429/retry, partial resume, corruption repair, recovery, global limits, and disk-failure tests passed.
- `python -m compileall -q UltraDownload`: passed.
- Local desktop startup could not be validated because native Qt prerequisites are absent. This is not reported as a successful GUI launch.

## Windows

The checked-in Windows Actions workflow runs source tests, source GUI smoke test, PyInstaller packaging, and packaged EXE smoke test. Its results and artifact are authoritative only after the workflow completes successfully. Windows 10/11 interactive acceptance remains a manual release requirement.
