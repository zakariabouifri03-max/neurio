$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    throw '.NET 10 SDK was not found. Install the x64 .NET 10 SDK, then rerun build.ps1.'
}

$SdkList = dotnet --list-sdks
if ($LASTEXITCODE -ne 0 -or -not ($SdkList -match '^10\.')) {
    throw 'TurboLoad Pro targets .NET 10. Install a supported .NET 10 SDK before building.'
}

Write-Host 'Restoring solution packages…'
dotnet restore .\TurboLoadPro.sln
if ($LASTEXITCODE -ne 0) { throw 'Package restore failed.' }

Write-Host 'Running automated transfer and recovery tests…'
dotnet test .\TurboLoadPro.sln -c Release --no-restore
if ($LASTEXITCODE -ne 0) { throw 'Tests failed; publish was stopped.' }

$PublishDirectory = Join-Path $ProjectRoot 'artifacts\publish\win-x64'
Write-Host "Publishing standalone Windows x64 executable to $PublishDirectory …"
dotnet publish .\src\TurboLoadPro.App\TurboLoadPro.App.csproj `
    -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:PublishReadyToRun=true `
    -p:DebugType=None -p:DebugSymbols=false `
    -o $PublishDirectory
if ($LASTEXITCODE -ne 0) { throw 'Self-contained publish failed.' }

$Exe = Join-Path $PublishDirectory 'TurboLoadPro.exe'
if (-not (Test-Path $Exe)) { throw "Publish did not produce $Exe" }
Write-Host "Standalone executable: $Exe"

$Iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if ($Iscc) {
    Write-Host 'Building the optional per-user installer…'
    New-Item -ItemType Directory -Force (Join-Path $ProjectRoot 'artifacts\installer') | Out-Null
    & $Iscc.Source .\installer\TurboLoadPro.iss
    if ($LASTEXITCODE -ne 0) { throw 'Inno Setup installer build failed.' }
} else {
    Write-Host 'Inno Setup was not found; the standalone EXE is ready. Install Inno Setup 6 and rerun to create the optional installer.'
}
