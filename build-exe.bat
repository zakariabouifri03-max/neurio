@echo off
REM SOLARA BAY — Build Windows EXE (one click)
REM Requires Node.js (https://nodejs.org) installed once

echo 🌴 SOLARA BAY — Building Windows EXE...
where node >nul 2>nul || (echo ❌ Node.js not found. Install from https://nodejs.org & try again & pause & exit /b)
where npm >nul 2>nul || (echo ❌ npm not found & pause & exit /b)

echo 📦 Installing Electron (first time only, ~180MB)...
if not exist solara-bay-exe\node_modules (
  pushd solara-bay-exe
  call npm install --silent
  popd
)

echo 🔨 Building portable EXE...
pushd solara-bay-exe
call npx electron-builder --win portable --x64
popd

echo ✅ Done! Find your EXE in solara-bay-exe\dist\SolaraBay-*.exe
echo    Double-click to play — no install needed!
pause
