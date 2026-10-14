@echo off
setlocal
cd /d "%~dp0"
echo === UltraDownload Windows x64 build ===
where py >nul 2>nul
if errorlevel 1 (
    echo Python launcher not found. Install Python 3.12 x64 from python.org with the launcher.
    exit /b 1
)
if not exist .venv\Scripts\python.exe (
    py -3.12 -m venv .venv
    if errorlevel 1 exit /b 1
)
set "PY=.venv\Scripts\python.exe"
"%PY%" -c "import sys,struct; assert sys.version_info[:2]==(3,12) and struct.calcsize('P')==8, 'Build requires Python 3.12 x64'"
if errorlevel 1 exit /b 1
"%PY%" -m pip install -r requirements.txt
if errorlevel 1 exit /b 1
"%PY%" tools\make_icon.py
if errorlevel 1 exit /b 1
set QT_QPA_PLATFORM=offscreen
"%PY%" -m pytest -q
if errorlevel 1 exit /b 1
set QT_QPA_PLATFORM=
"%PY%" -m PyInstaller --clean --noconfirm ultradownload.spec
if errorlevel 1 exit /b 1
"%PY%" tools\verify_windows.py
if errorlevel 1 exit /b 1
powershell -NoProfile -Command "(Get-FileHash 'dist\UltraDownload.exe' -Algorithm SHA256).Hash | Set-Content -Encoding ascii 'dist\UltraDownload.exe.sha256'"
if errorlevel 1 exit /b 1
echo.
echo Build and automated checks passed: %CD%\dist\UltraDownload.exe
echo Test interactively on Windows 10 and 11 before release. Code signing is not configured.
exit /b 0
