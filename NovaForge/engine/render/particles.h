// NovaForge Engine - V1 particle effects
// Deliberately small: a burst of camera facing sprites with gravity and fade.
// A Niagara-like system is explicitly out of scope for V1 (docs/ROADMAP.md).
#pragma once
#include "core/math.h"
#include "render/draw_list.h"

#include <cmath>
#include <vector>

namespace nf {

struct Particle {
    Vec3 position;
    Vec3 velocity;
    Vec4 color{1, 1, 1, 1};
    float life = 0;
    float maxLife = 1;
    float size = 0.1f;
    bool additive = false;
};

class ParticleEmitter {
public:
    void setConfig(const Vec3& color, float size, float lifetime, float speed, int count,
                   bool looping, bool additive);
    void burst();
    void update(float dt, const Vec3& origin);
    void buildBillboards(std::vector<BillboardItem>& out) const;
    void clear() { particles_.clear(); }
    size_t count() const { return particles_.size(); }
    bool active() const { return emitting_ || !particles_.empty(); }
    void setEmitting(bool e) { emitting_ = e; }

private:
    std::vector<Particle> particles_;
    Vec3 color_{1, 0.6f, 0.2f};
    float size_ = 0.15f;
    float lifetime_ = 0.8f;
    float speed_ = 2.5f;
    int count_ = 24;
    float accumulate_ = 0;
    bool emitting_ = false;
    bool looping_ = false;
    bool additive_ = true;
    Vec3 origin_{0, 0, 0};
    unsigned rngState_ = 12345;
    float rnd();
};

}  // namespace nf
