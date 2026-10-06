#!/usr/bin/env bash
#
# Builds the model exporter and regenerates the calibration models that ship in
# aiupscaler-sdk/src/main/assets/models/.
#
# Run this after changing tools/model/export_v4kmodel.cpp, or after changing
# anything the container format depends on (ai/v4k_model.cpp,
# ai/v4k_cpu_infer.cpp, ai/v4k_gpu_plan.cpp, core/v4k_image.cpp). The script fails
# if a model does not reproduce its analytic reference or does not fit the GPU
# planner's budget at 720p, so a stale asset cannot be committed quietly.
#
# Usage:  tools/model/generate-calibration-models.sh [--check]
#           --check   build into a temporary directory and compare against the
#                     committed assets instead of overwriting them (CI mode)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CPP="$ROOT/aiupscaler-sdk/src/main/cpp"
ASSETS="$ROOT/aiupscaler-sdk/src/main/assets/models"
BUILD="${TMPDIR:-/tmp}/v4k-model-export"
CHECK=0

for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

mkdir -p "$BUILD"
echo "== compiling the exporter =="
"${CXX:-g++}" -std=c++17 -O2 -pthread -Wall -Wextra -Wno-unused-parameter \
  -I"$CPP" \
  "$ROOT/tools/model/export_v4kmodel.cpp" \
  "$CPP/ai/v4k_model.cpp" "$CPP/ai/v4k_cpu_infer.cpp" "$CPP/ai/v4k_gpu_plan.cpp" \
  "$CPP/core/v4k_image.cpp" "$CPP/core/v4k_common.cpp" "$CPP/core/v4k_sha256.cpp" \
  -o "$BUILD/export_v4kmodel"

OUT="$ASSETS"
if [ "$CHECK" = "1" ]; then
  OUT="$BUILD/generated"
  mkdir -p "$OUT"
fi
mkdir -p "$OUT"

# The two calibration graphs. Both are linear on purpose: their output is known
# analytically, which is what makes them a check of the pipeline rather than a
# claim about image quality. See tools/model/README.md.
echo
echo "== sub-pixel x2 (must reproduce resizeBilinear) =="
"$BUILD/export_v4kmodel" \
  --out "$OUT/reference_sr_x2_subpixel.v4kmodel" \
  --arch subpixel --tier lite --scale 2 --verify --plan-check 1280x720

echo
echo "== bicubic + global residual x2 (must reproduce resizeBicubic) =="
"$BUILD/export_v4kmodel" \
  --out "$OUT/reference_sr_x2_residual.v4kmodel" \
  --arch residual --tier lite --scale 2 --verify --plan-check 1280x720

echo
echo "== fp16 variant (same graph, half-precision weights) =="
# Written to the build directory only: it exists to check that the fp16 loader
# path produces the same image as fp32, so it is compared rather than shipped.
"$BUILD/export_v4kmodel" \
  --out "$BUILD/reference_sr_x2_subpixel_fp16.v4kmodel" \
  --arch subpixel --tier lite --scale 2 --fp16 --verify --plan-check 1280x720

if [ "$CHECK" = "1" ]; then
  echo
  echo "== comparing against the committed assets =="
  status=0
  for name in reference_sr_x2_subpixel.v4kmodel reference_sr_x2_residual.v4kmodel; do
    if [ ! -f "$ASSETS/$name" ]; then
      echo "  MISSING  $name is not committed" >&2
      status=1
      continue
    fi
    if cmp -s "$OUT/$name" "$ASSETS/$name"; then
      echo "  ok       $name is up to date"
    else
      echo "  STALE    $name differs from a fresh export" >&2
      status=1
    fi
  done
  exit "$status"
fi

( cd "$ASSETS" && sha256sum ./*.v4kmodel > SHA256SUMS.txt )
echo
echo "== committed assets =="
cat "$ASSETS/SHA256SUMS.txt"
echo
echo "Verify from the assets directory with:  sha256sum -c SHA256SUMS.txt"
