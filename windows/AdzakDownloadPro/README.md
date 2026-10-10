# Adzak Download Pro — Windows x64

This directory contains a standalone .NET 8 WinForms download manager and its persistent HTTP recovery engine. The repository at the time this was added is a browser-based kart-racing game, not an existing Windows download-manager project, so the Windows app is intentionally isolated here rather than replacing the racing game.

## Build and test

Requires the .NET 8 SDK and Windows Desktop targeting pack for the GUI project.

```powershell
# Run the deterministic recovery scenarios (no third-party test packages)
dotnet run --project tests/AdzakDownloadPro.Tests/AdzakDownloadPro.Tests.csproj -c Release

# Build the desktop application
dotnet build src/AdzakDownloadPro.WinForms/AdzakDownloadPro.WinForms.csproj -c Release

# Publish one self-contained Windows x64 executable
dotnet publish src/AdzakDownloadPro.WinForms/AdzakDownloadPro.WinForms.csproj `
  -c Release -r win-x64 --self-contained true `
  -p:PlatformTarget=x64 -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true `
  -p:DebugType=None -p:DebugSymbols=false `
  -o artifacts/win-x64
```

The GitHub Actions workflow `.github/workflows/adzak-download-pro.yml` runs the scenario suite on Windows and uploads `AdzakDownloadPro.WinForms.exe` as the `AdzakDownloadPro-win-x64` workflow artifact.

## Recovery and integrity behavior

- The persistent queue is atomically replaced in `%LOCALAPPDATA%\AdzakDownloadPro\downloads.json`. The URL is stored verbatim; signed query-string tokens are sensitive. The UI discloses this and asks permission before resuming saved jobs after a restart.
- Ranged transfers use one HTTP request per contiguous segment, send `Range` and `If-Range`, and validate `206 Content-Range`, response length, total length, ETag and/or Last-Modified. Segment files are hashed and flushed before the queue checkpoint records them. A crash may discard only data beyond the last durable checkpoint.
- A server that ignores Range (`200 OK`) is handled as a new full response in a different temporary file. Existing ranges are never appended to it. The UI records that restarting from byte zero is unavoidable; old partial data remains until the new file is complete or the user explicitly cancels.
- A changed validator or length switches to a clean full download and preserves the old segments; bytes from different representations are not merged. `416` is accepted only when the saved range covers the server-reported total.
- DNS/socket/TLS failures, timeouts, `408`, `425`, `429`, and `5xx` use bounded exponential retries. Network-change events cancel an active request immediately; a 10-second polling fallback is also used. Before a retry after an error, the manager probes the actual download host and then resumes automatically.
- `401`/`403` report that authentication or a signed URL may need refreshing. Other non-transient HTTP errors are shown as failures and wait for the manual Retry button.
- The saved SHA-256 values detect local segment corruption and protect the merge from duplicate, missing, reordered or truncated ranges. They are not a cryptographic checksum from the remote publisher; end-to-end authenticity can only be proven when the server supplies a trusted digest or signature. Completion still requires exact total length, validated HTTP ranges, segment hashes and a final atomic destination replacement.
- Temporary files are removed only after successful finalization or when the user explicitly cancels. A transient error never deletes partial data.

The test executable exercises Wi-Fi loss, reconnection after virtual 10/30/60-second outages, repeated failures/backoff, range support/refusal, changed remote content, restart recovery, and corrupted/truncated segments using a local scripted HTTP handler. Production transfers use `HttpClient` against the real URL.
