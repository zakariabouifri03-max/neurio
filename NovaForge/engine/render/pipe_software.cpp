// NovaForge Engine - software renderer
//
// Design notes (docs/ARCHITECTURE.md has the full picture):
//  * tiles of 32x32 pixels, per-tile triangle bins -> rasterising a tile only
//    touches triangles that overlap it (cache friendly) and tiles are
//    completely independent, so they can be rasterised in parallel without
//    any locking.
//  * near plane clipping, backface culling, frustum + distance culling.
//  * per pixel Blinn-Phong shading with ambient, directional, point and spot
//    lights, optional shadow maps (directional + spot), PCF filtering,
//    texture sampling, alpha test, alpha blending, fog and particles.
#include "core/log.h"
#include "core/thread_pool.h"
#include "render/renderer.h"
#include "render/soft_raster.h"
#include "render/ui_overlay.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <deque>
#include <future>
#include <cmath>
#include <map>
#include <unordered_map>

namespace nf {

namespace {

constexpr int TILE = 32;

struct SurfaceVertex {
    Vec3 world;
    Vec3 normal;
    Vec2 uv;
    Vec4 color;
    float invW = 1.0f;
};

struct ScreenVertex {
    Vec3 p;          // screen x, y, depth (NDC z)
    SurfaceVertex s;
    bool clipped = false;
};

struct PreparedLight {
    LightType type = LightType::Directional;
    Vec3 position;
    Vec3 direction;
    Vec3 color{1, 1, 1};
    float intensity = 1.0f;
    float range = 20.0f;
    float cosInner = 0.9f, cosOuter = 0.8f;
    bool shadow = false;
    Mat4 shadowMatrix;      // world -> shadow clip space
    float shadowBias = 0.002f;
    float shadowWorldExtent = 2.0f;   // world size covered by the map (X / Y)
    float shadowTexelWorld = 0.05f;   // world size of one shadow map texel
    float shadowDepthRange = 32.0f;   // world units covered by depth 0..1
    std::vector<float>* shadowMap = nullptr;
    int shadowSize = 0;
};

enum class MaterialClass { Opaque, AlphaTest, Transparent, Invisible };

}  // namespace

// ---------------------------------------------------------------- ImGui glue
// The ImGui software backend (editor build) registers itself here, so the
// renderer itself has no ImGui dependency.
static SoftImGuiDrawFn g_softImGuiBackend = nullptr;
void setSoftwareImGuiBackend(SoftImGuiDrawFn fn) { g_softImGuiBackend = fn; }

class SoftwareRenderer : public IRenderer {
public:
    ~SoftwareRenderer() override { shutdown(); }

    bool init(Window* window, const RenderSettings& settings) override {
        window_ = window;
        settings_ = settings;
        targetWidth_ = settings.width;
        targetHeight_ = settings.height;
        allocate();
        pool_ = std::make_unique<ThreadPool>(std::max(1, (int)std::thread::hardware_concurrency() - 1));
        NF_LOG_INFO("Renderer",
                    "software renderer initialised (%dx%d target, %d raster threads, %s)",
                    targetWidth_, targetHeight_, pool_->threadCount(), platformName());
        return true;
    }

    void shutdown() override {
        if (pool_) pool_->waitIdle();
        pool_.reset();
    }

    void setSettings(const RenderSettings& s) override {
        bool shadowToggle = s.enableShadows != settings_.enableShadows ||
                            s.shadowMapSize != settings_.shadowMapSize;
        settings_ = s;
        if (shadowToggle) {
            shadowSize_ = 0;
        }
        allocate();
    }

    const char* name() const override { return "Software (CPU)"; }

    struct Tri {
        ScreenVertex v[3];
        float area = 0;
        const DrawItem* item = nullptr;
        const Material* material = nullptr;
        const Texture* texture = nullptr;
        Vec3 tint{1, 1, 1};
        bool doubleSided = false;
        bool highlighted = false;
    };
    bool isHardware() const override { return false; }
    bool hasShadows() const override { return true; }

    void beginFrame(const RenderCamera& camera) override {
        frameStart_ = std::chrono::steady_clock::now();
        camera_ = camera;
        if (!scene_.valid()) allocate();
        // sky: deep zenith -> hazy horizon (keeps flat-shaded scenes readable)
        Vec3 top = camera_.clearColor * 0.52f + Vec3(0.02f, 0.04f, 0.09f);
        Vec3 horizon = camera_.clearColor * 1.10f + Vec3(0.07f, 0.07f, 0.06f);
        scene_.clearGradient(top, horizon);
        stats_.reset();
        stats_.drawItems = 0;
    }

    void drawScene(const DrawList& list) override {
        // ---- collect lights (limited by the quality preset) -------------
        collectLights(list);
        // ---- shadow pass ------------------------------------------------
        if (settings_.enableShadows) renderShadowMaps(list);
        // ---- main pass --------------------------------------------------
        rasterizeItems(list);
        drawBillboards(list.billboards);
        if (!list.overlayLines.lines.empty()) drawLineBatch(list.overlayLines, true);
        if (!list.overlayLinesNoDepth.lines.empty()) drawLineBatch(list.overlayLinesNoDepth, false);
        if (settings_.wireframe) drawWireframe(list);
        stats_.drawItems = (int)list.items.size();
        stats_.culledItems = list.stats.culledItems;
        stats_.triangles = list.stats.triangles;
        for (auto& p : prepared_) {
            if (p.shadow) stats_.shadowCasters++;
        }
        auto end = std::chrono::steady_clock::now();
        stats_.rasterMs =
            std::chrono::duration<double, std::milli>(end - frameStart_).count();
        stats_.cpuFrameMs = stats_.rasterMs;
    }

    void drawLines(const LineBatch& batch, bool depthTest) override {
        drawLineBatch(batch, depthTest);
    }

    void drawUI(const UIBatch& ui) override {
        SoftTarget t = scene_.target();
        rasterizeUI(t, ui);
    }

    void drawImGui(void* drawData) override {
        if (!drawData || !g_softImGuiBackend) return;
        SoftTarget t = scene_.target();
        g_softImGuiBackend(t, drawData, camera_, 1.0f);
    }

    void endFrame() override {
        int winW = window_ ? window_->width() : scene_.width;
        int winH = window_ ? window_->height() : scene_.height;
        if (winW <= 0 || winH <= 0) return;
        present_.blitScaled(scene_, winW, winH, true);
        if (window_) window_->present((const uint8_t*)present_.color.data(), present_.width, present_.height);
    }

    bool captureFrame(std::vector<uint8_t>& rgba, int& w, int& h) override {
        if (!scene_.valid()) return false;
        w = scene_.width;
        h = scene_.height;
        rgba.resize((size_t)w * h * 4);
        memcpy(rgba.data(), scene_.color.data(), rgba.size());
        return true;
    }

    std::shared_ptr<Texture> viewportTexture() override {
        if (!viewportTexture_) viewportTexture_ = std::make_shared<Texture>();
        viewportTexture_->name = "SceneColor";
        viewportTexture_->width = scene_.width;
        viewportTexture_->height = scene_.height;
        viewportTexture_->filter = TextureFilter::Bilinear;
        viewportTexture_->wrap = TextureWrap::Clamp;
        viewportTexture_->pixels.resize((size_t)scene_.width * scene_.height * 4);
        memcpy(viewportTexture_->pixels.data(), scene_.color.data(), viewportTexture_->pixels.size());
        return viewportTexture_;
    }

    void* imguiTextureId(const Texture* texture) override {
        return (void*)(uintptr_t)texture;
    }

    std::shared_ptr<Texture> fontAtlas() { return UIBatch::createFontAtlas(); }

    // The editor renders the viewport without shadows while editing (faster),
    // and with the full pipeline in PLAY mode.
    void setEditorPreview(bool v) { editorPreview_ = v; }
    bool editorPreview() const { return editorPreview_; }

private:
    // ---------------------------------------------------------------- setup
    void allocate() {
        float scale = clampf(settings_.resolutionScale, 0.25f, 2.0f);
        int w = std::max(16, (int)(targetWidth_ * scale));
        int h = std::max(16, (int)(targetHeight_ * scale));
        if (scene_.width != w || scene_.height != h) {
            scene_.resize(w, h);
            bins_.clear();
            logoUploaded_ = false;
        }
        if (!present_.valid() || present_.width != targetWidth_ || present_.height != targetHeight_)
            present_.resize(targetWidth_, targetHeight_);
    }

    void collectLights(const DrawList& list) {
        prepared_.clear();
        spotShadows_.clear();
        ambientColor_ = list.ambientColor;
        ambientIntensity_ = list.ambientIntensity;
        int budget = settings_.maxLights;
        int shadowSlots = 0;
        int spotSlots = 0;
        for (const LightItem& l : list.lights) {
            if ((int)prepared_.size() >= budget) break;
            PreparedLight p;
            p.type = l.type;
            p.position = l.position;
            p.direction = l.direction.normalized();
            p.color = l.color;
            p.intensity = l.intensity;
            p.range = l.range;
            float cosOuter = std::cos(clampf(l.spotAngleDegrees, 1.0f, 89.0f) * DEG2RAD);
            p.cosOuter = cosOuter;
            p.cosInner = std::cos(clampf(l.spotAngleDegrees * (1.0f - l.spotSoftness), 0.5f, 88.0f) *
                                  DEG2RAD);
            p.shadowBias = l.shadowBias;
            if (settings_.enableShadows && l.castShadow) {
                if (l.type == LightType::Directional && shadowSlots == 0) {
                    p.shadow = true;
                    p.shadowSize = settings_.shadowMapSize;
                    p.shadowMap = &directionalShadow_;
                    shadowSlots++;
                } else if (l.type == LightType::Spot && spotSlots < settings_.maxSpotShadows) {
                    p.shadow = true;
                    p.shadowSize = settings_.spotShadowMapSize;
                    spotShadows_.emplace_back();
                    p.shadowMap = &spotShadows_.back();
                    spotSlots++;
                }
            }
            prepared_.push_back(p);
        }
        lastSpotShadowCount_ = spotSlots;
    }

    // ------------------------------------------------------------ shadows
    // Fits an orthographic projection around the camera frustum so the
    // shadow map resolution is spent where the player can see it.
    void renderShadowMaps(const DrawList& list) {
        if (prepared_.empty()) return;
        std::vector<const DrawItem*> casters;
        for (const DrawItem& it : list.items)
            if (it.castShadow && it.material && it.material->opacity > 0.05f) casters.push_back(&it);

        for (PreparedLight& light : prepared_) {
            if (!light.shadow || !light.shadowMap) continue;
            if (light.type == LightType::Directional) {
                // frustum corners of the main camera
                Vec3 corners[8];
                Mat4 invVP = camera_.viewProjection.inverse();
                for (int i = 0; i < 8; ++i) {
                    float x = (i & 1) ? 1.0f : -1.0f;
                    float y = (i & 2) ? 1.0f : -1.0f;
                    float z = (i & 4) ? 1.0f : 0.0f;   // 0 = near plane in GL clip space
                    Vec4 p = invVP * Vec4(x, y, z, 1.0f);
                    Vec3 corner = Vec3(p.x, p.y, p.z) / (std::fabs(p.w) > 1e-6f ? p.w : 1.0f);
                    // Shadow draw distance: an unbounded fit wastes most of the
                    // shadow map on geometry far outside the visible detail
                    // range, which is what causes blocky shadows.
                    float dist = (corner - camera_.position).length();
                    if (dist > settings_.shadowDistance && dist > 1e-4f)
                        corner = camera_.position + (corner - camera_.position) *
                                                        (settings_.shadowDistance / dist);
                    corners[i] = corner;
                }
                Vec3 center(0, 0, 0);
                for (auto& c : corners) center += c;
                center /= 8.0f;
                float radius = 0.0f;
                for (auto& c : corners) radius = std::max(radius, (c - center).length());
                radius = std::max(radius, 1.0f);
                Vec3 lightDir = light.direction * -1.0f;
                if (lightDir.length() < 0.001f) lightDir = Vec3(0, -1, 0);
                Vec3 eye = center + lightDir.normalized() * (radius + 5.0f);
                Vec3 up = std::fabs(lightDir.y) > 0.95f ? Vec3(0, 0, 1) : Vec3(0, 1, 0);
                Mat4 view = Mat4::lookAt(eye, center, up);
                float depthRange = radius * 2.0f + 10.0f;
                Mat4 proj = Mat4::ortho(-radius, radius, -radius, radius, 0.05f, depthRange);
                light.shadowMatrix = proj * view;
                light.shadowDepthRange = depthRange;
                light.shadowWorldExtent = radius * 2.0f;
            } else {
                Vec3 dir = light.direction.length() > 0.001f ? light.direction.normalized()
                                                            : Vec3(0, -1, 0);
                Vec3 up = std::fabs(dir.y) > 0.95f ? Vec3(0, 0, 1) : Vec3(0, 1, 0);
                Mat4 view = Mat4::lookAt(light.position, light.position + dir, up);
                float fov = std::acos(clampf(light.cosOuter, -1.0f, 1.0f)) * 2.0f;
                fov = clampf(fov * 1.25f, 0.2f, 2.4f);
                float farZ = std::max(light.range, 1.0f);
                Mat4 proj = Mat4::perspective(fov, 1.0f, 0.1f, farZ);
                light.shadowMatrix = proj * view;
                light.shadowDepthRange = farZ;
                light.shadowWorldExtent =
                    2.0f * std::tan(fov * 0.5f) * std::max(1.0f, farZ * 0.5f);
            }
            int size = light.shadowSize;
            light.shadowTexelWorld = light.shadowWorldExtent / (float)size;
            if (light.shadowMap->size() != (size_t)size * size)
                light.shadowMap->assign((size_t)size * size, 1.0f);
            else
                std::fill(light.shadowMap->begin(), light.shadowMap->end(), 1.0f);
            // depth-only rasterisation
            for (const DrawItem* item : casters) {
                rasterizeDepthOnly(*item, light.shadowMatrix, light.shadowMap->data(), size);
            }
        }
    }

    void rasterizeDepthOnly(const DrawItem& item, const Mat4& lightVP, float* depthMap, int size) {
        const Mesh* mesh = item.mesh;
        if (!mesh) return;
        const std::vector<Vertex>* verts = verticesFor(item);
        if (!verts) return;
        Mat4 mvp = lightVP * item.model;
        uint32_t count = item.indexCount;
        uint32_t first = item.indexOffset;
        for (uint32_t i = 0; i + 2 < count; i += 3) {
            uint32_t i0 = first + i, i1 = first + i + 1, i2 = first + i + 2;
            if (i2 >= mesh->indices.size()) break;
            const Vec3& p0 = (*verts)[mesh->indices[i0]].pos;
            const Vec3& p1 = (*verts)[mesh->indices[i1]].pos;
            const Vec3& p2 = (*verts)[mesh->indices[i2]].pos;
            Vec4 c0 = mvp * Vec4(p0, 1.0f);
            Vec4 c1 = mvp * Vec4(p1, 1.0f);
            Vec4 c2 = mvp * Vec4(p2, 1.0f);
            if (c0.w <= 0.0001f || c1.w <= 0.0001f || c2.w <= 0.0001f) continue;
            // orthographic projections keep w == 1
            float x0 = (c0.x / c0.w * 0.5f + 0.5f) * size, y0 = (0.5f - c0.y / c0.w * 0.5f) * size;
            float x1 = (c1.x / c1.w * 0.5f + 0.5f) * size, y1 = (0.5f - c1.y / c1.w * 0.5f) * size;
            float x2 = (c2.x / c2.w * 0.5f + 0.5f) * size, y2 = (0.5f - c2.y / c2.w * 0.5f) * size;
            float z0 = c0.z / c0.w * 0.5f + 0.5f, z1 = c1.z / c1.w * 0.5f + 0.5f,
                  z2 = c2.z / c2.w * 0.5f + 0.5f;
            if ((z0 < 0 && z1 < 0 && z2 < 0) || (z0 > 1 && z1 > 1 && z2 > 1)) continue;
            int minX = (int)std::floor(std::min(x0, std::min(x1, x2)));
            int maxX = (int)std::ceil(std::max(x0, std::max(x1, x2)));
            int minY = (int)std::floor(std::min(y0, std::min(y1, y2)));
            int maxY = (int)std::ceil(std::max(y0, std::max(y1, y2)));
            minX = std::max(0, minX); minY = std::max(0, minY);
            maxX = std::min(size - 1, maxX); maxY = std::min(size - 1, maxY);
            if (minX > maxX || minY > maxY) continue;
            float area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
            if (std::fabs(area) < 1e-7f) continue;
            for (int y = minY; y <= maxY; ++y) {
                for (int x = minX; x <= maxX; ++x) {
                    float px = x + 0.5f, py = y + 0.5f;
                    float w0 = (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1);
                    float w1 = (x0 - x2) * (py - y2) - (px - x2) * (y0 - y2);
                    float w2 = (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0);
                    if (area > 0) {
                        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                    } else {
                        if (w0 > 0 || w1 > 0 || w2 > 0) continue;
                    }
                    float z = (w0 * z0 + w1 * z1 + w2 * z2) / area;
                    float* d = depthMap + (size_t)y * size + x;
                    if (z < *d) *d = z;   // raw depth; bias is applied when sampling
                }
            }
        }
    }

    // ------------------------------------------------------------ main pass
    void rasterizeItems(const DrawList& list) {
        if (list.items.empty()) return;
        // prepare vertices (CPU skinning when needed) and screen space triangles
        tris_.clear();
        bins_.clear();
        int tileCols = (scene_.width + TILE - 1) / TILE;
        int tileRows = (scene_.height + TILE - 1) / TILE;
        bins_.resize((size_t)tileCols * tileRows);
        scratch_.resize(list.items.size());

        int itemIndex = 0;
        for (const DrawItem& item : list.items) {
            const std::vector<Vertex>* verts = verticesFor(item, &scratch_[itemIndex]);
            itemIndex++;
            if (!verts || verts->empty()) continue;
            if (!item.material) continue;
            const Material& mat = *item.material;
            if (mat.opacity < 0.02f) continue;

            Mat4 mvp = camera_.viewProjection * item.model;
            Mat4 model = item.model;
            uint32_t first = item.indexOffset;
            uint32_t count = item.indexCount;
            for (uint32_t i = 0; i + 2 < count; i += 3) {
                uint32_t ia = first + i, ib = first + i + 1, ic = first + i + 2;
                if (ic >= item.mesh->indices.size()) break;
                ScreenVertex v[3];
                bool ok = true;
                for (int k = 0; k < 3; ++k) {
                    const Vertex& src = (*verts)[item.mesh->indices[ia + k]];
                    Vec4 clip = mvp * Vec4(src.pos, 1.0f);
                    bool skinNormal = item.skinning != nullptr && item.skinning->size() > 0;
                    Vec3 normal = src.normal;
                    if (skinNormal) {
                        // skinned normals are already in the skinned vertex buffer
                        normal = src.normal;
                    }
                    Vec3 world = model.transformPoint(src.pos);
                    Vec4 wn4 = item.normalMatrix * Vec4(normal, 0.0f);
                    v[k].s.world = world;
                    v[k].s.normal = Vec3(wn4.x, wn4.y, wn4.z).normalized();
                    v[k].s.uv = Vec2(src.uv.x * mat.uvTiling.x + mat.uvOffset.x,
                                     src.uv.y * mat.uvTiling.y + mat.uvOffset.y);
                    v[k].s.color = mulRGB(src.color, mat.baseColor);
                    v[k].s.invW = 1.0f / std::max(clip.w, 1e-6f);
                    v[k].p = Vec3(clip.x, clip.y, clip.z);
                    if (clip.w <= 1e-5f) ok = false;
                }
                if (!ok) {
                    // near plane clip: emit the visible polygon(s)
                    emitClipped(item, verts, ia, ia + 1, ia + 2, mvp, model);
                    continue;
                }
                addScreenTriangle(v, item, mat);
            }
        }
        // rasterise tiles in parallel (tiles never share pixels)
        std::atomic<int> next(0);
        int totalTiles = (int)bins_.size();
        int threads = pool_ ? pool_->threadCount() : 1;
        if (threads <= 1 || totalTiles < 4) {
            for (int t = 0; t < totalTiles; ++t) rasterizeTile(t, tileCols);
        } else {
            std::vector<std::future<void>> futures;
            for (int w = 0; w < threads; ++w) {
                futures.push_back(pool_->submit([&]() {
                    for (;;) {
                        int t = next.fetch_add(1);
                        if (t >= totalTiles) break;
                        rasterizeTile(t, tileCols);
                    }
                }));
            }
            for (auto& f : futures) f.wait();
        }
    }

    const std::vector<Vertex>* verticesFor(const DrawItem& item,
                                           std::vector<Vertex>* scratch = nullptr) {
        if (!item.mesh) return nullptr;
        if (!item.skinning || item.skinning->empty()) return &item.mesh->vertices;
        if (!scratch) {
            // shadow pass: keep a separate scratch buffer per item pointer
            auto it = shadowScratch_.find(item.mesh);
            if (it == shadowScratch_.end()) {
                shadowScratch_[item.mesh] = std::vector<Vertex>();
                it = shadowScratch_.find(item.mesh);
            }
            applySkinning(*item.mesh, *item.skinning, it->second);
            return &it->second;
        }
        applySkinning(*item.mesh, *item.skinning, *scratch);
        return scratch;
    }

    void emitClipped(const DrawItem& item, const std::vector<Vertex>* verts, uint32_t a, uint32_t b,
                     uint32_t c, const Mat4& mvp, const Mat4& model) {
        const Mesh* mesh = item.mesh;
        const Material& mat = *item.material;
        SurfaceVertex sv[3];
        Vec4 clip[3];
        const uint32_t idx[3] = {a, b, c};
        for (int k = 0; k < 3; ++k) {
            const Vertex& src = (*verts)[mesh->indices[idx[k]]];
            clip[k] = mvp * Vec4(src.pos, 1.0f);
            Vec3 world = model.transformPoint(src.pos);
            Vec4 wn4 = item.normalMatrix * Vec4(src.normal, 0.0f);
            sv[k].world = world;
            sv[k].normal = Vec3(wn4.x, wn4.y, wn4.z).normalized();
            sv[k].uv = Vec2(src.uv.x * mat.uvTiling.x + mat.uvOffset.x,
                            src.uv.y * mat.uvTiling.y + mat.uvOffset.y);
            sv[k].color = mulRGB(src.color, mat.baseColor);
            sv[k].invW = 1.0f / std::max(clip[k].w, 1e-6f);
        }
        // Sutherland-Hodgman clip against the whole view frustum, not just the
        // near plane. Without the side planes a triangle that leaves the screen
        // produces screen coordinates in the millions, and the float edge
        // functions below lose every bit of sub-pixel precision (visible as
        // pinstripe gaps along large ground planes).
        const float eps = 1e-4f;
        Vec4 polyClip[16];
        SurfaceVertex polySv[16];
        int n = 3;
        for (int k = 0; k < 3; ++k) {
            polyClip[k] = clip[k];
            polySv[k] = sv[k];
        }
        // Signed distance to each clip plane; a vertex is kept when d >= 0.
        const auto planeDistance = [](int plane, const Vec4& v) -> float {
            switch (plane) {
                case 0: return v.w - 1e-4f;   // w > 0  (near)
                case 1: return v.w + v.x;     // x > -w (left)
                case 2: return v.w - v.x;     // x <  w (right)
                case 3: return v.w + v.y;     // y > -w (bottom)
                case 4: return v.w - v.y;     // y <  w (top)
                case 5: return v.w + v.z;     // z > -w (near z)
                default: return v.w - v.z;    // z <  w (far z)
            }
        };
        for (int plane = 0; plane < 7 && n > 0; ++plane) {
            Vec4 outClip[16];
            SurfaceVertex outSv[16];
            int m = 0;
            for (int k = 0; k < n; ++k) {
                const int next = (k + 1) % n;
                const float d0 = planeDistance(plane, polyClip[k]);
                const float d1 = planeDistance(plane, polyClip[next]);
                if (d0 >= 0) {
                    outClip[m] = polyClip[k];
                    outSv[m] = polySv[k];
                    ++m;
                }
                if ((d0 >= 0) != (d1 >= 0)) {
                    const float t = d0 / (d0 - d1);
                    const Vec4 c0 = polyClip[k], c1 = polyClip[next];
                    Vec4 cc = c0 + (c1 - c0) * t;
                    SurfaceVertex sp;
                    sp.world = lerp(polySv[k].world, polySv[next].world, t);
                    sp.normal = lerp(polySv[k].normal, polySv[next].normal, t).normalized();
                    sp.uv = lerp(polySv[k].uv, polySv[next].uv, t);
                    sp.color = lerp(polySv[k].color, polySv[next].color, t);
                    sp.invW = 1.0f / std::max(cc.w, 1e-6f);
                    if (m < 16) {
                        outClip[m] = cc;
                        outSv[m] = sp;
                        ++m;
                    }
                }
            }
            n = m;
            for (int k = 0; k < n; ++k) {
                polyClip[k] = outClip[k];
                polySv[k] = outSv[k];
            }
        }
        for (int k = 2; k < n; ++k) {
            ScreenVertex tri[3];
            int order[3] = {0, k - 1, k};
            for (int m = 0; m < 3; ++m) {
                tri[m].p = Vec3(polyClip[order[m]].x, polyClip[order[m]].y, polyClip[order[m]].z);
                tri[m].s = polySv[order[m]];
            }
            addScreenTriangle(tri, item, mat);
        }
    }

    void addScreenTriangle(ScreenVertex v[3], const DrawItem& item, const Material& mat) {
        // to viewport space
        const float W = (float)scene_.width, H = (float)scene_.height;
        for (int k = 0; k < 3; ++k) {
            float w = 1.0f / std::max(v[k].s.invW, 1e-9f);
            float ndcX = v[k].p.x / w;
            float ndcY = v[k].p.y / w;
            float ndcZ = v[k].p.z / w;
            v[k].p = Vec3((ndcX * 0.5f + 0.5f) * W, (0.5f - ndcY * 0.5f) * H, ndcZ);
            // perspective correct attributes: premultiply by 1/w
            v[k].s.world = v[k].s.world * v[k].s.invW;
            v[k].s.normal = v[k].s.normal * v[k].s.invW;
            v[k].s.uv = v[k].s.uv * v[k].s.invW;
            v[k].s.color = v[k].s.color * v[k].s.invW;
        }
        float area = (v[1].p.x - v[0].p.x) * (v[2].p.y - v[0].p.y) -
                     (v[2].p.x - v[0].p.x) * (v[1].p.y - v[0].p.y);
        if (std::fabs(area) < 1e-8f) return;
        bool doubleSided = mat.doubleSided;
        if (area > 0 && !doubleSided) return;      // back facing (CW after flip)
        // bounding box / tile bin
        float minX = std::min(v[0].p.x, std::min(v[1].p.x, v[2].p.x));
        float maxX = std::max(v[0].p.x, std::max(v[1].p.x, v[2].p.x));
        float minY = std::min(v[0].p.y, std::min(v[1].p.y, v[2].p.y));
        float maxY = std::max(v[0].p.y, std::max(v[1].p.y, v[2].p.y));
        if (maxX < 0 || maxY < 0 || minX >= W || minY >= H) return;
        int minTileX = std::max(0, (int)minX / TILE);
        int maxTileX = std::min((scene_.width - 1) / TILE, (int)maxX / TILE);
        int minTileY = std::max(0, (int)minY / TILE);
        int maxTileY = std::min((scene_.height - 1) / TILE, (int)maxY / TILE);
        if (minTileX > maxTileX || minTileY > maxTileY) return;
        int tileCols = (scene_.width + TILE - 1) / TILE;
        Tri tri;
        tri.v[0] = v[0];
        tri.v[1] = v[1];
        tri.v[2] = v[2];
        tri.area = area;
        tri.item = &item;
        tri.material = &mat;
        tri.texture = item.albedo;
        tri.highlighted = item.highlighted;
        tri.tint = item.tint;
        tri.doubleSided = doubleSided;
        int triIndex = (int)tris_.size();
        tris_.push_back(tri);
        for (int ty = minTileY; ty <= maxTileY; ++ty)
            for (int tx = minTileX; tx <= maxTileX; ++tx)
                bins_[(size_t)ty * tileCols + tx].push_back(triIndex);
    }

    // ------------------------------------------------------------ shading
    Vec4 shadePixel(const Tri& tri, const Vec3& world, const Vec3& normal, const Vec2& uv,
                    const Vec4& vertexColor, const Vec3& viewPos) {
        const Material& mat = *tri.material;
        Vec4 albedo = vertexColor;
        if (tri.texture && tri.texture->valid()) {
            Vec4 t = tri.texture->sample(uv.x, uv.y);
            albedo = mulRGB(albedo, t);
        }
        albedo = mulRGB(albedo, tri.tint);
        if (albedo.w < mat.alphaCutoff * 0.999f && mat.alphaCutoff > 0.001f) return Vec4(0, 0, 0, 0);
        Vec3 n = normal.normalized();
        Vec3 viewDir = (viewPos - world).normalized();
        if (tri.doubleSided && dot(n, viewDir) < 0) n = n * -1.0f;
        Vec3 base = Vec3(albedo.x, albedo.y, albedo.z);
        Vec3 color = base * ambientColor_ * ambientIntensity_;
        if (!mat.unlit) {
            for (const PreparedLight& l : prepared_) {
                Vec3 L;
                float attenuation = 1.0f;
                if (l.type == LightType::Directional) {
                    L = l.direction * -1.0f;
                } else {
                    Vec3 toLight = l.position - world;
                    float dist = toLight.length();
                    L = toLight / std::max(dist, 1e-5f);
                    float range = std::max(l.range, 0.001f);
                    attenuation = clampf(1.0f - dist / range, 0.0f, 1.0f);
                    attenuation *= attenuation;
                    if (l.type == LightType::Spot) {
                        float cosAngle = dot(-L, l.direction);
                        float spot = clampf((cosAngle - l.cosOuter) /
                                                std::max(l.cosInner - l.cosOuter, 1e-4f),
                                            0.0f, 1.0f);
                        attenuation *= spot;
                    }
                    if (attenuation <= 0.0f) continue;
                }
                float ndotl = std::max(dot(n, L), 0.0f);
                if (ndotl <= 0.0f) continue;
                float shadow = 1.0f;
                if (l.shadow && l.shadowMap) shadow = sampleShadow(l, world, n);
                if (shadow <= 0.001f) continue;
                float specular = 0.0f;
                float shininess = 2.0f / std::max(mat.roughness * mat.roughness, 0.02f) - 2.0f;
                shininess = clampf(shininess, 2.0f, 512.0f);
                Vec3 h = (L + viewDir).normalized();
                specular = std::pow(std::max(dot(n, h), 0.0f), shininess) * (1.0f - mat.roughness);
                Vec3 lightColor = l.color * (l.intensity * attenuation * shadow);
                Vec3 diff = base * ndotl * (1.0f - mat.metallic * 0.7f);
                Vec3 specTint = lerp(Vec3(1, 1, 1), base, mat.metallic);
                color += lightColor * (diff + specTint * specular * (0.35f + mat.metallic));
            }
        }
        color += mat.emissive * mat.emissiveStrength;
        if (settings_.enableFog) {
            float dist = (world - viewPos).length();
            float fog = 1.0f - std::exp(-settings_.fogDensity * dist);
            color = lerp(color, settings_.fogColor, clampf(fog, 0.0f, 1.0f));
        }
        color = color * camera_.exposure;
        // gamma correction (linear -> sRGB)
        color = Vec3(std::pow(clampf(color.x, 0.0f, 4.0f), 1.0f / 2.2f),
                     std::pow(clampf(color.y, 0.0f, 4.0f), 1.0f / 2.2f),
                     std::pow(clampf(color.z, 0.0f, 4.0f), 1.0f / 2.2f));
        return Vec4(color.x, color.y, color.z, clampf(mat.opacity * albedo.w, 0.0f, 1.0f));
    }

    float sampleShadow(const PreparedLight& l, const Vec3& world, const Vec3& normal) {
        const std::vector<float>& map = *l.shadowMap;
        int size = l.shadowSize;
        // Normal offset: move the sampling point a couple of texels along the
        // surface normal. This removes most self shadowing (shadow acne)
        // without the peter-panning a big constant depth bias would cause.
        Vec3 n = normal.normalized();
        Vec3 samplePos = world + n * (l.shadowTexelWorld * 1.5f);
        Vec4 sc = l.shadowMatrix * Vec4(samplePos, 1.0f);
        if (sc.w <= 0.0f) return 1.0f;
        Vec3 ndc(sc.x / sc.w, sc.y / sc.w, sc.z / sc.w);
        if (ndc.x < -1.0f || ndc.x > 1.0f || ndc.y < -1.0f || ndc.y > 1.0f || ndc.z > 1.0f)
            return 1.0f;
        float u = ndc.x * 0.5f + 0.5f;
        float v = 0.5f - ndc.y * 0.5f;
        float depth = ndc.z * 0.5f + 0.5f;
        // Slope scaled bias: a surface seen at a grazing angle by the light
        // needs a larger bias than one facing it.
        float ndotl = std::fabs(dot(n, l.direction));
        float slope = std::sqrt(std::max(0.0f, 1.0f - ndotl * ndotl)) / std::max(ndotl, 0.2f);
        float bias = l.shadowBias +
                     2.5f * l.shadowTexelWorld * slope / std::max(l.shadowDepthRange, 0.001f);
        int px = (int)(u * size), py = (int)(v * size);
        int taps = settings_.quality >= QualityLevel::High ? 3 : 2;
        float lit = 0.0f, total = 0.0f;
        for (int dy = -taps / 2; dy <= taps / 2; ++dy) {
            for (int dx = -taps / 2; dx <= taps / 2; ++dx) {
                int sx = std::min(size - 1, std::max(0, px + dx));
                int sy = std::min(size - 1, std::max(0, py + dy));
                float d = map[(size_t)sy * size + sx];
                lit += (depth - bias) <= d ? 1.0f : 0.0f;
                total += 1.0f;
            }
        }
        float shadow = total > 0 ? lit / total : 1.0f;
        return lerp(0.25f, 1.0f, shadow);   // keep some ambient in shadows
    }

    // ------------------------------------------------------------ tile raster
    void rasterizeTile(int tileIndex, int tileCols) {
        const std::vector<int>& triList = bins_[tileIndex];
        if (triList.empty()) return;
        int tx = tileIndex % tileCols;
        int ty = tileIndex / tileCols;
        int x0 = std::max(0, tx * TILE), y0 = std::max(0, ty * TILE);
        int x1 = std::min(scene_.width - 1, x0 + TILE - 1);
        int y1 = std::min(scene_.height - 1, y0 + TILE - 1);
        SoftTarget target = scene_.target();
        for (int triIdx : triList) {
            const Tri& tri = tris_[triIdx];
            const ScreenVertex& a = tri.v[0];
            const ScreenVertex& b = tri.v[1];
            const ScreenVertex& c = tri.v[2];
            float minX = std::max((float)x0, std::min(a.p.x, std::min(b.p.x, c.p.x)));
            float maxX = std::min((float)x1, std::max(a.p.x, std::max(b.p.x, c.p.x)));
            float minY = std::max((float)y0, std::min(a.p.y, std::min(b.p.y, c.p.y)));
            float maxY = std::min((float)y1, std::max(a.p.y, std::max(b.p.y, c.p.y)));
            if (minX > maxX || minY > maxY) continue;
            int i0 = (int)minX, i1 = (int)std::ceil(maxX);
            int j0 = (int)minY, j1 = (int)std::ceil(maxY);
            bool transparent = tri.material->isTransparent();
            for (int y = j0; y <= j1; ++y) {
                for (int x = i0; x <= i1; ++x) {
                    float px = x + 0.5f, py = y + 0.5f;
                    float w0 = (c.p.x - b.p.x) * (py - b.p.y) - (px - b.p.x) * (c.p.y - b.p.y);
                    float w1 = (a.p.x - c.p.x) * (py - c.p.y) - (px - c.p.x) * (a.p.y - c.p.y);
                    float w2 = (b.p.x - a.p.x) * (py - a.p.y) - (px - a.p.x) * (b.p.y - a.p.y);
                    if (tri.area > 0) {
                        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                    } else {
                        if (w0 > 0 || w1 > 0 || w2 > 0) continue;
                    }
                    float l0 = w0 / tri.area, l1 = w1 / tri.area, l2 = w2 / tri.area;
                    float depth = a.p.z * l0 + b.p.z * l1 + c.p.z * l2;
                    if (depth < -1.0f || depth > 1.0f) continue;
                    size_t di = (size_t)y * target.width + x;
                    // Transparent surfaces are depth *tested* (so water does not
                    // paint over the island behind it) but never depth written,
                    // and DrawList::sort() orders them back to front.
                    if (depth >= target.depth[di]) continue;
                    float invW = a.s.invW * l0 + b.s.invW * l1 + c.s.invW * l2;
                    if (invW <= 1e-9f) continue;
                    float wInv = 1.0f / invW;
                    Vec3 world = (a.s.world * l0 + b.s.world * l1 + c.s.world * l2) * wInv;
                    Vec3 normal = (a.s.normal * l0 + b.s.normal * l1 + c.s.normal * l2) * wInv;
                    Vec2 uv = Vec2((a.s.uv.x * l0 + b.s.uv.x * l1 + c.s.uv.x * l2) * wInv,
                                   (a.s.uv.y * l0 + b.s.uv.y * l1 + c.s.uv.y * l2) * wInv);
                    Vec4 vcolor = (a.s.color * l0 + b.s.color * l1 + c.s.color * l2) * wInv;
                    Vec4 out = shadePixel(tri, world, normal, uv, vcolor, camera_.position);
                    if (out.w <= 0.004f) continue;
                    if (transparent) {
                        // blend over what is already there
                        uint32_t dst = target.color[di];
                        float dr = (float)(dst & 0xFF) / 255.0f;
                        float dg = (float)((dst >> 8) & 0xFF) / 255.0f;
                        float db = (float)((dst >> 16) & 0xFF) / 255.0f;
                        float alpha = clampf(out.w, 0.0f, 1.0f);
                        Vec3 blended(dr + (out.x - dr) * alpha, dg + (out.y - dg) * alpha,
                                     db + (out.z - db) * alpha);
                        target.color[di] = packRGBA(blended.x, blended.y, blended.z, 1.0f);
                    } else {
                        target.color[di] = packRGBA(out.x, out.y, out.z, 1.0f);
                        target.depth[di] = depth;
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------ extras
    void drawBillboards(const std::vector<BillboardItem>& items) {
        if (items.empty() || !settings_.enableParticles) return;
        Vec3 camRight(camera_.view.at(0, 0), camera_.view.at(1, 0), camera_.view.at(2, 0));
        Vec3 camUp(camera_.view.at(0, 1), camera_.view.at(1, 1), camera_.view.at(2, 1));
        SoftTarget target = scene_.target();
        const float W = (float)scene_.width, H = (float)scene_.height;
        for (const BillboardItem& b : items) {
            Vec3 corners[4] = {
                b.position - camRight * b.size.x - camUp * b.size.y,
                b.position + camRight * b.size.x - camUp * b.size.y,
                b.position + camRight * b.size.x + camUp * b.size.y,
                b.position - camRight * b.size.x + camUp * b.size.y};
            Vec4 clip[4];
            float sx[4], sy[4], sz[4];
            bool visible = true;
            for (int i = 0; i < 4; ++i) {
                clip[i] = camera_.viewProjection * Vec4(corners[i], 1.0f);
                if (clip[i].w <= 1e-4f) {
                    visible = false;
                    break;
                }
                float invW = 1.0f / clip[i].w;
                sx[i] = (clip[i].x * invW * 0.5f + 0.5f) * W;
                sy[i] = (0.5f - clip[i].y * invW * 0.5f) * H;
                sz[i] = clip[i].z * invW;
            }
            if (!visible) continue;
            int minX = (int)std::min(std::min(sx[0], sx[1]), std::min(sx[2], sx[3]));
            int maxX = (int)std::max(std::max(sx[0], sx[1]), std::max(sx[2], sx[3]));
            int minY = (int)std::min(std::min(sy[0], sy[1]), std::min(sy[2], sy[3]));
            int maxY = (int)std::max(std::max(sy[0], sy[1]), std::max(sy[2], sy[3]));
            minX = std::max(0, minX); minY = std::max(0, minY);
            maxX = std::min(target.width - 1, maxX); maxY = std::min(target.height - 1, maxY);
            float depth = (sz[0] + sz[1] + sz[2] + sz[3]) * 0.25f;
            for (int y = minY; y <= maxY; ++y) {
                for (int x = minX; x <= maxX; ++x) {
                    float px = x + 0.5f, py = y + 0.5f;
                    // point in quad (two triangles)
                    auto edge = [](float ax, float ay, float bx, float by, float cx, float cy) {
                        return (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
                    };
                    float e0 = edge(sx[0], sy[0], sx[1], sy[1], px, py);
                    float e1 = edge(sx[1], sy[1], sx[2], sy[2], px, py);
                    float e2 = edge(sx[2], sy[2], sx[3], sy[3], px, py);
                    float e3 = edge(sx[3], sy[3], sx[0], sy[0], px, py);
                    bool inside = (e0 >= 0 && e1 >= 0 && e2 >= 0 && e3 >= 0) ||
                                  (e0 <= 0 && e1 <= 0 && e2 <= 0 && e3 <= 0);
                    if (!inside) continue;
                    size_t di = (size_t)y * target.width + x;
                    if (depth >= target.depth[di]) continue;
                    float alpha = b.color.w;
                    if (b.softCircle) {
                        // radial falloff for a soft round particle
                        float cx = (sx[0] + sx[1] + sx[2] + sx[3]) * 0.25f;
                        float cy = (sy[0] + sy[1] + sy[2] + sy[3]) * 0.25f;
                        float rx = std::max(1.0f, std::fabs(sx[1] - sx[0]) * 0.5f +
                                                      std::fabs(sx[3] - sx[0]) * 0.5f);
                        float ry = std::max(1.0f, std::fabs(sy[3] - sy[0]) * 0.5f +
                                                      std::fabs(sy[1] - sy[0]) * 0.5f);
                        float dx = (px - cx) / rx, dy = (py - cy) / ry;
                        float r = std::sqrt(dx * dx + dy * dy);
                        alpha *= clampf(1.0f - r, 0.0f, 1.0f);
                    }
                    if (alpha <= 0.004f) continue;
                    if (b.additive) {
                        uint32_t dst = target.color[di];
                        float dr = (float)(dst & 0xFF) / 255.0f + b.color.x * alpha;
                        float dg = (float)((dst >> 8) & 0xFF) / 255.0f + b.color.y * alpha;
                        float db = (float)((dst >> 16) & 0xFF) / 255.0f + b.color.z * alpha;
                        target.color[di] = packRGBA(dr, dg, db, 1.0f);
                    } else {
                        blendPixel(target, x, y, Vec4(b.color.x, b.color.y, b.color.z, alpha));
                    }
                }
            }
        }
    }

    void drawLineBatch(const LineBatch& batch, bool depthTest) {
        SoftTarget target = scene_.target();
        for (size_t i = 0; i + 1 < batch.lines.size(); i += 2) {
            const LineVertex& a = batch.lines[i];
            const LineVertex& b = batch.lines[i + 1];
            Vec4 ca = camera_.viewProjection * Vec4(a.pos, 1.0f);
            Vec4 cb = camera_.viewProjection * Vec4(b.pos, 1.0f);
            const float eps = 1e-4f;
            if (ca.w <= eps || cb.w <= eps) continue;
            float W = (float)scene_.width, H = (float)scene_.height;
            float x0 = (ca.x / ca.w * 0.5f + 0.5f) * W, y0 = (0.5f - ca.y / ca.w * 0.5f) * H;
            float x1 = (cb.x / cb.w * 0.5f + 0.5f) * W, y1 = (0.5f - cb.y / cb.w * 0.5f) * H;
            Vec4 color = a.color;
            if (depthTest) {
                // depth aware lines: sample the depth buffer at the mid point
                int mx = (int)((x0 + x1) * 0.5f), my = (int)((y0 + y1) * 0.5f);
                if (mx >= 0 && my >= 0 && mx < scene_.width && my < scene_.height) {
                    float d = scene_.depth[(size_t)my * scene_.width + mx];
                    float lineDepth = (ca.z / ca.w * 0.5f + 0.5f);
                    if (lineDepth > d + 0.002f) color.w *= 0.35f;   // faded when occluded
                }
            }
            drawLine2D(target, x0, y0, x1, y1, color, false);
        }
    }

    void drawWireframe(const DrawList& list) {
        LineBatch batch;
        for (const DrawItem& item : list.items) {
            const std::vector<Vertex>* verts = verticesFor(item);
            if (!verts || !item.mesh) continue;
            for (uint32_t i = 0; i + 2 < item.indexCount; i += 3) {
                uint32_t base = item.indexOffset + i;
                if (base + 2 >= item.mesh->indices.size()) break;
                Vec3 p[3];
                for (int k = 0; k < 3; ++k)
                    p[k] = item.model.transformPoint((*verts)[item.mesh->indices[base + k]].pos);
                Vec4 c(0.15f, 1.0f, 0.6f, 0.9f);
                batch.add(p[0], p[1], c);
                batch.add(p[1], p[2], c);
                batch.add(p[2], p[0], c);
            }
        }
        drawLineBatch(batch, true);
    }

    // ------------------------------------------------------------ state
    SoftBuffer scene_;
    SoftBuffer present_;
    RenderCamera camera_;
    std::unique_ptr<ThreadPool> pool_;
    std::vector<Tri> tris_;
    std::vector<std::vector<int>> bins_;
    std::vector<std::vector<Vertex>> scratch_;
    std::map<const void*, std::vector<Vertex>> shadowScratch_;
    std::vector<PreparedLight> prepared_;
    std::vector<float> directionalShadow_;
    std::deque<std::vector<float>> spotShadows_;
    std::shared_ptr<Texture> viewportTexture_;
    std::unordered_map<const Texture*, bool> uploadedTextures_;
    Vec3 ambientColor_{0.55f, 0.62f, 0.72f};
    float ambientIntensity_ = 0.35f;
    int shadowSize_ = 0;
    int lastSpotShadowCount_ = 0;
    bool editorPreview_ = false;
    bool logoUploaded_ = false;
    std::chrono::steady_clock::time_point frameStart_;
};

IRenderer* createSoftwareRenderer() { return new SoftwareRenderer(); }

}  // namespace nf
