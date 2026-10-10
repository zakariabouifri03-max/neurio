# Downloads the official FFmpeg "essentials" static build from gyan.dev
# and extracts ffmpeg.exe + ffprobe.exe into <repo>\ffmpeg\bin.
# The build is LGPL/GPL licensed - see LICENSES.md before redistributing.
$ErrorActionPreference = "Stop"

$root   = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root "ffmpeg\bin"
if (Test-Path (Join-Path $target "ffmpeg.exe")) {
    Write-Host "ffmpeg already present."
    exit 0
}

$url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
$zip = Join-Path $env:TEMP "ffmpeg-essentials.zip"
$extract = Join-Path $env:TEMP "ffmpeg-extract"

Write-Host "Downloading $url ..."
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
Write-Host "Extracting..."
if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $extract -Force

$binSrc = Get-ChildItem -Path $extract -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
if (-not $binSrc) { throw "ffmpeg.exe not found inside archive" }
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item $binSrc.FullName (Join-Path $target "ffmpeg.exe") -Force
$probe = Join-Path $binSrc.DirectoryName "ffprobe.exe"
if (Test-Path $probe) { Copy-Item $probe (Join-Path $target "ffprobe.exe") -Force }

Remove-Item $extract -Recurse -Force
Remove-Item $zip -Force
Write-Host "FFmpeg installed to $target"
