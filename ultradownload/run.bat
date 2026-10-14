@echo off
rem Run UltraDownload from source (Windows), creating a venv if needed.
setlocal EnableExtensions
cd /d "%~dp0"
if not exist ".run-venv\Scripts\python.exe" (
    python -m venv .run-venv
    ".run-venv\Scripts\python.exe" -m pip install -r requirements.txt
)
".run-venv\Scripts\python.exe" -m ultradownload %*
endlocal
