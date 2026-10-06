#!/usr/bin/env bash
# ============================================================================
# AI Vision Camera - offline Android toolchain setup
#
# Installs a complete, dependency-free Android build toolchain:
#   Temurin JDK 17  +  build-tools 34.0.0 (aapt2, d8, zipalign, apksigner)
#   +  platform-34 android.jar
#
# Everything comes from a public GitHub mirror because dl.google.com and
# maven.google.com are unreachable in restricted-network environments. The app
# itself has zero third-party dependencies, so nothing else is needed.
#
# Idempotent: re-running only downloads what is missing.
#   usage: bash tools/setup-toolchain.sh [install-root]   (default /opt)
# ============================================================================
set -euo pipefail

ROOT="${1:-/opt}"
MIRROR="whynusn/android-sdk-bundle"
# blob SHAs on that mirror (api.github.com works where raw.githubusercontent does not)
SHA_BUILDTOOLS="e534f1d50e9ad6d40bd43896bcdcaf054c5089ea"
SHA_PLATFORM="496a304710ffb19621e55d672ca03e30937f661f"
SHA_JDK_0="bcebbf5392b80d93a5569e75e888ceac387c12a9"
SHA_JDK_1="55e54de79c5fee51e33e281c0dfe8436a1b7ecb4"
SHA_JDK_2="b8391ddb85af44dc70e440367a9af113c93b616a"
JDK_SHA256="3808d1d15e3ec6bd5b84057fb5d84c33d8a1536a258146bcea2e603fc726e08e"

DL="${TMPDIR:-/tmp}/aivision-toolchain"
mkdir -p "$DL"
say() { printf '\n\033[36m==>\033[0m %s\n' "$*"; }
ok()  { printf '\033[32m[OK]\033[0m %s\n' "$*"; }

fetch_blob() { # sha, destination
  if [ -s "$2" ]; then ok "cached $(basename "$2")"; return; fi
  echo "downloading $(basename "$2")"
  gh api "/repos/$MIRROR/git/blobs/$1" -H "Accept: application/vnd.github.raw" > "$2"
  ok "$(basename "$2") $(stat -c%s "$2") bytes"
}

if ! command -v gh >/dev/null && ! command -v curl >/dev/null; then
  echo "need gh or curl" >&2; exit 1
fi

# ---------------------------------------------------------------- JDK 17
say "JDK 17 (Temurin, includes javac)"
if [ ! -x "$ROOT/jdk17/bin/javac" ]; then
  for i in 0 1 2; do
    case $i in
      0) S=$SHA_JDK_0;; 1) S=$SHA_JDK_1;; 2) S=$SHA_JDK_2;;
    esac
    fetch_blob "$S" "$DL/jdk17.part-$i"
  done
  cat "$DL/jdk17.part-0" "$DL/jdk17.part-1" "$DL/jdk17.part-2" > "$DL/jdk17.tar.gz"
  echo "$JDK_SHA256  $DL/jdk17.tar.gz" | sha256sum -c -
  mkdir -p "$ROOT/jdk17"
  tar xzf "$DL/jdk17.tar.gz" -C "$ROOT/jdk17" --strip-components=1
  ok "JDK installed: $("$ROOT/jdk17/bin/javac" -version 2>&1)"
else
  ok "JDK already present"
fi

# ---------------------------------------------------------------- build-tools
say "Android build-tools 34.0.0 (aapt2, d8, zipalign, apksigner)"
if [ ! -x "$ROOT/android/build-tools/34.0.0/aapt2" ]; then
  fetch_blob "$SHA_BUILDTOOLS" "$DL/build-tools.zip"
  rm -rf "$DL/bt" && mkdir -p "$DL/bt"
  unzip -q -o "$DL/build-tools.zip" -d "$DL/bt"
  mkdir -p "$ROOT/android/build-tools"
  rm -rf "$ROOT/android/build-tools/34.0.0"
  mv "$DL/bt"/android-* "$ROOT/android/build-tools/34.0.0"
  ok "build-tools installed"
else
  ok "build-tools already present"
fi

# ---------------------------------------------------------------- platform
say "Android platform 34 (android.jar)"
if [ ! -f "$ROOT/android/platforms/android-34/android.jar" ]; then
  fetch_blob "$SHA_PLATFORM" "$DL/platform-34.zip"
  rm -rf "$DL/pf" && mkdir -p "$DL/pf"
  unzip -q -o "$DL/platform-34.zip" -d "$DL/pf"
  mkdir -p "$ROOT/android/platforms"
  rm -rf "$ROOT/android/platforms/android-34"
  mv "$DL/pf"/android-34 "$ROOT/android/platforms/android-34"
  ok "android.jar installed"
else
  ok "platform already present"
fi

say "Toolchain ready"
echo "  JAVA_HOME=$ROOT/jdk17"
echo "  ANDROID_SDK=$ROOT/android"
echo
echo "Now build the APK:  bash tools/build-apk.sh"
