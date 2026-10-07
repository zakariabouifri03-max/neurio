# Unpacks the portable Windows package on a real Windows machine and *runs* it:
# the bundled interpreter, the script form, the windowed entry point the user
# double-clicks, the version resources Windows shows in the file properties.
#
# Everything is written to the log file (default ci/smoke.log) because the CI
# log of a failing step is not readable from outside the runner; the log file is
# committed to the `ci-reports` branch by the workflow when something fails.
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

# Runs an executable with a hard time limit, capturing every stream into the
# log file.  A pipeline would happily wait forever for a handle that never
# closes, so the timeout (and the kill) are part of the harness itself.
function Invoke-Program([string]$Label, [string]$Exe, [string[]]$ArgList,
                        [string]$Expect = "", [int]$TimeoutSec = 300) {
    Say ""
    Say "== $Label"
    Say "   $Exe $($ArgList -join ' ')"
    if (-not (Test-Path $Exe)) {
        Say "   FAIL missing executable"
        $script:Failed += "$Label (missing executable)"
        return
    }
    $so = Join-Path $env:TEMP "mfs-smoke-out.txt"
    $se = Join-Path $env:TEMP "mfs-smoke-err.txt"
    Remove-Item $so, $se -Force -ErrorAction SilentlyContinue
    try {
        $p = Start-Process -FilePath $Exe -ArgumentList $ArgList -PassThru `
            -RedirectStandardOutput $so -RedirectStandardError $se -ErrorAction Stop
    } catch {
        Say "   FAIL could not start: $_"
        $script:Failed += "$Label (could not start)"
        return
    }
    if ($p.WaitForExit($TimeoutSec * 1000)) {
        $code = $p.ExitCode
        Say "   exit code: $code"
        if ($code -ne 0) { $script:Failed += "$Label (exit $code)" }
    } else {
        Say "   FAIL still running after $TimeoutSec s - terminating it"
        $script:Failed += "$Label (timeout after $TimeoutSec s)"
        & taskkill /PID $p.Id /T /F 2>&1 | ForEach-Object { Say "   | $_" }
        Start-Sleep -Seconds 3
    }
    $out = ""
    foreach ($f in @($so, $se)) {
        if (Test-Path $f) {
            $text = Get-Content $f -Raw
            $out += $text
            foreach ($line in ($text -split "`r?`n")) { if ($line) { Say "   | $line" } }
        }
    }
    if ($Expect) {
        $found = $out -match [regex]::Escape($Expect)
        if (-not $found) { $script:Failed += "$Label (output does not contain '$Expect')" }
        Check "output contains '$Expect'" $found
    }
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

$gui = Join-Path $app "MotionForge Studio.exe"                  # what the user starts
$console = Join-Path $app "MotionForge runtime console.exe"     # interpreter, console
$runtime = Join-Path $app "MotionForge runtime.exe"             # interpreter, windowed
$launcherPy = Join-Path $app "MotionForge.py"

Check "MotionForge Studio.exe (entry point)" (Test-Path $gui)
Check "MotionForge runtime console.exe" (Test-Path $console)
Check "MotionForge runtime.exe" (Test-Path $runtime)
Check "MotionForge.py" (Test-Path $launcherPy)
Check "python313.dll" (Test-Path (Join-Path $app "python313.dll"))
Check "lib/PySide6/QtCore.pyd" (Test-Path (Join-Path $app "lib/PySide6/QtCore.pyd"))
Check "lib/imageio_ffmpeg" (Test-Path (Join-Path $app "lib/imageio_ffmpeg"))
Check "ffmpeg executable" ([bool](Get-ChildItem (Join-Path $app "lib/imageio_ffmpeg/binaries") -Filter "ffmpeg*.exe" -ErrorAction SilentlyContinue))
Check "the interpreters were renamed (no python.exe / pythonw.exe)" `
    (-not (Test-Path (Join-Path $app "python.exe")) -and -not (Test-Path (Join-Path $app "pythonw.exe")))

Say ""
Say "== file properties Windows shows for the entry point"
foreach ($exe in @($gui, $runtime, $console)) {
    if (-not (Test-Path $exe)) { continue }
    $vi = (Get-Item $exe).VersionInfo
    $name = [IO.Path]::GetFileName($exe)
    Say "   ${name}:"
    Say "     ProductName:     $($vi.ProductName)"
    Say "     FileVersion:     $($vi.FileVersion)"
    Say "     FileDescription: $($vi.FileDescription)"
    Say "     CompanyName:     $($vi.CompanyName)"
    if ($exe -eq $gui) {
        Check "$name is branded" ($vi.ProductName -eq "MotionForge Studio" -and $vi.FileVersion -eq "1.0.0")
    } else {
        Check "$name has a readable version resource" ([bool]$vi.ProductName -and [bool]$vi.FileVersion)
    }
}

Invoke-Program "bundled interpreter / Qt import" $console @(
    "-c", "import sys, PySide6; print(sys.version); print('PySide6', PySide6.__version__)"
) "PySide6" -TimeoutSec 120

Invoke-Program "script form (interpreter MotionForge.py)" $console @($launcherPy, "--selftest") "RESULT: OK" -TimeoutSec 420

Invoke-Program "entry point --selftest" $gui @("--selftest") "RESULT: OK" -TimeoutSec 420

Invoke-Program "entry point --version" $gui @("--version") "MotionForge Studio" -TimeoutSec 180

Say ""
if ($script:Failed.Count -gt 0) {
    Say "PORTABLE SMOKE TEST FAILED: $($script:Failed -join '; ')"
    exit 1
}
Say "PORTABLE SMOKE TEST PASSED"
exit 0
