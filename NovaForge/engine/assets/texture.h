// NovaForge Engine - texture assets (decode, cache, async load)
#pragma once
#include "core/image.h"
#include "core/math.h"

#include <mutex>

#include <atomic>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

namespace nf {

enum class TextureFilter { Nearest, Bilinear };
enum class TextureWrap { Repeat, Clamp };

struct Texture {
    std::string path;                 // project relative path ("" for built-ins)
    std::string name;
    int width = 0, height = 0;
    std::vector<uint8_t> pixels;      // RGBA8, row 0 = top of the image
    bool sRGB = true;
    TextureFilter filter = TextureFilter::Bilinear;
    TextureWrap wrap = TextureWrap::Repeat;

    // GPU handle - filled by the GL renderer, ignored by the software path
    unsigned glTexture = 0;
    bool uploaded = false;

    bool valid() const { return width > 0 && height > 0 && !pixels.empty(); }

    // Sampler used by the software rasterizer: bilinear or nearest, repeat or
    // clamp, with tiling/offset applied by the caller.
    Vec4 sample(float u, float v) const;

    static std::shared_ptr<Texture> white();
    static std::shared_ptr<Texture> checker();
    static std::shared_ptr<Texture> flat(const Vec3& color);
};

// Loads textures from disk with an in-memory cache. Loading can be dispatched
// to the engine thread pool (asynchronous loading) - `getAsync` returns a
// placeholder immediately and the texture is swapped in when ready.
class TextureCache {
public:
    static TextureCache& get();

    // Synchronous load (used for the editor's asset browser / inspector
    // previews and by the runtime for the starting scene).
    std::shared_ptr<Texture> load(const std::string& projectRelativePath);
    // Asynchronous load: returns immediately with a 1x1 placeholder when the
    // texture is not in the cache yet.
    std::shared_ptr<Texture> loadAsync(const std::string& projectRelativePath);
    std::shared_ptr<Texture> find(const std::string& projectRelativePath);

    void setProjectRoot(const std::string& root);
    const std::string& projectRoot() const { return projectRoot_; }
    size_t loadedCount() const {
        std::lock_guard<std::mutex> lk(mutex_);
        return cache_.size();
    }
    size_t memoryUsageBytes() const;
    void clear();
    void logStats();

private:
    TextureCache() = default;
    std::unordered_map<std::string, std::shared_ptr<Texture>> cache_;
    std::string projectRoot_;
    mutable std::mutex mutex_;    // guards cache_/projectRoot_ (and const queries)
};

}  // namespace nf
