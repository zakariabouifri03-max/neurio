#!/usr/bin/env bash
# Local type-check of the AI VIBES engine code against stubs + android.jar.
#
# This does NOT replace the CI Gradle build; it catches API/signature mistakes
# early, without needing Google Maven or the Android SDK. Requires:
#   * kotlinc 2.x on PATH (e.g. npm i -g kotlin-compiler)
#   * ANDROID_JAR=/path/to/android.jar (e.g. API 34 platform jar)
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
APP_SRC="$HERE/../../app/src/main/kotlin/com/neurio/aivibes"
STUBS="$HERE/stubs"
OUT="${OUT:-/tmp/aivibes-compile-check}"

: "${ANDROID_JAR:?Set ANDROID_JAR to the android.jar of API 34+}"

# kotlinx-coroutines jar (bundled with the kotlin-compiler npm distribution).
COROUTINES_JAR="${COROUTINES_JAR:-}"
if [ -z "$COROUTINES_JAR" ]; then
  for cand in \
    "$(dirname "$(dirname "$(command -v kotlinc)")")/lib/kotlinx-coroutines-core-jvm.jar" \
    /tmp/kc/package/lib/kotlinx-coroutines-core-jvm.jar; do
    if [ -f "$cand" ]; then COROUTINES_JAR="$cand"; break; fi
  done
fi
: "${COROUTINES_JAR:?Set COROUTINES_JAR to kotlinx-coroutines-core-jvm.jar}"

mkdir -p "$OUT"

# Engine sources: everything except Compose UI and the Activity.
SOURCES=$(find "$APP_SRC" -name '*.kt' \
  ! -path '*/ui/*' \
  ! -name 'MainActivity.kt' | sort)

echo "== type-checking $(echo "$SOURCES" | wc -l) engine files + stubs =="
kotlinc -nowarn -cp "$ANDROID_JAR:$COROUTINES_JAR" \
  "$STUBS"/*.kt \
  $SOURCES \
  -d "$OUT" 2>&1 | grep -v "^warning:" || true

if [ -d "$OUT/com" ]; then
  echo "ENGINE TYPE-CHECK PASSED"
else
  echo "ENGINE TYPE-CHECK FAILED" >&2
  exit 1
fi
