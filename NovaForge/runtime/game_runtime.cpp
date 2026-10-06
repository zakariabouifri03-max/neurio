// NovaForge Engine - standalone game runtime implementation
#include "runtime/game_runtime.h"

#include "core/fs.h"
#include "core/image.h"
#include "core/log.h"

#include <algorithm>
#include <cstring>

namespace nf {

namespace {

std::string jsonString(const Json& j, const std::string& key, const std::string& fallback = "") {
    return j.has(key) ? j[key].asString(fallback) : fallback;
}

}  // namespace

bool GameRuntime::resolveStartup(const RuntimeOptions& options, StartupInfo* out,
                                 std::string* error) {
    std::string exeDir = fs::executableDir();
    auto fail = [&](const std::string& msg) {
        if (error) *error = msg;
        return false;
    };
    out->scenePath = options.scenePath;

    // 1. an explicit --project wins
    if (!options.projectDir.empty()) {
        if (!fs::isDirectory(options.projectDir))
            return fail("project folder not found: " + options.projectDir);
        out->projectDir = fs::absolute(options.projectDir);
        out->source = "--project";
    } else {
        // 2. a game export: game.json / Project next to the executable
        const std::string gameJson = fs::join(exeDir, "game.json");
        const std::string localManifest = fs::join(exeDir, Project::manifestRelativePath());
        if (fs::exists(gameJson) || fs::exists(localManifest)) {
            out->projectDir = exeDir;
            out->source = fs::exists(gameJson) ? "game.json" : "project folder";
            if (fs::exists(gameJson)) {
                std::string text = fs::readText(gameJson);
                std::string parseError;
                Json j = Json::parse(text, &parseError);
                if (parseError.empty() && j.isObject()) {
                    out->gameName = jsonString(j, "gameName", fs::stem(fs::filename(exeDir)));
                    if (out->scenePath.empty()) out->scenePath = jsonString(j, "startScene");
                    out->executable = jsonString(j, "executable", fs::filename(fs::executablePath()));
                    out->builtUtc = jsonString(j, "builtUtc");
                    if (out->source == "game.json") {
                        // exported games carry their window/quality settings here
                        // (the values are applied by createOptions below)
                    }
                }
            }
        } else {
            // 3. the current working directory
            const std::string cwdManifest = fs::join(fs::currentDir(), Project::manifestRelativePath());
            if (fs::exists(cwdManifest)) {
                out->projectDir = fs::currentDir();
                out->source = "working directory";
            } else {
                return fail(
                    "no NovaForge project found.\n\n"
                    "This is the NovaForge game runtime. It looks for a game export\n"
                    "(game.json + Project/project.json + Assets/) next to the executable,\n"
                    "or for a project folder passed with --project <folder>.\n\n"
                    "If you want the editor, run NovaForge.exe instead.");
            }
        }
    }
    if (out->gameName.empty()) out->gameName = fs::filename(out->projectDir);
    return true;
}

bool GameRuntime::init(const RuntimeOptions& options, std::string* error) {
    options_ = options;
    if (!resolveStartup(options_, &startup_, error)) {
        lastError_ = error && !error->empty() ? *error : "runtime startup failed";
        return false;
    }

    // Everything the runtime does is also written next to the game, so a
    // problem on a player's machine is diagnosable without a debugger:
    //   <game folder>/Logs/runtime.log
    const std::string logDir = fs::join(startup_.projectDir, "Logs");
    fs::createDirectories(logDir);
    Log::get().setLogFile(fs::join(logDir, "runtime.log"));

    EngineConfig cfg;
    cfg.window.title = options_.title.empty() ? startup_.gameName : options_.title;
    cfg.window.width = options_.width;
    cfg.window.height = options_.height;
    cfg.window.headless = options_.headless;
    cfg.window.resizable = true;
    cfg.enableAudio = options_.enableAudio;
    cfg.enableScripts = options_.enableScripts;
    cfg.projectRoot = startup_.projectDir;
    cfg.startScene = startup_.scenePath;
    cfg.render = RenderSettings::preset(QualityLevel::High);
    if (!engine_.init(cfg, error)) {
        lastError_ = error ? *error : "engine init failed";
        return false;
    }
    // exported games may carry window/quality overrides in game.json
    const std::string gameJson = fs::join(startup_.projectDir, "game.json");
    if (fs::exists(gameJson)) {
        std::string text = fs::readText(gameJson);
        std::string parseError;
        Json j = Json::parse(text, &parseError);
        if (parseError.empty() && j.isObject()) {
            EngineConfig applied = engine_.config();
            applied.window.width = j["windowWidth"].asInt(applied.window.width);
            applied.window.height = j["windowHeight"].asInt(applied.window.height);
            const bool fullscreen = j["fullscreen"].asBool(false);
            (void)fullscreen;
            RenderSettings rs = applied.render;
            const std::string quality = j["quality"].asString(rs.qualityName());
            if (quality == "Low") rs = RenderSettings::preset(QualityLevel::Low);
            else if (quality == "Medium") rs = RenderSettings::preset(QualityLevel::Medium);
            else if (quality == "High") rs = RenderSettings::preset(QualityLevel::High);
            else if (quality == "Ultra") rs = RenderSettings::preset(QualityLevel::Ultra);
            rs.resolutionScale = j["resolutionScale"].asFloat(rs.resolutionScale);
            rs.vsync = j["vsync"].asBool(rs.vsync);
            applied.render = rs;
            if (Window* w = engine_.window())
                if (applied.window.width > 0 && applied.window.height > 0 &&
                    (applied.window.width != w->width() || applied.window.height != w->height()))
                    w->resize(applied.window.width, applied.window.height);
            engine_.renderer()->setSettings(rs);
        }
    }
    if (engine_.scenePath().empty() && !startup_.scenePath.empty())
        engine_.loadScene(startup_.scenePath, error);

    if (!engine_.play(error)) {
        NF_LOG_ERROR("Runtime", "cannot start the game: %s", error ? error->c_str() : "?");
        return false;
    }
    engine_.window()->setCursorCaptured(true);

    NF_LOG_INFO("Runtime", "%s - %s (%s)", startup_.gameName.c_str(), startup_.projectDir.c_str(),
                startup_.source.c_str());
    initialised_ = true;
    return true;
}

void GameRuntime::shutdown() {
    if (initialised_) {
        engine_.stop();
        engine_.shutdown();
        initialised_ = false;
    }
}

void GameRuntime::handleGlobalKeys(float dt) {
    InputState& in = engine_.input();
    (void)in;
    Window* w = engine_.window();
    if (!w) return;
    const InputState& input = w->input();
    if (input.pressed(Key::Escape)) {
        if (paused_) {
            engine_.pause(false);
            paused_ = false;
        } else {
            engine_.pause(true);
            paused_ = true;
        }
    }
    if (input.pressed(Key::F1)) showStats_ = !showStats_;
    if (input.pressed(Key::P)) {
        engine_.pause(!paused_);
        paused_ = !paused_;
    }
    if (input.pressed(Key::F2) && !options_.screenshotPath.empty()) {
        std::vector<uint8_t> rgba;
        int cw = 0, ch = 0;
        if (engine_.renderer()->captureFrame(rgba, cw, ch))
            writePng(options_.screenshotPath, rgba.data(), cw, ch);
    }
    if (input.pressed(Key::F11)) fullscreenRequested_ = !fullscreenRequested_;
    (void)dt;
}

void GameRuntime::drawOverlay(UIBatch& ui, int width, int height) {
    if (!paused_ && !showStats_) return;
    const float scale = std::max(1.0f, height / 720.0f);
    if (showStats_) {
        const FrameStats& s = engine_.stats();
        char buf[256];
        snprintf(buf, sizeof buf, "%.0f fps | %.1f ms | draw %zu | tris %zu | bodies %d | parts %zu",
                 s.fps, s.frameMs, s.drawItems, s.triangles, s.bodies, s.particles);
        ui.text(24 * scale, 48 * scale, buf, Vec4(0.85f, 0.9f, 1.0f, 1.0f), (int)scale);
        snprintf(buf, sizeof buf, "pos %.1f %.1f %.1f  |  %s",
                 engine_.controller().position().x, engine_.controller().position().y,
                 engine_.controller().position().z, engine_.renderer()->name());
        ui.text(24 * scale, 68 * scale, buf, Vec4(0.7f, 0.75f, 0.8f, 1.0f), (int)scale);
    }
    if (paused_) {
        ui.rect(0, 0, (float)width, (float)height, Vec4(0, 0, 0, 0.55f));
        ui.textCentered(width * 0.5f, height * 0.42f, "PAUSED", Vec4(1, 1, 1, 1),
                        (int)std::max(2.0f, scale * 2));
        ui.textCentered(width * 0.5f, height * 0.5f, "Esc resume   -   F1 stats   -   F11 fullscreen",
                        Vec4(0.85f, 0.87f, 0.9f, 1.0f), (int)std::max(1.0f, scale));
    }
}

int GameRuntime::run() {
    if (!initialised_) return 2;
    double last = timeSeconds();
    double start = last;
    while (!engine_.shouldClose()) {
        engine_.pumpEvents();
        if (engine_.shouldClose()) break;
        handleGlobalKeys(0.0f);
        if (fullscreenRequested_) fullscreenRequested_ = false;   // V1: windowed only (F11 hint)
        const double now = timeSeconds();
        float dt = (float)std::min(now - last, 0.1);
        last = now;
        engine_.update(dt);
        RenderCamera cam = engine_.gameCamera(engine_.window()->width(), engine_.window()->height());
        engine_.render(cam, SceneRenderOptions{});
        // runtime-only overlay (pause menu, stats) on top of the game HUD
        {
            UIBatch ui;
            const int w = engine_.window()->width(), h = engine_.window()->height();
            ui.setScreenSize(w, h);
            drawOverlay(ui, w, h);
            if (!ui.empty()) engine_.renderer()->drawUI(ui);
        }
        engine_.present();
        engine_.updateFrameStats(dt);
        if (options_.maxSeconds > 0.0f && (now - start) >= options_.maxSeconds) break;
    }
    shutdown();
    return 0;
}

bool GameRuntime::runHeadless(float seconds) {
    if (!initialised_) return false;
    const float dt = options_.fixedDelta;
    const int steps = std::max(1, (int)(seconds / dt));
    std::string firstError;
    for (int i = 0; i < steps; ++i) {
        engine_.update(dt);
        frameCount_++;
        frameTime_ += dt;
        if (i % 20 == 0) {
            RenderCamera cam = engine_.gameCamera(options_.width, options_.height);
            engine_.render(cam, SceneRenderOptions{});
        }
    }
    // always render a final frame so a screenshot reflects the last state
    RenderCamera cam = engine_.gameCamera(options_.width, options_.height);
    engine_.render(cam, SceneRenderOptions{});
    if (!options_.screenshotPath.empty()) {
        std::vector<uint8_t> rgba;
        int w = 0, h = 0;
        if (engine_.renderer()->captureFrame(rgba, w, h))
            writePng(options_.screenshotPath, rgba.data(), w, h);
    }
    return true;
}

bool parseRuntimeArguments(int argc, char** argv, RuntimeOptions* options) {
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        auto next = [&](std::string* out) {
            if (i + 1 < argc) {
                *out = argv[++i];
                return true;
            }
            return false;
        };
        if (a == "--project" || a == "-p") {
            if (!next(&options->projectDir)) return false;
        } else if (a == "--scene" || a == "-s") {
            if (!next(&options->scenePath)) return false;
        } else if (a == "--screenshot") {
            if (!next(&options->screenshotPath)) return false;
        } else if (a == "--seconds") {
            std::string v;
            if (!next(&v)) return false;
            options->maxSeconds = (float)std::atof(v.c_str());
        } else if (a == "--width") {
            std::string v;
            if (!next(&v)) return false;
            options->width = std::atoi(v.c_str());
        } else if (a == "--height") {
            std::string v;
            if (!next(&v)) return false;
            options->height = std::atoi(v.c_str());
        } else if (a == "--title") {
            if (!next(&options->title)) return false;
        } else if (a == "--headless") {
            options->headless = true;
        } else if (a == "--no-audio") {
            options->enableAudio = false;
        } else if (a == "--no-scripts") {
            options->enableScripts = false;
        } else if (a == "--debug") {
            options->showDebugOverlay = true;
        } else if (a == "--help" || a == "-h") {
            return false;
        }
    }
    return true;
}

}  // namespace nf
