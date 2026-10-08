<#
.SYNOPSIS
    Builds SwiftLoad and produces a ready-to-ship installer.

.DESCRIPTION
    Runs the whole release pipeline in order and stops at the first failure:

      1. toolchain check (Node, Rust, cargo)
      2. npm install                    (frontend dependencies)
      3. npm run typecheck              (TypeScript, no emit)
      4. cargo test                     (unit tests + engine integration tests)
      5. tauri build --bundles nsis     (application + installer)
      6. copy the installer to dist-installer\SwiftLoad-Setup.exe with a SHA-256

.PARAMETER SkipTests
    Skip the Rust test suite (only for a throw-away build).

.PARAMETER SkipBuild
    Re-use the last bundle instead of rebuilding (only re-packages the artifact).

.EXAMPLE
    .\tools\build-installer.ps1
#>
[CmdletBinding()]
param(
    [switch]$SkipTests,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Write-Step([string]$text) {
    Write-Host ""
    Write-Host "=== $text" -ForegroundColor Cyan
}

function Assert-Tool([string]$name, [string]$hint) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "'$name' was not found. $hint"
    }
    return $command.Source
}

Write-Host "SwiftLoad release build" -ForegroundColor White
Write-Host "Working directory: $root"

Write-Step "Checking the toolchain"
$node = Assert-Tool "node" "Install Node.js 18 or newer from https://nodejs.org."
$cargo = Assert-Tool "cargo" "Install Rust from https://rustup.rs (MSVC toolchain)."
& $node --version
& $cargo --version
$packageJson = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$version = $packageJson.version
Write-Host "SwiftLoad version: $version"

if (-not $SkipBuild) {
    Write-Step "Installing frontend dependencies"
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }

    Write-Step "Type-checking the interface"
    & npm run typecheck
    if ($LASTEXITCODE -ne 0) { throw "TypeScript reported errors." }
}

if (-not $SkipTests) {
    Write-Step "Running the Rust tests (unit + engine integration)"
    & cargo test --manifest-path src-tauri\Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw "cargo test failed." }
}

if (-not $SkipBuild) {
    Write-Step "Building the application and the NSIS installer"
    & npm run tauri build -- --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed." }
}

Write-Step "Collecting the artifacts"
$bundleDir = Join-Path $root "src-tauri\target\release\bundle\nsis"
if (-not (Test-Path $bundleDir)) {
    throw "The NSIS bundle folder was not found ($bundleDir). Did the build finish?"
}
$installer = Get-ChildItem -Path $bundleDir -Filter "*-setup.exe" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $installer) {
    throw "No installer (*-setup.exe) was produced in $bundleDir."
}

$outputDir = Join-Path $root "dist-installer"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$target = Join-Path $outputDir "SwiftLoad-Setup.exe"
Copy-Item $installer.FullName $target -Force

$hash = (Get-FileHash -Algorithm SHA256 $target).Hash.ToLower()
"$hash  SwiftLoad-Setup.exe" | Set-Content -Path "$target.sha256" -Encoding ASCII

$sizeMb = [math]::Round((Get-Item $target).Length / 1MB, 2)
$appExe = Join-Path $root "src-tauri\target\release\SwiftLoad.exe"

Write-Host ""
Write-Host "Build finished." -ForegroundColor Green
Write-Host "  Application : $appExe"
Write-Host "  Installer   : $target  ($sizeMb MB)"
Write-Host "  SHA-256     : $hash"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  • run the installer on a clean Windows account and walk through docs/TESTING.md"
Write-Host "  • check Start Menu, the optional desktop shortcut and Apps & Features entry"
Write-Host "  • verify the uninstaller removes the program and the shortcuts"
