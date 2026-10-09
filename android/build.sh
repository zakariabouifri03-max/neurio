#!/usr/bin/env bash
# Build an architecture-independent, development-signed APK without Gradle.
set -euo pipefail
cd "$(dirname "$0")/.."
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
: "${SDK:?Set ANDROID_HOME to an Android SDK installation}"
TOOLS="$SDK/build-tools/35.0.0"
PLATFORM="$SDK/platforms/android-35/android.jar"
OUT="$PWD/android/out"
mkdir -p "$OUT/web/src" "$OUT/web/assets" "$OUT/web/icons" "$OUT/classes" "$OUT/dex"
cp index.html manifest.webmanifest "$OUT/web/"
cp src/neurio.js src/neurio.css "$OUT/web/src/"
cp -R assets/. "$OUT/web/assets/"
cp icons/neurio-*.png "$OUT/web/icons/"
# This package contains only Neurio: no previous game, APK, tests, or node_modules.
"$TOOLS/aapt2" compile --dir android/res -o "$OUT/resources.zip"
"$TOOLS/aapt2" link -o "$OUT/unsigned.apk" -I "$PLATFORM" \
  --manifest android/AndroidManifest.xml -A "$OUT/web" "$OUT/resources.zip"
find android/src -name '*.java' -print0 | xargs -0 javac \
  -encoding UTF-8 -source 8 -target 8 -classpath "$PLATFORM" -d "$OUT/classes"
find "$OUT/classes" -name '*.class' -print0 | xargs -0 "$TOOLS/d8" \
  --lib "$PLATFORM" --min-api 26 --output "$OUT/dex"
zip -q -j "$OUT/unsigned.apk" "$OUT/dex/classes.dex"
"$TOOLS/zipalign" -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
# Ephemeral preview signing key. Never committed or distributed. Future preview
# builds may require uninstall/reinstall; export local plans before uninstalling.
if [ ! -f "$OUT/preview.keystore" ]; then
  keytool -genkeypair -noprompt -keystore "$OUT/preview.keystore" -alias neurio-preview \
    -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 3650 \
    -dname 'CN=Neurio Preview, O=Neurio, C=MA'
fi
APK="$OUT/Neurio-0.1.0-preview.apk"
"$TOOLS/apksigner" sign --ks "$OUT/preview.keystore" --ks-key-alias neurio-preview \
  --ks-pass pass:android --key-pass pass:android --min-sdk-version 26 \
  --out "$APK" "$OUT/aligned.apk"
"$TOOLS/apksigner" verify --verbose "$APK"
"$TOOLS/aapt2" dump badging "$APK" > "$OUT/package-info.txt"
grep "package: name='com.neurio.creator'" "$OUT/package-info.txt"
grep "launchable-activity: name='com.neurio.creator.MainActivity'" "$OUT/package-info.txt"
(cd "$OUT" && sha256sum Neurio-0.1.0-preview.apk > Neurio-0.1.0-preview.apk.sha256)
echo "Built: $APK"
