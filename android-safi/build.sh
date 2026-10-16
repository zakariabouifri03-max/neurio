#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
: "${SDK:?Set ANDROID_HOME to an Android SDK with platform 35 and build-tools 35.0.0}"
TOOLS="$SDK/build-tools/35.0.0"
PLATFORM="$SDK/platforms/android-35/android.jar"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT
mkdir -p "$BUILD/classes" "$BUILD/dex" "$BUILD/assets" "$BUILD/res/drawable" deliverables
cp android-safi/res/drawable/icon.png "$BUILD/res/drawable/icon.png"
cp sound/{index.html,app.js,style.css,dsp.mjs,limiter-worklet.js,icon.svg,icon-192.png,icon-512.png,manifest.webmanifest} "$BUILD/assets/"
# Assets are shipped inside the APK: no external hosting or service worker needed.
python3 - "$BUILD/assets" <<'PY'
import sys
from pathlib import Path
assets=Path(sys.argv[1])
p=assets/'index.html'
s=p.read_text().replace('<head>', '<head>\n<script>window.SAFI_ANDROID = true;</script>', 1)
s=s.replace('Install from your browser menu', 'This Android app is already installed. On the web version: install from your browser menu')
p.write_text(s)
p=assets/'app.js'
s=p.read_text().replace('"serviceWorker" in navigator && window.isSecureContext', '!window.SAFI_ANDROID && "serviceWorker" in navigator && window.isSecureContext')
# Fail the build rather than accidentally ship the wrong service worker behavior.
assert '!window.SAFI_ANDROID' in s, 'Update APK transform after app.js changes'
p.write_text(s)
PY
"$TOOLS/aapt2" compile --dir "$BUILD/res" -o "$BUILD/resources.zip"
"$TOOLS/aapt2" link -I "$PLATFORM" --manifest android-safi/AndroidManifest.xml \
  --min-sdk-version 26 --target-sdk-version 35 -A "$BUILD/assets" \
  -o "$BUILD/unsigned.apk" "$BUILD/resources.zip"
javac -encoding UTF-8 --release 8 -classpath "$PLATFORM" \
  -d "$BUILD/classes" android-safi/src/ma/safi/player/MainActivity.java
mapfile -t CLASSES < <(find "$BUILD/classes" -name '*.class' | sort)
"$TOOLS/d8" --lib "$PLATFORM" --min-api 26 --output "$BUILD/dex" "${CLASSES[@]}"
(cd "$BUILD/dex" && zip -q -j "$BUILD/unsigned.apk" classes*.dex)
"$TOOLS/zipalign" -p -f 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"
# Local test signing key is created ephemerally and is NEVER checked into Git.
# This produces a sideload/test build, not a Play Store production release.
keytool -genkeypair -noprompt -keystore "$BUILD/test-signing.p12" -storetype PKCS12 \
  -storepass android -keypass android -alias safi-test -keyalg RSA -keysize 2048 \
  -validity 3650 -dname 'CN=Safi Local Test Build,O=Safi,C=MA'
"$TOOLS/apksigner" sign --ks "$BUILD/test-signing.p12" --ks-key-alias safi-test \
  --ks-pass pass:android --key-pass pass:android --out deliverables/Safi-Sound.apk "$BUILD/aligned.apk"
"$TOOLS/apksigner" verify --verbose deliverables/Safi-Sound.apk
"$TOOLS/aapt2" dump badging deliverables/Safi-Sound.apk
sha256sum deliverables/Safi-Sound.apk > deliverables/Safi-Sound.apk.sha256
