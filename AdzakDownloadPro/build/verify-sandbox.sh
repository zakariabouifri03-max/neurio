#!/usr/bin/env bash
#
# ADZAK DOWNLOAD PRO — sandbox verification (no .NET SDK, no NuGet required).
#
# This environment has no .NET SDK and no NuGet access, so this script verifies the
# deliverable with only the pieces that ARE reachable (pypi + GitHub):
#
#   1. A real .NET Core 3.1 runtime  (pypi wheel "dotnetcore2")
#   2. Roslyn 4.8 (C# 12) compiler   (DLLs committed in a public GitHub repo)
#   3. pythonnet + clr_loader         (pypi) to host the runtime and drive Roslyn
#   4. OpenSSL 1.1                    (bundled in a pypi wheel) for the 3.1 crypto PAL
#
# It then compiles the SAME .cs sources that ship in the repo against the .NET Core 3.1
# runtime assemblies (the Core engine sticks to an API surface that exists in both
# .NET Core 3.1 and .NET 8), runs the full test suite on the real runtime, and
# syntax-checks the WPF application sources.
#
# Usage:  ./build/verify-sandbox.sh
# Env:    ADZAK_TOOLS   tool cache directory (default: /tmp/adzak-verify-tools)
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="${ADZAK_TOOLS:-/tmp/adzak-verify-tools}"
DOTNET="$TOOLS/dotnetcore2/dotnetcore2/bin"
ROSLYN="$TOOLS/roslyn4/SmartAuditor-master/Editor/Plugins/Roslyn"
OSSL="$TOOLS/ossl11"
VENV="$TOOLS/venv"

log() { printf '\033[36m==> %s\033[0m\n' "$*"; }

mkdir -p "$TOOLS"

# ---------------------------------------------------------------------------
# 1. .NET Core 3.1.23 runtime (pypi wheel)
# ---------------------------------------------------------------------------
if [ ! -x "$DOTNET/dotnet" ]; then
    log "Downloading .NET Core 3.1.23 runtime (pypi dotnetcore2 wheel)"
    curl -sSL -o "$TOOLS/dotnetcore2.whl" \
        "https://files.pythonhosted.org/packages/d9/04/ddd3fc5c374870e5e3d386b18512e8c0c7557aca9fbc1d9f286bf9f4844d/dotnetcore2-3.1.23-py3-none-manylinux1_x86_64.whl"
    mkdir -p "$TOOLS/dotnetcore2"
    unzip -q -o "$TOOLS/dotnetcore2.whl" -d "$TOOLS/dotnetcore2"
    rm -f "$TOOLS/dotnetcore2.whl"
fi
"$DOTNET/dotnet" --info | head -3

# ---------------------------------------------------------------------------
# 2. Roslyn 4.8 compiler set (GitHub repo with committed Roslyn DLLs)
# ---------------------------------------------------------------------------
if [ ! -f "$ROSLYN/Microsoft.CodeAnalysis.CSharp.dll" ]; then
    log "Downloading Roslyn 4.8 (C# 12) compiler set from GitHub"
    mkdir -p "$TOOLS/roslyn4"
    curl -sSL -o "$TOOLS/smartauditor.tar.gz" \
        "https://codeload.github.com/mtrive/SmartAuditor/tar.gz/refs/heads/master"
    tar -xzf "$TOOLS/smartauditor.tar.gz" \
        --wildcards 'SmartAuditor-master/Editor/Plugins/Roslyn/*' \
        -C "$TOOLS/roslyn4"
    rm -f "$TOOLS/smartauditor.tar.gz"
fi

# ---------------------------------------------------------------------------
# 3. Python venv with pythonnet + clr_loader
# ---------------------------------------------------------------------------
if [ ! -x "$VENV/bin/python" ]; then
    log "Creating Python venv (pythonnet + clr_loader)"
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install -q pythonnet clr_loader
fi

# ---------------------------------------------------------------------------
# 4. OpenSSL 1.1 for the .NET Core 3.1 crypto PAL (bundled in a pypi wheel)
# ---------------------------------------------------------------------------
if [ ! -f "$OSSL/libssl.so.1.1" ]; then
    log "Extracting OpenSSL 1.1 from a pypi wheel (psycopg2-binary)"
    mkdir -p "$TOOLS/wheels" "$OSSL"
    "$VENV/bin/pip" download -q --no-deps --only-binary=:all: \
        "psycopg2-binary==2.9.9" -d "$TOOLS/wheels"
    unzip -q -o "$TOOLS/wheels"/psycopg2_binary-*.whl \
        'psycopg2_binary.libs/libssl-*.so.1.1' 'psycopg2_binary.libs/libcrypto-*.so.1.1' \
        -d "$TOOLS/wheels/x"
    SSL_SRC="$(ls "$TOOLS/wheels/x/psycopg2_binary.libs/"libssl-*.so.1.1 | head -1)"
    CRYPTO_SRC="$(ls "$TOOLS/wheels/x/psycopg2_binary.libs/"libcrypto-*.so.1.1 | head -1)"
    cp "$SSL_SRC" "$OSSL/libssl.so.1.1"
    cp "$CRYPTO_SRC" "$OSSL/libcrypto.so.1.1"
    # The bundled libssl references libcrypto by its auditwheel-renamed SONAME — provide it.
    NEEDED="$(readelf -d "$OSSL/libssl.so.1.1" 2>/dev/null | grep NEEDED | grep libcrypto | sed 's/.*\[\(.*\)\]/\1/' || true)"
    if [ -n "$NEEDED" ] && [ "$NEEDED" != "libcrypto.so.1.1" ]; then
        cp "$CRYPTO_SRC" "$OSSL/$NEEDED"
    fi
    rm -rf "$TOOLS/wheels"
fi

# ---------------------------------------------------------------------------
# 5. runtimeconfig.json for hosting the 3.1 runtime (invariant globalization)
# ---------------------------------------------------------------------------
if [ ! -f "$TOOLS/runtimeconfig.json" ]; then
    log "Writing runtimeconfig.json"
    cat > "$TOOLS/runtimeconfig.json" <<'JSON'
{
  "runtimeOptions": {
    "tfm": "netcoreapp3.1",
    "framework": {
      "name": "Microsoft.NETCore.App",
      "version": "3.1.23"
    },
    "configProperties": {
      "System.Globalization.Invariant": true
    }
  }
}
JSON
fi

# ---------------------------------------------------------------------------
# 6. Compile + test + syntax-check
# ---------------------------------------------------------------------------
log "Compiling Core + Tests with Roslyn 4.8, running the test suite, syntax-checking the WPF app"
ADZAK_TOOLS="$TOOLS" \
ADZAK_DOTNET_BIN="$DOTNET" \
ADZAK_ROSLYN_DIR="$ROSLYN" \
ADZAK_OSSL_DIR="$OSSL" \
ADZAK_VENV_PYTHON="$VENV/bin/python" \
ADZAK_RUNTIMECONFIG="$TOOLS/runtimeconfig.json" \
    "$VENV/bin/python" "$ROOT/build/sandbox/compile_and_test.py" --check-wpf
