#!/usr/bin/env bash
# Downloads everything needed to build an Android APK on a machine WITHOUT the
# Android SDK / Gradle (all artifacts come from npm + PyPI, no Maven/Google).
#
#   bash android/tools/fetch-toolchain.sh
#
# Installs into $ANDROID_TOOLCHAIN (default: /opt/android-toolchain):
#   jdk/        Java runtime (jdk4py)  ....... java, keytool
#   tools/      d8.jar, android.jar, apksigner.jar, ecj.jar, debug.keystore   (npm: @drxiaozhi/minapk)
#   aapt2       linux x64 aapt2 binary ....... (npm: aaptjs3)
set -euo pipefail

TC="${ANDROID_TOOLCHAIN:-/opt/android-toolchain}"
NPM=https://registry.npmjs.org
log() { echo "[toolchain] $*"; }

if ! mkdir -p "$TC" 2>/dev/null; then
  log "creating $TC with sudo"
  sudo mkdir -p "$TC" && sudo chown -R "$(id -u):$(id -g)" "$TC"
fi
mkdir -p "$TC/tools" /tmp/tc-dl
cd /tmp/tc-dl

# --------------------------------------------------------------- Java runtime
if [ ! -x "$TC/jdk/bin/java" ]; then
  log "fetching JDK (jdk4py)"
  python3 -m venv "$TC/venv" >/dev/null 2>&1 || python3 -m venv --without-pip "$TC/venv"
  "$TC/venv/bin/pip" install --quiet --upgrade pip >/dev/null 2>&1 || true
  "$TC/venv/bin/pip" install --quiet jdk4py
  JDKSRC="$("$TC/venv/bin/python" -c 'import jdk4py,os;print(os.path.join(os.path.dirname(jdk4py.__file__),"java-runtime"))')"
  ln -sfn "$JDKSRC" "$TC/jdk"
fi
"$TC/jdk/bin/java" -version 2>&1 | head -1

# ------------------------------------------- d8, android.jar, apksigner, ecj
if [ ! -f "$TC/tools/d8.jar" ]; then
  log "fetching d8 / android.jar / apksigner / ecj (minapk)"
  curl -fsSL -o minapk.tgz "$NPM/@drxiaozhi/minapk/-/minapk-0.4.0.tgz"
  rm -rf minapk && mkdir minapk && tar xzf minapk.tgz -C minapk
  cp minapk/package/tools/{d8.jar,android.jar,apksigner.jar,ecj-3.45.0.jar,debug.keystore} "$TC/tools/"
fi

# -------------------------------------------------------------- aapt2 (linux)
if [ ! -x "$TC/aapt2" ]; then
  log "fetching aapt2 (aaptjs3)"
  curl -fsSL -o aaptjs3.tgz "$NPM/aaptjs3/-/aaptjs3-2.0.2.tgz"
  rm -rf aaptjs3 && mkdir aaptjs3 && tar xzf aaptjs3.tgz -C aaptjs3
  cp aaptjs3/package/bin/x64/linux/aapt2 "$TC/aapt2"
  chmod +x "$TC/aapt2"
fi

cat > "$TC/env.sh" <<EOF
# source me
export ANDROID_TOOLCHAIN=$TC
export JAVA_HOME=$TC/jdk
export PATH=$TC/jdk/bin:\$PATH
EOF

log "aapt2      : $("$TC/aapt2" version)"
log "java       : $("$TC/jdk/bin/java" -version 2>&1 | head -1)"
log "d8         : $("$TC/jdk/bin/java" -cp "$TC/tools/d8.jar" com.android.tools.r8.D8 --version 2>/dev/null | head -1)"
log "android.jar: $(stat -c%s "$TC/tools/android.jar") bytes"
log "ready -> source $TC/env.sh"
