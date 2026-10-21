# Smoke tests for Neurio APK Player (run by .github/workflows/apk-player-windows.yml).
# Can also be run by hand on Windows:
#   pwsh apk-player\tests\ci-smoke.ps1 -BashBaqiApk C:\path\BashBaqiRacing.apk
param(
    [Parameter(Mandatory = $true)][string]$BashBaqiApk,
    [string]$Exe = "$PSScriptRoot\..\bin\NeurioApkPlayer.exe",
    [string]$Exe32 = "$PSScriptRoot\..\bin\NeurioApkPlayer-32bit.exe",
    [string]$Results = "$PSScriptRoot\..\bin\ci",
    [string]$Work = "$env:RUNNER_TEMP\apk-player-smoke"
)
$ErrorActionPreference = 'Stop'
if (-not $env:RUNNER_TEMP -and $Work -eq '\apk-player-smoke') { $Work = Join-Path $env:TEMP 'apk-player-smoke' }

$Exe = (Resolve-Path $Exe).Path
$Exe32 = (Resolve-Path $Exe32).Path
$BashBaqiApk = (Resolve-Path $BashBaqiApk).Path
$Fixtures = (Resolve-Path "$PSScriptRoot\fixtures").Path
$CordovaApk = Join-Path $Fixtures 'cordova-test.apk'
$UnityApk = Join-Path $Fixtures 'native-unity-test.apk'

if (Test-Path $Work) { Remove-Item -Recurse -Force $Work }
New-Item -ItemType Directory -Force -Path $Work | Out-Null
if (Test-Path $Results) { Remove-Item -Recurse -Force $Results }
New-Item -ItemType Directory -Force -Path $Results | Out-Null

$script:failures = New-Object System.Collections.Generic.List[string]
$script:rows = New-Object System.Collections.Generic.List[string]
function Check([string]$name, [bool]$ok, [string]$detail = '') {
    $mark = if ($ok) { 'PASS' } else { 'FAIL' }
    $script:rows.Add("| $mark | $name | $($detail -replace '\|', '/') |")
    Write-Output ("[{0}] {1}  {2}" -f $mark, $name, $detail)
    if (-not $ok) { $script:failures.Add("$name $detail"); Write-Output "::error::$name $detail" }
}

function Invoke-Player([string]$exe, [string[]]$argv, [int]$timeoutSec = 240) {
    # GUI program: start it and wait explicitly (quote every argument; none ends with a backslash)
    $line = ($argv | ForEach-Object { '"' + $_ + '"' }) -join ' '
    $p = Start-Process -FilePath $exe -ArgumentList $line -PassThru
    $null = $p.Handle   # keeps the handle so ExitCode is available later
    if (-not $p.WaitForExit($timeoutSec * 1000)) {
        try { $p.Kill() } catch {}
        return -999
    }
    $p.WaitForExit()
    return $p.ExitCode
}

function Read-Json([string]$path) {
    if (-not (Test-Path $path)) { return $null }
    $t = Get-Content -Raw -Encoding utf8 $path
    $o = $t | ConvertFrom-Json
    if ($o -is [string]) { $o = $o | ConvertFrom-Json }   # ExecuteScript results are JSON string literals
    return $o
}

function Save-Results([string]$from, [string]$name) {
    $dst = Join-Path $Results $name
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    foreach ($f in 'game.json', 'game.png', 'home.png', 'native.png', 'player.log', 'error.txt') {
        $src = Join-Path $from $f
        if (Test-Path $src) { Copy-Item $src $dst }
    }
}

# ------------------------------------------------------------------ 1. --inspect
function Inspect([string]$apk, [string]$name) {
    $out = Join-Path $Work "$name.json"
    $code = Invoke-Player $Exe @('--inspect', $apk, $out) 60
    $j = Read-Json $out
    if ($j) { Copy-Item $out (Join-Path $Results "inspect-$name.json") }
    return @{ code = $code; json = $j }
}

$r = Inspect $BashBaqiApk 'bashbaqi'
Check 'inspect Bash Baqi' ($r.code -eq 0 -and $r.json.package -eq 'com.neurio.bashbaqi' -and $r.json.kind -eq 'web') `
    "exit=$($r.code) package=$($r.json.package) kind=$($r.json.kind) framework=$($r.json.framework) entry=$($r.json.entry)"

# same APK from a folder and file name in Arabic script (Unicode paths)
$arabicDir = Join-Path $Work ([string]::new([char[]](0x0644, 0x0639, 0x0628, 0x0020, 0x0628, 0x0627, 0x0634)))
New-Item -ItemType Directory -Force -Path $arabicDir | Out-Null
$arabicApk = Join-Path $arabicDir (([string]::new([char[]](0x0628, 0x0627, 0x0634, 0x0020, 0x0628, 0x0627, 0x0642, 0x064A))) + '.apk')
Copy-Item $BashBaqiApk $arabicApk
$r = Inspect $arabicApk 'arabic-path'
Check 'inspect from an Arabic path' ($r.code -eq 0 -and $r.json.package -eq 'com.neurio.bashbaqi') "exit=$($r.code) package=$($r.json.package)"

$r = Inspect $CordovaApk 'cordova'
Check 'inspect Cordova fixture' ($r.code -eq 0 -and $r.json.framework -eq 'Cordova' -and $r.json.kind -eq 'web' -and -not $r.json.keyboard) `
    "exit=$($r.code) framework=$($r.json.framework) kind=$($r.json.kind) keyboard=$($r.json.keyboard)"

$r = Inspect $UnityApk 'unity'
Check 'inspect Unity fixture' ($r.code -eq 0 -and $r.json.kind -eq 'native' -and $r.json.framework -eq 'Unity') `
    "exit=$($r.code) kind=$($r.json.kind) framework=$($r.json.framework)"

$bad = Join-Path $Work 'not-an-apk.apk'
Set-Content -Path $bad -Value 'hello' -Encoding ascii
$r = Inspect $bad 'invalid'
Check 'inspect rejects a broken file' ($r.code -eq 3 -and $r.json.error) "exit=$($r.code) error='$($r.json.error)'"

# ------------------------------------------------------------------ 2. smoke runs (real WebView2 window)
$smokeRoot = Join-Path $Work 'runs'
function Smoke([string]$exe, [string]$name, [string[]]$apks) {
    $out = Join-Path $smokeRoot $name
    $argv = @('--smoke-test', $apks[0], $out)
    if ($apks.Count -gt 1) { $argv += $apks[1] }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $code = Invoke-Player $exe $argv 240
    $sw.Stop()
    Save-Results $out $name
    Start-Sleep -Seconds 5   # let the WebView2 browser processes release the profile
    $err = if (Test-Path "$out\error.txt") { (Get-Content -Raw "$out\error.txt").Trim() } else { '' }
    return @{ code = $code; json = (Read-Json "$out\game.json"); out = $out; secs = [int]$sw.Elapsed.TotalSeconds; err = $err }
}

$s = Smoke $Exe 'bashbaqi' @($BashBaqiApk, $UnityApk)
$g = $s.json
Check 'smoke: Bash Baqi runs (x64)' ($s.code -eq 0 -and $g -and $g.canvases -ge 1 -and $g.storage -eq $true) `
    "exit=$($s.code) $($s.secs)s err='$($s.err)' title='$($g.title)' canvases=$($g.canvases) size=$($g.size -join 'x') webgl='$($g.webgl)' errors=$(@($g.errors).Count)"
if ($g) {
    Write-Output "  ua: $($g.ua)"
    Write-Output "  touch: maxTouchPoints=$($g.maxTouchPoints) ontouchstart=$($g.ontouchstart)"
    Write-Output "  errors: $(@($g.errors) -join ' || ')"
    Write-Output "  text: $($g.text)"
}
Check 'smoke: Bash Baqi runs without JavaScript errors' ($g -and @($g.errors).Count -eq 0) "errors=$(@($g.errors) -join ' || ')"
Check 'smoke: Bash Baqi starts in keyboard mode' ($g -and $g.maxTouchPoints -le 1) "maxTouchPoints=$($g.maxTouchPoints)"
Check 'smoke: app user-agent token (fast mode)' ($g -and $g.ua -match 'BashBaqiAPK/1\.0') "ua='$($g.ua)'"
Check 'smoke: screenshots (game, library, native dialog)' ((Test-Path "$($s.out)\game.png") -and (Test-Path "$($s.out)\home.png") -and (Test-Path "$($s.out)\native.png")) ''

$s = Smoke $Exe 'cordova' @($CordovaApk)
$g = $s.json
Check 'smoke: Cordova fires deviceready' ($s.code -eq 0 -and $g -and $g.title -eq 'DEVICE READY') "exit=$($s.code) title='$($g.title)' err='$($s.err)' errors=$(@($g.errors) -join ' || ')"
Check 'smoke: Cordova app gets touch input' ($g -and $g.maxTouchPoints -eq 5 -and $g.ontouchstart -eq $true) "maxTouchPoints=$($g.maxTouchPoints) ontouchstart=$($g.ontouchstart) ua='$($g.ua)'"

$s = Smoke $Exe 'bashbaqi-again' @($BashBaqiApk)
$g = $s.json
Check 'smoke: game saves persist between runs' ($s.code -eq 0 -and $g -and $g.storagePrev -eq '1') "exit=$($s.code) storagePrev='$($g.storagePrev)'"

$s = Smoke $Exe32 'bashbaqi-32bit' @($BashBaqiApk)
$g = $s.json
Check 'smoke: 32-bit build runs' ($s.code -eq 0 -and $g -and $g.canvases -ge 1) "exit=$($s.code) $($s.secs)s canvases=$($g.canvases) err='$($s.err)'"

# ------------------------------------------------------------------ summary
$x64 = Get-Item $Exe
$x86 = Get-Item $Exe32
$wv = (Get-ItemProperty -ErrorAction SilentlyContinue 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}').pv
$summary = @(
    '# Neurio APK Player - CI smoke test',
    '',
    "* commit: $env:GITHUB_SHA",
    "* NeurioApkPlayer.exe: $([math]::Round($x64.Length / 1KB)) KB, NeurioApkPlayer-32bit.exe: $([math]::Round($x86.Length / 1KB)) KB",
    "* WebView2 runtime on the runner: $wv",
    "* OS: $([Environment]::OSVersion.VersionString)",
    '',
    '| result | check | details |',
    '|---|---|---|'
) + $script:rows
$summary | Set-Content -Encoding utf8 (Join-Path $Results 'summary.md')
if ($env:GITHUB_STEP_SUMMARY) { $summary | Add-Content -Encoding utf8 $env:GITHUB_STEP_SUMMARY }

if ($script:failures.Count -gt 0) {
    Write-Output "$($script:failures.Count) check(s) failed"
    exit 1
}
Write-Output 'all checks passed'
exit 0
