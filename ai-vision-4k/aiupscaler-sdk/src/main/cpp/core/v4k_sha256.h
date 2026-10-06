// SHA-256, used to verify downloaded AI models and to fingerprint model files
// that are packaged inside an APK. Self-contained (no OpenSSL on Android NDK
// by default) and unit tested against the published NIST vectors.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace v4k {

class Sha256 {
public:
    Sha256() { reset(); }

    void reset();
    void update(const void* data, size_t len);
    // Finalise into a 32 byte digest. The object must not be reused afterwards
    // without calling reset().
    void finalize(uint8_t out[32]);

private:
    void processBlock(const uint8_t* block);

    uint32_t state_[8];
    uint64_t bitLength_;
    uint8_t buffer_[64];
    size_t bufferLength_;
};

std::string sha256Hex(const void* data, size_t len);
std::string sha256Hex(const std::vector<uint8_t>& data);
// Reads the file in chunks. Returns false when the file cannot be opened.
bool sha256File(const std::string& path, std::string& outHex);

}  // namespace v4k
