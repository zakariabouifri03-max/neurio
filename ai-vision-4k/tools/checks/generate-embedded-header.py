#!/usr/bin/env python3
"""Generates the same SPIR-V embedding header that CMake produces.

CMake does this during a real Android build (see
aiupscaler-sdk/src/main/cpp/shaders/CMakeLists.txt). This script exists so the
*native sources can be syntax checked without Gradle or CMake* — it must emit a
byte-for-byte equivalent header, and tests/checks/verify-native.sh compares the
two symbol tables to catch drift.

Usage: generate-embedded-header.py <spirv-dir> <output-header>
"""
import os
import re
import sys

SHADERS = [
    "preprocess_luma.comp",
    "motion_estimate.comp",
    "sr_conv.comp",
    "pixel_shuffle.comp",
    "edge_reconstruct.comp",
    "temporal_accum.comp",
    "aa_resolve.comp",
    "sharpen.comp",
    "denoise.comp",
    "quality_metrics.comp",
    "elementwise.comp",
    "downsample.comp",
    "image_to_planar.comp",
    "planar_to_image.comp",
    "bicubic_residual.comp",
    "prelu.comp",
    "particle_sim.comp",
    "fullscreen.vert",
    "present.frag",
    "sky.frag",
    "scene.vert",
    "scene_shadow.vert",
    "scene.frag",
    "particle.vert",
    "particle.frag",
]


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    spirv_dir, output_path = sys.argv[1], sys.argv[2]

    lines = []
    lines.append("// GENERATED FILE - do not edit.\n")
    lines.append("// Regenerate with: node tools/shaders/build-shaders.js && <build>\n")
    lines.append("#pragma once\n#include <cstdint>\n\n")
    lines.append("namespace v4k {\nnamespace shaders {\n\n")
    lines.append("struct EmbeddedShader {\n    const char* name;\n    const uint32_t* words;\n"
                 "    uint32_t wordCount;\n};\n\n")

    table = []
    missing = []
    for name in SHADERS:
        path = os.path.join(spirv_dir, name + ".spv")
        if not os.path.exists(path):
            missing.append(name)
            continue
        with open(path, "rb") as handle:
            data = handle.read()
        assert len(data) % 4 == 0, f"{name}: SPIR-V must be word aligned"
        symbol = re.sub(r"[^A-Za-z0-9_]", "_", name)
        lines.append(f"// {name} ({len(data)} bytes, {len(data) // 4} words)\n")
        lines.append(f"alignas(4) static const uint8_t v4k_spirv_bytes_{symbol}[] = "
                     f"{{{','.join('0x%02x' % b for b in data)}}};\n")
        lines.append(f"static const uint32_t* const v4k_spirv_{symbol} = "
                     f"reinterpret_cast<const uint32_t*>(v4k_spirv_bytes_{symbol});\n\n")
        table.append(f'    {{"{name}", v4k_spirv_{symbol}, {len(data) // 4}}},\n')

    lines.append("static const EmbeddedShader kEmbeddedShaders[] = {\n")
    lines.extend(table)
    lines.append("};\n\n")
    lines.append(f"static const uint32_t kEmbeddedShaderCount = {len(table)};\n\n")
    lines.append("}  // namespace shaders\n}  // namespace v4k\n")

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as handle:
        handle.write("".join(lines))

    if missing:
        print(f"warning: missing pre-compiled shaders: {', '.join(missing)}", file=sys.stderr)
    print(f"wrote {output_path} ({len(table)} shaders)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
