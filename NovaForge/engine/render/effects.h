// NovaForge Engine - gameplay effects
//
// A tiny world-space effect queue: gameplay code (AI hits, pickups, footsteps,
// explosions) pushes bursts in, the renderer pulls camera facing billboards
// out. This is the V1 replacement for a full VFX graph (out of scope, see
// docs/ROADMAP.md).
#pragma once
#include "core/math.h"
#include "render/particles.h"
#include "scene/scene.h"    // EntityId

#include <vector>

namespace nf {

struct BillboardItem;

struct EffectBurst {
    Vec3 position;
    Vec3 color{1.0f, 0.6f, 0.2f};
    int count = 12;
    float size = 0.15f;
    float lifetime = 0.7f;
    float speed = 2.5f;
    bool loop = false;
    bool additive = true;
    EntityId owner = kInvalidEntity;
};

class EffectsQueue {
public:
    void spawn(const EffectBurst& burst);
    // Convenience for one-shot bursts (hit sparks, pickups, dust).
    void spawnBurst(const Vec3& position, const Vec3& color = Vec3(1.0f, 0.6f, 0.2f),
                    int count = 12, float size = 0.15f, float lifetime = 0.7f,
                    float speed = 2.5f);
    // Attaches a looping emitter to an entity (moving effects follow it).
    void setLooping(EntityId owner, const Vec3& color, float size, float lifetime, float speed,
                    int count);
    void stopLooping(EntityId owner);
    void setPosition(EntityId owner, const Vec3& position);

    void update(float dt);
    void appendBillboards(std::vector<BillboardItem>& out) const;
    void clear();

    size_t particleCount() const;
    size_t activeEmitterCount() const;

private:
    struct Entry {
        EntityId owner = kInvalidEntity;
        Vec3 position;
        ParticleEmitter emitter;
        bool oneShot = true;
    };
    std::vector<Entry> entries_;
};

}  // namespace nf
