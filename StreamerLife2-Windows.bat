@echo off
rem Streamer Life 2 — Windows launcher (zero-install: uses your Edge/Chrome in app mode)
set "G=%~dp0streamer\streamer-life-2.html"
set "G=file:///%G:\=/%"
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app="%G%"
  goto :eof
)
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app="%G%"
  goto :eof
)
start "" "%~dp0streamer\streamer-life-2.html"
