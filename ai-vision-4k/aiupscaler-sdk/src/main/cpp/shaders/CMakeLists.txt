# Embeds the pre-compiled SPIR-V blobs into a C++ header.
#
# Why embed instead of loading from assets:
#   * a game that integrates the SDK should not have to ship (or trust) loose
#     shader files next to its own assets;
#   * the engine must never compile GLSL at runtime — driver GLSL front ends
#     differ wildly and a runtime compile failure would break the title;
#   * it removes the Android asset manager from the engine's dependency list.
#
# The .spv files themselves are built by tools/shaders/build-shaders.js and
# checked in, so a normal build needs no shader compiler at all.

set(V4K_SPIRV_DIR "${CMAKE_CURRENT_SOURCE_DIR}/spirv")

set(V4K_SHADER_NAMES
    preprocess_luma.comp
    motion_estimate.comp
    sr_conv.comp
    pixel_shuffle.comp
    edge_reconstruct.comp
    temporal_accum.comp
    aa_resolve.comp
    sharpen.comp
    denoise.comp
    quality_metrics.comp
    elementwise.comp
    downsample.comp
    image_to_planar.comp
    planar_to_image.comp
    bicubic_residual.comp
    prelu.comp
    particle_sim.comp
    fullscreen.vert
    present.frag
    sky.frag
    scene.vert
    scene_shadow.vert
    scene.frag
    particle.vert
    particle.frag
)

set(V4K_EMBED_HEADER "${CMAKE_CURRENT_BINARY_DIR}/v4k_shaders_embedded.h")

set(V4K_HEADER_TEXT "// GENERATED FILE - do not edit.\n")
string(APPEND V4K_HEADER_TEXT "// Regenerate with: node tools/shaders/build-shaders.js && <build>\n")
string(APPEND V4K_HEADER_TEXT "#pragma once\n#include <cstdint>\n\n")
string(APPEND V4K_HEADER_TEXT "namespace v4k {\nnamespace shaders {\n\n")
string(APPEND V4K_HEADER_TEXT "struct EmbeddedShader {\n    const char* name;\n    const uint32_t* words;\n    uint32_t wordCount;\n};\n\n")

set(V4K_TABLE "")
set(V4K_MISSING "")
set(V4K_INDEX 0)

foreach(SHADER_NAME IN LISTS V4K_SHADER_NAMES)
    string(TOUPPER "${SHADER_NAME}" SHADER_UPPER)
    string(REPLACE "." "_" SYMBOL "${SHADER_NAME}")
    string(REPLACE "-" "_" SYMBOL "${SYMBOL}")
    set(SPV_FILE "${V4K_SPIRV_DIR}/${SHADER_NAME}.spv")

    if(NOT EXISTS "${SPV_FILE}")
        list(APPEND V4K_MISSING "${SHADER_NAME}")
        continue()
    endif()

    file(READ "${SPV_FILE}" SPV_HEX HEX)
    string(LENGTH "${SPV_HEX}" SPV_HEX_LENGTH)
    math(EXPR SPV_BYTES "${SPV_HEX_LENGTH} / 2")
    math(EXPR SPV_WORDS "${SPV_BYTES} / 4")
    # 0xAB, 0xCD, ... one entry per byte; the loader reinterprets the array as
    # uint32_t words which is valid because the file is little endian and every
    # supported target (arm64, x86_64) is little endian too.
    string(REGEX REPLACE "(..)" "0x\\1," SPV_BYTES_LIST "${SPV_HEX}")

    string(APPEND V4K_HEADER_TEXT
        "// ${SHADER_NAME} (${SPV_BYTES} bytes, ${SPV_WORDS} words)\n")
    string(APPEND V4K_HEADER_TEXT
        "alignas(4) static const uint8_t v4k_spirv_bytes_${SYMBOL}[] = {${SPV_BYTES_LIST}};\n")
    string(APPEND V4K_HEADER_TEXT
        "static const uint32_t* const v4k_spirv_${SYMBOL} = reinterpret_cast<const uint32_t*>(v4k_spirv_bytes_${SYMBOL});\n\n")

    string(APPEND V4K_TABLE "    {\"${SHADER_NAME}\", v4k_spirv_${SYMBOL}, ${SPV_WORDS}},\n")
    math(EXPR V4K_INDEX "${V4K_INDEX} + 1")
endforeach()

string(APPEND V4K_HEADER_TEXT "static const EmbeddedShader kEmbeddedShaders[] = {\n")
string(APPEND V4K_HEADER_TEXT "${V4K_TABLE}")
string(APPEND V4K_HEADER_TEXT "};\n\n")
string(APPEND V4K_HEADER_TEXT
    "static const uint32_t kEmbeddedShaderCount = ${V4K_INDEX};\n\n")
string(APPEND V4K_HEADER_TEXT "}  // namespace shaders\n}  // namespace v4k\n")

if(V4K_MISSING)
    message(WARNING
        "Missing pre-compiled shaders: ${V4K_MISSING}. Run 'node tools/shaders/build-shaders.js' "
        "and rebuild.")
endif()

file(WRITE "${V4K_EMBED_HEADER}" "${V4K_HEADER_TEXT}")

# The header is generated at configure time; add a custom target so a shader
# rebuild is picked up without a full reconfigure.
add_custom_command(
    OUTPUT "${V4K_EMBED_HEADER}"
    COMMAND ${CMAKE_COMMAND} -E echo "Shader header regenerated"
    DEPENDS ${V4K_SPIRV_DIR}
    VERBATIM)

# The parent directory attaches this target to the engine library, so touching a
# .spv file rebuilds the header without a manual reconfigure.
add_custom_target(v4k_shaders_embedded DEPENDS "${V4K_EMBED_HEADER}")

set(V4K_SHADER_EMBED_HEADER "${V4K_EMBED_HEADER}" CACHE INTERNAL "generated shader header")
