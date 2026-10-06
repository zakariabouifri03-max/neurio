#include "assets/texture.h"
#include "core/fs.h"
#include "core/log.h"
#include "core/thread_pool.h"
#include "assets/material.h"

#include <mutex>

namespace nf {

Vec4 Texture::sample(float u, float v) const {
    if (!valid()) return Vec4(1, 1, 1, 1);
    if (wrap == TextureWrap::Repeat) {
        u = u - std::floor(u);
        v = v - std::floor(v);
    } else {
        u = clampf(u, 0.0f, 1.0f);
        v = clampf(v, 0.0f, 1.0f);
    }
    float fx = u * (float)(width - 1);
    float fy = v * (float)(height - 1);
    auto fetch = [&](int x, int y) {
        x = x < 0 ? 0 : (x >= width ? width - 1 : x);
        y = y < 0 ? 0 : (y >= height ? height - 1 : y);
        size_t i = ((size_t)y * width + x) * 4;
        const float inv = 1.0f / 255.0f;
        return Vec4(pixels[i] * inv, pixels[i + 1] * inv, pixels[i + 2] * inv,
                    pixels[i + 3] * inv);
    };
    if (filter == TextureFilter::Nearest) return fetch((int)(fx + 0.5f), (int)(fy + 0.5f));
    int x0 = (int)fx, y0 = (int)fy;
    float tx = fx - (float)x0, ty = fy - (float)y0;
    Vec4 c00 = fetch(x0, y0), c10 = fetch(x0 + 1, y0);
    Vec4 c01 = fetch(x0, y0 + 1), c11 = fetch(x0 + 1, y0 + 1);
    auto mix = [](float a, float b, float t) { return a + (b - a) * t; };
    Vec4 r;
    r.x = mix(mix(c00.x, c10.x, tx), mix(c01.x, c11.x, tx), ty);
    r.y = mix(mix(c00.y, c10.y, tx), mix(c01.y, c11.y, tx), ty);
    r.z = mix(mix(c00.z, c10.z, tx), mix(c01.z, c11.z, tx), ty);
    r.w = mix(mix(c00.w, c10.w, tx), mix(c01.w, c11.w, tx), ty);
    return r;
}

static std::shared_ptr<Texture> makeFlat(const std::string& name, Vec3 c) {
    auto t = std::make_shared<Texture>();
    t->name = name;
    t->width = t->height = 1;
    t->pixels = {(uint8_t)clampf(c.x * 255, 0, 255), (uint8_t)clampf(c.y * 255, 0, 255),
                 (uint8_t)clampf(c.z * 255, 0, 255), 255};
    return t;
}

std::shared_ptr<Texture> Texture::white() {
    static std::shared_ptr<Texture> t = makeFlat("White", Vec3(1, 1, 1));
    return t;
}
std::shared_ptr<Texture> Texture::flat(const Vec3& color) { return makeFlat("Flat", color); }

std::shared_ptr<Texture> Texture::checker() {
    static std::shared_ptr<Texture> t = [] {
        ImageData img;
        generateCheckerImage(img);
        auto tex = std::make_shared<Texture>();
        tex->name = "Checker";
        tex->width = img.width;
        tex->height = img.height;
        tex->pixels = std::move(img.pixels);
        return tex;
    }();
    return t;
}

TextureCache& TextureCache::get() {
    static TextureCache c;
    return c;
}

void TextureCache::setProjectRoot(const std::string& root) {
    // NOTE: clear() takes mutex_ itself, so it must NOT be called while the
    // lock is held - that self-deadlocks on a non-recursive std::mutex and
    // hangs the editor while opening a project.
    std::lock_guard<std::mutex> lk(mutex_);
    if (projectRoot_ != root) {
        cache_.clear();
        projectRoot_ = root;
    }
}

std::shared_ptr<Texture> TextureCache::find(const std::string& p) {
    std::lock_guard<std::mutex> lk(mutex_);
    auto it = cache_.find(p);
    return it != cache_.end() ? it->second : nullptr;
}

std::shared_ptr<Texture> TextureCache::load(const std::string& relPath) {
    if (relPath.empty()) return Texture::white();
    {
        std::lock_guard<std::mutex> lk(mutex_);
        auto it = cache_.find(relPath);
        if (it != cache_.end() && it->second && it->second->valid()) return it->second;
    }
    std::string full = fs::isAbsolute(relPath) ? relPath : fs::join(projectRoot_, relPath);
    if (!fs::exists(full)) full = fs::resolveAssetPath(relPath);
    ImageData img;
    std::string err;
    auto tex = std::make_shared<Texture>();
    tex->path = relPath;
    tex->name = fs::stem(relPath);
    if (!decodeImageFile(full, img, 4, false, &err)) {
        NF_LOG_ERROR("Assets", "Unable to load texture '%s'\n  Reason: %s", relPath.c_str(),
                     err.c_str());
        tex->pixels = {255, 255, 255, 255};
        tex->width = tex->height = 1;
    } else {
        tex->width = img.width;
        tex->height = img.height;
        tex->pixels = std::move(img.pixels);
    }
    {
        std::lock_guard<std::mutex> lk(mutex_);
        cache_[relPath] = tex;
    }
    return tex;
}

std::shared_ptr<Texture> TextureCache::loadAsync(const std::string& relPath) {
    if (relPath.empty()) return Texture::white();
    {
        std::lock_guard<std::mutex> lk(mutex_);
        auto it = cache_.find(relPath);
        if (it != cache_.end()) return it->second;
        cache_[relPath] = Texture::white();  // placeholder until loaded
    }
    static ThreadPool* pool = new ThreadPool(2);
    pool->submit([this, relPath]() { load(relPath); });
    return Texture::white();
}

void TextureCache::clear() {
    std::lock_guard<std::mutex> lk(mutex_);
    cache_.clear();
}

size_t TextureCache::memoryUsageBytes() const {
    std::lock_guard<std::mutex> lk(mutex_);
    size_t total = 0;
    for (auto& kv : cache_)
        if (kv.second) total += kv.second->pixels.size();
    return total;
}

void TextureCache::logStats() {
    NF_LOG_INFO("Assets", "texture cache: %zu textures, %.2f MB", loadedCount(),
                memoryUsageBytes() / 1048576.0);
}

}  // namespace nf
