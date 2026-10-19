@echo off
REM ============================================================================
REM  NovaCut AI Studio - full Windows build script (tested on Windows 10/11)
REM  Produces:
REM    dist\NovaCutAIStudio\           portable app folder (zip it to share)
REM    installer\Output\NovaCutSetup.exe  if Inno Setup 6 is installed
REM ============================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0\.."

if not exist .venv (
    echo [1/6] Creating virtual environment...
    py -3.11 -m venv .venv || python -m venv .venv
)
call .venv\Scripts\activate.bat

echo [2/6] Installing dependencies...
python -m pip install --upgrade pip
pip install -r requirements.txt
pip install pyinstaller

echo [3/6] Preparing FFmpeg...
if not exist installer\bin mkdir installer\bin
if not exist installer\bin\ffmpeg.exe (
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$ProgressPreference='SilentlyContinue';" ^
      "$url='https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials-win64-static.zip';" ^
      "Invoke-WebRequest -Uri $url -OutFile installer\ffmpeg.zip;" ^
      "Expand-Archive -Force installer\ffmpeg.zip installer\ffmpeg;" ^
      "Copy-Item installer\ffmpeg\*\bin\ffmpeg.exe installer\bin\";" ^
      "Copy-Item installer\ffmpeg\*\bin\ffprobe.exe installer\bin\"
    if errorlevel 1 (
        echo FFmpeg download failed. Manually place ffmpeg.exe and ffprobe.exe in installer\bin
        exit /b 1
    )
)

echo [4/6] Running test suite...
pytest tests || echo WARNING: tests failed - review before distributing

echo [5/6] Building application with PyInstaller...
pyinstaller --noconfirm installer\novacut.spec
if errorlevel 1 exit /b 1

echo [6/6] Building installer with Inno Setup (if available)...
where iscc >nul 2>nul
if %errorlevel%==0 (
    iscc installer\novacut.iss
) else (
    echo Inno Setup not found - skipping installer. The portable folder is in dist\NovaCutAIStudio
)

echo.
echo Build complete: dist\NovaCutAIStudio\NovaCutAIStudio.exe
endlocal
