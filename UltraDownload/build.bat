@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher not found. Install Python 3.12 x64 from python.org first.
  exit /b 1
)
if not exist .venv\Scripts\python.exe (
  py -3.12 -m venv .venv
  if errorlevel 1 exit /b 1
)
.venv\Scripts\python.exe -m pip install --disable-pip-version-check -r requirements.txt
if errorlevel 1 exit /b 1
set QT_QPA_PLATFORM=offscreen
.venv\Scripts\python.exe -m pytest -q
if errorlevel 1 exit /b 1
.venv\Scripts\python.exe main.py --smoke-test
if errorlevel 1 exit /b 1
.venv\Scripts\python.exe -m PyInstaller --clean --noconfirm ultradownload.spec
if errorlevel 1 exit /b 1
powershell -NoProfile -Command "$p = Start-Process -FilePath '.\dist\UltraDownload.exe' -ArgumentList '--smoke-test' -PassThru; if (-not $p.WaitForExit(60000)) { $p.Kill(); exit 1 }; if ($p.ExitCode -ne 0) { exit 1 }; Get-FileHash '.\dist\UltraDownload.exe' -Algorithm SHA256 | Format-List"
if errorlevel 1 exit /b 1
echo.
echo Build and smoke test succeeded: dist\UltraDownload.exe
exit /b 0
