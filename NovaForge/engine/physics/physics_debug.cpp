// NovaForge Engine - physics debug drawing implementation
#include "physics/physics_debug.h"

#include "render/draw_list.h"

namespace nf {

void physicsDebugDraw(const PhysicsWorld& world, LineBatch& lines, bool onlyDebugDraw) {
    std::vector<PhysicsDebugLine> debugLines;
    world.collectDebugLines(debugLines, onlyDebugDraw);
    for (const PhysicsDebugLine& l : debugLines)
        lines.add(l.a, l.b, Vec4(l.color, 1.0f));
}

std::vector<PhysicsDebugLine> physicsDebugLines(const PhysicsWorld& world, bool onlyDebugDraw) {
    std::vector<PhysicsDebugLine> debugLines;
    world.collectDebugLines(debugLines, onlyDebugDraw);
    return debugLines;
}

}  // namespace nf
