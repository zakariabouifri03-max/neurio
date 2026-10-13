#!/usr/bin/env bash
# Exports the Android debug APK defined by the "Android" preset in export_presets.cfg.
#
# Requirements (not included in this repository):
#   - A Godot 4.7.x EDITOR binary (export needs the editor build, not a template build)
#   - Godot Android export templates for 4.7.x installed (Editor > Manage Export Templates)
#   - JDK 17 and the Android SDK (platform-tools, build-tools, platform 34+) configured in
#     Editor Settings > Export > Android, or via the ANDROID_HOME / JAVA_HOME variables.
#
# Usage:  GODOT=/path/to/Godot_v4.7.2-stable_linux.x86_64 tools/build_apk.sh
set -euo pipefail
GODOT="${GODOT:-godot}"
cd "$(dirname "$0")/.."
mkdir -p build
"$GODOT" --headless --path . --export-debug "Android" build/BlockStrikeRoyale-debug.apk
echo "Exported build/BlockStrikeRoyale-debug.apk"
