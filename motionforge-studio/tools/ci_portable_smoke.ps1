# Unpacks the portable Windows package on a real Windows machine and runs the
# packaged application's own self test -- first the payload interpreter, then
# the console twin, then the normal windowed exe.
#
# Everything is written to the log file (default ci/smoke.log) because the CI
# log of a failing step is not readable from outside the runner; the log file
# is committed to the `ci-reports` branch by the workflow when something fails.
#
# Exit code: 0 when every check passed, 1 otherwise.

param(
    [Parameter(Mandatory = $true)][string]$Zip,
    [string]$LogPath = "ci/smoke.log",
    [string]$WorkDir = ""
)

$ErrorActionPreference = "Continue"
$script:Failed = @()

if (-not $WorkDir) { $WorkDir = Join-Path $env:TEMP "mfs-portable" }
$logDir = Split-Path -Parent $LogPath
if ($logDir) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
Set-Content -Path $LogPath -Value "portable smoke test $(Get-Date -Format o)`nzip: $Zip" -Encoding utf8

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

# Runs a native command, capturing *all* streams into the log file.
function Invoke-Logged([string]$Label, [string]$Exe, [string[]]$ArgList, [switch]$NoCheck) {
    Say ""
    Say "== $Label"
    Say "   $Exe $($ArgList -join ' ')"
    if (-not (Test-Path $Exe)) {
        Say "   FAIL missing executable"
        $script:Failed += "$Label (missing executable)"
        return -1
    }
    & $Exe @ArgList *>&1 | Out-File -FilePath $LogPath -Append -Encoding utf8
    $code = $LASTEXITCODE
    Say "   exit code: $code"
    if (-not $NoCheck -and $code -ne 0) { $script:Failed += "$Label (exit $code)" }
    return $code
}

Say ""
Say "== unpacking the portable package"
Say "   target: $WorkDir"
Remove-Item $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
try {
    Expand-Archive -Path $Zip -DestinationPath $WorkDir -Force -ErrorAction Stop
    Say "   ok   archive expanded"
} catch {
    Say "   FAIL expand: $_"
    $script:Failed += "expand-archive"
    exit 1
}

$app = Join-Path $WorkDir "MotionForge Studio"
Say ""
Say "== application folder"
Say "   $app"
if (-not (Test-Path $app)) {
    Say "   FAIL no 'MotionForge Studio' folder was produced"
    Say "   contents: $((Get-ChildItem $WorkDir | Select-Object -ExpandProperty Name) -join ', ')"
    $script:Failed += "app folder"
    exit 1
}
Say "   contents: $((Get-ChildItem $app | Select-Object -ExpandProperty Name) -join ', ')"
Say "   folder size: $([math]::Round((Get-ChildItem $app -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)) MB"

$py = Join-Path $app "python.exe"
$console = Join-Path $app "MotionForge console.exe"
$gui = Join-Path $app "MotionForge Studio.exe"

Check "python.exe" (Test-Path $py)
Check "MotionForge console.exe" (Test-Path $console)
Check "MotionForge Studio.exe" (Test-Path $gui)
Check "python313.dll" (Test-Path (Join-Path $app "python313.dll"))
Check "lib/PySide6/QtCore.pyd" (Test-Path (Join-Path $app "lib/PySide6/QtCore.pyd"))
Check "lib/imageio_ffmpeg" (Test-Path (Join-Path $app "lib/imageio_ffmpeg"))
Check "ffmpeg executable" ([bool](Get-ChildItem (Join-Path $app "lib/imageio_ffmpeg/binaries") -Filter "ffmpeg*.exe" -ErrorAction SilentlyContinue))

Say ""
Say "== version resource of the main executable"
if (Test-Path $gui) {
    $vi = (Get-Item $gui).VersionInfo
    Say "   ProductName:     $($vi.ProductName)"
    Say "   FileVersion:     $($vi.FileVersion)"
    Say "   FileDescription: $($vi.FileDescription)"
}

Invoke-Logged "payload interpreter / Qt import" $py @(
    "-c",
    "import sys, PySide6; print(sys.version); print('PySide6', PySide6.__version__)"
)

Invoke-Logged "console twin --selftest" $console @("--selftest")

Invoke-Logged "windowed exe --selftest" $gui @("--selftest")

Say ""
if ($script:Failed.Count -gt 0) {
    Say "PORTABLE SMOKE TEST FAILED: $($script:Failed -join '; ')"
    exit 1
}
Say "PORTABLE SMOKE TEST PASSED"
exit 0
