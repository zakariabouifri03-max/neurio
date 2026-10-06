#!/usr/bin/env bash
# Builds ReelsOffline.apk without Gradle and without the Android SDK manager:
# aapt2 (resources) -> ecj (javac) -> d8 (dex) -> zipalign.py -> apksigner.
#
#   bash android/build.sh
#
# Everything lands in android/build/, the final apk is copied to
# android/ReelsOffline.apk
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TC="${ANDROID_TOOLCHAIN:-/opt/android-toolchain}"

if [ ! -f "$TC/tools/d8.jar" ] || [ ! -x "$TC/aapt2" ]; then
  echo "[build] toolchain missing -> fetching it first"
  bash "$HERE/tools/fetch-toolchain.sh"
fi

JAVA="$TC/jdk/bin/java"
AAPT2="$TC/aapt2"
D8="$TC/tools/d8.jar"
ECJ="$TC/tools/ecj-3.45.0.jar"
ANDROID_JAR="$TC/tools/android.jar"
SIGNER="$TC/tools/apksigner.jar"
KS="$HERE/reelsoffline.keystore"
KSPASS="reelsoffline"
MIN_SDK=21
TARGET_SDK=34

OUT="$HERE/build"
rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/gen" "$OUT/dex"

# ---------------------------------------------------------------- assets
mkdir -p "$HERE/app/assets/games"
if [ -f "$ROOT/bash-baqi-racing.html" ]; then
  cp "$ROOT/bash-baqi-racing.html" "$HERE/app/assets/games/bash-baqi-racing.html"
  echo "[build] bundled offline game: $(du -h "$HERE/app/assets/games/bash-baqi-racing.html" | cut -f1)"
else
  echo "[build] warning: $ROOT/bash-baqi-racing.html not found, the game tab will be empty"
fi

# ------------------------------------------------------------- resources
echo "[build] aapt2 compile"
"$AAPT2" compile --dir "$HERE/app/res" -o "$OUT/res.zip"
echo "[build] aapt2 link"
"$AAPT2" link \
  -o "$OUT/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$HERE/app/AndroidManifest.xml" \
  -A "$HERE/app/assets" \
  --java "$OUT/gen" \
  --min-sdk-version "$MIN_SDK" \
  --target-sdk-version "$TARGET_SDK" \
  --version-code 1 --version-name 1.0 \
  "$OUT/res.zip"

# ------------------------------------------------------------ java -> dex
echo "[build] compiling java (ecj)"
find "$HERE/app/java" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
"$JAVA" -jar "$ECJ" \
  -source 1.8 -target 1.8 -encoding UTF-8 -nowarn -proc:none \
  -classpath "$ANDROID_JAR" \
  -d "$OUT/classes" \
  @"$OUT/sources.txt"

echo "[build] dexing (d8)"
find "$OUT/classes" -name '*.class' > "$OUT/classes.txt"
"$JAVA" -cp "$D8" com.android.tools.r8.D8 \
  --min-api "$MIN_SDK" --lib "$ANDROID_JAR" \
  --output "$OUT/dex" @"$OUT/classes.txt"

# ---------------------------------------------------------------- package
echo "[build] packaging"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
python3 - "$OUT/unsigned.apk" "$OUT/dex/classes.dex" <<'PY'
import shutil, sys, zipfile
apk, dex = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(apk, "a", zipfile.ZIP_DEFLATED) as z:
    z.write(dex, "classes.dex")
print("   + classes.dex (%d KB)" % (len(open(dex, 'rb').read()) // 1024))
PY
python3 "$HERE/tools/zipalign.py" -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

# ------------------------------------------------------------------- sign
if [ ! -f "$KS" ]; then
  echo "[build] creating the signing keystore (keep it to publish updates!)"
  "$TC/jdk/bin/keytool" -genkeypair -v -keystore "$KS" -alias reels \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass "$KSPASS" -keypass "$KSPASS" \
    -dname "CN=Reels Offline, O=Zakaria, L=Fes, C=MA" >/dev/null 2>&1
fi

echo "[build] signing (v1 + v2 + v3)"
"$JAVA" -jar "$SIGNER" sign \
  --ks "$KS" --ks-pass "pass:$KSPASS" --key-pass "pass:$KSPASS" \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --min-sdk-version "$MIN_SDK" \
  --out "$OUT/ReelsOffline.apk" "$OUT/aligned.apk"

echo "[build] verifying"
"$JAVA" -jar "$SIGNER" verify --print-certs --min-sdk-version "$MIN_SDK" "$OUT/ReelsOffline.apk" \
  > "$OUT/verify.txt" 2>&1 || { cat "$OUT/verify.txt"; exit 1; }
grep -E "Signer #1 certificate (DN|SHA-256)" "$OUT/verify.txt"

cp "$OUT/ReelsOffline.apk" "$HERE/ReelsOffline.apk"
echo
echo "[build] ✅ $HERE/ReelsOffline.apk  ($(du -h "$HERE/ReelsOffline.apk" | cut -f1))"
"$AAPT2" dump badging "$HERE/ReelsOffline.apk" > "$OUT/badging.txt" 2>&1 || true
sed -n '1,8p' "$OUT/badging.txt"
