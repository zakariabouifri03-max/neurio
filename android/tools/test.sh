#!/usr/bin/env bash
# Runs the extractor/sniffer tests on the JVM (no phone, no emulator needed).
#
#   bash android/tools/test.sh
#
# Compiles android/app/java with ecj against android.jar and runs ExtractTest
# with the test-only org.json shim in tools/test/.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ANDROID="$(cd "$HERE/.." && pwd)"
TC="${ANDROID_TOOLCHAIN:-/opt/android-toolchain}"
OUT="$ANDROID/build/test"

if [ ! -f "$TC/tools/android.jar" ]; then
  echo "[test] toolchain missing -> fetching it"
  bash "$ANDROID/tools/fetch-toolchain.sh"
fi

rm -rf "$OUT"
mkdir -p "$OUT/classes"

# R.java comes from aapt2; generate it once if it is not there yet
GEN="$ANDROID/build/gen"
if [ ! -f "$GEN/ma/zakaria/reelsoffline/R.java" ]; then
  echo "[test] generating R.java (aapt2)"
  mkdir -p "$GEN" "$ANDROID/build/genres"
  "$TC/aapt2" compile --dir "$ANDROID/app/res" -o "$ANDROID/build/genres/res.zip"
  "$TC/aapt2" link -o "$ANDROID/build/genres/base.apk" -I "$TC/tools/android.jar" \
    --manifest "$ANDROID/app/AndroidManifest.xml" --java "$GEN" \
    --min-sdk-version 21 --target-sdk-version 34 "$ANDROID/build/genres/res.zip"
fi

find "$ANDROID/app/java" "$GEN" "$HERE/test" -name '*.java' > "$OUT/sources.txt"
echo "[test] compiling $(wc -l < "$OUT/sources.txt") sources (ecj)"
"$TC/jdk/bin/java" -jar "$TC/tools/ecj-3.45.0.jar" \
  -source 1.8 -target 1.8 -encoding UTF-8 -nowarn -proc:none \
  -classpath "$TC/tools/android.jar" \
  -d "$OUT/classes" @"$OUT/sources.txt"

echo "[test] running"
# android.jar first would shadow the real implementations we need, so the test
# classes (with our org.json shim) come first on the classpath
"$TC/jdk/bin/java" -cp "$OUT/classes:$TC/tools/android.jar" ExtractTest
