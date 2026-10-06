// NovaForge Engine - image / audio file helpers (STB wrappers)
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace nf {

struct ImageData {
    int width = 0, height = 0, channels = 0;
    std::vector<uint8_t> pixels;  // RGBA8 (always converted to 4 channels by default)
    bool valid() const { return width > 0 && height > 0 && !pixels.empty(); }
};

// Decodes PNG/JPG/TGA/BMP/PSD/GIF/HDR from memory. `wantChannels` 0 = as-is,
// 4 = force RGBA. `flipY` is useful because image files have origin top-left
// while the renderer samples with origin bottom-left.
bool decodeImage(const uint8_t* data, size_t size, ImageData& out, int wantChannels = 4,
                 bool flipY = false, std::string* error = nullptr);
bool decodeImageFile(const std::string& path, ImageData& out, int wantChannels = 4,
                     bool flipY = false, std::string* error = nullptr);
bool writePng(const std::string& path, const uint8_t* rgba, int w, int h);
bool writePngFile(const std::string& path, const uint8_t* rgba, int w, int h);

// 16 bit PCM WAV writer used by the audio tests and the sample game export.
bool writeWav16(const std::string& path, const float* interleaved, int frames, int channels,
                int sampleRate);
bool readWav(const uint8_t* data, size_t size, std::vector<float>& interleaved, int& channels,
             int& sampleRate, std::string* error = nullptr);

}  // namespace nf
