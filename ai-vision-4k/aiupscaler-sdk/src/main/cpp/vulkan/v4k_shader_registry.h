// Access to the SPIR-V blobs embedded at build time.
#pragma once

#include <cstdint>

namespace v4k {
namespace shaders {

struct ShaderBlob {
    const uint32_t* words = nullptr;
    uint32_t wordCount = 0;
    bool valid() const { return words != nullptr && wordCount > 0; }
};

// Validates the SPIR-V magic before handing the blob out, so a truncated or
// text-mode file fails at load time instead of as a driver crash.
ShaderBlob loadShader(const char* name);

uint32_t embeddedShaderCount();
const char* embeddedShaderName(uint32_t index);
void logEmbeddedShaders();

}  // namespace shaders
}  // namespace v4k
