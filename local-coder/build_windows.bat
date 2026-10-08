@echo off
setlocal
cd /d "%~dp0"

echo ==============================================
echo   Building Neurio Coder for Windows
echo ==============================================

where py >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install Python 3.10+ and enable the Python Launcher.
  pause
  exit /b 1
)

py -c "import tkinter" >nul 2>nul
if errorlevel 1 (
  echo This Python installation does not include Tkinter.
  echo Reinstall Python from python.org and include Tcl/Tk support.
  pause
  exit /b 1
)

py -c "import PyInstaller" >nul 2>nul
if errorlevel 1 (
  echo Installing the build tool PyInstaller...
  py -m pip install --user pyinstaller
  if errorlevel 1 (
    echo Could not install PyInstaller. Check Python and your build-time internet connection.
    pause
    exit /b 1
  )
)

py -m PyInstaller --noconfirm --clean --onefile --windowed --name NeurioCoder neurio_coder.py
if errorlevel 1 (
  echo Build failed. See the error above.
  pause
  exit /b 1
)

echo.
echo Done: %~dp0dist\NeurioCoder.exe
echo The local Ollama model is not bundled in the EXE; install it separately.
pause
