// NovaForge Engine - engine facade implementation
#include "engine_api.h"

#include "core/fs.h"
#include "core/log.h"
#include "scene/prefabs.h"

#include <algorithm>
#include <cmath>
#include <thread>

namespace nf {

const char* engineVersion() { return "0.1.0"; }

const char* qualityName(QualityLevel q) {
    switch (q) {
        case QualityLevel::Low: return "Low";
        case QualityLevel::Medium: return "Medium";
        case QualityLevel::High: return "High";
        case QualityLevel::Ultra: return "Ultra";
    }
    return "Medium";
}

namespace {

// The project stores a small, serializable subset of the render settings (see
// RenderProjectSettings); these two helpers convert in both directions so the
// project file stays readable while the renderer keeps its full settings.
void applyProjectRenderSettings(const RenderProjectSettings& p, RenderSettings& r) {
    r.quality = p.quality == "Low" ? QualityLevel::Low
               : p.quality == "Medium" ? QualityLevel::Medium
               : p.quality == "High" ? QualityLevel::High
               : p.quality == "Ultra" ? QualityLevel::Ultra
                                      : r.quality;
    r.resolutionScale = p.resolutionScale;
    r.enableShadows = p.enableShadows;
    r.shadowMapSize = p.shadowMapSize;
    r.shadowDistance = p.shadowDistance;
    r.enableFog = p.enableFog;
    r.fogDensity = p.fogDensity;
    r.fogColor = p.fogColor;
    r.enableParticles = p.enableParticles;
    r.vsync = p.vsync;
}

RenderProjectSettings projectRenderSettingsFrom(const RenderSettings& r,
                                               const RenderProjectSettings& previous) {
    RenderProjectSettings p = previous;
    p.quality = qualityName(r.quality);
    p.resolutionScale = r.resolutionScale;
    p.enableShadows = r.enableShadows;
    p.shadowMapSize = r.shadowMapSize;
    p.shadowDistance = r.shadowDistance;
    p.enableFog = r.enableFog;
    p.fogDensity = r.fogDensity;
    p.fogColor = r.fogColor;
    p.enableParticles = r.enableParticles;
    p.vsync = r.vsync;
    return p;
}

}  // namespace

Engine::Engine() = default;

Engine::~Engine() { shutdown(); }

// ------------------------------------------------------------------- lifecycle
bool Engine::init(const EngineConfig& config, std::string* error) {
    auto fail = [&](const std::string& msg) {
        lastError_ = msg;
        if (error) *error = msg;
        NF_LOG_ERROR("Engine", "%s", msg.c_str());
        return false;
    };
    config_ = config;

    // ---- window ---------------------------------------------------------
    WindowDesc desc = config.window;
    desc.headless = desc.headless;
    window_.reset(desc.headless ? createOffscreenWindow(desc) : createWindow(desc));
    if (!window_) return fail("could not create a window (" + std::string(platformName()) + ")");
    window_->setTitle(desc.title);

    // ---- renderer -------------------------------------------------------
    renderer_.reset(createSoftwareRenderer());
    if (!renderer_) return fail("could not create the software renderer");
    if (!renderer_->init(window_.get(), config.render))
        return fail("renderer initialisation failed");
    renderer_->setTargetSize(desc.width, desc.height);

    // ---- subsystems ------------------------------------------------------
    threads_ = std::make_unique<ThreadPool>(std::max(2, (int)std::thread::hardware_concurrency()));
    physics_ = std::make_unique<PhysicsWorld>(config.physics);
    physics_->setMeshProvider([](const std::string& modelPath) -> const Mesh* {
        if (modelPath.empty()) return nullptr;
        std::shared_ptr<Model> model = AssetLibrary::get().loadModel(modelPath);
        if (!model || model->parts.empty()) return nullptr;
        return model->parts.front().mesh.get();
    });
    audio_ = std::make_unique<AudioSystem>();
    if (config.enableAudio) {
        std::string audioError;
        if (!audio_->init(config.audio, &audioError))
            NF_LOG_WARN("Engine", "audio disabled: %s", audioError.c_str());
    }
    ai_ = std::make_unique<AISystem>();
    scripts_ = std::make_unique<ScriptHost>();
    if (config.enableScripts) {
        std::string scriptError;
        if (!scripts_->init(&scriptError))
            NF_LOG_WARN("Engine", "scripting disabled: %s", scriptError.c_str());
    }
    effects_ = std::make_unique<EffectsQueue>();

    ai_->setEffectsQueue(effects_.get());
    gameplay_.setEffectsQueue(effects_.get());
    gameplay_.setAudio(audio_->isInitialised() ? audio_.get() : nullptr);
    gameplay_.setScripts(scripts_->isInitialised() ? scripts_.get() : nullptr);
    gameplay_.setPathResolver([this](const std::string& rel) { return resolveProjectPath(rel); });
    wireScriptContext();

    initialised_ = true;
    if (!config_.projectRoot.empty()) {
        std::string openError;
        if (!openProject(config_.projectRoot, &openError))
            NF_LOG_WARN("Engine", "could not open '%s': %s", config_.projectRoot.c_str(),
                        openError.c_str());
    }
    NF_LOG_INFO("Engine", "initialised | renderer=%s | audio=%s | platform=%s",
                renderer_->name(), audio_->backendName().c_str(), platformName());
    return true;
}

void Engine::shutdown() {
    if (!initialised_) {
        window_.reset();
        return;
    }
    if (mode_ != EngineMode::Edit) stop();
    if (physics_) physics_->clear();
    if (audio_) {
        audio_->stopAll();
        audio_->shutdown();
    }
    if (scripts_) scripts_->shutdown();
    if (renderer_) renderer_->shutdown();
    renderer_.reset();
    window_.reset();
    initialised_ = false;
}

void Engine::wireScriptContext() {
    if (!scripts_) return;
    ScriptContext ctx;
    ctx.scene = &scene_;
    ctx.physics = physics_.get();
    ctx.audio = audio_->isInitialised() ? audio_.get() : nullptr;
    ctx.effects = effects_.get();
    ctx.keyDown = [this](const std::string& key) { return actionDownRaw(key); };
    ctx.keyPressed = [this](const std::string& key) { return actionPressedRaw(key); };
    ctx.actionValue = [this](const std::string& action) { return actionValue(action); };
    ctx.hudMessage = [this](const std::string& msg, float seconds) { gameplay_.message(msg, seconds); };
    ctx.consolePrint = [](const std::string& msg) { NF_LOG_INFO("Lua", "%s", msg.c_str()); };
    ctx.requestWin = [this]() { gameplay_.requestWin(); };
    ctx.resolveAssetPath = [this](const std::string& rel) { return resolveProjectPath(rel); };
    ctx.time = playTime_;
    ctx.deltaTime = 0.0f;
    scripts_->setContext(ctx);
}

// ---------------------------------------------------------------------- project
bool Engine::createProject(const std::string& directory, const std::string& name,
                           std::string* error) {
    if (!project_.create(directory, name, error)) return false;
    applyProjectSettings();
    scenePath_.clear();
    newScene("Main");
    saveProject();
    return true;
}

bool Engine::openProject(const std::string& directory, std::string* error) {
    if (!project_.open(directory, error)) return false;
    applyProjectSettings();
    AssetLibrary::get().rescan();
    std::string scene = config_.startScene.empty() ? project_.startSceneRelative() : config_.startScene;
    scenePath_ = scene;
    std::string loadError;
    if (!loadScene(scene, &loadError)) {
        NF_LOG_WARN("Engine", "start scene '%s' could not be loaded (%s) - creating an empty one",
                    scene.c_str(), loadError.c_str());
        newScene("Untitled Scene");
    }
    return true;
}

void Engine::applyProjectSettings() {
    applyProjectRenderSettings(project_.settings.render, config_.render);
    renderer_->setSettings(config_.render);
    config_.physics.gravity = project_.settings.physics.gravity;
    config_.physics.fixedTimestep = project_.settings.physics.fixedTimestep;
    config_.physics.maxSubSteps = project_.settings.physics.maxSubSteps;
    config_.physics.enableCcd = project_.settings.physics.enableCcd;
    physics_->setSettings(config_.physics);
    bindings_ = project_.settings.inputActions;
}

bool Engine::saveProject(std::string* error) {
    if (!project_.isOpen()) {
        if (error) *error = "no project is open";
        return false;
    }
    if (renderer_)
        project_.settings.render = projectRenderSettingsFrom(renderer_->settings(),
                                                             project_.settings.render);
    const PhysicsSettings& ps = physics_->settings();
    project_.settings.physics.gravity = ps.gravity;
    project_.settings.physics.fixedTimestep = ps.fixedTimestep;
    project_.settings.physics.maxSubSteps = ps.maxSubSteps;
    project_.settings.physics.enableCcd = ps.enableCcd;
    project_.settings.inputActions = bindings_;
    return project_.save(error);
}

bool Engine::newScene(const std::string& name, std::string* error) {
    scene_.clear();
    scene_.name = name;
    scene_.path.clear();
    scenePath_.clear();
    effectState_.clear();
    EntityId camera = scene_.createEntity("Main Camera");
    scene_.get(camera)->camera = CameraComponent();
    scene_.get(camera)->camera->isActive = true;
    scene_.get(camera)->camera->backgroundColor = Vec3(0.42f, 0.55f, 0.70f);
    scene_.get(camera)->transform.position = Vec3(0, 4, -10);
    scene_.get(camera)->transform.setEulerDegrees(Vec3(-10, 0, 0));

    EntityId sun = scene_.createEntity("Sun");
    scene_.get(sun)->light = LightComponent();
    scene_.get(sun)->light->type = LightType::Directional;
    scene_.get(sun)->light->intensity = 1.35f;
    scene_.get(sun)->light->castShadow = true;
    scene_.get(sun)->transform.setEulerDegrees(Vec3(-35, 30, 0));

    EntityId ground = scene_.createEntity("Ground");
    scene_.get(ground)->tag = "Ground";
    scene_.get(ground)->mesh = MeshRendererComponent();
    scene_.get(ground)->mesh->modelPath = "primitive://Plane";
    scene_.get(ground)->transform.scale = Vec3(20, 1, 20);
    scene_.get(ground)->collider = ColliderComponent();
    scene_.get(ground)->collider->shape = ColliderShape::Box;
    scene_.get(ground)->collider->size = Vec3(40, 0.2f, 40);
    scene_.get(ground)->collider->center = Vec3(0, -0.1f, 0);
    scene_.get(ground)->rigidbody = RigidBodyComponent();
    scene_.get(ground)->rigidbody->motionType = MotionType::Static;
    scene_.updateTransforms();
    (void)error;
    return true;
}

bool Engine::loadScene(const std::string& projectRelative, std::string* error) {
    if (mode_ != EngineMode::Edit) stop();
    std::string path = resolveProjectPath(projectRelative);
    if (!scene_.load(path, error)) return false;
    scenePath_ = projectRelative;
    scene_.path = projectRelative;
    effectState_.clear();
    project_.noteModified(projectRelative);
    AssetLibrary::get().rescan();
    return true;
}

bool Engine::saveScene(std::string* error) {
    if (scenePath_.empty())
        return saveSceneAs("Assets/Scenes/" + scene_.name + ".nfscene.json", error);
    return saveSceneAs(scenePath_, error);
}

bool Engine::saveSceneAs(const std::string& projectRelative, std::string* error) {
    if (!project_.isOpen()) {
        if (error) *error = "no project is open";
        return false;
    }
    std::string path = resolveProjectPath(projectRelative);
    if (!fs::createDirectories(fs::parent(path))) {
        if (error) *error = "cannot create " + fs::parent(path);
        return false;
    }
    if (!scene_.save(path)) {
        if (error) *error = "could not write " + path;
        return false;
    }
    scenePath_ = projectRelative;
    scene_.path = projectRelative;
    project_.noteModified(projectRelative);
    if (project_.startSceneRelative().empty()) project_.setStartScene(projectRelative);
    NF_LOG_INFO("Engine", "saved scene %s", projectRelative.c_str());
    return true;
}

std::string Engine::resolveProjectPath(const std::string& projectRelative) const {
    if (fs::isAbsolute(projectRelative)) return projectRelative;
    if (project_.isOpen()) return fs::join(project_.root(), projectRelative);
    return fs::resolveAssetPath(projectRelative);
}

// -------------------------------------------------------------------- play mode
void Engine::snapshotScene() { sceneSnapshot_ = scene_; }

void Engine::restoreSceneSnapshot() {
    scene_ = sceneSnapshot_;
    sceneSnapshot_.clear();
    scene_.markAllDirty();
    scene_.updateTransforms();
}

bool Engine::play(std::string* error) {
    if (!project_.isOpen()) {
        if (error) *error = "open or create a project before pressing PLAY";
        return false;
    }
    if (mode_ != EngineMode::Edit) stop();
    if (scenePath_.empty()) {
        if (error) *error = "save the scene before pressing PLAY";
        return false;
    }
    // The scene is reloaded from disk so play mode always starts from what is
    // saved - this guarantees the exported game behaves the same.
    if (!scene_.save(resolveProjectPath(scenePath_))) {
        if (error) *error = "could not save the scene before playing";
        return false;
    }
    std::string loadError;
    if (!scene_.load(resolveProjectPath(scenePath_), &loadError)) {
        if (error) *error = loadError;
        return false;
    }

    snapshotScene();

    // runtime state reset (health, NPC states, particles, triggers)
    for (Entity* e : scene_.allEntities()) {
        if (e->health) e->health->reset();
        if (e->npc) {
            e->npc->state = NPCComponent::State::Idle;
            e->npc->stateTime = 0.0f;
            e->npc->attackTimer = 0.0f;
            e->npc->patrolIndex = 0;
            e->npc->hasTarget = false;
        }
        if (e->script) e->script->luaRef = -1;
        if (e->trigger) {
            e->trigger->firedEnter = false;
            e->trigger->firedExit = false;
        }
        if (e->interactable) e->interactable->used = false;
        if (e->door) {
            e->door->open = e->door->startsOpen;
            e->door->t = e->door->open ? 1.0f : 0.0f;
        }
    }
    scene_.updateTransforms();
    effectState_.clear();
    if (effects_) effects_->clear();
    if (physics_) {
        physics_->clear();
        physics_->setSettings(config_.physics);
        physics_->syncScene(scene_);
    }
    if (ai_) ai_->reset(scene_);
    if (scripts_) scripts_->resetInstances();

    playerEntity_ = findPlayerEntity(scene_);
    if (playerEntity_ == kInvalidEntity)
        NF_LOG_WARN("Engine", "the scene has no player character - PAN is free look, PLAY has no avatar");
    playerController_.reset(scene_, playerEntity_);
    gameplay_.start(scene_, *physics_, playerEntity_);
    playTime_ = 0.0f;
    paused_ = false;
    mode_ = EngineMode::Play;
    wireScriptContext();
    NF_LOG_INFO("Engine", "PLAY started (%u entities, %zu physics bodies)", (unsigned)scene_.count(),
                (size_t)physics_->bodyCount());
    return true;
}

void Engine::pause(bool paused) {
    if (mode_ == EngineMode::Edit) return;
    paused_ = paused;
    mode_ = paused ? EngineMode::Paused : EngineMode::Play;
    if (ai_) {
        AISettings s = ai_->settings();
        s.freezeAi = paused;
        ai_->setSettings(s);
    }
}

void Engine::stepOnce(float dt) {
    if (mode_ != EngineMode::Paused) return;
    forcedStepDt_ = dt;
    update(dt);
    forcedStepDt_ = 0.0f;
}

void Engine::stop() {
    if (mode_ == EngineMode::Edit) return;
    if (gameplay_.hud().playTime > 0.0f)
        NF_LOG_INFO("Engine", "PLAY stopped after %.1fs", gameplay_.hud().playTime);
    gameplay_.stop(scene_, *physics_);
    if (physics_) physics_->clear();
    if (ai_) ai_->reset(scene_);
    restoreSceneSnapshot();
    effectState_.clear();
    if (effects_) effects_->clear();
    playerEntity_ = kInvalidEntity;
    playTime_ = 0.0f;
    paused_ = false;
    mode_ = EngineMode::Edit;
}

// ------------------------------------------------------------------------ frame
void Engine::pumpEvents() {
    if (!window_) return;
    window_->pumpEvents();
}

bool Engine::shouldClose() const { return !window_ || window_->shouldClose(); }

void Engine::update(float dt) {
    if (!initialised_) return;
    const double start = timeSeconds();
    dt = std::min(dt, 0.1f);

    if (mode_ == EngineMode::Edit) {
        scene_.updateTransforms();
        return;
    }
    const float stepDt = forcedStepDt_ > 0.0f ? forcedStepDt_ : (paused_ ? 0.0f : dt);

    playerEntity_ = findPlayerEntity(scene_);
    PlayerInputState in;
    if (!paused_) in = readPlayerInput();

    if (playerEntity_ != kInvalidEntity)
        playerController_.update(scene_, *physics_, playerEntity_, stepDt);

    gameplay_.update(scene_, *physics_, playerEntity_, playerController_, in, stepDt);

    physics_->syncScene(scene_);                 // picks up spawns/destroys from scripts

    if (ai_) {
        ai_->update(scene_, physics_.get(), playerEntity_, stepDt);
        for (const AIEvent& ev : ai_->drainEvents()) {
            switch (ev.type) {
                case AIEvent::Type::Attacked:
                    gameplay_.message("The enemy hits you!", 1.5f);
                    break;
                case AIEvent::Type::Died: {
                    gameplay_.addKill();
                    const Entity* e = scene_.get(ev.npc);
                    gameplay_.message(e ? (e->displayName() + " defeated") : std::string("Enemy defeated"),
                                      2.5f);
                    if (scripts_ && e) scripts_->callDeath(scene_, ev.npc);
                    break;
                }
                case AIEvent::Type::TargetSpotted:
                    gameplay_.message("The enemy spotted you!", 2.0f);
                    break;
                default:
                    break;
            }
        }
    }

    const double physStart = timeSeconds();
    physics_->simulate(scene_, stepDt);
    stats_.physicsMs = (float)((timeSeconds() - physStart) * 1000.0);

    gameplay_.handlePhysicsEvents(scene_, *physics_, playerEntity_);
    gameplay_.postStep(scene_, *physics_, playerEntity_, stepDt);

    if (audio_ && audio_->isInitialised()) {
        const Vec3 pos = playerEntity_ != kInvalidEntity ? playerController_.position() : Vec3(0, 0, 0);
        const Vec3 fwd = playerEntity_ != kInvalidEntity ? playerController_.forward() : Vec3(0, 0, -1);
        audio_->setListener(pos + Vec3(0, 1.6f, 0), fwd, Vec3(0, 1, 0));
        audio_->update(dt);
    }
    if (effects_) effects_->update(dt);
    playTime_ += dt;
    stats_.bodies = physics_->bodyCount();
    stats_.updateMs = (float)((timeSeconds() - start) * 1000.0);
    if (scripts_) {
        scripts_->context().time = playTime_;
        scripts_->context().deltaTime = dt;
    }
}

void Engine::render(const RenderCamera& camera, const SceneRenderOptions& options) {
    if (!renderer_) return;
    const double start = timeSeconds();
    DrawList list;
    buildDrawList(scene_, list, camera, renderer_->settings(), options);
    updateSceneEffects(scene_, effectState_, effects_.get(), lastEffectDt_, list, mode_ != EngineMode::Edit);
    renderer_->beginFrame(camera);
    renderer_->drawScene(list);
    if (mode_ != EngineMode::Edit) {
        UIBatch ui;
        ui.setScreenSize(camera.viewportWidth, camera.viewportHeight);
        buildHudBatch(ui, camera.viewportWidth, camera.viewportHeight);
        if (!ui.empty()) renderer_->drawUI(ui);
    }
    stats_.drawItems = list.items.size();
    stats_.triangles = list.stats.triangles;
    stats_.particles = list.particles;
    stats_.renderMs = (float)((timeSeconds() - start) * 1000.0);
}

void Engine::present() {
    if (renderer_) renderer_->endFrame();
}

bool Engine::frame(float dt) {
    pumpEvents();
    if (shouldClose()) return false;
    update(dt);
    lastEffectDt_ = mode_ == EngineMode::Paused ? 0.0f : dt;
    RenderCamera cam = gameCamera(window_ ? window_->width() : 1280,
                                  window_ ? window_->height() : 720);
    render(cam, SceneRenderOptions{});
    present();
    updateFrameStats(dt);
    return true;
}

RenderCamera Engine::gameCamera(int width, int height) {
    if (mode_ != EngineMode::Edit && playerEntity_ != kInvalidEntity)
        return playerController_.camera(scene_, physics_.get(), playerEntity_, width, height, 1.0f / 60.0f);
    return sceneCamera(width, height);
}

RenderCamera Engine::sceneCamera(int width, int height) {
    Scene& scene = scene_;
    scene.updateTransforms();
    EntityId camId = scene.activeCamera();
    if (camId == kInvalidEntity) camId = scene.findByName("Main Camera");
    const float aspect = height > 0 ? (float)width / (float)height : 16.0f / 9.0f;
    RenderCamera cam;
    if (const Entity* e = scene.get(camId); e && e->camera) {
        Vec3 eye; Quat q; Vec3 sc; e->cachedWorld.decompose(eye, q, sc);
        const Vec3 fwd = q.rotate(Vec3(0, 0, -1)).normalized();
        const Vec3 up = q.rotate(Vec3(0, 1, 0)).normalized();
        cam = RenderCamera::perspective(eye, eye + fwd, up, e->camera->fovDegrees, aspect,
                                        e->camera->nearPlane, e->camera->farPlane);
        cam.clearColor = e->camera->backgroundColor;
        cam.exposure = e->camera->exposure;
    } else {
        const AABB bounds = scene.worldBounds();
        const Vec3 center = bounds.valid() ? bounds.center() : Vec3(0, 0, 0);
        const float radius = bounds.valid() ? std::max(bounds.radius(), 4.0f) : 12.0f;
        const Vec3 eye = center + Vec3(radius * 0.9f, radius * 0.7f, -radius * 1.3f);
        cam = RenderCamera::perspective(eye, center, Vec3(0, 1, 0), 60.0f, aspect, 0.1f, 800.0f);
    }
    cam.viewportWidth = width;
    cam.viewportHeight = height;
    return cam;
}

void Engine::updateFrameStats(float dt) {
    stats_.frameMs = dt * 1000.0f;
    stats_.fps = dt > 0.0f ? 1.0f / dt : 0.0f;
    stats_.totalFrames += 1.0;
}

// ----------------------------------------------------------------------- input
bool Engine::keyDown(Key k) const {
    return window_ ? window_->input().down(k) : false;
}

bool Engine::keyPressed(Key k) const {
    return window_ ? window_->input().pressed(k) : false;
}

float Engine::actionValue(const std::string& action) const {
    const InputState* in = window_ ? &window_->input() : nullptr;
    if (!in) return 0.0f;
    for (const InputActionBinding& b : bindings_) {
        if (!b.isAxis || b.action != action) continue;
        float value = 0.0f;
        for (const std::string& keyName : b.keys) {
            const Key k = keyFromName(keyName);
            if (k == Key::None) continue;
            if (in->down(k)) value += 1.0f;
        }
        return std::clamp(value, -1.0f, 1.0f);
    }
    return 0.0f;
}

bool Engine::actionPressed(const std::string& action) const {
    const InputState* in = window_ ? &window_->input() : nullptr;
    if (!in) return false;
    for (const InputActionBinding& b : bindings_) {
        if (b.action != action) continue;
        for (const std::string& keyName : b.keys) {
            const Key k = keyFromName(keyName);
            if (k != Key::None && in->pressed(k)) return true;
            if (keyName == "Mouse0" && in->mousePressed[0]) return true;
            if (keyName == "Mouse1" && in->mousePressed[1]) return true;
        }
    }
    return false;
}

PlayerInputState Engine::readPlayerInput() {
    PlayerInputState in;
    if (!window_) return in;
    const InputState& is = window_->input();
    auto down = [&](Key k) { return is.down(k); };
    auto pressed = [&](Key k) { return is.pressed(k); };

    float forward = 0.0f, strafe = 0.0f;
    if (down(Key::W) || down(Key::Up)) forward += 1.0f;
    if (down(Key::S) || down(Key::Down)) forward -= 1.0f;
    if (down(Key::D) || down(Key::Right)) strafe += 1.0f;
    if (down(Key::A) || down(Key::Left)) strafe -= 1.0f;
    // action bindings from the project settings take priority when present
    if (forward == 0.0f && strafe == 0.0f) {
        for (const InputActionBinding& b : bindings_) {
            if (b.action == "MoveForward") forward += actionValue("MoveForward");
            if (b.action == "MoveBack") forward -= actionValue("MoveBack");
            if (b.action == "MoveRight") strafe += actionValue("MoveRight");
            if (b.action == "MoveLeft") strafe -= actionValue("MoveLeft");
        }
    }
    in.move = Vec2(strafe, forward);
    in.run = down(Key::LeftShift) || down(Key::RightShift) || actionPressed("Run");
    in.jumpPressed = pressed(Key::Space) || actionPressed("Jump");
    in.interactPressed = pressed(Key::E) || actionPressed("Interact");
    in.attackPressed = is.mousePressed[0] || actionPressed("Fire");
    in.attackHeld = is.mouseDown[0];
    in.resetRequested = pressed(Key::R);
    in.lookX = is.mouseDX;
    in.lookY = is.mouseDY;
    return in;
}

bool Engine::actionDownRaw(const std::string& name) const {
    if (!window_) return false;
    const Key k = keyFromName(name);
    if (k != Key::None) return window_->input().down(k);
    if (name == "Mouse0") return window_->input().mouseDown[0];
    if (name == "Mouse1") return window_->input().mouseDown[1];
    if (name == "Mouse2") return window_->input().mouseDown[2];
    return actionValue(name) != 0.0f;
}

bool Engine::actionPressedRaw(const std::string& name) const {
    if (!window_) return false;
    const Key k = keyFromName(name);
    if (k != Key::None) return window_->input().pressed(k);
    if (name == "Mouse0") return window_->input().mousePressed[0];
    if (name == "Mouse1") return window_->input().mousePressed[1];
    if (name == "Mouse2") return window_->input().mousePressed[2];
    return actionPressed(name);
}

// ------------------------------------------------------------------------- HUD
void Engine::buildHudBatch(UIBatch& ui, int width, int height) const {
    const HudState& hud = gameplay_.hud();
    const float scale = std::max(1.0f, height / 720.0f);
    const Vec4 white(1, 1, 1, 1), grey(0.85f, 0.87f, 0.9f, 1.0f), red(0.9f, 0.25f, 0.2f, 1.0f);
    const Vec4 dark(0, 0, 0, 0.45f);

    // crosshair
    ui.crosshair(width * 0.5f, height * 0.5f, 8.0f * scale, Vec4(1, 1, 1, 0.55f));

    // health
    if (hud.hasHealth) {
        const float w = 260 * scale, h = 18 * scale;
        const float x = 24 * scale, y = height - 46 * scale;
        ui.bar(x, y, w, h, hud.maxHealth > 0 ? hud.health / hud.maxHealth : 0.0f,
               hud.health > 30 ? Vec4(0.35f, 0.8f, 0.35f, 0.95f) : red, dark,
               Vec4(0.15f, 0.16f, 0.18f, 0.9f));
        ui.text(x, y - 20 * scale,
                "HP " + std::to_string((int)std::max(hud.health, 0.0f)) + "/" +
                    std::to_string((int)hud.maxHealth),
                white, (int)std::max(1.0f, scale));
    }

    // prompt + messages
    if (!hud.prompt.empty())
        ui.textCentered(width * 0.5f, height * 0.62f, hud.prompt, Vec4(1, 1, 0.85f, 1.0f),
                        (int)std::max(1.0f, scale));
    if (!hud.message.empty())
        ui.textCentered(width * 0.5f, 64 * scale, hud.message, white, (int)std::max(1.0f, scale));

    // counters
    const std::string counters = "Pickups " + std::to_string(hud.pickups) +
                                 "   Kills " + std::to_string(hud.kills);
    ui.text(24 * scale, 24 * scale, counters, grey, (int)std::max(1.0f, scale));

    // death / win overlays
    if (hud.dead || hud.won) {
        ui.rect(0, 0, (float)width, (float)height, Vec4(0, 0, 0, 0.45f));
        ui.textCentered(width * 0.5f, height * 0.45f, hud.won ? "YOU WIN" : "YOU DIED",
                        hud.won ? Vec4(1, 0.85f, 0.3f, 1) : red, (int)std::max(2.0f, scale * 2));
        ui.textCentered(width * 0.5f, height * 0.53f, hud.won ? hud.winMessage : "Press R to respawn",
                        white, (int)std::max(1.0f, scale));
    }
}

void Engine::notifyScriptsChanged() {
    if (scripts_) scripts_->clearCache();
}

}  // namespace nf
