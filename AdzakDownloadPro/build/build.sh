#!/usr/bin/env bash
#
# Build and test ADZAK DOWNLOAD PRO on Linux/macOS.
#
# Requirements: .NET 8 SDK (https://dotnet.microsoft.com/download/dotnet/8.0)
#
# The test suite runs against a local scriptable HTTP server — no network needed.
#
# Publishing the Windows executable from Linux/macOS is possible but needs NuGet
# access for the Windows runtime pack (see the commented command below).
#
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Restore"
dotnet restore AdzakDownloadPro.sln

echo "==> Test (AdzakDownloadPro.Tests)"
dotnet run --project tests/AdzakDownloadPro.Tests/AdzakDownloadPro.Tests.csproj -c Release

echo "==> Build (WPF app, Windows target)"
# Cross-building the WindowsDesktop target from Linux requires the Windows Desktop
# reference pack from NuGet. On a machine with NuGet access this works:
#   dotnet publish src/AdzakDownloadPro/AdzakDownloadPro.csproj -c Release -r win-x64 \
#       --self-contained true -p:PublishSingleFile=true \
#       -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableWindowsTargeting=true \
#       -o publish
# The recommended path is to run build/build.ps1 on Windows.
echo "    (skipped — run build/build.ps1 on Windows to produce ADZAK-DOWNLOAD-PRO.exe)"

echo "==> Done."
