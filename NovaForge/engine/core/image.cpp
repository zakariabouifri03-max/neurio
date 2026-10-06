#include "core/image.h"
#include "core/fs.h"
#include "core/log.h"

#include <algorithm>
#include <cmath>
#include <cstring>

#define STB_IMAGE_IMPLEMENTATION
#define STBI_NO_STDIO 0
#define STBI_FAILURE_USERMSG
#include "stb_image.h"
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

namespace nf {

bool decodeImage(const uint8_t* data, size_t size, ImageData& out, int wantChannels, bool flipY,
                 std::string* error) {
    stbi_set_flip_vertically_on_load(flipY ? 1 : 0);
    int w = 0, h = 0, c = 0;
    unsigned char* px = stbi_load_from_memory(data, (int)size, &w, &h, &c, wantChannels);
    if (!px) {
        const char* reason = stbi_failure_reason();
        std::string msg = std::string("image decode failed: ") + (reason ? reason : "unknown");
        if (error) *error = msg;
        NF_LOG_ERROR("Image", "%s", msg.c_str());
        return false;
    }
    out.width = w;
    out.height = h;
    out.channels = wantChannels > 0 ? wantChannels : c;
    out.pixels.assign(px, px + (size_t)w * h * out.channels);
    stbi_image_free(px);
    return true;
}

bool decodeImageFile(const std::string& path, ImageData& out, int wantChannels, bool flipY,
                     std::string* error) {
    fs::Bytes bytes = fs::readBinary(path);
    if (bytes.empty()) {
        if (error) *error = "cannot read file: " + path;
        NF_LOG_ERROR("Image", "cannot read texture '%s' (missing or empty file)", path.c_str());
        return false;
    }
    std::string local;
    bool ok = decodeImage(bytes.data(), bytes.size(), out, wantChannels, flipY,
                          error ? &local : nullptr);
    if (!ok && error) *error = path + ": " + local;
    return ok;
}

bool writePng(const std::string& path, const uint8_t* rgba, int w, int h) {
    std::string dir = fs::parent(path);
    if (!dir.empty() && !fs::exists(dir)) fs::createDirectories(dir);
    int rc = stbi_write_png(path.c_str(), w, h, 4, rgba, w * 4);
    if (!rc) {
        NF_LOG_ERROR("Image", "failed to write PNG '%s'", path.c_str());
        return false;
    }
    return true;
}

bool writePngFile(const std::string& path, const uint8_t* rgba, int w, int h) {
    return writePng(path, rgba, w, h);
}

bool writeWav16(const std::string& path, const float* interleaved, int frames, int channels,
                int sampleRate) {
    std::vector<int16_t> pcm((size_t)frames * channels);
    for (size_t i = 0; i < pcm.size(); ++i) {
        float v = interleaved[i];
        v = v < -1.0f ? -1.0f : (v > 1.0f ? 1.0f : v);
        pcm[i] = (int16_t)std::lround(v * 32767.0f);
    }
    uint32_t dataSize = (uint32_t)(pcm.size() * 2);
    uint32_t byteRate = (uint32_t)sampleRate * channels * 2;
    uint16_t blockAlign = (uint16_t)(channels * 2);
    std::vector<uint8_t> out;
    auto put32 = [&](uint32_t v) {
        out.push_back(v & 0xFF); out.push_back((v >> 8) & 0xFF);
        out.push_back((v >> 16) & 0xFF); out.push_back((v >> 24) & 0xFF);
    };
    auto put16 = [&](uint16_t v) { out.push_back(v & 0xFF); out.push_back((v >> 8) & 0xFF); };
    auto puts = [&](const char* s) { while (*s) out.push_back((uint8_t)*s++); };
    puts("RIFF"); put32(36 + dataSize); puts("WAVE");
    puts("fmt "); put32(16); put16(1); put16((uint16_t)channels); put32((uint32_t)sampleRate);
    put32(byteRate); put16(blockAlign); put16(16);
    puts("data"); put32(dataSize);
    const uint8_t* raw = (const uint8_t*)pcm.data();
    out.insert(out.end(), raw, raw + dataSize);
    return fs::writeBinary(path, out);
}

bool readWav(const uint8_t* data, size_t size, std::vector<float>& interleaved, int& channels,
             int& sampleRate, std::string* error) {
    interleaved.clear();
    channels = 0;
    sampleRate = 0;
    if (size < 44 || memcmp(data, "RIFF", 4) != 0 || memcmp(data + 8, "WAVE", 4) != 0) {
        if (error) *error = "not a RIFF/WAVE file";
        return false;
    }
    size_t pos = 12;
    int bits = 16, format = 1;
    size_t dataOff = 0, dataLen = 0;
    while (pos + 8 <= size) {
        char id[5] = {0};
        memcpy(id, data + pos, 4);
        uint32_t len = 0;
        memcpy(&len, data + pos + 4, 4);
        pos += 8;
        if (memcmp(id, "fmt ", 4) == 0 && pos + 16 <= size) {
            uint16_t ch = 0, ba = 0;
            memcpy(&format, data + pos, 2);
            memcpy(&ch, data + pos + 2, 2);
            memcpy(&sampleRate, data + pos + 4, 4);
            memcpy(&ba, data + pos + 12, 2);
            memcpy(&bits, data + pos + 14, 2);
            channels = ch;
        } else if (memcmp(id, "data", 4) == 0) {
            dataOff = pos;
            dataLen = std::min<size_t>(len, size - pos);
        }
        pos += len + (len & 1);
    }
    if (channels <= 0 || dataLen == 0) {
        if (error) *error = "WAV has no fmt/data chunk";
        return false;
    }
    if (format == 3) {
        if (error) *error = "32 bit float WAV is not supported in V1 (use 16 bit PCM)";
        return false;
    }
    int bytesPerSample = bits / 8;
    size_t frames = dataLen / (bytesPerSample * channels);
    interleaved.resize(frames * channels);
    const uint8_t* d = data + dataOff;
    for (size_t i = 0; i < frames * (size_t)channels; ++i) {
        float v = 0;
        if (bits == 16) {
            int16_t s;
            memcpy(&s, d + i * 2, 2);
            v = s / 32768.0f;
        } else if (bits == 8) {
            v = ((int)d[i] - 128) / 128.0f;
        } else if (bits == 24) {
            int32_t s = (d[i * 3] << 8) | (d[i * 3 + 1] << 16) | (d[i * 3 + 2] << 24);
            v = (float)(s >> 8) / 8388608.0f;
        } else if (bits == 32) {
            int32_t s;
            memcpy(&s, d + i * 4, 4);
            v = (float)s / 2147483648.0f;
        }
        interleaved[i] = v;
    }
    return true;
}

}  // namespace nf
