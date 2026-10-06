// NovaForge Engine - project system implementation
#include "project/project.h"

#include "assets/asset_library.h"
#include "core/fs.h"
#include "core/log.h"
#include "scene/scene.h"

#include <algorithm>
#include <cstdlib>
#include <ctime>

namespace nf {

namespace {

Json vec3Json(const Vec3& v) {
    Json a = Json::array();
    a.push(v.x);
    a.push(v.y);
    a.push(v.z);
    return a;
}

Vec3 vec3From(const Json& j, const Vec3& def) {
    if (!j.isArray() || j.size() < 3) return def;
    return Vec3(j[0].asFloat(def.x), j[1].asFloat(def.y), j[2].asFloat(def.z));
}

std::string nowIso() {
    std::time_t t = std::time(nullptr);
    std::tm tm{};
#if defined(_WIN32)
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    char buf[32];
    std::strftime(buf, sizeof buf, "%Y-%m-%dT%H:%M:%SZ", &tm);
    return buf;
}

Json renderSettingsToJson(const RenderProjectSettings& s) {
    Json j = Json::object();
    j.set("quality", s.quality);
    j.set("resolutionScale", s.resolutionScale);
    j.set("shadows", s.enableShadows);
    j.set("shadowMapSize", s.shadowMapSize);
    j.set("shadowDistance", s.shadowDistance);
    j.set("fog", s.enableFog);
    j.set("fogDensity", s.fogDensity);
    j.set("fogColor", vec3Json(s.fogColor));
    j.set("exposure", s.exposure);
    j.set("particles", s.enableParticles);
    j.set("vsync", s.vsync);
    j.set("postGrade", s.postGrade);
    j.set("debugDrawPhysics", s.debugDrawPhysics);
    j.set("showFps", s.showFps);
    return j;
}

void renderSettingsFromJson(const Json& j, RenderProjectSettings& s) {
    s.quality = j["quality"].asString(s.quality);
    s.resolutionScale = j["resolutionScale"].asFloat(s.resolutionScale);
    s.enableShadows = j["shadows"].asBool(s.enableShadows);
    s.shadowMapSize = j["shadowMapSize"].asInt(s.shadowMapSize);
    s.shadowDistance = j["shadowDistance"].asFloat(s.shadowDistance);
    s.enableFog = j["fog"].asBool(s.enableFog);
    s.fogDensity = j["fogDensity"].asFloat(s.fogDensity);
    s.fogColor = vec3From(j["fogColor"], s.fogColor);
    s.exposure = j["exposure"].asFloat(s.exposure);
    s.enableParticles = j["particles"].asBool(s.enableParticles);
    s.vsync = j["vsync"].asBool(s.vsync);
    s.postGrade = j["postGrade"].asString(s.postGrade);
    s.debugDrawPhysics = j["debugDrawPhysics"].asBool(s.debugDrawPhysics);
    s.showFps = j["showFps"].asBool(s.showFps);
}

Json inputActionsToJson(const std::vector<InputActionBinding>& actions) {
    Json j = Json::object();
    for (const InputActionBinding& a : actions) {
        Json entry = Json::object();
        Json keys = Json::array();
        for (const std::string& k : a.keys) keys.push(k);
        entry.set("keys", keys);
        entry.set("deadzone", a.deadzone);
        entry.set("axis", a.isAxis);
        j.set(a.action, entry);
    }
    return j;
}

std::vector<InputActionBinding> inputActionsFromJson(const Json& j) {
    std::vector<InputActionBinding> out;
    for (const auto& [name, entry] : j.fields()) {
        InputActionBinding a;
        a.action = name;
        for (const Json& k : entry["keys"].items()) a.keys.push_back(k.asString());
        a.deadzone = entry["deadzone"].asFloat(0.1f);
        a.isAxis = entry["axis"].asBool(false);
        out.push_back(a);
    }
    return out;
}

std::vector<InputActionBinding> defaultInputActions() {
    std::vector<InputActionBinding> a;
    auto add = [&a](const char* action, std::vector<std::string> keys, bool axis = false) {
        InputActionBinding b;
        b.action = action;
        b.keys = std::move(keys);
        b.isAxis = axis;
        a.push_back(b);
    };
    add("MoveForward", {"W"});
    add("MoveBack", {"S"});
    add("MoveLeft", {"A"});
    add("MoveRight", {"D"});
    add("Jump", {"Space"});
    add("Sprint", {"LeftShift"});
    add("Interact", {"E"});
    add("Fire", {"Mouse0"});
    add("CameraLook", {"Mouse1"}, true);
    add("ToggleDebug", {"F1"});
    add("TogglePause", {"P"});
    return a;
}

}  // namespace

// ------------------------------------------------------------------- statics
std::string Project::defaultProjectsDir() {
    // <home>/NovaForgeProjects (created on demand by the editor)
    const char* home = std::getenv("USERPROFILE");
    if (!home || !*home) home = std::getenv("HOME");
    std::string base = home && *home ? home : ".";
    return fs::join(base, "NovaForgeProjects");
}

bool Project::isProject(const std::string& dir) {
    return fs::exists(fs::join(dir, manifestRelativePath()));
}

bool Project::createProject(const std::string& rootDir, const std::string& name,
                            std::string* error) {
    Project p;
    return p.create(rootDir, name, error);
}

// ------------------------------------------------------------------- create
bool Project::create(const std::string& rootDir, const std::string& name, std::string* error) {
    auto fail = [&](const std::string& msg) {
        if (error) *error = msg;
        NF_LOG_ERROR("Project", "%s", msg.c_str());
        return false;
    };
    if (rootDir.empty()) return fail("project folder is empty");
    fs::createDirectories(rootDir);
    if (!fs::isDirectory(rootDir)) return fail("cannot create project folder: " + rootDir);
    root_ = fs::normalize(fs::absolute(rootDir));
    name_ = name.empty() ? std::string("Untitled") : name;
    startScene_ = "Assets/Scenes/Main.nfscene.json";
    settings.inputActions = defaultInputActions();
    settings.build.gameName = name_;
    settings.build.executableName = name_ + (std::string(".exe"));

    // asset folders (also creates Settings/, Logs/, Builds/)
    AssetLibrary::get().setProjectRoot(root_);
    AssetLibrary::get().ensureStandardFolders();
    for (const char* dir : {"Settings", "Logs", "Builds", "Project"})
        fs::createDirectories(fs::join(root_, dir));

    open_ = true;
    if (!save(error)) return false;

    // a fresh project starts with an empty scene containing a camera and a sun
    std::string sceneError;
    if (createScene("Main", &sceneError).empty()) {
        NF_LOG_WARN("Project", "could not create the start scene: %s", sceneError.c_str());
    }
    NF_LOG_INFO("Project", "created project '%s' at %s", name_.c_str(), root_.c_str());
    return true;
}

// --------------------------------------------------------------------- open
bool Project::open(const std::string& rootDir, std::string* error) {
    auto fail = [&](const std::string& msg) {
        if (error) *error = msg;
        NF_LOG_ERROR("Project", "%s", msg.c_str());
        return false;
    };
    std::string manifest = fs::join(rootDir, manifestRelativePath());
    if (!fs::exists(manifest)) {
        // accept a folder that has Assets/ but no manifest (repair it)
        if (fs::isDirectory(fs::join(rootDir, "Assets"))) {
            NF_LOG_WARN("Project", "project.json missing - repairing %s", rootDir.c_str());
            if (!create(rootDir, fs::filename(fs::normalize(rootDir)), error)) return false;
            return true;
        }
        return fail("not a NovaForge project (missing " + std::string(manifestRelativePath()) + ")");
    }
    std::string parseError;
    Json j = Json::parse(fs::readText(manifest), &parseError);
    if (!parseError.empty() || !j.isObject())
        return fail("project.json is malformed: " + parseError);

    root_ = fs::normalize(fs::absolute(rootDir));
    name_ = j["name"].asString(fs::filename(root_));
    engineVersion = j["engineVersion"].asString("0.1.0");
    startScene_ = j["startScene"].asString("Assets/Scenes/Main.nfscene.json");
    settings.extra = j["extra"];

    const Json& r = j["render"];
    renderSettingsFromJson(r, settings.render);
    const Json& ph = j["physics"];
    settings.physics.gravity = vec3From(ph["gravity"], settings.physics.gravity);
    settings.physics.fixedTimestep = ph["fixedTimestep"].asFloat(settings.physics.fixedTimestep);
    settings.physics.maxSubSteps = ph["maxSubSteps"].asInt(settings.physics.maxSubSteps);
    settings.physics.enableCcd = ph["ccd"].asBool(settings.physics.enableCcd);

    const Json& b = j["build"];
    settings.build.gameName = b["gameName"].asString(name_ + "Game");
    settings.build.executableName = b["executableName"].asString(settings.build.gameName + ".exe");
    settings.build.icon = b["icon"].asString("");
    settings.build.copyAssets = b["copyAssets"].asBool(true);
    settings.build.createZip = b["createZip"].asBool(false);
    settings.build.windowed = b["windowed"].asBool(true);
    settings.build.windowWidth = b["windowWidth"].asInt(1280);
    settings.build.windowHeight = b["windowHeight"].asInt(720);
    settings.build.fullscreen = b["fullscreen"].asBool(false);

    const Json& ai = j["ai"];
    settings.ai.provider = ai["provider"].asString(settings.ai.provider);
    settings.ai.model = ai["model"].asString(settings.ai.model);
    settings.ai.endpoint = ai["endpoint"].asString(settings.ai.endpoint);
    settings.ai.apiKeyEnv = ai["apiKeyEnv"].asString(settings.ai.apiKeyEnv);
    settings.ai.allowFileWrites = ai["allowFileWrites"].asBool(true);
    settings.ai.confirmDestructive = ai["confirmDestructive"].asBool(true);
    settings.ai.maxTokens = ai["maxTokens"].asInt(1200);

    settings.inputActions = j.has("input") ? inputActionsFromJson(j["input"])
                                           : defaultInputActions();
    recentScenes.clear();
    for (const Json& s : j["recentScenes"].items()) recentScenes.push_back(s.asString());

    AssetLibrary::get().setProjectRoot(root_);
    AssetLibrary::get().ensureStandardFolders();
    AssetLibrary::get().rescan();
    for (const char* dir : {"Settings", "Logs", "Builds", "Project"})
        fs::createDirectories(fs::join(root_, dir));

    open_ = true;
    NF_LOG_INFO("Project", "opened '%s' (%s assets)", name_.c_str(),
                std::to_string(AssetLibrary::get().assets().size()).c_str());
    return true;
}

bool Project::save(std::string* error) const {
    if (!open_) {
        if (error) *error = "no project is open";
        return false;
    }
    Json j = Json::object();
    j.set("format", "NovaForgeProject");
    j.set("version", 1);
    j.set("name", name_);
    j.set("engineVersion", engineVersion);
    j.set("savedUtc", nowIso());
    j.set("startScene", startScene_);
    j.set("render", renderSettingsToJson(settings.render));
    Json ph = Json::object();
    ph.set("gravity", vec3Json(settings.physics.gravity));
    ph.set("fixedTimestep", settings.physics.fixedTimestep);
    ph.set("maxSubSteps", settings.physics.maxSubSteps);
    ph.set("ccd", settings.physics.enableCcd);
    j.set("physics", ph);
    Json b = Json::object();
    b.set("gameName", settings.build.gameName.empty() ? name_ : settings.build.gameName);
    b.set("executableName",
          settings.build.executableName.empty() ? name_ + ".exe" : settings.build.executableName);
    b.set("icon", settings.build.icon);
    b.set("copyAssets", settings.build.copyAssets);
    b.set("createZip", settings.build.createZip);
    b.set("windowed", settings.build.windowed);
    b.set("windowWidth", settings.build.windowWidth);
    b.set("windowHeight", settings.build.windowHeight);
    b.set("fullscreen", settings.build.fullscreen);
    j.set("build", b);
    Json ai = Json::object();
    ai.set("provider", settings.ai.provider);
    ai.set("model", settings.ai.model);
    ai.set("endpoint", settings.ai.endpoint);
    ai.set("apiKeyEnv", settings.ai.apiKeyEnv);
    ai.set("allowFileWrites", settings.ai.allowFileWrites);
    ai.set("confirmDestructive", settings.ai.confirmDestructive);
    ai.set("maxTokens", settings.ai.maxTokens);
    j.set("ai", ai);
    j.set("input", inputActionsToJson(settings.inputActions));
    Json recent = Json::array();
    for (const std::string& s : recentScenes) recent.push(s);
    j.set("recentScenes", recent);
    if (!settings.extra.isNull()) j.set("extra", settings.extra);

    std::string path = fs::join(root_, manifestRelativePath());
    fs::createDirectories(fs::parent(path));
    if (!j.saveFile(path, 2)) {
        if (error) *error = "cannot write " + path;
        return false;
    }
    return true;
}

void Project::close() {
    open_ = false;
    root_.clear();
    name_ = "Untitled";
    AssetLibrary::get().clearCaches();
    AssetLibrary::get().setProjectRoot("");
}

// -------------------------------------------------------------------- paths
std::string Project::assetPath(const std::string& relative) const {
    if (relative.empty()) return fs::join(root_, "Assets");
    if (relative.rfind("Assets/", 0) == 0) return fs::join(root_, relative);
    return fs::join(fs::join(root_, "Assets"), relative);
}

std::string Project::path(const std::string& relative) const {
    if (relative.empty()) return root_;
    if (fs::isAbsolute(relative)) return fs::normalize(relative);
    return fs::normalize(fs::join(root_, relative));
}

std::string Project::relative(const std::string& absolutePath) const {
    std::string rel = fs::relativeTo(absolutePath, root_);
    return rel;
}

// ------------------------------------------------------------------- scenes
std::vector<std::string> Project::listScenes() const {
    std::vector<std::string> out;
    if (!open_) return out;
    std::vector<fs::DirEntry> entries = fs::listDirectoryExt(path("Assets"), {".json"}, true);
    for (const fs::DirEntry& e : entries) {
        if (e.name.size() > 9 && e.name.find(".nfscene.") != std::string::npos)
            out.push_back(relative(e.path));
    }
    std::sort(out.begin(), out.end());
    return out;
}

void Project::setStartScene(const std::string& projectRelative) {
    startScene_ = fs::isAbsolute(projectRelative) ? relative(projectRelative) : projectRelative;
}

std::string Project::createScene(const std::string& sceneName, std::string* error) {
    if (!open_) {
        if (error) *error = "no project is open";
        return "";
    }
    Scene scene;
    scene.name = sceneName.empty() ? "Untitled" : sceneName;
    // A usable default scene: a sun and a camera looking at the origin.
    EntityId camera = scene.createEntity("Main Camera");
    scene.get(camera)->camera = CameraComponent();
    scene.get(camera)->camera->isActive = true;
    scene.get(camera)->transform.position = Vec3(0, 3, -8);
    scene.get(camera)->transform.setEulerDegrees(Vec3(-12, 0, 0));

    EntityId sun = scene.createEntity("Sun");
    scene.get(sun)->light = LightComponent();
    scene.get(sun)->light->type = LightType::Directional;
    scene.get(sun)->light->intensity = 1.4f;
    scene.get(sun)->light->castShadow = true;
    scene.get(sun)->transform.setEulerDegrees(Vec3(-30, 25, 0));

    std::string rel = fs::join(scenesDir(), sceneName + ".nfscene.json");
    if (!saveScene(scene, rel, error)) return "";
    if (!fs::exists(path(startScene_))) setStartScene(rel);
    recentScenes.insert(recentScenes.begin(), rel);
    return rel;
}

bool Project::saveScene(const Scene& scene, const std::string& projectRelative,
                        std::string* error) const {
    if (!open_) {
        if (error) *error = "no project is open";
        return false;
    }
    std::string abs = path(projectRelative);
    fs::createDirectories(fs::parent(abs));
    if (!scene.save(abs)) {
        if (error) *error = "cannot write scene " + abs;
        return false;
    }
    noteModified(projectRelative);
    return true;
}

bool Project::loadScene(Scene& scene, const std::string& projectRelative, std::string* error) const {
    if (!open_) {
        if (error) *error = "no project is open";
        return false;
    }
    std::string abs = path(projectRelative);
    if (!fs::exists(abs)) {
        if (error) *error = "scene not found: " + projectRelative;
        return false;
    }
    std::string loadError;
    if (!scene.load(abs, &loadError)) {
        if (error) *error = loadError;
        return false;
    }
    scene.path = projectRelative;
    return true;
}

// -------------------------------------------------------------------- files
std::string Project::readTextFile(const std::string& projectRelative, bool* ok) const {
    std::string abs = path(projectRelative);
    bool exists = fs::exists(abs);
    if (ok) *ok = exists;
    return exists ? fs::readText(abs) : std::string();
}

bool Project::writeTextFile(const std::string& projectRelative, const std::string& contents,
                            std::string* error) const {
    if (!open_) {
        if (error) *error = "no project is open";
        return false;
    }
    std::string abs = path(projectRelative);
    fs::createDirectories(fs::parent(abs));
    if (!fs::writeText(abs, contents)) {
        if (error) *error = "cannot write " + abs;
        return false;
    }
    noteModified(projectRelative);
    return true;
}

Json Project::readJson(const std::string& projectRelative, bool* ok) const {
    bool exists = fs::exists(path(projectRelative));
    if (ok) *ok = exists;
    if (!exists) return Json();
    std::string err;
    return Json::parse(readTextFile(projectRelative), &err);
}

bool Project::writeJson(const std::string& projectRelative, const Json& json,
                        std::string* error) const {
    return writeTextFile(projectRelative, json.dump(2) + "\n", error);
}

bool Project::deleteFile(const std::string& projectRelative) const {
    return fs::removeFile(path(projectRelative));
}

std::vector<std::string> Project::listFiles(const std::string& projectRelativeDir,
                                            const std::string& extension) const {
    std::vector<std::string> out;
    std::string abs = path(projectRelativeDir);
    if (!fs::isDirectory(abs)) return out;
    for (const fs::DirEntry& e : fs::listDirectory(abs, false)) {
        if (e.directory) continue;
        if (!extension.empty() && fs::extension(e.name) != extension) continue;
        out.push_back(relative(e.path));
    }
    std::sort(out.begin(), out.end());
    return out;
}

}  // namespace nf
