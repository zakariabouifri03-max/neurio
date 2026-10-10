@echo off
REM ============================================================
REM  ADZAK CREATIVE STUDIO - reproducible Windows build
REM  Produces: dist\AdzakCreativeStudio\AdzakCreativeStudio.exe
REM            and (if Inno Setup is installed) the installer
REM            ADZAK-Creative-Studio-Setup.exe
REM  Requires: Python 3.11+ (64-bit) and internet access.
REM ============================================================
setlocal
cd /d "%~dp0\.."

echo [1/5] Creating virtual environment...
if not exist .venv py -3 -m venv .venv || goto :err
call .venv\Scripts\activate.bat

echo [2/5] Installing dependencies...
python -m pip install --upgrade pip || goto :err
pip install -r requirements-dev.txt || goto :err

echo [3/5] Running automated tests...
python -m pytest tests -q || goto :err

echo [4/5] Getting FFmpeg (official static build from gyan.dev)...
if not exist ffmpeg\bin\ffmpeg.exe (
    powershell -ExecutionPolicy Bypass -File scripts\fetch_ffmpeg.ps1 || goto :err
)

echo [5/5] Building executable...
pyinstaller --clean --noconfirm scripts\adzak.spec || goto :err

REM Optional installer (needs Inno Setup 6: https://jrsoftware.org/isinfo.php)
where iscc >nul 2>nul
if %errorlevel%==0 (
    iscc scripts\installer\ADZAK-Creative-Studio.iss || goto :err
) else (
    echo Inno Setup not found - skipping installer. Portable build is in dist\
)

echo.
echo BUILD OK
exit /b 0

:err
echo BUILD FAILED
exit /b 1
