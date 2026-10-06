param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$resourceDir = Join-Path $projectRoot 'src-tauri\resources'
$ffmpegPath = Join-Path $resourceDir 'ffmpeg.exe'
$ffprobePath = Join-Path $resourceDir 'ffprobe.exe'
$licensePath = Join-Path $resourceDir 'FFMPEG-LICENSE.txt'

if ((Test-Path $ffmpegPath) -and (Test-Path $ffprobePath) -and (Test-Path $licensePath) -and -not $Force) {
  Write-Host "FFmpeg resources already prepared: $resourceDir"
  exit 0
}

New-Item -ItemType Directory -Force -Path $resourceDir | Out-Null
$tempRoot = Join-Path $env:TEMP ("nexus-ffmpeg-" + [guid]::NewGuid().ToString('N'))
$zipPath = Join-Path $tempRoot 'ffmpeg.zip'
$extractPath = Join-Path $tempRoot 'extract'
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

try {
  $uri = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
  Write-Host 'Downloading the FFmpeg Windows essentials build for the installer…'
  Invoke-WebRequest -Uri $uri -OutFile $zipPath
  $archiveHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath -Force

  $binary = Get-ChildItem -Path $extractPath -Filter ffmpeg.exe -File -Recurse | Select-Object -First 1
  if (-not $binary) { throw 'The downloaded FFmpeg archive did not contain ffmpeg.exe.' }
  $binDir = $binary.Directory.FullName
  $probe = Join-Path $binDir 'ffprobe.exe'
  if (-not (Test-Path $probe)) { throw 'The downloaded FFmpeg archive did not contain the matching ffprobe.exe.' }

  $license = Get-ChildItem -Path $extractPath -File -Recurse |
    Where-Object { $_.Name -match '^(?i:LICENSE|COPYING)(\.txt|\.gplv3)?$' } |
    Select-Object -First 1

  Copy-Item -LiteralPath $binary.FullName -Destination $ffmpegPath -Force
  Copy-Item -LiteralPath $probe -Destination $ffprobePath -Force
  if ($license) {
    Copy-Item -LiteralPath $license.FullName -Destination $licensePath -Force
    $licenseDescription = $license.FullName.Substring($extractPath.Length + 1)
  } else {
    $licenseUrl = 'https://git.ffmpeg.org/gitweb/ffmpeg.git/blob_plain/HEAD:/COPYING.GPLv3'
    Invoke-WebRequest -Uri $licenseUrl -OutFile $licensePath
    if ((Get-Item -LiteralPath $licensePath).Length -lt 10000) { throw 'Could not obtain the complete FFmpeg GPL license notice.' }
    $licenseDescription = "FFmpeg COPYING.GPLv3 downloaded from $licenseUrl"
  }

  $versionLine = (& $ffmpegPath -version 2>&1 | Select-Object -First 1 | Out-String).Trim()
  @"

Bundled binary provenance
-------------------------
Archive URL: $uri
Downloaded archive SHA-256: $archiveHash
FFmpeg version: $versionLine
Upstream license source: $licenseDescription

The binaries above are redistributed from the Gyan.dev FFmpeg essentials build.
Review its build configuration, exact corresponding source, and applicable license
obligations before redistributing this installer. Upstream build/source information:
https://www.gyan.dev/ffmpeg/builds/
https://ffmpeg.org/download.html
"@ | Add-Content -LiteralPath $licensePath -Encoding UTF8

  Write-Host 'Bundled tools and upstream license prepared:'
  Get-Item $ffmpegPath, $ffprobePath, $licensePath | Select-Object Name, Length | Format-Table -AutoSize
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
