@echo off
REM Neurio launcher — Windows
REM Double-click this file to run Neurio (installs deps if needed)

set DIR=%~dp0
set ROOT=%DIR%..
echo ▶ Neurio — Hayed Background + Zid Quality
echo.

REM Check Python
python --version >nul 2>&1
if errorlevel 1 (
  echo ❌ Python not found! Install from python.org (check "Add to PATH")
  pause
  exit /b 1
)

REM Create venv if missing
if not exist "%ROOT%\venv" (
  echo ▶ Creating venv...
  python -m venv "%ROOT%\venv"
)

echo ▶ Activating venv...
call "%ROOT%\venv\Scripts\activate.bat"

echo ▶ Installing deps (if needed)...
pip install -q -r "%DIR%requirements.txt"
if errorlevel 1 (
  echo Trying with --user...
  pip install -r "%DIR%requirements.txt"
)

echo ▶ Launching Neurio Desktop...
python "%DIR%main.py" %*

if errorlevel 1 (
  echo.
  echo ⚠ Desktop failed — launching Web demo at http://localhost:7860
  echo Open browser at http://localhost:7860
  python "%DIR%web_app.py"
)

pause
