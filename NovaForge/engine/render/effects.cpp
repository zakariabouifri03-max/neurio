// NovaForge Engine - gameplay effect queue implementation
#include "render/effects.h"

#include "render/draw_list.h"

#include <algorithm>

namespace nf {

void EffectsQueue::spawn(const EffectBurst& burst) {
    Entry e;
    e.owner = burst.owner;
    e.position = burst.position;
    e.oneShot = !burst.loop;
    e.emitter.setConfig(burst.color, burst.size, burst.lifetime, burst.speed, burst.count,
                        burst.loop, burst.additive);
    e.emitter.setEmitting(burst.loop);
    if (!burst.loop) e.emitter.burst();
    // one-shot entries are removed once their particles die
    entries_.push_back(std::move(e));
}

void EffectsQueue::spawnBurst(const Vec3& position, const Vec3& color, int count, float size,
                              float lifetime, float speed) {
    EffectBurst b;
    b.position = position;
    b.color = color;
    b.count = count;
    b.size = size;
    b.lifetime = lifetime;
    b.speed = speed;
    spawn(b);
}

void EffectsQueue::setLooping(EntityId owner, const Vec3& color, float size, float lifetime,
                              float speed, int count) {
    for (Entry& e : entries_)
        if (e.owner == owner && !e.oneShot) {
            e.emitter.setConfig(color, size, lifetime, speed, count, true, true);
            e.emitter.setEmitting(true);
            return;
        }
    EffectBurst b;
    b.owner = owner;
    b.color = color;
    b.size = size;
    b.lifetime = lifetime;
    b.speed = speed;
    b.count = count;
    b.loop = true;
    spawn(b);
}

void EffectsQueue::stopLooping(EntityId owner) {
    entries_.erase(std::remove_if(entries_.begin(), entries_.end(),
                                  [owner](const Entry& e) { return e.owner == owner && !e.oneShot; }),
                   entries_.end());
}

void EffectsQueue::setPosition(EntityId owner, const Vec3& position) {
    for (Entry& e : entries_)
        if (e.owner == owner) e.position = position;
}

void EffectsQueue::update(float dt) {
    if (dt <= 0.0f) return;
    for (Entry& e : entries_) e.emitter.update(dt, e.position);
    entries_.erase(std::remove_if(entries_.begin(), entries_.end(),
                                  [](const Entry& e) { return e.oneShot && !e.emitter.active(); }),
                   entries_.end());
}

void EffectsQueue::appendBillboards(std::vector<BillboardItem>& out) const {
    for (const Entry& e : entries_) e.emitter.buildBillboards(out);
}

void EffectsQueue::clear() { entries_.clear(); }

size_t EffectsQueue::particleCount() const {
    size_t n = 0;
    for (const Entry& e : entries_) n += e.emitter.count();
    return n;
}

size_t EffectsQueue::activeEmitterCount() const { return entries_.size(); }

}  // namespace nf
