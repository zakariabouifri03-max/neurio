@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0USB-Helper.ps1"
if errorlevel 1 (
  echo.
  echo The helper could not start. Read the error above.
  pause
)
endlocal
