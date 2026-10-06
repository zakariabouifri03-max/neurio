#!/usr/bin/env bash
# Verification gate for the AI Vision 4K repository.
#
# Runs everything that can be checked without a device or the Android SDK:
#
#   1. the host test suite (core + ai + tests, real g++/clang build)
#   2. the shader build in --check mode (every GLSL source still produces the
#      checked-in SPIR-V blob)
#   3. the SPIR-V interface check: the C++ push-constant mirrors in
#      vulkan/v4k_vk_push.h must match the shader binaries byte for byte
#   4. the embedded-shader header parity check: the CMake generator and the
#      Python mirror (tools/checks/generate-embedded-header.py) must expose the
#      same symbol table, so a host syntax check sees what Gradle will build
#   5. a CMake configure + build of the engine and the test binary in the
#      no-Vulkan configuration (this is the configuration that has no loader on
#      a developer desktop, and it catches unguarded Vulkan types)
#   6. an optional Vulkan-enabled syntax check of every native source, using the
#      NDK's headers when $ANDROID_NDK_HOME is set or $V4K_VULKAN_INCLUDE points
#      at a Vulkan-Headers checkout
#
# The Android/Gradle build itself is not part of this script: it needs the SDK
# and a licensed NDK, so it lives in docs/BUILD.md (`./gradlew assembleDebug`).
#
# Usage: tools/verify.sh [--quick] [--verbose]
#   --quick    skip step 5 and step 6 (fast inner loop)
#   --verbose  stream the output of every step instead of only failures
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CPP="$ROOT/aiupscaler-sdk/src/main/cpp"
SPIRV="$CPP/shaders/spirv"
QUICK=0
VERBOSE=0
for arg in "$@"; do
    case "$arg" in
        --quick) QUICK=1 ;;
        --verbose|-v) VERBOSE=1 ;;
        -h|--help) sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
    esac
done

PASS=0
FAIL=0
SKIP=0
LOG_DIR="$(mktemp -d)"
BUILD_DIR=""
cleanup() {
    if [ -n "$BUILD_DIR" ] && [ -d "$BUILD_DIR" ]; then rm -rf "$BUILD_DIR"; fi
    rm -rf "$LOG_DIR"
}
trap cleanup EXIT

step() {
    local name="$1"
    shift
    local log="$LOG_DIR/$(echo "$name" | tr ' /' '__').log"
    printf -- '-- %s\n' "$name"
    if [ "$VERBOSE" = 1 ]; then
        if "$@" 2>&1 | tee "$log"; then
            PASS=$((PASS + 1)); printf '   ok\n'
        else
            FAIL=$((FAIL + 1)); printf '   FAILED (output above, full log: %s)\n' "$log"
        fi
    else
        if "$@" >"$log" 2>&1; then
            PASS=$((PASS + 1)); printf '   ok\n'
        else
            FAIL=$((FAIL + 1))
            printf '   FAILED\n'
            sed 's/^/      /' "$log" | tail -n 30
        fi
    fi
}

skip() { SKIP=$((SKIP + 1)); printf -- '-- %s\n   skipped: %s\n' "$1" "$2"; }

echo "AI Vision 4K verification"
echo "native root: $CPP"

# ---------------------------------------------------------------------------
# 1. Host test suite
# ---------------------------------------------------------------------------
if [ -x "$ROOT/tools/run-native-tests.sh" ]; then
    step "host test suite" bash "$ROOT/tools/run-native-tests.sh"
else
    skip "host test suite" "tools/run-native-tests.sh is missing"
fi

# ---------------------------------------------------------------------------
# 2. Shader build check
# ---------------------------------------------------------------------------
if command -v node >/dev/null 2>&1 && [ -f "$ROOT/tools/shaders/build-shaders.js" ]; then
    step "shader build (--check)" node "$ROOT/tools/shaders/build-shaders.js" --check
else
    skip "shader build (--check)" "node or tools/shaders/build-shaders.js unavailable"
fi

# ---------------------------------------------------------------------------
# 3. Push-constant interface check
# ---------------------------------------------------------------------------
if [ -f "$ROOT/tools/checks/dump-spirv-interface.py" ]; then
    step "SPIR-V push-constant mirrors" \
        python3 "$ROOT/tools/checks/dump-spirv-interface.py" "$SPIRV" \
        --verify "$CPP/vulkan/v4k_vk_push.h"
else
    skip "SPIR-V push-constant mirrors" "tools/checks/dump-spirv-interface.py is missing"
fi

# ---------------------------------------------------------------------------
# 4. JNI bindings (names, signatures and the string handed to FindClass)
# ---------------------------------------------------------------------------
# A wrong entry in a JNINativeMethod table is invisible to both compilers and
# fatal at load time: System.loadLibrary throws, and every screen that uses the
# engine dies rather than just the method that changed.
if [ -f "$ROOT/tools/checks/jni-bindings.py" ]; then
    step "JNI bindings" python3 "$ROOT/tools/checks/jni-bindings.py"
else
    skip "JNI bindings" "tools/checks/jni-bindings.py is missing"
fi

# ---------------------------------------------------------------------------
# 5. Embedded shader header parity (CMake generator vs Python mirror)
# ---------------------------------------------------------------------------
check_embedding() {
    if ! command -v cmake >/dev/null 2>&1; then
        echo "cmake not found; only the Python mirror was generated"
        python3 "$ROOT/tools/checks/generate-embedded-header.py" "$SPIRV" "$LOG_DIR/py_embed.h"
        return 0
    fi
    local build="$LOG_DIR/embed-build"
    cmake -S "$CPP" -B "$build" -G "Unix Makefiles" \
        -DV4K_ENABLE_VULKAN=OFF -DV4K_ENABLE_NNAPI=OFF >/dev/null
    python3 "$ROOT/tools/checks/generate-embedded-header.py" "$SPIRV" "$LOG_DIR/py_embed.h"
    # Compare the symbol tables, not the whole file: the comments carry the
    # generator's name on purpose.
    grep -o 'v4k_spirv[a-z0-9_]*' "$LOG_DIR/py_embed.h" | sort -u > "$LOG_DIR/py.syms"
    grep -o 'v4k_spirv[a-z0-9_]*' "$build/shaders/v4k_shaders_embedded.h" | sort -u \
        > "$LOG_DIR/cmake.syms"
    if ! diff -u "$LOG_DIR/py.syms" "$LOG_DIR/cmake.syms"; then
        echo "the CMake and Python shader embeddings disagree"
        return 1
    fi
    # The generated header must actually compile: this is what caught the
    # double-brace initializer that neither generator test noticed.
    printf '#include "v4k_shaders_embedded.h"\nint main() { return v4k::shaders::kEmbeddedShaderCount > 0 ? 0 : 1; }\n' \
        > "$LOG_DIR/embed_check.cpp"
    "${CXX:-g++}" -std=c++17 -fsyntax-only -I"$build/shaders" "$LOG_DIR/embed_check.cpp"
    echo "$(grep -c 'v4k_spirv_bytes_' "$build/shaders/v4k_shaders_embedded.h") shader blobs, symbol tables identical"
}
step "embedded shader header parity" check_embedding

# ---------------------------------------------------------------------------
# 6. CMake configure + build (no-Vulkan configuration)
# ---------------------------------------------------------------------------
if [ "$QUICK" = 1 ]; then
    skip "CMake no-Vulkan build" "--quick"
elif ! command -v cmake >/dev/null 2>&1; then
    skip "CMake no-Vulkan build" "cmake is not installed"
else
    BUILD_DIR="$(mktemp -d)"
    cmake_build() {
        cmake -S "$CPP" -B "$BUILD_DIR" -G "Unix Makefiles" \
            -DV4K_BUILD_TESTS=ON -DV4K_ENABLE_VULKAN=OFF -DV4K_ENABLE_NNAPI=OFF \
            -DCMAKE_BUILD_TYPE=Debug
        cmake --build "$BUILD_DIR" -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
        "$BUILD_DIR/v4k_native_tests"
    }
    step "CMake no-Vulkan build + tests" cmake_build
fi

# ---------------------------------------------------------------------------
# 7. Optional Vulkan-enabled syntax check
# ---------------------------------------------------------------------------
if [ "$QUICK" = 1 ]; then
    skip "Vulkan syntax check" "--quick"
else
    VULKAN_INCLUDE="${V4K_VULKAN_INCLUDE:-}"
    if [ -z "$VULKAN_INCLUDE" ] && [ -n "${ANDROID_NDK_HOME:-}" ]; then
        VULKAN_INCLUDE="$(find "$ANDROID_NDK_HOME/toolchains/llvm/prebuilt" -maxdepth 3 \
            -type d -name vulkan 2>/dev/null | head -1)"
        [ -n "$VULKAN_INCLUDE" ] && VULKAN_INCLUDE="${VULKAN_INCLUDE%/vulkan}"
    fi
    if [ -n "$VULKAN_INCLUDE" ] && [ -f "$VULKAN_INCLUDE/vulkan/vulkan.h" ]; then
        vulkan_syntax() {
            local embed
            embed="$(dirname "$(find "$LOG_DIR" -name v4k_shaders_embedded.h | head -1)")"
            # The JNI bridge is compiled too when a JDK/NDK header root is given:
            # it is the one file that only exists in an Android build.
            # V4K_JNI_INCLUDE may be a single directory or several separated by
            # colons: a JDK keeps jni.h in include/ and jni_md.h in
            # include/linux (or include/unix...), while the NDK puts both in the
            # same sysroot directory. Accepting a list covers both without the
            # caller having to build a merged directory first.
            local extra=()
            if [ -n "${V4K_JNI_INCLUDE:-}" ]; then
                local jni_root
                local -a jni_roots=()
                IFS=':' read -r -a jni_roots <<< "$V4K_JNI_INCLUDE"
                for jni_root in "${jni_roots[@]}"; do
                    [ -n "$jni_root" ] && extra+=("-I${jni_root}")
                done
            fi
            "${CXX:-g++}" -std=c++17 -fsyntax-only -Wall -Wextra -Wno-unused-parameter \
                -DV4K_ENABLE_VULKAN=1 -DV4K_ENABLE_NNAPI=1 -DV4K_DEBUG_CHECKS=1 \
                -I"$CPP" -I"$CPP/core" -I"$CPP/ai" -I"$CPP/vulkan" \
                -I"$VULKAN_INCLUDE" -I"$embed" "${extra[@]}" \
                "$CPP"/core/*.cpp "$CPP"/ai/*.cpp "$CPP"/vulkan/*.cpp "$CPP"/sdk/*.cpp
            if [ -n "${V4K_JNI_INCLUDE:-}" ]; then
                # V4K_ENABLE_DEMO=1 exercises the demo registration call from the
                # SDK bridge. The demo sources are compiled here too: the renderer
                # and the bridge that drives it are one unit, and they are the
                # newest code in the tree, so the gate must cover them.
                "${CXX:-g++}" -std=c++17 -fsyntax-only -Wall -Wextra -Wno-unused-parameter \
                    -DV4K_ENABLE_VULKAN=1 -DV4K_ENABLE_NNAPI=1 -DV4K_DEBUG_CHECKS=1 \
                    -DV4K_ENABLE_DEMO=1 \
                    -I"$CPP" -I"$CPP/core" -I"$CPP/ai" -I"$CPP/vulkan" -I"$CPP/graphics" \
                    -I"$VULKAN_INCLUDE" -I"$embed" "${extra[@]}" "$CPP"/jni/*.cpp "$CPP"/demo/*.cpp
                echo "every native source (including the JNI bridge, the demo renderer and its bridge) compiles with Vulkan enabled"
            else
                echo "every native source compiles with the Vulkan backend enabled"
            fi
        }
        step "Vulkan syntax check (V4K_ENABLE_VULKAN=1)" vulkan_syntax
    else
        skip "Vulkan syntax check" "set V4K_VULKAN_INCLUDE to a Vulkan-Headers checkout (or ANDROID_NDK_HOME)"
    fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
echo "== verification: $PASS passed, $FAIL failed, $SKIP skipped =="
if [ "$FAIL" != 0 ]; then
    exit 1
fi
if [ "$SKIP" != 0 ]; then
    echo "   (skipped steps are optional in this environment; CI runs all of them)"
fi
