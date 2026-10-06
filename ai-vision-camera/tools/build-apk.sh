#!/usr/bin/env bash
# ============================================================================
# AI Vision Camera - APK build (no Gradle, no network, no third-party deps)
#
#   resources -> aapt2 compile / link        (resources + R.java + manifest)
#   java      -> javac against android.jar   (framework only, Java 8 bytecode)
#   bytecode  -> d8                          (dex)
#   package   -> zip + zipalign + apksigner  (v1 + v2 signature)
#
# usage: bash tools/build-apk.sh [--release] [--install]
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${ANDROID_TOOLCHAIN_ROOT:-/opt}"
JAVA_HOME="${JAVA_HOME:-$ROOT/jdk17}"
SDK="${ANDROID_SDK_ROOT:-$ROOT/android}"
BT="$SDK/build-tools/34.0.0"
AJ="$SDK/platforms/android-34/android.jar"

APP="$HERE/app"
BUILD="$HERE/build"
OUT="$HERE/out"
DEBUG="${DEBUG:-false}"
[ "${1:-}" = "--release" ] && DEBUG=false

export PATH="$JAVA_HOME/bin:$PATH"

say() { printf '\n\033[36m==>\033[0m %s\n' "$*"; }

for f in "$BT/aapt2" "$BT/d8" "$BT/zipalign" "$BT/apksigner" "$JAVA_HOME/bin/javac" "$AJ"; do
  [ -e "$f" ] || { echo "missing $f - run tools/setup-toolchain.sh first" >&2; exit 1; }
done

MIN_SDK=24
TARGET_SDK=34
VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-1.0.0}"
PKG_DEX="$BUILD/dex"
APK_UNSIGNED="$BUILD/app-unsigned.apk"
APK_ALIGNED="$BUILD/app-aligned.apk"
APK_SIGNED="$OUT/AIVisionCamera.apk"
KS="$HERE/tools/aivision-release.keystore"
KS_PASS="aivision"
KS_ALIAS="aivision"

rm -rf "$BUILD"
mkdir -p "$BUILD/flat" "$BUILD/gen" "$BUILD/classes" "$PKG_DEX" "$OUT"

say "1/6 aapt2 compile resources"
"$BT/aapt2" compile --dir "$APP/res" -o "$BUILD/flat"

say "2/6 aapt2 link (manifest + resources + R.java)"
"$BT/aapt2" link \
  -o "$BUILD/base.apk" \
  -I "$AJ" \
  --manifest "$APP/AndroidManifest.xml" \
  --java "$BUILD/gen" \
  --min-sdk-version "$MIN_SDK" \
  --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME" \
  --no-version-vectors \
  $(find "$BUILD/flat" -name '*.flat' | sort)

say "3/6 javac"
find "$APP/src" "$BUILD/gen" -name '*.java' > "$BUILD/sources.txt"
"$JAVA_HOME/bin/javac" \
  -encoding UTF-8 \
  -source 8 -target 8 \
  -nowarn -Xlint:-options \
  -bootclasspath "$AJ" -cp "$AJ" \
  -d "$BUILD/classes" \
  @"$BUILD/sources.txt"

say "4/6 d8 (dex)"
find "$BUILD/classes" -name '*.class' > "$BUILD/classes.txt"
"$BT/d8" --release --min-api "$MIN_SDK" --lib "$AJ" \
  --output "$PKG_DEX" @"$BUILD/classes.txt"

say "5/6 package + zipalign"
cp "$BUILD/base.apk" "$APK_UNSIGNED"
(cd "$PKG_DEX" && zip -q -X "$APK_UNSIGNED" classes.dex)
"$BT/zipalign" -f -p 4 "$APK_UNSIGNED" "$APK_ALIGNED"

say "6/6 sign"
if [ ! -f "$KS" ]; then
  echo "generating signing key ($KS)"
  keytool -genkeypair -keystore "$KS" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias "$KS_ALIAS" -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=AI Vision Camera, O=AI Vision, C=US" >/dev/null 2>&1
fi
"$BT/apksigner" sign \
  --ks "$KS" --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" --ks-key-alias "$KS_ALIAS" \
  --v1-signing-enabled true --v2-signing-enabled true \
  --out "$APK_SIGNED" "$APK_ALIGNED"
"$BT/apksigner" verify --print-certs "$APK_SIGNED" | head -4

say "done"
ls -la "$APK_SIGNED"
"$BT/aapt2" dump badging "$APK_SIGNED" | grep -E "^(package|application-label|launchable-activity|uses-permission|uses-feature)" | head -20

if [ "${1:-}" = "--install" ] || [ "${2:-}" = "--install" ]; then
  adb install -r "$APK_SIGNED"
fi
