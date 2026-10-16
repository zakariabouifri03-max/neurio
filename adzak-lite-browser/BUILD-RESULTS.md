# Build & test results — ADZAK Lite Browser 1.0

Recorded 2026-10-16. All builds ran on GitHub Actions `windows-latest`
(.NET SDK 8.x) from this repository; artifacts were produced from the exact
source in `src/ADZAKLiteBrowser/`. The authoring sandbox is Linux with no .NET
SDK, so nothing here was compiled locally — the CI logs below are the evidence.

## Final result: ✅ SUCCESS

Run: https://github.com/zakariabouifri03-max/neurio/actions/runs/38928622187
(all 13 steps green, including the headless smoke test of the shipped EXE)

Artifacts (GitHub Actions → “ADZAK-Lite-Browser-win-x64”):

| File | Kind | Notes |
|---|---|---|
| `ADZAKLiteBrowser.exe` | Self-contained single-file, win-x64 Release | The recommended download; includes .NET 8 runtime. Needs only the WebView2 Runtime. |
| `ADZAK-Lite-Browser-win-x64-folder.zip` | Self-contained folder build | Same build, classic EXE+DLL layout. |
| `dist/ADZAKLiteBrowser-portable.exe` (in this repo) | Framework-dependent single-file, win-x64, 1,065,332 bytes | Runs on PCs that already have the **.NET 8 Desktop Runtime**; convenient small download. Committed back by CI because the authoring sandbox cannot download Actions artifacts (see below). |

## Smoke test (really executed the shipped single-file EXE)

`ADZAKLiteBrowser.exe --smoke-test` output (`dist/smoke-result.json`):

```json
{
  "runtimeVersion": "155.0.4283.60",
  "blocklistBlocksDoubleclick": true,
  "blocklistAllowsExample": true,
  "normalizeSearch": "how to boil eggs",
  "normalizeHost": "https://example.com/docs",
  "settingsLoadOk": true,
  "navigationCompleted": true,
  "documentTitle": "ADZAK Smoke OK",
  "domText": "hello",
  "webglRenderer": "ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)",
  "ok": true
}
```

Reading of the GPU line, honestly: the CI runner is a VM **without a GPU**, so
Chromium/ANGLE fell back to Microsoft's Basic Render (software) driver over
D3D11. This proves the WebGL/D3D11 path initializes; it does **not** prove
hardware-GPU rendering on a real PC. On a PC with a GPU, ☰ → GPU Status shows
the actual renderer (e.g. an Intel/NVIDIA/AMD ANGLE string).

## Failed attempts (fixed; kept here for honesty)

1. Run 38927205666 — `ToolStripSpringTextBox could not be found`:
   replaced with a manually-resized `ToolStripTextBox`.
2. Run 38927422470 — same line persisted due to an incomplete edit; re-applied.
3. Run 38927841909 — three real API mistakes, fixed:
   `CoreWebView2.TrySuspendAsync()` (not `SuspendAsync`),
   no `CameraAndMicrophone` member in `CoreWebView2PermissionKind`,
   download byte counts need `Convert.ToInt64` (SDK type variance).
4. Run 38928101626 — ✅ first fully green build + smoke test.
5. Run 38928622187 — ✅ added portable EXE publish + commit-back; all green.

Nullable-reference warnings remain (non-fatal) in Dialogs.cs.

## Not tested

- Interactive GUI use on a physical Windows PC (tabs, downloads, dialogs were
  compiled and the engine was exercised headlessly only).
- Real-GPU rendering, 8 GB RAM long-session behaviour, DRM streaming,
  enterprise proxy/auth flows.
- Code signing: the EXE is **not** Authenticode-signed, so Windows SmartScreen
  will warn on first launch (“More info → Run anyway”). This is normal for
  unsigned freeware; sign with a code-signing certificate for distribution.

## Delivery note

`gh run download` of the Actions artifact fails inside the authoring sandbox
(Azure blob endpoint is outside its network allowlist, HTTP EOF). The portable
EXE + smoke JSON are therefore committed at `adzak-lite-browser/dist/` by the
workflow itself. The full self-contained EXE remains available from the
Actions run page above in any browser.
