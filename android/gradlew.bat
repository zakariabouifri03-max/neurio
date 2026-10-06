@echo off
setlocal
set GRADLE_VERSION=8.9
set GRADLE_SHA256=d725d707bfabd4dfdc958c624003b3c80accc03f7037b5122c4b1d0ef15cecab
if not defined GRADLE_USER_HOME set GRADLE_USER_HOME=%USERPROFILE%\.gradle
set DIST_HOME=%GRADLE_USER_HOME%\wrapper\dists\gradle-%GRADLE_VERSION%-bin\neurio
set DIST_DIR=%DIST_HOME%\gradle-%GRADLE_VERSION%
if not exist "%DIST_DIR%\bin\gradle.bat" (
  if not exist "%DIST_HOME%" mkdir "%DIST_HOME%"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $zip=Join-Path '%DIST_HOME%' 'gradle-%GRADLE_VERSION%-bin.zip'; if (!(Test-Path $zip)) { Invoke-WebRequest -UseBasicParsing 'https://services.gradle.org/distributions/gradle-%GRADLE_VERSION%-bin.zip' -OutFile $zip }; $actual=(Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant(); if ($actual -ne '%GRADLE_SHA256%') { Remove-Item -Force $zip; throw 'Gradle distribution checksum mismatch; refusing to run it' }; Expand-Archive -Force $zip '%DIST_HOME%'"
  if errorlevel 1 exit /b 1
)
call "%DIST_DIR%\bin\gradle.bat" -p "%~dp0" %*
endlocal
