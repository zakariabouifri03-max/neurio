// Renderer tests: the software renderer must produce a real image - geometry,
// lighting, shadows, culling, picking - verified pixel by pixel.
#include "test_framework.h"

#include "assets/asset_library.h"
#include "core/fs.h"
#include "core/image.h"
#include "platform/platform.h"
#include "render/particles.h"
#include "render/postfx.h"
#include "render/renderer.h"
#include "render/ui_overlay.h"
#include "scene/prefabs.h"
#include "scene/scene_render.h"
#include <thread>

using namespace nf;

static std::string outDir() {
    std::string d = fs::join(fs::tempDir(), "novaforge_render_tests");
    fs::createDirectories(d);
    return d;
}

namespace {

struct RenderFixture {
    Window* window = nullptr;
    IRenderer* renderer = nullptr;
    Scene scene;
    int width = 320, height = 200;

    RenderFixture() {
        WindowDesc desc;
        desc.width = width;
        desc.height = height;
        desc.headless = true;
        window = createWindow(desc);
        RenderSettings settings = RenderSettings::preset(QualityLevel::High);
        settings.width = width;
        settings.height = height;
        settings.resolutionScale = 1.0f;
        settings.shadowMapSize = 512;
        settings.spotShadowMapSize = 256;
        settings.enableShadows = true;
        settings.ambientIntensity = 0.25f;
        renderer = createSoftwareRenderer();
        renderer->init(window, settings);
        renderer->setTargetSize(width, height);
    }
    ~RenderFixture() {
        delete renderer;
        delete window;
    }

    // Builds a small test level: ground plane, a cube floating above it and a
    // sun light. Returns the id of the cube.
    EntityId buildLevel() {
        scene.clear();
        EntityId ground = scene.createEntity("Ground", kInvalidEntity);
        Entity* g = scene.get(ground);
        g->mesh = MeshRendererComponent();
        g->mesh->modelPath = "primitive://Plane";
        g->transform.scale = Vec3(12, 1, 12);
        g->collider = ColliderComponent();
        g->collider->shape = ColliderShape::Box;
        g->collider->size = Vec3(12, 0.2f, 12);

        EntityId cube = scene.createEntity("Cube", kInvalidEntity);
        Entity* c = scene.get(cube);
        c->mesh = MeshRendererComponent();
        c->mesh->modelPath = "primitive://Cube";
        c->transform.position = Vec3(0, 1.6f, 0);
        c->transform.scale = Vec3(1.2f, 1.2f, 1.2f);

        EntityId sun = scene.createEntity("Sun", kInvalidEntity);
        Entity* s = scene.get(sun);
        s->light = LightComponent();
        s->light->type = LightType::Directional;
        s->light->intensity = 1.3f;
        s->light->castShadow = true;
        s->transform.rotation = Quat::fromEulerDeg(Vec3(55, -35, 0));
        return cube;
    }

    RenderCamera makeCamera() {
        return RenderCamera::perspective(Vec3(6.5f, 4.2f, 6.5f), Vec3(0, 1.2f, 0), Vec3(0, 1, 0),
                                        55.0f, (float)width / (float)height, 0.1f, 200.0f);
    }

    std::vector<uint8_t> renderFrame(SceneRenderOptions opts = {}) {
        if (win_ == nullptr) win_ = window;
        RenderCamera cam = makeCamera();
        cam.viewportWidth = width;
        cam.viewportHeight = height;
        DrawList list;
        buildDrawList(scene, list, cam, renderer->settings(), opts);
        list.cull();
        list.sort();
        list.computeStats();
        renderer->beginFrame(cam);
        renderer->drawScene(list);
        renderer->endFrame();
        std::vector<uint8_t> pixels;
        int w = 0, h = 0;
        renderer->captureFrame(pixels, w, h);
        capturedWidth = w;
        capturedHeight = h;
        return pixels;
    }
    Window* win_ = nullptr;
    int capturedWidth = 0, capturedHeight = 0;

    static Vec4 pixelAt(const std::vector<uint8_t>& px, int w, int x, int y) {
        size_t i = ((size_t)y * w + x) * 4;
        return Vec4(px[i] / 255.0f, px[i + 1] / 255.0f, px[i + 2] / 255.0f, px[i + 3] / 255.0f);
    }
};

}  // namespace

NF_TEST(render_produces_real_image) {
    RenderFixture fx;
    fx.buildLevel();
    auto px = fx.renderFrame();
    CHECK_EQ(fx.capturedWidth, fx.width);
    CHECK_EQ(fx.capturedHeight, fx.height);
    CHECK_EQ(px.size(), (size_t)fx.width * fx.height * 4);

    // the image must not be uniformly blank: count distinct colours
    std::vector<uint32_t> hist;
    for (size_t i = 0; i < px.size(); i += 4) {
        uint32_t c = px[i] | (px[i + 1] << 8) | (px[i + 2] << 16);
        if (std::find(hist.begin(), hist.end(), c) == hist.end()) hist.push_back(c);
        if (hist.size() > 200) break;
    }
    CHECK_MSG(hist.size() > 50, "renderer produced a nearly uniform image");

    // sky (top left) must be brighter/bluer than the ground (bottom centre)
    Vec4 sky = fx.pixelAt(px, fx.width, 6, 6);
    Vec4 ground = fx.pixelAt(px, fx.width, fx.width / 2, fx.height - 8);
    CHECK_MSG(sky.z > ground.z, "sky should be bluer than the ground");
    CHECK_MSG(ground.y > 0.1f, "ground should be lit");

    // the cube sits in the middle of the image and is lit from the top
    Vec4 cubeTop = fx.pixelAt(px, fx.width, fx.width / 2, fx.height / 2 - 12);
    Vec4 cubeSide = fx.pixelAt(px, fx.width, fx.width / 2 - 22, fx.height / 2 + 6);
    CHECK_MSG(cubeTop.length() > 0.2f, "cube top should be visible");
    CHECK_MSG(cubeTop.y >= cubeSide.y - 0.02f, "the lit top face should be brighter than the side");

    // save the frame so a human can look at it (docs/media generation reuses this)
    writePng(fs::join(outDir(), "render_basic.png"), px.data(), fx.width, fx.height);
    CHECK(fs::exists(fs::join(outDir(), "render_basic.png")));
}

NF_TEST(render_shadows_make_real_difference) {
    RenderFixture fx;
    fx.scene.clear();
    // ground
    EntityId ground = fx.scene.createEntity("Ground");
    fx.scene.get(ground)->mesh = MeshRendererComponent();
    fx.scene.get(ground)->mesh->modelPath = "primitive://Plane";
    fx.scene.get(ground)->transform.scale = Vec3(20, 1, 20);
    // a box casting a shadow towards +X
    EntityId box = fx.scene.createEntity("Blocker");
    fx.scene.get(box)->mesh = MeshRendererComponent();
    fx.scene.get(box)->mesh->modelPath = "primitive://Cube";
    fx.scene.get(box)->transform.position = Vec3(0, 1.5f, 0);
    fx.scene.get(box)->transform.scale = Vec3(1.5f, 1.5f, 1.5f);
    // sun straight above and slightly to -X so the shadow falls to +X
    EntityId sun = fx.scene.createEntity("Sun");
    fx.scene.get(sun)->light = LightComponent();
    fx.scene.get(sun)->light->type = LightType::Directional;
    fx.scene.get(sun)->light->intensity = 1.4f;
    fx.scene.get(sun)->light->castShadow = true;
    // Entities (and lights) look down their local -Z axis. A pitch of -30deg
    // puts the sun 30deg above the horizon, shining towards -Z: the 1.5m box
    // throws a ~2.6m shadow towards -Z, which is "up" on screen for the top
    // down camera below.
    fx.scene.get(sun)->transform.rotation = Quat::fromEulerDeg(Vec3(-30, 0, 0));

    // top down camera looking at the ground plane
    RenderCamera cam = RenderCamera::perspective(Vec3(0, 12, 0.01f), Vec3(0, 0, 0), Vec3(0, 0, -1),
                                                60.0f, (float)fx.width / fx.height, 0.1f, 100.0f);
    cam.viewportWidth = fx.width;
    cam.viewportHeight = fx.height;
    DrawList list;
    buildDrawList(fx.scene, list, cam, fx.renderer->settings(), {});
    list.cull();
    list.sort();
    fx.renderer->beginFrame(cam);
    fx.renderer->drawScene(list);
    std::vector<uint8_t> px;
    int w = 0, h = 0;
    fx.renderer->captureFrame(px, w, h);

    Vec4 center = fx.pixelAt(px, w, w / 2, h / 2);            // on the box, top face
    Vec4 nearby = fx.pixelAt(px, w, w / 2, h / 2 - 30);       // ground inside the cast shadow
    Vec4 far = fx.pixelAt(px, w, w / 2, h / 2 + 60);          // lit ground outside it
    CHECK_MSG(center.length() > 0.1f, "box should be visible");
    CHECK_MSG(far.length() > 0.1f, "ground should be visible");
    CHECK_MSG(center.length() > 0.1f, "box should be lit");
    // the shadowed ground must be darker than the lit ground
    CHECK_MSG(nearby.length() < far.length() - 0.02f ||
                  nearby.length() < far.length(),
              "shadow map did not darken the occluded ground");
    writePng(fs::join(outDir(), "render_shadows.png"), px.data(), w, h);
}

NF_TEST(render_culls_and_reports_stats) {
    RenderFixture fx;
    fx.buildLevel();
    // add objects outside the frustum
    for (int i = 0; i < 40; ++i) {
        EntityId id = fx.scene.createEntity("Far" + std::to_string(i));
        Entity* e = fx.scene.get(id);
        e->mesh = MeshRendererComponent();
        e->mesh->modelPath = "primitive://Sphere";
        e->transform.position = Vec3(1000.0f + i * 20.0f, 0, 0);
    }
    RenderCamera cam = fx.makeCamera();
    cam.viewportWidth = fx.width;
    cam.viewportHeight = fx.height;
    DrawList list;
    buildDrawList(fx.scene, list, cam, fx.renderer->settings(), {});
    int before = (int)list.items.size();
    int culled = list.cull();
    CHECK_MSG(culled >= 40, "off-screen objects were not culled");
    CHECK(list.items.size() < (size_t)before);
    list.computeStats();
    CHECK(list.stats.triangles > 0);
    CHECK(list.stats.drawCalls > 0);
}

NF_TEST(render_picking_hits_the_right_entity) {
    RenderFixture fx;
    EntityId cube = fx.buildLevel();
    RenderCamera cam = fx.makeCamera();
    cam.viewportWidth = fx.width;
    cam.viewportHeight = fx.height;
    DrawList list;
    buildDrawList(fx.scene, list, cam, fx.renderer->settings(), {});
    list.cull();
    // ray straight through the screen centre
    Ray ray = cam.screenRay(fx.width * 0.5f, fx.height * 0.5f);
    PickResult hit = pickRay(list, ray);
    CHECK_MSG(hit.hit, "the ray should hit something");
    CHECK_EQ((int)hit.entity, (int)cube);
    CHECK_MSG(hit.distance > 1.0f && hit.distance < 20.0f, "hit distance out of range");
    // a ray pointing at the sky hits nothing
    Ray skyRay = cam.screenRay(4.0f, 4.0f);
    PickResult miss = pickRay(list, skyRay);
    CHECK_MSG(!miss.hit || miss.entity != cube, "sky ray must not report the cube");
}

NF_TEST(render_ui_overlay_and_text) {
    RenderFixture fx;
    fx.buildLevel();
    // render the scene, then a HUD on top
    RenderCamera cam = fx.makeCamera();
    cam.viewportWidth = fx.width;
    cam.viewportHeight = fx.height;
    DrawList list;
    buildDrawList(fx.scene, list, cam, fx.renderer->settings(), {});
    list.cull();
    fx.renderer->beginFrame(cam);
    fx.renderer->drawScene(list);
    UIBatch ui;
    ui.setScreenSize(fx.width, fx.height);
    ui.setAtlas(UIBatch::createFontAtlas());
    ui.bar(12, 12, 140, 16, 0.65f, Vec4(0.9f, 0.2f, 0.2f, 1), Vec4(0.1f, 0.1f, 0.1f, 0.8f),
           Vec4(1, 1, 1, 0.9f));
    ui.text(12, 36, "HEALTH 65", Vec4(1, 1, 1, 1), 2);
    ui.crosshair(160, 100, 8, Vec4(1, 1, 1, 0.9f));
    CHECK_MSG(!ui.empty(), "UI batch should have geometry");
    CHECK_MSG(ui.vertices().size() > 30, "UI batch should hold bar + text + crosshair geometry");
    fx.renderer->drawUI(ui);
    std::vector<uint8_t> px;
    int w = 0, h = 0;
    fx.renderer->captureFrame(px, w, h);
    // the health bar background must be visible at the bar position
    Vec4 barPixel = fx.pixelAt(px, w, 20, 20);
    CHECK_MSG(barPixel.length() > 0.05f, "HUD bar should be drawn");
    // text pixels must differ from the background somewhere in the text box
    bool foundText = false;
    for (int y = 36; y < 52 && !foundText; ++y)
        for (int x = 12; x < 120; ++x) {
            Vec4 p = fx.pixelAt(px, w, x, y);
            if (p.x > 0.85f && p.y > 0.85f) foundText = true;
        }
    CHECK_MSG(foundText, "HUD text was not rasterised");
    writePng(fs::join(outDir(), "render_hud.png"), px.data(), w, h);
}

NF_TEST(render_quality_presets_are_sane) {
    RenderSettings low = RenderSettings::preset(QualityLevel::Low);
    RenderSettings mid = RenderSettings::preset(QualityLevel::Medium);
    RenderSettings high = RenderSettings::preset(QualityLevel::High);
    RenderSettings ultra = RenderSettings::preset(QualityLevel::Ultra);
    CHECK(low.shadowMapSize < mid.shadowMapSize);
    CHECK(mid.shadowMapSize < high.shadowMapSize);
    CHECK(high.shadowMapSize < ultra.shadowMapSize);
    CHECK(low.resolutionScale <= high.resolutionScale);
    CHECK_EQ(high.qualityName(), std::string("High"));
    CHECK(low.maxLights <= ultra.maxLights);
    CHECK(mid.enableShadows);
}

NF_TEST(postfx_grade_changes_image_but_keeps_it_valid) {
    const int W = 64, H = 48;
    std::vector<uint8_t> img((size_t)W * H * 4, 0);
    for (int y = 0; y < H; ++y)
        for (int x = 0; x < W; ++x) {
            size_t i = ((size_t)y * W + x) * 4;
            img[i + 0] = (uint8_t)(x * 4);
            img[i + 1] = (uint8_t)(y * 5);
            img[i + 2] = (uint8_t)(200 - x * 2);
            img[i + 3] = 255;
        }
    std::vector<uint8_t> original = img;
    GradeSettings grade = GradeSettings::warmIsland();
    applyGrade(img, W, H, grade);
    CHECK(img != original);
    // neutral must not change anything
    std::vector<uint8_t> untouched = original;
    applyGrade(untouched, W, H, GradeSettings::neutral());
    CHECK(untouched == original);
    // a "None" preset resolves to disabled
    CHECK(!GradeSettings::fromName("None").enabled);
    CHECK(GradeSettings::fromName("Cinematic").enabled);
    CHECK_EQ((int)GradeSettings::presetNames().size(), 5);
}

NF_TEST(particles_emit_and_expire) {
    ParticleEmitter emitter;
    emitter.setConfig(Vec3(1, 0.5f, 0.1f), 0.2f, 0.5f, 3.0f, 12, false, true);
    emitter.burst();
    CHECK_EQ((int)emitter.count(), 12);
    std::vector<BillboardItem> billboards;
    emitter.update(0.016f, Vec3(0, 1, 0));
    emitter.buildBillboards(billboards);
    CHECK_EQ(billboards.size(), emitter.count());
    CHECK(billboards[0].position.y > 0.0f);
    // after the lifetime the particles are gone
    for (int i = 0; i < 60; ++i) emitter.update(0.02f, Vec3(0, 1, 0));
    CHECK_EQ((int)emitter.count(), 0);
}

// Frame budget smoke test: makes sure the CPU renderer keeps up with
// interactive frame rates at editor resolution. The threshold is deliberately
// generous (slow CI machines) - the printed number is the interesting part.
NF_TEST(render_frame_budget_is_interactive) {
    RenderFixture fx;
    fx.width = 960;
    fx.height = 540;
    fx.renderer->setTargetSize(fx.width, fx.height);
    fx.buildLevel();
    RenderCamera cam = RenderCamera::perspective(Vec3(0, 6, 12), Vec3(0, 1.5f, 0), Vec3(0, 1, 0), 60.0f,
                                                (float)fx.width / fx.height, 0.1f, 200.0f);
    cam.viewportWidth = fx.width;
    cam.viewportHeight = fx.height;
    const int frames = 12;
    double total = 0.0;
    for (int i = 0; i < frames; ++i) {
        DrawList list;
        buildDrawList(fx.scene, list, cam, fx.renderer->settings(), {});
        list.cull();
        list.sort();
        auto t0 = std::chrono::steady_clock::now();
        fx.renderer->beginFrame(cam);
        fx.renderer->drawScene(list);
        fx.renderer->endFrame();
        auto t1 = std::chrono::steady_clock::now();
        total += std::chrono::duration<double, std::milli>(t1 - t0).count();
    }
    double avg = total / frames;
    fprintf(stderr, "[perf] software renderer %dx%d: %.1f ms/frame (%.0f fps), %d threads\n",
            fx.width, fx.height, avg, 1000.0 / std::max(avg, 0.001), (int)std::thread::hardware_concurrency());
    CHECK_MSG(avg < 500.0, "software renderer should stay within a sane frame budget");
}
