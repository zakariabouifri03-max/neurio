[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$buildPath = Join-Path $projectRoot "build"

function Invoke-NativeChecked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Executable failed with exit code $LASTEXITCODE"
    }
}

if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
    throw "CMake 3.22 or later was not found. Install CMake and Visual Studio 2022 with the Desktop development with C++ workload."
}

Invoke-NativeChecked "cmake" @(
    "-S", $projectRoot,
    "-B", $buildPath,
    "-A", "x64",
    "-DPIANOPRO_BUILD_DESKTOP_APP=ON",
    "-DPIANOPRO_BUILD_TESTS=ON"
)
Invoke-NativeChecked "cmake" @("--build", $buildPath, "--config", "Release", "--parallel")
Invoke-NativeChecked "ctest" @("--test-dir", $buildPath, "-C", "Release", "--output-on-failure")
Invoke-NativeChecked "cmake" @("--install", $buildPath, "--config", "Release", "--prefix", (Join-Path $buildPath "stage"))

$isccCommand = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
$isccPath = if ($null -ne $isccCommand) { $isccCommand.Source } else { $null }
if ([string]::IsNullOrWhiteSpace($isccPath)) {
    $isccPath = Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"
}
if (-not (Test-Path $isccPath)) {
    throw "Inno Setup 6 was not found. Install it, then rerun this script to produce the installer. The app and tests have already been built successfully."
}

Push-Location $PSScriptRoot
try {
    Invoke-NativeChecked $isccPath @("PianoPro.iss")
}
finally {
    Pop-Location
}

Write-Host "Build, tests, staged portable app, and installer completed."
Write-Host "Portable app: $(Join-Path $buildPath 'stage')"
Write-Host "Installer: $(Join-Path $buildPath 'installer\PianoPro_Setup.exe')"
