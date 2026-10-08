# Building SwiftLoad

## Requirements (Windows build machine)

| Tool | Notes |
|------|-------|
| Node.js 18+ | frontend build (Vite + TypeScript) |
| Rust stable (MSVC toolchain) | `rustup default stable-x86_64-pc-windows-msvc` |
| Visual Studio Build Tools | “Desktop development with C++” workload |
| WebView2 runtime | pre-installed on Windows 11 and current Windows 10; the installer bootstraps it otherwise |
| NSIS | **not** required — Tauri downloads the NSIS toolchain itself during the first bundle run |

No network access is needed at runtime by the application; the build machine only
needs it to fetch crates/npm packages and the NSIS toolchain.

## Quick build

```powershell
cd swiftload
npm install
npm run typecheck      # tsc --noEmit
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --bundles nsis
```

Or everything in one go, including a renamed artifact and a checksum:

```powershell
.\tools\build-installer.ps1
```

Resulting files:

```
src-tauri/target/release/SwiftLoad.exe                              # the application
src-tauri/target/release/bundle/nsis/SwiftLoad_1.0.0_x64-setup.exe  # the installer
dist-installer/SwiftLoad-Setup.exe                                  # renamed copy
dist-installer/SwiftLoad-Setup.exe.sha256                           # checksum
```

## Checks that do not need a Rust toolchain

```bash
bash scripts/check_all.sh
```

| Step | What it proves |
|------|----------------|
| `npx tsc --noEmit` | the interface type-checks against the command/event types |
| `npm run build` | Vite produces a bundle |
| `scripts/check_rust_syntax.py` | every Rust file parses (tree-sitter) |
| `scripts/check_rust_refs.py` | every `crate::` path and associated item resolves |
| `scripts/check_contracts.py` | each `#[tauri::command]` is registered, each API call exists, and the six event names match `src/lib/events.ts` in both directions |

They are a safety net for environments without `cargo`; on a Windows build
machine `cargo test` is the authoritative check.

## Development loop

```powershell
npm run tauri dev      # Vite dev server + Rust hot rebuild
```

To review the interface without the desktop shell:

```powershell
npm run build
node dev/preview-server.mjs 4173
```

The preview shows the real UI in “preview mode” (no engine) — useful for layout
work, useless for downloads.

## What the installer does

* **Per-user install** (`installMode: currentUser`): no administrator prompt, no
  files outside the user’s own profile.
* **Start Menu** entry under `SwiftLoad` and a standard **uninstaller**.
* **Optional desktop shortcut** — the installer asks before copying files
  (silent installs keep Tauri’s default behaviour). Implemented in
  `src-tauri/installer/hooks.nsh`.
* **WebView2** is bootstrapped silently if it is missing.
* Executable metadata (product name, version, copyright, icon) comes from
  `src-tauri/tauri.conf.json` + `src-tauri/Cargo.toml` + `src-tauri/icons/`.

Uninstalling removes the program, the Start Menu entry and the desktop shortcut.
`%LOCALAPPDATA%\SwiftLoad` (database, logs, settings) is intentionally left in
place so a reinstall keeps your history; delete that folder to remove all traces.

## Replacing the icon

```powershell
# edit src-tauri/icons/app-icon-source.png (1024×1024 PNG), then:
npx tauri icon src-tauri/icons/app-icon-source.png -o src-tauri/icons
copy src-tauri/icons/icon.png public/icon.png
```

## Building without a Windows machine

`.github/workflows/swiftload-installer.yml` in the repository root builds the
installer on GitHub's `windows-latest` runner (Actions → *SwiftLoad installer* →
*Run workflow*) and uploads `SwiftLoad-Setup.zip` containing
`SwiftLoad-Setup.exe` and its SHA-256. The workflow is triggered manually only.

## Code signing (optional but recommended for distribution)

Unsigned installers trigger SmartScreen warnings. With a code-signing
certificate:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "..."      # for updater artifacts, if used
npm run tauri build -- --bundles nsis --config '{"bundle":{"windows":{"certificateThumbprint":"<THUMBPRINT>","digestAlgorithm":"sha256","timestampUrl":"http://timestamp.digicert.com"}}}'
```

The certificate must be in the current user’s certificate store; Tauri uses
`signtool` internally.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `error: linker link.exe not found` | install the MSVC build tools (“Desktop development with C++”) |
| `failed to bundle project: NSIS not found` | run the bundle step once with internet access so Tauri can download NSIS |
| Blank window after `tauri dev` | the Vite dev server is on port 1420; check nothing else uses it (`strictPort` is on) |
| `WebView2` missing on an old machine | the installer’s bootstrapper fetches it, or install the Evergreen runtime manually |
| Antivirus blocks the installer | sign the build (above) or allow the file for the test machine |
