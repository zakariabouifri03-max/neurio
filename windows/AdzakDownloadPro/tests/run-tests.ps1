$ErrorActionPreference = 'Stop'
$logPath = Join-Path $PWD 'recovery-test.log'
$errorPath = Join-Path $PWD 'recovery-test-error.log'

$process = Start-Process -FilePath 'dotnet' -ArgumentList @(
    'run',
    '--project', 'windows/AdzakDownloadPro/tests/AdzakDownloadPro.Tests/AdzakDownloadPro.Tests.csproj',
    '--configuration', 'Release'
) -NoNewWindow -Wait -PassThru -RedirectStandardOutput $logPath -RedirectStandardError $errorPath

$stdout = if (Test-Path $logPath) { Get-Content $logPath -Raw } else { '' }
$stderr = if (Test-Path $errorPath) { Get-Content $errorPath -Raw } else { '' }
$details = ($stdout + "`n" + $stderr).Trim()
if ($details) { Write-Output $details }

if ($process.ExitCode -ne 0) {
    $summary = $details -replace "`r?`n", ' | '
    $summary = $summary.Replace('%', '%25').Replace(':', '%3A').Replace(',', '%2C')
    if ($summary.Length -gt 4000) { $summary = $summary.Substring(0, 4000) }
    Write-Output "::error title=Recovery tests or build failed::$summary"
    Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value ("## Recovery test/build failure`n`n```text`n" + $details + "`n```")
}

exit $process.ExitCode
