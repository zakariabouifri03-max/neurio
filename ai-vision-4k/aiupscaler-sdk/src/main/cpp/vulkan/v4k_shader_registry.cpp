// Access to the SPIR-V blobs that CMake embedded into the library.
#include <cstring>

#include "../core/v4k_log.h"
#include "v4k_shader_registry.h"

// Generated at build time from the .spv files (see shaders/CMakeLists.txt).
#include "v4k_shaders_embedded.h"

namespace v4k {
namespace shaders {

namespace {

const EmbeddedShader* findEmbedded(const char* name) {
    for (uint32_t i = 0; i < kEmbeddedShaderCount; ++i) {
        if (std::strcmp(kEmbeddedShaders[i].name, name) == 0) {
            return &kEmbeddedShaders[i];
        }
    }
    return nullptr;
}

}  // namespace

ShaderBlob loadShader(const char* name) {
    ShaderBlob blob;
    const EmbeddedShader* embedded = findEmbedded(name);
    if (embedded == nullptr) {
        V4K_LOGE("shader '%s' is not embedded in this build", name);
        return blob;
    }
    blob.words = embedded->words;
    blob.wordCount = embedded->wordCount;
    // SPIR-V magic: catches an accidental text-mode read or a truncated file.
    if (blob.wordCount < 5 || blob.words[0] != 0x07230203u) {
        V4K_LOGE("shader '%s' has an invalid SPIR-V header (magic 0x%08x)", name, blob.words[0]);
        blob.words = nullptr;
        blob.wordCount = 0;
        return blob;
    }
    return blob;
}

uint32_t embeddedShaderCount() { return kEmbeddedShaderCount; }

const char* embeddedShaderName(uint32_t index) {
    return index < kEmbeddedShaderCount ? kEmbeddedShaders[index].name : "";
}

void logEmbeddedShaders() {
    V4K_LOGI("engine ships %u precompiled shaders", kEmbeddedShaderCount);
    for (uint32_t i = 0; i < kEmbeddedShaderCount; ++i) {
        V4K_LOGI("  shader[%u] = %s (%u words)", i, kEmbeddedShaders[i].name,
                 kEmbeddedShaders[i].wordCount);
    }
}

}  // namespace shaders
}  // namespace v4k
