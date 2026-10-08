param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ChromeExtensionId,
  [Parameter(Mandatory=$true)][string]$AppExePath
)

$ErrorActionPreference = 'Stop'
$resolvedExe = (Resolve-Path $AppExePath).Path
$hostName = 'com.neurio.aidownloadmanagerpro'
$hostDirectory = Join-Path $env:APPDATA 'AI Download Manager Pro\native-host'
New-Item -ItemType Directory -Force -Path $hostDirectory | Out-Null

function Write-HostManifest([string]$browser, [string]$allowedKey, [object]$allowedValue) {
  $manifestPath = Join-Path $hostDirectory "$browser-host.json"
  $manifest = [ordered]@{
    name = $hostName
    description = 'AI Download Manager Pro native browser bridge'
    path = $resolvedExe
    type = 'stdio'
    args = @('--native-host')
  }
  $manifest[$allowedKey] = $allowedValue
  $json = $manifest | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText($manifestPath, $json, [System.Text.UTF8Encoding]::new($false))
  return $manifestPath
}

$chromeManifest = Write-HostManifest 'chrome' 'allowed_origins' @("chrome-extension://$ChromeExtensionId/")
$edgeManifest = Write-HostManifest 'edge' 'allowed_origins' @("chrome-extension://$ChromeExtensionId/")
$firefoxManifest = Write-HostManifest 'firefox' 'allowed_extensions' @('aidmp@neurio.local')

$registrations = @(
  @{ Key = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.neurio.aidownloadmanagerpro'; Value = $chromeManifest },
  @{ Key = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.neurio.aidownloadmanagerpro'; Value = $edgeManifest },
  @{ Key = 'HKCU:\Software\Mozilla\NativeMessagingHosts\com.neurio.aidownloadmanagerpro'; Value = $firefoxManifest }
)
foreach ($registration in $registrations) {
  New-Item -Path $registration.Key -Force | Out-Null
  Set-Item -Path $registration.Key -Value $registration.Value
}
Write-Host 'Native browser bridge registered for the current Windows user.'
Write-Host 'Load browser-extension as an unpacked extension and use its extension ID when running this script.'
