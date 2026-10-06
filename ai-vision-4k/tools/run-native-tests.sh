#!/usr/bin/env bash
#
# Compiles and runs the platform-independent engine core on the host.
#
# This is the fastest way to validate a change: no device, no Gradle, no NDK.
# It covers profiles/presets, the thermal governor, the compatibility rule
# engine, metrics, image quality metrics, SHA-256, the model container, the CPU
# reference interpreter and the GPU execution plan (tensor shapes, slot reuse,
# memory budget). The Vulkan layer itself needs a device and is checked by
# tools/verify-native-sources.sh (syntax) plus the on-device self test.
#
# Usage:  tools/run-native-tests.sh [-v]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CPP="$ROOT/aiupscaler-sdk/src/main/cpp"
OUT="${TMPDIR:-/tmp}/v4k-native-tests"
CXX="${CXX:-g++}"
mkdir -p "$OUT"

SOURCES=(
  "$CPP"/core/*.cpp
  "$CPP"/ai/*.cpp
  "$CPP"/tests/*.cpp
)

echo "== compiling host test binary with $CXX =="
"$CXX" -std=c++17 -O1 -g \
  -Wall -Wextra -Wno-unused-parameter -Wno-missing-field-initializers \
  -I"$CPP" -I"$CPP/core" -I"$CPP/ai" -I"$CPP/tests" \
  "${SOURCES[@]}" -o "$OUT/v4k_tests"

echo "== running =="
"$OUT/v4k_tests" "$@"
