#include "render/particles.h"

namespace nf {

float ParticleEmitter::rnd() {
    // xorshift: deterministic particle look, no dependency on <random>
    rngState_ ^= rngState_ << 13;
    rngState_ ^= rngState_ >> 17;
    rngState_ ^= rngState_ << 5;
    return (float)(rngState_ % 100000) / 100000.0f;
}

void ParticleEmitter::setConfig(const Vec3& color, float size, float lifetime, float speed,
                                int count, bool looping, bool additive) {
    color_ = color;
    size_ = size;
    lifetime_ = std::max(0.05f, lifetime);
    speed_ = speed;
    count_ = std::max(1, count);
    looping_ = looping;
    emitting_ = looping;
    additive_ = additive;
}

void ParticleEmitter::burst() {
    for (int i = 0; i < count_; ++i) {
        Particle p;
        p.position = Vec3(0, 0, 0);
        float theta = rnd() * 2.0f * PI;
        float phi = std::acos(1.0f - 1.4f * rnd());
        Vec3 dir(std::sin(phi) * std::cos(theta), std::cos(phi) * 1.2f, std::sin(phi) * std::sin(theta));
        p.velocity = dir.normalized() * (speed_ * (0.5f + rnd()));
        p.color = Vec4(color_.x, color_.y, color_.z, 1.0f);
        p.maxLife = lifetime_ * (0.7f + 0.6f * rnd());
        p.life = p.maxLife;
        p.size = size_ * (0.7f + 0.6f * rnd());
        p.additive = additive_;
        particles_.push_back(p);
    }
}

void ParticleEmitter::update(float dt, const Vec3& origin) {
    if (looping_) {
        accumulate_ += dt;
        float interval = std::max(0.02f, lifetime_ / std::max(1.0f, (float)count_ * 0.15f));
        while (accumulate_ >= interval) {
            accumulate_ -= interval;
            burst();
            // Only a fraction of each burst gets spawned after the first frame
            if (particles_.size() > (size_t)count_ * 8) particles_.erase(particles_.begin());
        }
    }
    for (size_t i = 0; i < particles_.size();) {
        Particle& p = particles_[i];
        p.life -= dt;
        if (p.life <= 0.0f) {
            particles_.erase(particles_.begin() + (long)i);
            continue;
        }
        p.velocity.y -= 4.5f * dt;                    // gravity
        p.position += p.velocity * dt;
        ++i;
    }
    origin_ = origin;
}

void ParticleEmitter::buildBillboards(std::vector<BillboardItem>& out) const {
    for (const Particle& p : particles_) {
        float t = clampf(p.life / p.maxLife, 0.0f, 1.0f);
        BillboardItem b;
        b.position = origin_ + p.position;
        float s = p.size * (0.4f + 0.6f * t);
        b.size = Vec2(s, s);
        b.color = Vec4(p.color.x, p.color.y, p.color.z, t * p.color.w);
        b.additive = p.additive;
        b.softCircle = true;
        out.push_back(b);
    }
}

}  // namespace nf
