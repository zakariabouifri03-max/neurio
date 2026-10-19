$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if ($env:OS -ne "Windows_NT") {
    throw "This script must be run on Windows x64; PyInstaller does not cross-compile Windows executables from Linux."
}
if (-not [Environment]::Is64BitOperatingSystem) {
    throw "NovaCut's build target is Windows x64."
}

$Python = Get-Command py -ErrorAction SilentlyContinue
if ($Python) {
    & py -3 -c "import struct,sys; assert sys.version_info >= (3,11) and struct.calcsize('P') == 8; print(sys.version)"
    if ($LASTEXITCODE -ne 0) { throw "Install 64-bit Python 3.11 or newer and try again." }
    $PythonCommand = "py"
    $PythonArgs = @("-3")
} else {
    $Python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $Python) { throw "Python 3.11+ (64-bit) was not found." }
    & python -c "import struct,sys; assert sys.version_info >= (3,11) and struct.calcsize('P') == 8; print(sys.version)"
    if ($LASTEXITCODE -ne 0) { throw "Install 64-bit Python 3.11 or newer and try again." }
    $PythonCommand = "python"
    $PythonArgs = @()
}

$Venv = Join-Path $Root ".venv"
if (-not (Test-Path (Join-Path $Venv "Scripts/python.exe"))) {
    & $PythonCommand @PythonArgs -m venv $Venv
    if ($LASTEXITCODE -ne 0) { throw "Could not create the build virtual environment." }
}
$VenvPython = Join-Path $Venv "Scripts/python.exe"
& $VenvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Could not upgrade pip." }
& $VenvPython -m pip install -r (Join-Path $Root "requirements-dev.txt")
if ($LASTEXITCODE -ne 0) { throw "Could not install the Python build dependencies." }

& $VenvPython -m pyflakes novacut tests tools/generate_novacut_test_media.py
if ($LASTEXITCODE -ne 0) { throw "Static checks failed; fix pyflakes findings before packaging." }
& $VenvPython -m pytest -q
if ($LASTEXITCODE -ne 0) { throw "Automated tests failed; refusing to package an unverified build." }

$Dist = Join-Path $Root "dist"
$Build = Join-Path $Root "build"
$Arguments = @(
    "--noconfirm", "--clean", "--windowed", "--onedir",
    "--name", "NovaCut AI Studio",
    "--distpath", $Dist,
    "--workpath", (Join-Path $Build "pyinstaller"),
    "--specpath", $Build,
    "--collect-all", "PySide6.QtMultimedia",
    "--collect-all", "PySide6.QtMultimediaWidgets",
    "--add-data", ((Join-Path $Root "THIRD_PARTY_NOTICES.md") + ";."),
    "--add-data", ((Join-Path $Root "novacut/LICENSE") + ";novacut"),
    (Join-Path $Root "novacut_launcher.py")
)

if ($env:FFMPEG_DIR) {
    $FfmpegExe = Join-Path $env:FFMPEG_DIR "ffmpeg.exe"
    if (-not (Test-Path $FfmpegExe)) { throw "FFMPEG_DIR must contain ffmpeg.exe." }
    if (-not $env:FFMPEG_LICENSE_FILE -or -not (Test-Path $env:FFMPEG_LICENSE_FILE)) {
        throw "When bundling FFmpeg, set FFMPEG_LICENSE_FILE to the license/source-notice file supplied with that exact build."
    }
    $Arguments += @("--add-binary", ($FfmpegExe + ";ffmpeg"))
}

& $VenvPython -m PyInstaller @Arguments
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed. See the build output above." }

$AppFolder = Join-Path $Dist "NovaCut AI Studio"
$Executable = Join-Path $AppFolder "NovaCut AI Studio.exe"
if (-not (Test-Path $Executable)) { throw "The packaged Windows executable was not found." }
$Smoke = Start-Process -FilePath $Executable -ArgumentList "--smoke" -PassThru
if (-not $Smoke.WaitForExit(30000)) {
    Stop-Process -Id $Smoke.Id -Force
    throw "The packaged application did not finish its startup smoke test within 30 seconds."
}
if ($Smoke.ExitCode -ne 0) {
    $RuntimeLog = Join-Path $env:LOCALAPPDATA "NovaCut AI Studio\Logs\novacut.log"
    if (Test-Path $RuntimeLog) {
        Write-Host "Application log tail after startup failure:"
        Get-Content $RuntimeLog | Select-Object -Last 50 | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host "The application exited before creating its log file."
    }
    throw "The packaged application startup smoke test failed with exit code $($Smoke.ExitCode)."
}
Write-Host "Packaged application startup smoke test passed."

if ($env:FFMPEG_DIR) {
    $LicenseFolder = Join-Path $AppFolder "licenses"
    New-Item -ItemType Directory -Force -Path $LicenseFolder | Out-Null
    Copy-Item $env:FFMPEG_LICENSE_FILE (Join-Path $LicenseFolder "FFmpeg-LICENSE-AND-SOURCE-NOTICE.txt") -Force
}

Write-Host "Portable app output: $AppFolder\NovaCut AI Studio.exe"
Write-Host "This is an onedir portable build. Model files are intentionally not included."

$ISCC = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if ($ISCC) {
    & $ISCC.Source (Join-Path $Root "installer/NovaCut.iss")
    if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed." }
    Write-Host "Installer output is in dist/installer."
} else {
    Write-Host "Inno Setup is not installed; portable EXE is ready. Install Inno Setup and run ISCC installer/NovaCut.iss to build an installer."
}
