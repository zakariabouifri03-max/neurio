@echo off
rem ---------------------------------------------------------------------------
rem  Builds Neurio APK Player with Visual Studio (2019 or 2022, "Desktop
rem  development with C++").  Usage:   build.bat [x64^|x86]
rem  Output: bin\NeurioApkPlayer.exe (x64) or bin\NeurioApkPlayer-32bit.exe (x86)
rem ---------------------------------------------------------------------------
setlocal EnableExtensions
cd /d "%~dp0"

set "ARCH=%~1"
if "%ARCH%"=="" set "ARCH=x64"
if /i "%ARCH%"=="x64" goto :arch_ok
if /i "%ARCH%"=="x86" goto :arch_ok
echo usage: build.bat [x64^|x86]
exit /b 2
:arch_ok

if "%WV2_VERSION%"=="" set "WV2_VERSION=1.0.2903.40"
set "OBJ=build\%ARCH%"
set "OUTNAME=NeurioApkPlayer.exe"
if /i "%ARCH%"=="x86" set "OUTNAME=NeurioApkPlayer-32bit.exe"

rem ---- 1. Visual C++ environment ---------------------------------------------
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" goto :no_vs
set "VSINSTALL="
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSINSTALL=%%i"
if "%VSINSTALL%"=="" goto :no_vs
call "%VSINSTALL%\VC\Auxiliary\Build\vcvarsall.bat" %ARCH% >nul
if errorlevel 1 goto :fail
where cl >nul 2>nul || goto :no_vs

rem ---- 2. WebView2 SDK (NuGet package, cached in build\) -----------------------
set "WV2=%CD%\build\webview2-%WV2_VERSION%"
if exist "%WV2%\build\native\include\WebView2.h" goto :have_wv2
echo Downloading the WebView2 SDK %WV2_VERSION% ...
if not exist "%WV2%" mkdir "%WV2%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri 'https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/%WV2_VERSION%' -OutFile '%WV2%\sdk.zip'; Expand-Archive -Force -Path '%WV2%\sdk.zip' -DestinationPath '%WV2%'"
if errorlevel 1 goto :fail
if not exist "%WV2%\build\native\include\WebView2.h" goto :fail
:have_wv2

rem ---- 3. compile ---------------------------------------------------------------
if not exist "%OBJ%" mkdir "%OBJ%"
if not exist bin mkdir bin
del /q "%OBJ%\*.obj" "%OBJ%\*.res" 2>nul

echo [%ARCH%] compiling miniz ...
cl /nologo /c /MP /MT /O2 /W3 /DNDEBUG /D_CRT_SECURE_NO_WARNINGS /Ithird_party\miniz /Fo%OBJ%\ ^
   third_party\miniz\miniz.c third_party\miniz\miniz_zip.c third_party\miniz\miniz_tinfl.c third_party\miniz\miniz_tdef.c
if errorlevel 1 goto :fail

echo [%ARCH%] compiling the player ...
cl /nologo /c /MP /MT /O2 /EHsc /std:c++17 /utf-8 /W3 /DUNICODE /D_UNICODE /DNDEBUG /D_CRT_SECURE_NO_WARNINGS ^
   /Ithird_party\miniz "/I%WV2%\build\native\include" /Fo%OBJ%\ src\apk.cpp src\main.cpp
if errorlevel 1 goto :fail

echo [%ARCH%] resources ...
pushd src
rc /nologo /fo ..\%OBJ%\app.res app.rc
if errorlevel 1 (popd & goto :fail)
popd

echo [%ARCH%] linking bin\%OUTNAME% ...
link /nologo /OUT:bin\%OUTNAME% %OBJ%\*.obj %OBJ%\app.res "%WV2%\build\native\%ARCH%\WebView2LoaderStatic.lib" ^
   user32.lib gdi32.lib shell32.lib shlwapi.lib ole32.lib oleaut32.lib comdlg32.lib advapi32.lib version.lib uuid.lib ^
   /SUBSYSTEM:WINDOWS /MANIFEST:NO /OPT:REF /OPT:ICF /DYNAMICBASE /NXCOMPAT
if errorlevel 1 goto :fail

for %%F in (bin\%OUTNAME%) do echo OK: %%~fF  (%%~zF bytes)
exit /b 0

:no_vs
echo Visual Studio with the C++ tools was not found.
echo Install "Visual Studio Build Tools" with the "Desktop development with C++" workload.
exit /b 1

:fail
echo BUILD FAILED (%ARCH%)
exit /b 1
