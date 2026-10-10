@echo off
rem AI VIBES - Gradle bootstrap (Windows).
rem The real gradle-wrapper.jar is deliberately not committed. This script
rem downloads the pinned Gradle distribution once, verifies its SHA-256 and
rem forwards every argument to it. Run: gradlew.bat :app:assembleDebug

setlocal
set APP_HOME=%~dp0
set GRADLE_VERSION=8.9
set GRADLE_SHA256=d725d707bfabd4dfdc958c624003b3c80accc03f7037b5122c4b1d0ef15cecab

if "%GRADLE_USER_HOME%"=="" set GRADLE_USER_HOME=%USERPROFILE%\.gradle
set DIST_HOME=%GRADLE_USER_HOME%\wrapper\dists\gradle-%GRADLE_VERSION%-bin\aivibes
set DIST_DIR=%DIST_HOME%\gradle-%GRADLE_VERSION%

if exist "%DIST_DIR%\bin\gradle.bat" goto :run

if not exist "%DIST_HOME%" mkdir "%DIST_HOME%"
set ZIP=%DIST_HOME%\gradle-%GRADLE_VERSION%-bin.zip
if exist "%ZIP%" goto :verify
echo Downloading Gradle %GRADLE_VERSION%...
curl -fL --retry 2 "https://services.gradle.org/distributions/gradle-%GRADLE_VERSION%-bin.zip" -o "%ZIP%"
if errorlevel 1 (
  echo Failed to download Gradle. Install curl or Gradle %GRADLE_VERSION% manually.
  exit /b 1
)

:verify
for /f "skip=1 tokens=1" %%H in ('certutil -hashfile "%ZIP%" SHA256') do (
  if /i not "%%H"=="%GRADLE_SHA256%" (
    echo Gradle distribution checksum mismatch; refusing to run it.
    del "%ZIP%"
    exit /b 1
  )
  goto :unpack
)

:unpack
powershell -NoProfile -Command "Expand-Archive -Force '%ZIP%' '%DIST_HOME%'"

:run
"%DIST_DIR%\bin\gradle.bat" -p "%APP_HOME%" %*
