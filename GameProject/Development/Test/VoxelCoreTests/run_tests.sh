#!/usr/bin/env bash
# Builds and RUNS the native voxel core tests.
#
# This is a real test run, not a substitute for compiling the Unreal project. It
# compiles the engine-agnostic voxel core (coordinates, chunk data, noise, palette,
# both meshers, terrain generator, world settings) against a small stand-in for
# Unreal's core types and executes the assertions in main.cpp.
#
# What it proves: the maths, the mesh output and the generation are correct.
# What it cannot prove: anything involving UObject, components, actors, rendering,
# collision cooking or the editor. Those need a real Unreal install.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HERE/../../.." && pwd)"
CORE="$PROJECT_ROOT/Source/ProjectCore"
BUILD="$HERE/build"

mkdir -p "$BUILD"

SOURCES=(
  "$HERE/main.cpp"
  "$CORE/Private/Voxel/VoxelChunkData.cpp"
  "$CORE/Private/Voxel/VoxelMesher.cpp"
  "$CORE/Private/Voxel/VoxelTerrainGenerator.cpp"
  "$CORE/Private/Voxel/VoxelWorldSettings.cpp"
)

echo "Compiling voxel core tests (g++ -std=c++20, warnings on)..."
g++ -std=c++20 -O1 -Wall -Wextra -Wno-unused-parameter -Wno-unused-variable \
    -I"$HERE/Shim" -I"$CORE/Public" \
    -o "$BUILD/VoxelCoreTests" "${SOURCES[@]}"

echo "Running..."
"$BUILD/VoxelCoreTests"
