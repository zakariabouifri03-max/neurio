@echo off
rem ============================================================
rem  UltraDownload — Windows build script
rem  Produces dist\UltraDownload.exe via PyInstaller.
rem  Requires: Windows 10/11, Python 3.12+ on PATH (64-bit).
rem ============================================================
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo.
echo === UltraDownload build ===================================
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python was not found on PATH.
    echo         Install Python 3.12+ from https://python.org and re-run.
    exit /b 1
)

for /f "tokens=2" %%v in ('python --version') do set PYVER=%%v
echo Using Python %PYVER%

if not exist ".venv" (
    echo Creating virtual environment...
    python -m venv .venv
    if errorlevel 1 goto :fail
)

call .venv\Scripts\activate.bat
if errorlevel 1 goto :fail

echo Installing build dependencies...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m pip install pyinstaller pillow pytest
if errorlevel 1 goto :fail

echo.
echo Running test suite...
python -m pytest tests -q
if errorlevel 1 (
    echo [ERROR] Tests failed — aborting build.
    goto :fail
)

echo.
echo Building UltraDownload.exe ...
python -m PyInstaller --clean --noconfirm UltraDownload.spec
if errorlevel 1 goto :fail

if exist "dist\UltraDownload.exe" (
    echo.
    echo === BUILD SUCCEEDED ======================================
    echo  Executable: %~dp0dist\UltraDownload.exe
    echo  Test it on Windows 10 and Windows 11 before distribution.
    echo ==========================================================
    exit /b 0
)

echo [ERROR] dist\UltraDownload.exe was not produced.
exit /b 1

:fail
echo.
echo === BUILD FAILED =========================================
echo  Check the messages above.
echo ==========================================================
exit /b 1
