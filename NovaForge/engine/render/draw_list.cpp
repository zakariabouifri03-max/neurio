#include "render/draw_list.h"

#include "core/log.h"

#include <algorithm>
#include <functional>

namespace nf {

RenderSettings RenderSettings::preset(QualityLevel q) {
    RenderSettings s;
    switch (q) {
        case QualityLevel::Low:
            s.quality = q;
            s.resolutionScale = 0.6f;
            s.shadowMapSize = 512;
            s.spotShadowMapSize = 256;
            s.maxSpotShadows = 0;
            s.enableShadows = true;
            s.maxLights = 4;
            s.drawDistance = 250.0f;
            s.enableParticles = false;
            break;
        case QualityLevel::Medium:
            s.quality = q;
            s.resolutionScale = 0.85f;
            s.shadowMapSize = 1024;
            s.spotShadowMapSize = 512;
            s.maxSpotShadows = 1;
            s.maxLights = 8;
            s.drawDistance = 400.0f;
            break;
        case QualityLevel::High:
            s.quality = q;
            s.resolutionScale = 1.0f;
            s.shadowMapSize = 2048;
            s.spotShadowMapSize = 1024;
            s.maxSpotShadows = 2;
            s.maxLights = 12;
            s.drawDistance = 600.0f;
            break;
        case QualityLevel::Ultra:
            s.quality = q;
            s.resolutionScale = 1.0f;
            s.shadowMapSize = 4096;
            s.spotShadowMapSize = 2048;
            s.maxSpotShadows = 4;
            s.maxLights = 16;
            s.drawDistance = 1000.0f;
            break;
    }
    return s;
}

std::string RenderSettings::qualityName() const {
    switch (quality) {
        case QualityLevel::Low: return "Low";
        case QualityLevel::Medium: return "Medium";
        case QualityLevel::High: return "High";
        case QualityLevel::Ultra: return "Ultra";
    }
    return "Medium";
}

// ---------------------------------------------------------------- camera
RenderCamera RenderCamera::perspective(const Vec3& eye, const Vec3& target, const Vec3& up,
                                       float fovY, float aspect, float nearZ, float farZ) {
    RenderCamera c;
    c.position = eye;
    c.forward = (target - eye).normalized();
    c.up = up;
    c.fovYDegrees = fovY;
    c.aspect = aspect;
    c.nearZ = nearZ;
    c.farZ = farZ;
    c.view = Mat4::lookAt(eye, target, up);
    c.projection = Mat4::perspective(fovY * DEG2RAD, aspect, nearZ, farZ);
    c.viewProjection = c.projection * c.view;
    c.frustum = Frustum::fromMatrix(c.viewProjection);
    return c;
}

void RenderCamera::rebuild() {
    view = Mat4::lookAt(position, position + forward, up);
    projection = orthographic
                     ? Mat4::ortho(-aspect * 5.0f, aspect * 5.0f, -5.0f, 5.0f, nearZ, farZ)
                     : Mat4::perspective(fovYDegrees * DEG2RAD, aspect, nearZ, farZ);
    viewProjection = projection * view;
    frustum = Frustum::fromMatrix(viewProjection);
}

Ray RenderCamera::screenRay(float x, float y) const {
    float ndcX = (x / (float)viewportWidth) * 2.0f - 1.0f;
    float ndcY = 1.0f - (y / (float)viewportHeight) * 2.0f;
    Mat4 invVP = viewProjection.inverse();
    Vec4 nearP = invVP * Vec4(ndcX, ndcY, -1.0f, 1.0f);
    Vec4 farP = invVP * Vec4(ndcX, ndcY, 1.0f, 1.0f);
    Vec3 n = Vec3(nearP.x, nearP.y, nearP.z) / (std::fabs(nearP.w) > 1e-8f ? nearP.w : 1.0f);
    Vec3 f = Vec3(farP.x, farP.y, farP.z) / (std::fabs(farP.w) > 1e-8f ? farP.w : 1.0f);
    Ray r;
    r.origin = n;
    r.dir = (f - n).normalized();
    return r;
}

Vec3 RenderCamera::worldToScreen(const Vec3& world) const {
    Vec4 clip = viewProjection * Vec4(world, 1.0f);
    if (std::fabs(clip.w) < 1e-8f) return Vec3(0, 0, -1);
    Vec3 ndc(clip.x / clip.w, clip.y / clip.w, clip.z / clip.w);
    return Vec3((ndc.x * 0.5f + 0.5f) * viewportWidth,
                (1.0f - (ndc.y * 0.5f + 0.5f)) * viewportHeight, ndc.z);
}

bool RenderCamera::projectPoint(const Vec3& world, Vec2& outScreen) const {
    Vec3 s = worldToScreen(world);
    if (s.z < -1.0f || s.z > 1.0f) return false;
    outScreen = Vec2(s.x, s.y);
    return true;
}

// ---------------------------------------------------------------- draw list
void DrawList::clear() {
    items.clear();
    lights.clear();
    overlayLines.clear();
    overlayLinesNoDepth.clear();
    particles = 0;
    stats.reset();
}

void DrawList::add(const Mesh& mesh, const Mat4& model, const Material& material,
                   const Texture* albedo, const std::vector<Mat4>* skinning, EntityId entity) {
    DrawItem item;
    item.mesh = &mesh;
    item.model = model;
    item.normalMatrix = model.normalMatrix();
    item.material = &material;
    item.albedo = albedo;
    item.skinning = skinning;
    item.entity = entity;
    item.castShadow = material.castShadow;
    item.doubleSided = material.doubleSided;
    item.unlit = material.unlit;
    item.indexOffset = 0;
    item.indexCount = (uint32_t)mesh.indices.size();
    item.worldBounds = transformAABB(mesh.bounds, model);
    items.push_back(item);
}

void DrawList::addMeshAll(
    const Mesh& mesh, const Mat4& model, EntityId entity,
    const std::function<const Material*(int submeshIndex, const Texture** albedoOut)>& resolve,
    const std::vector<Mat4>* skinning, bool castShadow, bool receiveShadow, bool highlighted,
    const Vec3& tint) {
    Mat4 normalMat = model.normalMatrix();
    AABB world = transformAABB(mesh.bounds, model);
    if (mesh.submeshes.empty()) {
        const Texture* albedo = nullptr;
        const Material* mat = resolve(0, &albedo);
        DrawItem item;
        item.mesh = &mesh;
        item.model = model;
        item.normalMatrix = normalMat;
        item.material = mat;
        item.subMaterial = mat;
        item.albedo = albedo;
        item.skinning = skinning;
        item.entity = entity;
        item.castShadow = castShadow;
        item.receiveShadow = receiveShadow;
        item.highlighted = highlighted;
        item.tint = tint;
        item.indexOffset = 0;
        item.indexCount = (uint32_t)mesh.indices.size();
        item.worldBounds = world;
        items.push_back(item);
        return;
    }
    for (size_t i = 0; i < mesh.submeshes.size(); ++i) {
        const SubMesh& sm = mesh.submeshes[i];
        if (sm.indexCount == 0) continue;
        const Texture* albedo = nullptr;
        const Material* mat = resolve((int)i, &albedo);
        DrawItem item;
        item.mesh = &mesh;
        item.model = model;
        item.normalMatrix = normalMat;
        item.material = mat;
        item.subMaterial = mat;
        item.albedo = albedo;
        item.skinning = skinning;
        item.entity = entity;
        item.submeshIndex = (int)i;
        item.materialIndex = sm.materialIndex;
        item.indexOffset = sm.indexOffset;
        item.indexCount = sm.indexCount;
        item.castShadow = castShadow && (!mat || mat->castShadow);
        item.receiveShadow = receiveShadow;
        item.doubleSided = mat ? mat->doubleSided : false;
        item.unlit = mat ? mat->unlit : false;
        item.highlighted = highlighted;
        item.tint = tint;
        item.worldBounds = world;
        items.push_back(item);
    }
}

int DrawList::cull() {
    int culled = 0;
    std::vector<DrawItem> kept;
    kept.reserve(items.size());
    float maxDist = settings.drawDistance;
    for (auto& it : items) {
        if (!it.mesh || it.indexCount == 0) {
            culled++;
            continue;
        }
        if (!camera.frustum.intersectsAABB(it.worldBounds)) {
            culled++;
            continue;
        }
        if (maxDist > 0) {
            float d = (it.worldBounds.center() - camera.position).length() -
                      it.worldBounds.radius();
            if (d > maxDist) {
                culled++;
                continue;
            }
        }
        kept.push_back(it);
    }
    items.swap(kept);
    stats.culledItems += culled;
    return culled;
}

void DrawList::sort() {
    // Sort key: opaque (0) -> alpha test (1) -> transparent (2)
    auto classify = [](const DrawItem& it) {
        const Material* m = it.subMaterial ? it.subMaterial : it.material;
        if (!m) return 0;
        if (m->opacity < 0.05f) return 4;             // fully invisible: last
        if (m->isTransparent() || m->opacity < 0.999f) return 2;
        return m->albedoTexture.empty() && m->alphaCutoff > 0.0f ? 1 : 0;
    };
    for (auto& it : items) {
        Vec3 c = it.worldBounds.center();
        it.sortDepth = (c - camera.position).sqLength();
    }
    std::stable_sort(items.begin(), items.end(), [&](const DrawItem& a, const DrawItem& b) {
        int ca = classify(a), cb = classify(b);
        if (ca != cb) return ca < cb;
        if (ca == 2 || ca == 4) return a.sortDepth > b.sortDepth;   // back to front
        return a.sortDepth < b.sortDepth;                            // front to back
    });
}

void DrawList::computeStats() {
    stats.drawItems = (int)items.size();
    stats.drawCalls = 0;
    stats.triangles = 0;
    stats.vertices = 0;
    stats.shadowCasters = 0;
    uint32_t lastMeshId = 0;
    for (auto& it : items) {
        stats.drawCalls++;
        stats.triangles += (int)(it.indexCount / 3);
        stats.vertices += (int)it.indexCount;
        if (it.castShadow) stats.shadowCasters++;
        (void)lastMeshId;
    }
}

DrawList::LightSummary DrawList::lightSummary() const {
    LightSummary s;
    for (auto& l : lights) {
        if (l.type == LightType::Directional) s.directional++;
        else if (l.type == LightType::Point) s.point++;
        else s.spot++;
        if (l.castShadow && l.shadowSlot >= 0) s.shadowCasters++;
    }
    return s;
}

// ---------------------------------------------------------------- picking
PickResult pickRay(const DrawList& list, const Ray& ray, bool includeInvisible) {
    PickResult best;
    for (const DrawItem& item : list.items) {
        if (!includeInvisible && item.material && item.material->opacity < 0.05f) continue;
        float tBox = 0;
        if (!rayAABB(ray, item.worldBounds, tBox)) continue;
        if (tBox > best.distance) continue;
        const Mesh& mesh = *item.mesh;
        Mat4 inv = item.model.inverse();
        Ray local;
        local.origin = inv.transformPoint(ray.origin);
        local.dir = inv.transformDir(ray.dir).normalized();
        for (uint32_t i = 0; i < item.indexCount; i += 3) {
            uint32_t base = item.indexOffset + i;
            if (base + 2 >= mesh.indices.size()) break;
            const Vec3& a = mesh.vertices[mesh.indices[base]].pos;
            const Vec3& b = mesh.vertices[mesh.indices[base + 1]].pos;
            const Vec3& c = mesh.vertices[mesh.indices[base + 2]].pos;
            float t = 0;
            if (rayTriangle(local, a, b, c, t)) {
                Vec3 hitLocal = local.origin + local.dir * t;
                Vec3 hitWorld = item.model.transformPoint(hitLocal);
                float d = (hitWorld - ray.origin).length();
                if (d < best.distance) {
                    best.distance = d;
                    best.entity = item.entity;
                    best.point = hitWorld;
                    best.hit = true;
                }
            }
        }
    }
    return best;
}

}  // namespace nf
