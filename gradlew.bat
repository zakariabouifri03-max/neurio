@rem VYRO PLAY — Gradle 8.9 bootstrap (Windows)
@if "%DEBUG%"=="" @echo off
setlocal enabledelayedexpansion
set "APP_HOME=%~dp0"
set "GRADLE_VERSION=8.9"
if "%GRADLE_USER_HOME%"=="" set "GRADLE_USER_HOME=%USERPROFILE%\.gradle"
set "DIST_HOME=%GRADLE_USER_HOME%\wrapper\dists\gradle-%GRADLE_VERSION%-bin\vyroplay"
set "DIST_DIR=%DIST_HOME%\gradle-%GRADLE_VERSION%"

if not exist "%DIST_DIR%\bin\gradle.bat" (
  mkdir "%DIST_HOME%" 2>nul
  powershell -NoProfile -Command ^
    "$ProgressPreference='SilentlyContinue'; " ^
    "Invoke-WebRequest -Uri 'https://services.gradle.org/distributions/gradle-%GRADLE_VERSION%-bin.zip' -OutFile '%DIST_HOME%\gradle.zip'; " ^
    "Expand-Archive -Force -Path '%DIST_HOME%\gradle.zip' -DestinationPath '%DIST_HOME%'"
)

call "%DIST_DIR%\bin\gradle.bat" -p "%APP_HOME%" %*
exit /b %ERRORLEVEL%
