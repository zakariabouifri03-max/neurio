# Builds ADZAK-Creative-Studio-Setup.exe on Windows 10/11 (64-bit).
# Requirements: Python 3.12 (64-bit) on PATH, Inno Setup 6 (ISCC.exe) for the installer.
# Usage (from the adzak-studio folder):  powershell -ExecutionPolicy Bypass -File scripts\build_windows.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt

& .\.venv\Scripts\python.exe scripts\fetch_ffmpeg.py
if ($LASTEXITCODE -ne 0) { throw "FFmpeg download failed" }

$env:ADZAK_FFMPEG = (Resolve-Path packaging\ffmpeg\ffmpeg.exe).Path
& .\.venv\Scripts\python.exe -m pytest -q
if ($LASTEXITCODE -ne 0) { throw "Tests failed" }
& .\.venv\Scripts\python.exe -m pyflakes adzak
& .\.venv\Scripts\python.exe -m PyInstaller --noconfirm packaging\adzak.spec
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }

$iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if (-not $iscc) { $iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" }
& $iscc /DAppVersion=0.1.0 packaging\installer.iss
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed" }
Write-Host "Installer: $(Resolve-Path output\ADZAK-Creative-Studio-Setup.exe)"
