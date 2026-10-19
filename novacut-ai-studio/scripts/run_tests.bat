@echo off
REM Windows test runner
cd /d "%~dp0\.."
if not exist .venv python -m venv .venv
call .venv\Scripts\activate.bat
pip install -r requirements-dev.txt
set QT_QPA_PLATFORM=offscreen
pytest tests %*
