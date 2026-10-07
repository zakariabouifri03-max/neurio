# Installs MotionForge Studio silently on a real Windows machine, checks the
# installed application, the Start menu shortcut and the uninstall entry, then
# uninstalls it again and makes sure nothing is left behind.
#
# Everything is written to the log file (default ci/install.log) for the same
# reason as ci_portable_smoke.ps1: a failing step's CI log is not readable from
# outside the runner, but the log file is pushed to the `ci-reports` branch.
#
# Exit code: 0 when every check passed, 1 otherwise.

param(
    [Parameter(Mandatory = $true)][string]$Setup,
    [string]$LogPath = "ci/install.log",
    [string]$InstallDir = ""
)

$ErrorActionPreference = "Continue"
$script:Failed = @()

if (-not $InstallDir) { $InstallDir = Join-Path $env:TEMP "mfstest" }
$logDir = Split-Path -Parent $LogPath
if ($logDir) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
Set-Content -Path $LogPath -Value "install test $(Get-Date -Format o)`nsetup: $Setup`ndir:   $InstallDir" -Encoding utf8

function Say([string]$Text) {
    Write-Host $Text
    $Text | Out-File -FilePath $LogPath -Append -Encoding utf8
}

function Check([string]$Label, [bool]$Ok, [string]$Detail = "") {
    if ($Ok) {
        Say "   ok   $Label"
    } else {
        Say "   FAIL $Label $Detail"
        $script:Failed += $Label
    }
    return $Ok
}

$setupLog = Join-Path $env:TEMP "motionforge-setup.log"

Say ""
Say "== silent install into $InstallDir"
Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $setupLog -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath $Setup -ArgumentList @("/silent", "/dir", "`"$InstallDir`"") -PassThru -Wait
Say "   installer exit code: $($p.ExitCode)"
Check "installer exit code 0" ($p.ExitCode -eq 0) "(got $($p.ExitCode))"

Say ""
Say "== installer log ($setupLog)"
if (Test-Path $setupLog) {
    Get-Content $setupLog | Out-File -FilePath $LogPath -Append -Encoding utf8
} else {
    Say "   (no installer log)"
}

Say ""
Say "== installed files"
if (Test-Path $InstallDir) {
    Say "   contents: $((Get-ChildItem $InstallDir | Select-Object -ExpandProperty Name) -join ', ')"
    Say "   size: $([math]::Round((Get-ChildItem $InstallDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)) MB"
} else {
    Say "   FAIL install directory missing"
    $script:Failed += "install directory"
    exit 1
}

$app = Join-Path $InstallDir "MotionForge Studio.exe"
$console = Join-Path $InstallDir "MotionForge console.exe"
$uninstaller = Join-Path $InstallDir "Uninstall.exe"
Check "MotionForge Studio.exe" (Test-Path $app)
Check "MotionForge console.exe" (Test-Path $console)
Check "Uninstall.exe" (Test-Path $uninstaller)
Check "python313.dll" (Test-Path (Join-Path $InstallDir "python313.dll"))
Check "app/mfs/app.py" (Test-Path (Join-Path $InstallDir "app/mfs/app.py"))

Say ""
Say "== desktop shortcut"
$desktop = Join-Path ([Environment]::GetFolderPath("Desktop")) "MotionForge Studio.lnk"
Check "desktop shortcut" (Test-Path $desktop)
Say "== start menu"
$startDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\MotionForge Studio"
if (Test-Path $startDir) {
    Say "   $((Get-ChildItem $startDir | Select-Object -ExpandProperty Name) -join ', ')"
} else {
    Say "   FAIL start menu folder missing"
    $script:Failed += "start menu folder"
}

Say ""
Say "== uninstall registry entry"
$keys = Get-ChildItem "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall" -ErrorAction SilentlyContinue |
    Where-Object { $_.PSChildName -like "*MotionForge*" }
if ($keys) {
    foreach ($k in $keys) {
        $v = Get-ItemProperty $k.PSPath
        Say "   $($k.PSChildName): $($v.DisplayName) $($v.DisplayVersion) -> $($v.UninstallString)"
    }
} else {
    Say "   FAIL no uninstall entry"
    $script:Failed += "uninstall registry entry"
}

Say ""
Say "== installed application self test"
if (Test-Path $console) {
    & $console --selftest *>&1 | Out-File -FilePath $LogPath -Append -Encoding utf8
    Say "   exit code: $LASTEXITCODE"
    if ($LASTEXITCODE -ne 0) { $script:Failed += "installed self test (exit $LASTEXITCODE)" }
}

Say ""
Say "== uninstall"
if (Test-Path $uninstaller) {
    $u = Start-Process -FilePath $uninstaller -ArgumentList @("--uninstall", "--silent", "--dir", "`"$InstallDir`"") -PassThru -Wait
    Say "   uninstaller exit code: $($u.ExitCode)"
    Check "uninstaller exit code 0" ($u.ExitCode -eq 0) "(got $($u.ExitCode))"
    Start-Sleep -Seconds 5
    $left = @()
    if (Test-Path $InstallDir) {
        $left = Get-ChildItem $InstallDir -Recurse -File -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty FullName
    }
    if ($left.Count -gt 0) {
        Say "   FAIL files left behind: $($left -join ', ')"
        $script:Failed += "uninstall leftovers"
    } else {
        Say "   ok   install directory removed"
    }
    if (Test-Path $desktop) {
        Say "   FAIL desktop shortcut still present"
        $script:Failed += "shortcut leftovers"
    } else {
        Say "   ok   desktop shortcut removed"
    }
}

Say ""
if ($script:Failed.Count -gt 0) {
    Say "INSTALL TEST FAILED: $($script:Failed -join '; ')"
    exit 1
}
Say "INSTALL TEST PASSED"
exit 0
