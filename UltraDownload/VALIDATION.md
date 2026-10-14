# Verified build and test record

Date: **2026-10-14**

## Download the real Windows EXE

**[UltraDownload-Windows-x64 (ZIP)](https://github.com/zakariabouifri03-max/neurio/actions/runs/38536392228/artifacts/11880705546)**

Open the artifact while signed in to GitHub with access to this repository. Unzip it and run `dist/UltraDownload.exe`. Python is not needed by end users. The executable is unsigned; verify the artifact source and checksum before running it.

- [Successful workflow](https://github.com/zakariabouifri03-max/neurio/actions/runs/38536392228)
- Source/build commit: `6a16c63acd4fa38b5f36577f95b727ef335f3960`
- Binary: `UltraDownload.exe`, Windows x64, **52,856,800 bytes** (50.4 MiB)
- SHA-256: `7911796bd271f4896797fc372215fdbb94439cd73e8d95317b406382b031325a`
- Artifact also contains the binary checksum, resolved dependency versions, and README.
- GitHub artifact retention: 30 days. Download it before expiry, or rerun the workflow/build locally using `build.bat`.
- The binary is hosted as a CI artifact, not committed into the source repository. This sandbox cannot fetch GitHub's redirected blob-storage download endpoint, so the actual EXE is delivered through the artifact link above rather than a local copy.

## Windows CI — passed

Runner: **Windows Server 2022**, Python 3.12 x64.

1. Entire test suite: **67 passed**, no skips (48.25 seconds).
2. Source PySide6 application launch and clean exit: **passed**.
3. PyInstaller one-file, windowed Windows EXE creation: **passed**.
4. Launch of the actual packaged EXE with `--smoke-test`: **passed, exit code 0**.
5. SHA-256 generation and artifact upload: **passed**.

The Windows suite includes real Credential Manager storage/retrieval, actual HTTP Range transfers, exact ten-request concurrency, replacement scheduling measured after worker verification, bounded futures, cross-file global limits, pause/partial resume, queue priority, GUI dialogs/models, corrupted-chunk repair, changed remote validators, crash recovery, checksum rejection, disk failures, HTTP 429/retry, and full byte-for-byte comparisons against a non-repeating deterministic payload.

## Linux CI — passed

Runner: Ubuntu 24.04, Python 3.12, native Qt libraries installed.

- **66 passed, 1 skipped** (32.03 seconds). Only the Windows-specific Credential Manager test is skipped.
- GUI integration tests execute offscreen against the actual PySide6 application.
- Source application `--smoke-test`: **passed**.

## Local Linux sandbox

- Python 3.11.2, HTTPX 0.28.1, pytest 8.3.5.
- **63 passed, 2 skipped** (26.64 seconds).
- Local skips: the GUI module (native `libGL.so.1` is absent) and the Windows-only credential-store test.
- Bytecode compilation and `git diff --check`: passed.
- Native GUI validation was performed by CI instead of falsely claiming a local desktop launch.

## Remaining release validation

These results demonstrate a real Windows build, successful packaged startup, real desktop functionality, and real transfers in automated environments. They do **not** establish interactive Windows 10/11 certification or successful real-world 40–100 GiB transfers. Range arithmetic is tested through 100 GiB; network fixtures are approximately 12 MiB to keep tests bounded. Execute the Windows 10/11 and large-file manual checklist in `README.md` before a public production release. Code signing is also a publisher responsibility.

Later documentation-only commits do not change the tested application/build code listed above.
