// NovaForge Engine - scene -> DrawList bridge
//
// This is the single place that turns the scene graph into renderable data, so
// the editor viewport, PLAY mode and the exported game all render the same way.
#pragma once
#include "assets/model.h"
#include "render/draw_list.h"
#include "render/effects.h"
#include "render/particles.h"
#include "scene/scene.h"

#include <memory>
#include <unordered_map>
#include <vector>

namespace nf {

struct SceneRenderOptions {
    bool editorMode = true;        // translucent for invisible objects, gizmos
    bool updateAnimations = true;
    bool drawColliders = false;
    bool showLightGizmos = false;
    bool showBounds = false;
    bool invertSelectedInvisible = false;
    std::vector<EntityId> selection;
    float alphaForInvisible = 0.30f;
    Vec3 selectionColor{1.0f, 0.62f, 0.1f};
};

// Fills `out` with everything that needs drawing for this scene. Model
// instances (and their animation players) are created on demand and stored in
// the entities, so calling this every frame is cheap for static scenes.
void buildDrawList(Scene& scene, DrawList& out, const RenderCamera& camera,
                   const RenderSettings& settings, const SceneRenderOptions& options);

// Applies scene lights to the draw list (also used by the runtime).
void collectSceneLights(Scene& scene, DrawList& out);

// Shadow map slot assignment for lights that cast shadows.
void assignShadowSlots(DrawList& out, const RenderSettings& settings);

// ------------------------------------------------------------------ effects
// Per entity particle emitters for ParticleComponent, kept outside the scene so
// the component itself stays serializable plain data. `runtimeMode` enables the
// playOnStart / looping emitters (in the editor they stay idle unless previewed).
struct SceneEffectState {
    std::unordered_map<EntityId, ParticleEmitter> emitters;
    std::unordered_map<EntityId, bool> started;
    void clear() {
        emitters.clear();
        started.clear();
    }
};

// Updates particle components + the gameplay effect queue and appends their
// billboards to `out`.
void updateSceneEffects(Scene& scene, SceneEffectState& state, EffectsQueue* effects, float dt,
                        DrawList& out, bool runtimeMode);

// Triggers a one shot burst for an entity (used by interactables, doors, ...).
void burstEntityEffect(Scene& scene, SceneEffectState& state, EntityId entity, int count = -1);

// Ensures a model instance exists for the entity and returns it.
std::shared_ptr<ModelInstance> ensureModelInstance(Entity& e);

// Resolves the material for a model sub-mesh, honouring per entity overrides.
const Material* resolveMaterial(const Entity& e, const ModelPart& part, int submeshIndex,
                                const Texture** albedoOut);

}  // namespace nf
