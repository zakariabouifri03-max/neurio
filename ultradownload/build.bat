@echo off
rem ==========================================================================
rem  UltraDownload — Windows build script
rem
rem  Creates dist\UltraDownload\UltraDownload.exe (onedir, recommended).
rem  Pass --onefile for a single dist\UltraDownload.exe instead.
rem
rem  Requirements: Windows 10/11, Python 3.12+ on PATH ("python" command).
rem ==========================================================================
setlocal EnableExtensions
cd /d "%~dp0"

echo [1/5] Checking Python...
where python >nul 2>nul
if errorlevel 1 (
    echo ERROR: python was not found on PATH. Install Python 3.12+ from
    echo        https://www.python.org/downloads/ and re-run build.bat
    exit /b 1
)
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"
if errorlevel 1 (
    echo ERROR: Python 3.10 or newer is required.
    exit /b 1
)

echo [2/5] Creating build virtual environment...
if not exist ".build-venv\Scripts\python.exe" (
    python -m venv .build-venv
    if errorlevel 1 (
        echo ERROR: could not create the virtual environment.
        exit /b 1
    )
)
set "VENV_PY=.build-venv\Scripts\python.exe"

echo [3/5] Installing dependencies...
"%VENV_PY%" -m pip install --upgrade pip >nul
"%VENV_PY%" -m pip install -r requirements.txt -r requirements-dev.txt
if errorlevel 1 (
    echo ERROR: dependency installation failed.
    exit /b 1
)

echo [4/5] Generating application icons...
if not exist "assets\icon.ico" (
    "%VENV_PY%" tools\make_icon.py
)

echo [5/5] Packaging with PyInstaller...
if /i "%~1"=="--onefile" (
    "%VENV_PY%" -m PyInstaller UltraDownload-onefile.spec --noconfirm --clean
) else (
    "%VENV_PY%" -m PyInstaller UltraDownload.spec --noconfirm --clean
)
if errorlevel 1 (
    echo ERROR: PyInstaller build failed.
    exit /b 1
)

echo.
echo ================================================================
if /i "%~1"=="--onefile" (
    echo  Build OK: dist\UltraDownload.exe
) else (
    echo  Build OK: dist\UltraDownload\UltraDownload.exe
    echo  Ship the whole dist\UltraDownload folder.
)
echo  Run the automated tests with:  .build-venv\Scripts\python.exe -m pytest
echo ================================================================
endlocal
exit /b 0
