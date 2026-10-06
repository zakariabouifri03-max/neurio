#include "scene/scene_render.h"

#include "assets/asset_library.h"
#include "core/log.h"

#include <algorithm>

namespace nf {

std::shared_ptr<ModelInstance> ensureModelInstance(Entity& e) {
    if (e.modelInstance) {
        // reload when the model asset changed (reimport / inspector edit)
        if (e.mesh && e.modelInstance->model() && e.modelInstance->model()->path == e.mesh->modelPath)
            return e.modelInstance;
    }
    if (!e.mesh) return nullptr;
    auto model = AssetLibrary::get().loadModel(e.mesh->modelPath);
    if (!model) return nullptr;
    e.modelInstance = std::make_shared<ModelInstance>(model);
    return e.modelInstance;
}

const Material* resolveMaterial(const Entity& e, const ModelPart& part, int submeshIndex,
                                const Texture** albedoOut) {
    AssetLibrary& lib = AssetLibrary::get();
    std::string path;
    if (e.mesh) {
        if (submeshIndex >= 0 && submeshIndex < (int)e.mesh->subMaterialOverrides.size() &&
            !e.mesh->subMaterialOverrides[submeshIndex].empty())
            path = e.mesh->subMaterialOverrides[submeshIndex];
        else if (!e.mesh->materialOverride.empty())
            path = e.mesh->materialOverride;
    }
    if (path.empty() && submeshIndex >= 0 && submeshIndex < (int)part.subMaterialPaths.size())
        path = part.subMaterialPaths[submeshIndex];
    if (path.empty()) path = part.materialPath;

    std::shared_ptr<Material> mat;
    if (!path.empty()) mat = lib.loadMaterial(path);
    if (!mat) {
        // inline material (OBJ/GLB without a material asset) or the default
        static thread_local std::shared_ptr<Material> inlineMat;
        if (part.materialPath.empty() && !part.inlineMaterial.name.empty() &&
            part.inlineMaterial.name != "Material") {
            inlineMat = std::make_shared<Material>(part.inlineMaterial);
            mat = inlineMat;
        } else {
            mat = lib.defaultMaterial();
        }
    }
    const Texture* albedo = nullptr;
    if (albedoOut) {
        *albedoOut = nullptr;
        if (!mat->albedoTexture.empty()) {
            *albedoOut = TextureCache::get().load(mat->albedoTexture).get();
            albedo = *albedoOut;
        }
    }
    (void)albedo;
    return mat.get();
}

void collectSceneLights(Scene& scene, DrawList& out) {
    scene.updateTransforms();
    for (Entity* entity : scene.allEntities()) {
        Entity& e = *entity;
        if (!e.light || !e.light->enabled) continue;
        if (!e.active) continue;
        LightItem item;
        item.type = e.light->type;
        item.entity = e.id;
        Mat4 world = e.cachedWorld;
        item.position = world.translation();
        // entities look down their local -Z axis
        Vec3 dir = world.transformDir(Vec3(0, 0, -1)).normalized();
        item.direction = dir;
        item.color = e.light->color;
        item.intensity = e.light->intensity;
        item.range = e.light->range;
        item.spotAngleDegrees = e.light->spotAngleDegrees;
        item.spotSoftness = e.light->spotSoftness;
        item.castShadow = e.light->castShadow;
        item.shadowBias = e.light->shadowBias;
        out.lights.push_back(item);
    }
}

void assignShadowSlots(DrawList& out, const RenderSettings& settings) {
    int directional = 0, spots = 0;
    for (auto& l : out.lights) {
        l.shadowSlot = -1;
        if (!l.castShadow || !settings.enableShadows) continue;
        if (l.type == LightType::Directional && directional == 0) {
            l.shadowSlot = 0;
            directional++;
        } else if (l.type == LightType::Spot && spots < settings.maxSpotShadows) {
            l.shadowSlot = 1 + spots++;
        }
    }
}

static bool isAncestorInactive(const Scene& scene, EntityId id) {
    const Entity* e = scene.get(id);
    int guard = 0;
    while (e && guard++ < 512) {
        if (!e->active) return true;
        e = e->parent != kInvalidEntity ? scene.get(e->parent) : nullptr;
    }
    return false;
}

void buildDrawList(Scene& scene, DrawList& out, const RenderCamera& camera,
                   const RenderSettings& settings, const SceneRenderOptions& options) {
    out.camera = camera;
    out.settings = settings;
    out.ambientIntensity = settings.ambientIntensity;
    scene.updateTransforms();

    if (options.drawColliders) {
        // collider wireframes (editor overlay)
        for (Entity* entity : scene.allEntities()) {
            const Entity& e = *entity;
            if (!e.collider) continue;
            Mat4 w = e.cachedWorld * Mat4::translate(e.collider->center);
            AABB box;
            switch (e.collider->shape) {
                case ColliderShape::Box:
                    box.expand(e.collider->size * -0.5f);
                    box.expand(e.collider->size * 0.5f);
                    break;
                case ColliderShape::Sphere:
                    box.expand(Vec3(-e.collider->radius, -e.collider->radius, -e.collider->radius));
                    box.expand(Vec3(e.collider->radius, e.collider->radius, e.collider->radius));
                    break;
                default:
                    box.expand(Vec3(-e.collider->radius, -e.collider->height * 0.5f,
                                    -e.collider->radius));
                    box.expand(Vec3(e.collider->radius, e.collider->height * 0.5f,
                                    e.collider->radius));
                    break;
            }
            AABB world = transformAABB(box, w);
            Vec4 color = e.collider->isTrigger ? Vec4(0.2f, 0.9f, 1.0f, 0.8f)
                                               : Vec4(0.3f, 1.0f, 0.4f, 0.8f);
            out.overlayLines.addAABB(world, color);
        }
    }

    for (Entity* entity : scene.allEntities()) {
        Entity& e = *entity;
        if (!e.active) continue;
        if (isAncestorInactive(scene, e.id)) continue;

        // ---- meshes -------------------------------------------------
        if (e.mesh) {
            auto instance = ensureModelInstance(e);
            const bool hasInstance = instance && instance->valid();
            if (hasInstance) {
                const Model* model = instance->model().get();
                const bool invisible = !e.mesh->visible;
                bool selected = false;
                for (EntityId sel : options.selection)
                    if (sel == e.id) selected = true;
                const bool showTranslucent = options.editorMode && invisible;
                if (!invisible || options.editorMode) {
                    Mat4 entityWorld = e.cachedWorld;
                    for (size_t partIndex = 0; partIndex < model->parts.size(); ++partIndex) {
                        const ModelPart& part = model->parts[partIndex];
                        if (!part.mesh) continue;
                        Mat4 partWorld = entityWorld * instance->partWorld((int)partIndex);
                        const std::vector<Mat4>* joints = nullptr;
                        if (part.skin >= 0) {
                            joints = &instance->jointMatrices((int)partIndex);
                            if (joints->empty()) joints = nullptr;
                        }
                        const float alphaOverride = showTranslucent ? options.alphaForInvisible : -1.0f;
                        out.addMeshAll(
                            *part.mesh, partWorld, e.id,
                            [&](int submeshIndex, const Texture** albedo) -> const Material* {
                                const Material* mat = resolveMaterial(e, part, submeshIndex, albedo);
                                if (alphaOverride >= 0.0f && mat) {
                                    auto copy = std::make_shared<Material>(*mat);
                                    copy->opacity = std::min(copy->opacity, alphaOverride);
                                    copy->castShadow = false;
                                    out.ownedMaterials.push_back(copy);
                                    return copy.get();
                                }
                                return mat;
                            },
                            joints, e.mesh->castShadow && !invisible, e.mesh->receiveShadow, selected,
                            e.mesh->colorTint);
                    }
                    if (options.editorMode && selected) {
                        AABB b = transformAABB(model->bounds, e.cachedWorld);
                        out.overlayLines.addAABB(b, Vec4(options.selectionColor.x,
                                                         options.selectionColor.y,
                                                         options.selectionColor.z, 1.0f));
                    }
                    if (options.showBounds) {
                        AABB b = transformAABB(model->bounds, e.cachedWorld);
                        out.overlayLinesNoDepth.addAABB(b, Vec4(0.5f, 0.5f, 0.6f, 0.5f));
                    }
                }
            } else if (!AssetLibrary::isPrimitive(e.mesh->modelPath)) {
                // Missing/unloadable model: the asset library already logged the
                // reason. Draw a placeholder so the object stays selectable.
                static const Mesh* placeholder = nullptr;
                static Mesh placeholderMesh;
                if (!placeholder) {
                    placeholderMesh = primitives::cube(1.0f);
                    placeholder = &placeholderMesh;
                }
                const Material* m = AssetLibrary::get().defaultMaterial().get();
                out.addMeshAll(*placeholder, e.cachedWorld, e.id,
                               [&](int, const Texture**) { return m; }, nullptr, false, false,
                               false, Vec3(1.0f, 0.4f, 0.4f));
            }
        }

        // ---- lights --------------------------------------------------
        if (e.light && e.light->enabled && options.editorMode && options.showLightGizmos) {
            Vec3 p = e.cachedWorld.translation();
            Vec4 c = Vec4(e.light->color.x, e.light->color.y, e.light->color.z, 0.9f);
            float r = e.light->type == LightType::Directional ? 0.5f : 0.25f;
            out.overlayLinesNoDepth.addCircle(p, Vec3(0, 0, 1), Vec3(1, 0, 0), r, 16, c);
            out.overlayLinesNoDepth.addCircle(p, Vec3(1, 0, 0), Vec3(0, 1, 0), r, 16, c);
            out.overlayLinesNoDepth.addCircle(p, Vec3(0, 1, 0), Vec3(0, 0, 1), r, 16, c);
            if (e.light->type != LightType::Point) {
                Vec3 dir = e.cachedWorld.transformDir(Vec3(0, 0, -1)).normalized();
                out.overlayLinesNoDepth.add(p, p + dir * (e.light->type == LightType::Directional
                                                              ? 4.0f
                                                              : e.light->range * 0.5f),
                                            c);
            }
        }

        // ---- cameras -------------------------------------------------
        if (e.camera && options.editorMode) {
            Vec3 p = e.cachedWorld.translation();
            Vec3 f = e.cachedWorld.transformDir(Vec3(0, 0, -1)).normalized();
            Vec4 c(0.9f, 0.85f, 0.3f, 0.9f);
            out.overlayLinesNoDepth.add(p, p + f * 1.2f, c);
        }
    }

    collectSceneLights(scene, out);
    assignShadowSlots(out, settings);
    out.stats.culledItems = 0;
}

// ---------------------------------------------------------------- effects
void burstEntityEffect(Scene& scene, SceneEffectState& state, EntityId entity, int count) {
    Entity* e = scene.get(entity);
    if (!e || !e->particles) return;
    const ParticleComponent& pc = *e->particles;
    if (count <= 0) count = pc.count;
    ParticleEmitter& emitter = state.emitters[entity];
    emitter.setConfig(pc.color, pc.size, pc.lifetime, pc.speed, std::max(count, 1), false, true);
    emitter.burst();
    state.started[entity] = true;
}

void updateSceneEffects(Scene& scene, SceneEffectState& state, EffectsQueue* effects, float dt,
                        DrawList& out, bool runtimeMode) {
    scene.updateTransforms();
    // remove emitters whose entity lost the component
    for (auto it = state.emitters.begin(); it != state.emitters.end();) {
        Entity* e = scene.get(it->first);
        if (!e || !e->particles) {
            state.started.erase(it->first);
            it = state.emitters.erase(it);
        } else {
            ++it;
        }
    }
    for (Entity* e : scene.allEntities()) {
        if (!e->particles || !e->active) continue;
        const ParticleComponent& pc = *e->particles;
        if (!pc.playOnStart && !pc.looping) continue;   // component is burst-only
        ParticleEmitter& emitter = state.emitters[e->id];
        emitter.setConfig(pc.color, pc.size, pc.lifetime, pc.speed, pc.count, pc.looping, true);
        if (runtimeMode || pc.looping) {
            emitter.setEmitting(true);
            state.started[e->id] = true;
        }
        emitter.update(dt, e->cachedWorld.translation());
        emitter.buildBillboards(out.billboards);
        out.particles += emitter.count();
    }
    // fix up positions of emitters that were not updated above but still alive
    for (auto& [id, emitter] : state.emitters) {
        Entity* e = scene.get(id);
        if (!e || !e->particles) continue;
        if (!state.started[id]) continue;
        if (e->particles->playOnStart || e->particles->looping) continue;   // already updated
        emitter.update(dt, e->cachedWorld.translation());
        emitter.buildBillboards(out.billboards);
        out.particles += emitter.count();
    }
    // one-shot emitters that finished are forgotten
    for (auto it = state.started.begin(); it != state.started.end();) {
        auto em = state.emitters.find(it->first);
        bool alive = em != state.emitters.end() && em->second.active();
        if (!alive && !(scene.get(it->first) && scene.get(it->first)->particles &&
                        (scene.get(it->first)->particles->playOnStart ||
                         scene.get(it->first)->particles->looping))) {
            state.emitters.erase(it->first);
            it = state.started.erase(it);
        } else {
            ++it;
        }
    }
    if (effects) {
        effects->update(dt);
        for (Entity* e : scene.allEntities())
            if (e->particles && e->particles->emitOnInteract)
                effects->setPosition(e->id, e->cachedWorld.translation());
        effects->appendBillboards(out.billboards);
    }
}

}  // namespace nf
