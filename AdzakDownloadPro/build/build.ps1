<#
.SYNOPSIS
    Builds, tests and publishes ADZAK DOWNLOAD PRO as a self-contained Windows x64
    single-file executable: publish\ADZAK-DOWNLOAD-PRO.exe

.DESCRIPTION
    Requirements:
      * Windows 10/11 (x64)
      * .NET 8 SDK          (https://dotnet.microsoft.com/download/dotnet/8.0)
      * Internet access for the first NuGet restore (runtime/reference packs)

    The test suite runs against a local scriptable HTTP server — no network needed.

.EXAMPLE
    .\build\build.ps1                 # restore + test + publish
    .\build\build.ps1 -SkipTests     # publish only
#>
[CmdletBinding()]
param(
    [switch]$SkipTests,
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "==> Restore" -ForegroundColor Cyan
dotnet restore AdzakDownloadPro.sln
if ($LASTEXITCODE -ne 0) { throw "Restore failed." }

if (-not $SkipTests) {
    Write-Host "==> Test (AdzakDownloadPro.Tests)" -ForegroundColor Cyan
    dotnet run --project tests/AdzakDownloadPro.Tests/AdzakDownloadPro.Tests.csproj -c $Configuration
    if ($LASTEXITCODE -ne 0) { throw "Tests failed." }
}

Write-Host "==> Publish: self-contained win-x64, single file" -ForegroundColor Cyan
dotnet publish src/AdzakDownloadPro/AdzakDownloadPro.csproj `
    -c $Configuration `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -o publish
if ($LASTEXITCODE -ne 0) { throw "Publish failed." }

$exe = Join-Path $root "publish\ADZAK-DOWNLOAD-PRO.exe"
if (-not (Test-Path $exe)) { throw "Publish did not produce $exe" }

Write-Host ""
Write-Host "==> Done. Run it with:" -ForegroundColor Green
Write-Host "    $exe"
