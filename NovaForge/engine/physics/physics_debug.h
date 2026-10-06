// NovaForge Engine - physics debug drawing
//
// Bridges the physics world's debug wireframes into the renderer's line batch
// so colliders, triggers and character capsules can be inspected in the
// viewport (and in the game with F1).
#pragma once
#include "physics/physics.h"

#include <vector>

namespace nf {

struct LineBatch;

// Appends the physics wireframes to `lines`. `onlyDebugDraw` limits the output
// to colliders whose ColliderComponent::debugDraw flag is set.
void physicsDebugDraw(const PhysicsWorld& world, LineBatch& lines, bool onlyDebugDraw = false);

// Renderer independent variant (used by tests and by exporters).
std::vector<PhysicsDebugLine> physicsDebugLines(const PhysicsWorld& world,
                                                bool onlyDebugDraw = false);

}  // namespace nf
